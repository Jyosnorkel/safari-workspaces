import {mkdir, open, readFile, rename, unlink, access} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export class UsageError extends Error {
  constructor(code, message, retryAt = null) {
    super(message); this.name = 'UsageError'; this.code = code; this.retryAt = retryAt;
  }
}
const positive = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new UsageError('invalid_config', `${name} must be a positive integer.`);
  return value;
};
const dayOf = time => new Date(time).toISOString().slice(0, 10);
const nextDay = time => Date.parse(`${dayOf(time)}T00:00:00.000Z`) + 86400000;
const minuteRetry = (attempts, limit) => [...attempts].sort((a,b) => a-b)[attempts.length-limit] + 60000;
const validTime = time => Number.isSafeInteger(time) && time >= 0 && Number.isFinite(new Date(time).getTime());

/** One account, one shared state path, one local machine. Not a distributed limiter. */
export class UsageGuard {
  #busy = false;
  constructor({statePath, perMinute = 2, perDay = 20, timeoutMs = 30000, now = Date.now}) {
    if (typeof statePath !== 'string' || !statePath) throw new UsageError('invalid_config', 'A persistent usage state path is required.');
    this.statePath = statePath; this.lockPath = `${statePath}.lock`;
    this.perMinute = positive(perMinute, 'perMinute'); this.perDay = positive(perDay, 'perDay');
    this.timeoutMs = positive(timeoutMs, 'timeoutMs'); this.now = now;
  }
  #time() {
    const time = this.now();
    if (!validTime(time)) throw new UsageError('clock_error', 'The usage clock is invalid.');
    return time;
  }
  async #read(time) {
    let state;
    try { state = JSON.parse(await readFile(this.statePath, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return {version: 1, day: dayOf(time), daily: 0, attempts: [], lastSeenAt: time};
      throw new UsageError('state_error', 'Usage state is unreadable. Requests are blocked until it is recovered.');
    }
    if (state?.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(state.day) || !Number.isSafeInteger(state.daily) || state.daily < 0 || !Array.isArray(state.attempts) || state.attempts.some(t => !validTime(t)) || !validTime(state.lastSeenAt) || state.day !== dayOf(state.lastSeenAt) || state.attempts.some(t => t > state.lastSeenAt)) {
      throw new UsageError('state_error', 'Usage state is invalid. Requests are blocked until it is recovered.');
    }
    if (time < state.lastSeenAt) throw new UsageError('clock_error', 'The clock moved backwards. Requests remain blocked until it catches up.', state.lastSeenAt);
    return {...state, day: dayOf(time), daily: state.day === dayOf(time) ? state.daily : 0, attempts: state.attempts.filter(t => t > time - 60000)};
  }
  async #write(state) {
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state)); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, this.statePath);
      const directory = await open(dirname(this.statePath), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch {
      throw new UsageError('state_error', 'The usage reservation could not be persisted. No provider call was made.');
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }
  async status() {
    const time = this.#time(); const state = await this.#read(time);
    let locked = this.#busy;
    try { await access(this.lockPath); locked = true; } catch (error) { if (error.code !== 'ENOENT') throw new UsageError('state_error', 'Cannot inspect the usage lock.'); }
    const minuteAt = state.attempts.length >= this.perMinute ? minuteRetry(state.attempts, this.perMinute) : null;
    const dailyAt = state.daily >= this.perDay ? nextDay(time) : null;
    return {
      maxConcurrent: 1, busy: locked, attemptsToday: state.daily,
      remainingToday: Math.max(0, this.perDay-state.daily), remainingThisMinute: Math.max(0, this.perMinute-state.attempts.length),
      perMinute: this.perMinute, perDay: this.perDay, dailyResetAt: nextDay(time),
      retryAt: Math.max(minuteAt || 0, dailyAt || 0) || null, timezone: 'UTC'
    };
  }
  async run(operation) {
    if (typeof operation !== 'function') throw new UsageError('invalid_operation', 'A provider operation is required.');
    if (this.#busy) throw new UsageError('concurrency_limit', 'A model request is already running. No new request was sent.');
    this.#busy = true;
    let lock, handedOff = false;
    const release = async () => {
      try {
        if (lock) { await lock.close(); lock = null; await unlink(this.lockPath); }
      } finally { this.#busy = false; }
    };
    try {
      await mkdir(dirname(this.statePath), {recursive: true, mode: 0o700});
      try { lock = await open(this.lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw new UsageError('concurrency_limit', 'Another request or interrupted service holds the usage lock. No new request was sent.');
        throw new UsageError('state_error', 'Cannot acquire the persistent usage lock.');
      }
      const time = this.#time(), state = await this.#read(time);
      if (state.daily >= this.perDay) throw new UsageError('daily_limit', 'The daily request budget is exhausted. No new request was sent.', nextDay(time));
      if (state.attempts.length >= this.perMinute) throw new UsageError('minute_limit', 'The rolling-minute limit is reached. No new request was sent.', minuteRetry(state.attempts, this.perMinute));
      state.daily++; state.attempts.push(time); state.lastSeenAt = time;
      await this.#write(state); // Attempts, including failures/timeouts, count before any network operation.
      const controller = new AbortController();
      let timer, settled = false;
      const request = Promise.resolve().then(() => operation(controller.signal)).finally(() => { settled = true; });
      try {
        return await Promise.race([request, new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new UsageError('timeout', 'The request timed out and still counts against your budget. It was not retried.'));
          }, this.timeoutMs);
        })]);
      } finally {
        clearTimeout(timer);
        if (!settled) {
          // An adapter might ignore AbortSignal. Retain concurrency ownership until it actually settles.
          handedOff = true;
          void request.catch(() => {}).then(release).catch(() => {});
        }
      }
    } finally { if (!handedOff) await release(); }
  }
}

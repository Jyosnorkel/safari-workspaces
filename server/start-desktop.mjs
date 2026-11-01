// Private parent/child pipe protocol for the macOS app. Never invoke through a shell.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readConnection, createConnection, rePairConnection, resolveStateDirectory} from './connection.mjs';
import {createAIService} from './ai-service.mjs';
import {createMetaProvider} from './meta-provider.mjs';
import {createLoopbackServer} from './loopback.mjs';

export function desktopConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || typeof value.apiKey !== 'string' ||
      typeof value.liveEnabled !== 'boolean' || value.apiKey.length > 8192 ||
      /[\r\n\0]/.test(value.apiKey)) throw new Error('Invalid desktop configuration');
  return {AI_LIVE_ENABLED: String(value.liveEnabled), META_API_KEY: value.apiKey,
    META_API_PROVIDER_ID: 'meta', META_API_MODEL: 'muse-spark-1.3'};
}

// directory/port/provider injection is for isolated fake-provider tests, never CLI flags.
export async function createDesktopService(value, {
  directory = resolveStateDirectory(), port = 8788, provider = createMetaProvider()
} = {}) {
  const env = desktopConfig(value);
  const connectionPath = resolve(directory, 'connection.json');
  let connection;
  try { connection = await readConnection(connectionPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Initial placeholder is never sufficient to authenticate. The extension's
    // first token-authenticated /v1/connect binds the actual browser Origin.
    connection = await createConnection(connectionPath, `safari-web-extension://${randomUUID()}`);
  }
  const service = createAIService({env, provider, statePath: resolve(directory, 'usage.json')});
  // Fail early on corrupt/unreadable accounting, without rewriting/resetting it.
  await service.status();
  const loopback = createLoopbackServer({service, ...connection, port,
    getConnection: () => readConnection(connectionPath),
    updateOrigin: (origin, options) => rePairConnection(connectionPath, origin, options)});
  const address = await loopback.listen();
  return {...loopback, address, token: connection.token, service};
}

export async function runDesktop({input = process.stdin, output = process.stdout, ...options} = {}) {
  let server, ended = false, started = false, bytes = 0, chunks = [];
  const stop = () => {
    ended = true; clearTimeout(timer); input.destroy();
    if (server) {server.close(); server.closeAllConnections();}
  };
  const fail = () => {
    output.write(JSON.stringify({type:'error', code:'startup_failed',
      message:'AI could not start. Check the saved connection and usage files, or stop another local AI service before trying again.'}) + '\n');
    stop(); process.exitCode = 1;
  };
  const timer = setTimeout(fail, 15000);
  output.on('error', stop);
  input.on('end', stop);
  input.on('error', stop);
  const signal = () => stop();
  process.once('SIGTERM', signal); process.once('SIGINT', signal);
  input.on('data', async chunk => {
    if (ended) return;
    // Parent sends one record only, and keeps stdin open as its ownership lease.
    if (started) return fail();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 16384) return fail();
    chunks.push(buffer);
    const joined = Buffer.concat(chunks);
    const newline = joined.indexOf(10);
    if (newline === -1) return;
    clearTimeout(timer); started = true; chunks = [];
    try {
      if (newline !== joined.length - 1) throw new Error('Extra configuration');
      const value = JSON.parse(joined.subarray(0, newline).toString('utf8'));
      const result = await createDesktopService(value, options);
      server = result.server;
      if (ended) {server.close(); server.closeAllConnections(); return;}
      // This token is sent only over the app-owned anonymous pipe, never a log.
      output.write(JSON.stringify({type:'ready', token:result.token}) + '\n');
    } catch { fail(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runDesktop();
}

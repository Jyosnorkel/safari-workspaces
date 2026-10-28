/* A single background coordinator serializes every mutation from every dashboard. */
(() => {
  const api = globalThis.browser;
  const C = WorkspaceCore;
  let queue = Promise.resolve();
  const read = async () => {
    const value = (await api.storage.local.get(C.KEY))[C.KEY];
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace storage is unreadable. No tabs were closed.');
    return value;
  };
  async function write(record) {
    record.updatedAt = new Date().toISOString();
    const all = await read();
    all[record.id] = record;
    await api.storage.local.set({[C.KEY]: all});
    const stored = (await read())[record.id];
    if (JSON.stringify(stored) !== JSON.stringify(record)) throw new Error('Could not verify the saved workspace. Stopping before further tab changes.');
  }
  async function normalWindow(windowId) {
    if (!Number.isInteger(windowId)) throw new Error('Select a normal Safari window first.');
    const win = await api.windows.get(windowId);
    if (win.incognito) throw new Error('Private browsing is excluded from this MVP. Use a normal Safari window.');
    return win;
  }
  async function currentTab(original, windowId) {
    const tab = await api.tabs.get(original.id);
    if (tab.incognito || tab.pinned || tab.windowId !== windowId || tab.url !== original.url) throw new Error('Tab changed, moved, became pinned, or is no longer available. Left open.');
    return tab;
  }
  async function save({name, tabs, windowId, close = false, requestId}) {
    await normalWindow(windowId);
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('Invalid save request.');
    const previous = (await read())[requestId];
    if (previous) return {workspace: previous, repeated: true};
    if (!Array.isArray(tabs) || tabs.length > 500) throw new Error('Invalid tab selection.');
    // Read live tab data instead of trusting stale titles/URLs from the dashboard.
    const live = [];
    for (const original of tabs) live.push(await currentTab(original, windowId));
    live.sort((a, b) => a.index - b.index);
    const record = C.snapshot(name, live, requestId);
    record.close.state = close ? 'closing' : 'not-requested';
    await write(record); // Full snapshot must be persisted AND read back before any close.
    const closedTabIds = [];
    if (close) {
      for (let i = 0; i < live.length; i++) {
        let result;
        try {
          await currentTab(live[i], windowId);
          await api.tabs.remove(live[i].id);
          closedTabIds.push(live[i].id);
          result = {tabId: record.tabs[i].id, state: 'closed'};
        } catch (error) { result = {tabId: record.tabs[i].id, state: 'left-open', error: error.message}; }
        record.close.results.push(result);
        await write(record); // Stop if progress cannot be recorded; original snapshot survives.
      }
      record.close.state = record.close.results.every(r => r.state === 'closed') ? 'closed' : 'partial';
      await write(record);
    }
    return {workspace: record, closedTabIds};
  }
  async function restore({id, windowId, newSessionId, previousSessionId}) {
    await normalWindow(windowId);
    const record = (await read())[id];
    if (!record || record.version !== 1 || !Array.isArray(record.tabs)) throw new Error('Workspace not found or unsupported.');
    if (newSessionId && newSessionId !== record.restore.sessionId) {
      if (!/^[a-f0-9-]{36}$/i.test(newSessionId)) throw new Error('Invalid restore session.');
      if (record.restore.state !== 'complete' || (previousSessionId ?? null) !== (record.restore.sessionId ?? null)) {
        throw new Error('This workspace changed in another manager. Refresh saved workspaces before starting another copy.');
      }
      record.restoreHistory = [...(record.restoreHistory || []), {
        sessionId: record.restore.sessionId || null, completedAt: record.updatedAt,
        openedCount: Object.values(record.restore.results).filter(r => r.state === 'opened').length
      }].slice(-20);
      record.restore = {state: 'not-started', sessionId: newSessionId, results: {}};
    }
    if (record.restore.state === 'complete') return {workspace: record, repeated: true};
    record.restore.sessionId ||= crypto.randomUUID();
    if (Object.values(record.restore.results).some(r => r.state === 'pending')) throw new Error('A previous restore was interrupted. Check Safari for already opened tabs, then resolve the uncertain items before retrying.');
    record.restore.state = 'restoring';
    await write(record);
    for (const tab of record.tabs) {
      if (record.restore.results[tab.id]?.state === 'opened') continue;
      if (!C.restorable(tab.url)) {
        record.restore.results[tab.id] = {state: 'failed', error: 'Unsupported URL scheme'};
        await write(record); continue;
      }
      // A pending journal entry prevents duplicate reopening after a worker interruption.
      record.restore.results[tab.id] = {state: 'pending'};
      await write(record);
      let created;
      try { created = await api.tabs.create({windowId, url: tab.url, active: false}); }
      catch (error) {
        record.restore.results[tab.id] = {state: 'failed', error: error.message};
        await write(record); continue;
      }
      if (!Number.isInteger(created?.id)) throw new Error('Safari did not confirm the new tab. Check the window before resolving the uncertain restore.');
      record.restore.results[tab.id] = {state: 'opened', openedAt: new Date().toISOString()};
      await write(record);
    }
    record.restore.state = Object.values(record.restore.results).every(r => r.state === 'opened') ? 'complete' : 'partial';
    await write(record);
    return {workspace: record};
  }
  async function handle(message) {
    switch (message.type) {
      case 'scan': {
        await normalWindow(message.windowId);
        return {tabs: C.inventory(await api.tabs.query({windowId: message.windowId}))};
      }
      case 'list': return {workspaces: Object.values(await read()).sort((a,b) => b.createdAt.localeCompare(a.createdAt))};
      case 'save': return save(message);
      case 'restore': return restore(message);
      case 'resolve': {
        const record = (await read())[message.id];
        if (!record || !['opened','failed'].includes(message.resolution) || record.restore.results[message.tabId]?.state !== 'pending') throw new Error('No uncertain restore to resolve.');
        record.restore.results[message.tabId] = {state: message.resolution, resolvedAt: new Date().toISOString()};
        record.restore.state = 'partial';
        await write(record); return {workspace: record};
      }
      default: throw new Error('Unknown workspace operation.');
    }
  }
  api.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== api.runtime.id || !sender.url?.startsWith(api.runtime.getURL(''))) return undefined;
    if (message?.channel !== 'workspace') return undefined;
    const result = queue.then(async () => {
      try { return {ok: true, ...await handle(message)}; }
      catch (error) { return {ok: false, error: error.message || 'Operation failed.'}; }
    });
    queue = result.catch(() => {});
    return result;
  });
  // Event pages stay alive while Safari processes messages; no page content is injected.
})();

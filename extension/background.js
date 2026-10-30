/* A single background coordinator serializes every mutation from every dashboard. */
(() => {
  const api = globalThis.browser;
  const C = WorkspaceCore;
  let queue = Promise.resolve();
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  function verifiedRecord(record, id) {
    const invalid = () => { throw new Error('This workspace snapshot or recovery journal is invalid. No tabs were changed. Keep the saved data for recovery.'); };
    if (!object(record) || record.version !== 1 || !uuid(id) || record.id !== id ||
        typeof record.name !== 'string' || !record.name.trim() || record.name.length > 80 ||
        !timestamp(record.createdAt) || !timestamp(record.updatedAt) ||
        !Array.isArray(record.tabs) || !record.tabs.length || record.tabs.length > 500) invalid();
    const ids = new Set();
    let lastIndex = -1;
    for (const tab of record.tabs) {
      if (!object(tab) || !uuid(tab.id) || ids.has(tab.id) || typeof tab.title !== 'string' ||
          typeof tab.url !== 'string' || !C.restorable(tab.url) || !Number.isSafeInteger(tab.index) || tab.index <= lastIndex) invalid();
      ids.add(tab.id); lastIndex = tab.index;
    }
    if (!object(record.close) || !['not-requested','closing','closed','partial'].includes(record.close.state) ||
        !Array.isArray(record.close.results) || !object(record.restore) ||
        !['not-started','restoring','complete','partial'].includes(record.restore.state) ||
        !object(record.restore.results) || (record.restore.sessionId !== undefined && !uuid(record.restore.sessionId))) invalid();
    const closedIds = new Set();
    for (const result of record.close.results) {
      if (!object(result) || !ids.has(result.tabId) || closedIds.has(result.tabId) || !['closed','left-open'].includes(result.state)) invalid();
      closedIds.add(result.tabId);
    }
    for (const [tabId, result] of Object.entries(record.restore.results)) {
      if (!ids.has(tabId) || !object(result) || !['pending','opened','failed'].includes(result.state)) invalid();
    }
    if (record.restore.state === 'complete' && !record.tabs.every(tab => record.restore.results[tab.id]?.state === 'opened')) invalid();
    if (record.restoreHistory !== undefined && (!Array.isArray(record.restoreHistory) || record.restoreHistory.length > 20)) invalid();
    return record;
  }
  const read = async () => {
    const value = (await api.storage.local.get(C.KEY))[C.KEY];
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace storage is unreadable. No tabs were closed.');
    return value;
  };
  // Safari storage may return object properties in a different order. Compare
  // canonical JSON values while retaining array order and every saved field.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])])
    );
    return value;
  }
  async function write(record) {
    record.updatedAt = new Date().toISOString();
    const all = await read();
    all[record.id] = record;
    await api.storage.local.set({[C.KEY]: all});
    const stored = (await read())[record.id];
    if (JSON.stringify(canonical(stored)) !== JSON.stringify(canonical(record))) throw new Error('Could not verify the saved workspace. Stopping before further tab changes.');
  }
  async function normalWindow(windowId) {
    if (!Number.isInteger(windowId)) throw new Error('Select a normal Safari window first.');
    const win = await api.windows.get(windowId);
    if (win.incognito) throw new Error('Private browsing is excluded from this MVP. Use a normal Safari window.');
    if (win.type !== 'normal') throw new Error('Workspace operations require a normal Safari window.');
    return win;
  }
  async function currentTab(original, windowId) {
    const tab = await api.tabs.get(original.id);
    if (tab.incognito || tab.pinned || tab.pendingUrl || tab.windowId !== windowId || tab.url !== original.url) throw new Error('Tab changed, is navigating, moved, became pinned, or is no longer available. Left open.');
    return tab;
  }
  async function save({name, tabs, windowId, close = false, requestId}) {
    await normalWindow(windowId);
    if (!uuid(requestId)) throw new Error('Invalid save request.');
    const previous = (await read())[requestId];
    if (previous) return {workspace: verifiedRecord(previous, requestId), repeated: true};
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
  async function importBackup(json) {
    // Validate the entire file before a single storage mutation; imported journals are discarded.
    const workspaces = C.decodeBackup(json);
    const all = await read();
    const records = workspaces.map(workspace => ({
      version: 1, id: crypto.randomUUID(), name: workspace.name,
      createdAt: workspace.createdAt, updatedAt: new Date().toISOString(),
      tabs: workspace.tabs.map((tab, index) => ({...tab, index, id: crypto.randomUUID()})),
      close: {state: 'not-requested', results: []}, restore: {state: 'not-started', results: {}}
    }));
    for (const record of records) all[record.id] = verifiedRecord(record, record.id);
    await api.storage.local.set({[C.KEY]: all});
    const stored = await read();
    for (const record of records) if (JSON.stringify(canonical(stored[record.id])) !== JSON.stringify(canonical(record))) throw new Error('Backup import could not be verified. Refresh saved workspaces before retrying.');
    return {imported: records.length};
  }
  async function restore({id, windowId, newSessionId, previousSessionId}) {
    await normalWindow(windowId);
    const record = (await read())[id];
    if (!record) throw new Error('Workspace not found or unsupported.');
    verifiedRecord(record, id);
    if (newSessionId && newSessionId !== record.restore.sessionId) {
      if (!uuid(newSessionId)) throw new Error('Invalid restore session.');
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
      case 'snapshot-window': {
        await normalWindow(message.windowId);
        const inventory = C.inventory(await api.tabs.query({windowId: message.windowId}));
        const candidates = inventory.filter(tab => C.restorable(tab.url) && (tab.eligible || tab.pinned));
        // Snapshot-only operation: pinned URLs may be backed up, never passed to close.
        const record = C.snapshot(message.name, candidates.map(tab => ({...tab, pinned: false})), message.requestId);
        const previous = (await read())[record.id];
        if (previous) return {workspace: verifiedRecord(previous, record.id), repeated: true};
        verifiedRecord(record, record.id);
        await write(record);
        return {workspace: record, skipped: inventory.length - candidates.length};
      }
      case 'list': return {workspaces: Object.values(await read()).sort((a,b) => b.createdAt.localeCompare(a.createdAt))};
      case 'save': return save(message);
      case 'import-backup': return importBackup(message.json);
      case 'export-backup': {
        const all = await read();
        const records = message.id ? [verifiedRecord(all[message.id], message.id)] : Object.entries(all).map(([id, record]) => verifiedRecord(record, id));
        return {json: C.encodeBackup(records)};
      }
      case 'restore': return restore(message);
      case 'resolve': {
        const record = (await read())[message.id];
        if (!record) throw new Error('No uncertain restore to resolve.');
        verifiedRecord(record, message.id);
        if (!['opened','failed'].includes(message.resolution) || record.restore.results[message.tabId]?.state !== 'pending') throw new Error('No uncertain restore to resolve.');
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

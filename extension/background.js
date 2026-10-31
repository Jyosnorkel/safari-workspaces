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
        !object(record.restore.results) || (record.restore.sessionId !== undefined && !uuid(record.restore.sessionId)) ||
        (record.restore.windowId !== undefined && (!Number.isSafeInteger(record.restore.windowId) || record.restore.windowId < 0))) invalid();
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
    // Dashboard order is the user’s review order; browser positions remain untouched.
    const record = C.snapshot(name, live.map((tab, index) => ({...tab, index})), requestId);
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
  async function importBackup(json, dropRequestId) {
    // Validate the entire file before a single storage mutation; imported journals are discarded.
    const workspaces = C.decodeBackup(json);
    const all = await read();
    const records = workspaces.map(workspace => ({
      version: 1, id: crypto.randomUUID(), name: workspace.name,
      createdAt: workspace.createdAt, updatedAt: new Date().toISOString(),
      tabs: workspace.tabs.map((tab, index) => ({...tab, index, id: crypto.randomUUID()})),
      close: {state: 'not-requested', results: []}, restore: {state: 'not-started', results: {}},
      ...(dropRequestId ? {dropRequestId} : {})
    }));
    for (const record of records) all[record.id] = verifiedRecord(record, record.id);
    await api.storage.local.set({[C.KEY]: all});
    const stored = await read();
    for (const record of records) if (JSON.stringify(canonical(stored[record.id])) !== JSON.stringify(canonical(record))) throw new Error('Backup import could not be verified. Refresh saved workspaces before retrying.');
    return {imported: records.length, workspaces: records};
  }
  async function dropBackup({json, requestId, windowId}) {
    if (!uuid(requestId)) throw new Error('Invalid backup drop request.');
    await normalWindow(windowId);
    // Decode even on replay: untrusted files are never accepted without full validation.
    C.decodeBackup(json);
    let records = Object.values(await read()).filter(record => record.dropRequestId === requestId);
    if (records.length) {
      for (const record of records) verifiedRecord(record, record.id);
      // Replays never repeat window creation or tab creation. Recovery uses normal restore.
      return {imported: records.length, workspaces: records, windowId: records[0].dropWindow?.id, repeated: true};
    }
    records = (await importBackup(json, requestId)).workspaces;
    const first = records[0];
    first.dropWindow = {state: 'pending'};
    await write(first); // Persist intent before the browser side effect.
    let win;
    try { win = await api.windows.create({type: 'normal', incognito: false, focused: true, url: 'about:blank'}); }
    catch (error) {
      first.dropWindow = {state: 'uncertain'};
      await write(first);
      throw new Error('Snapshots were saved, but Safari did not confirm the new window. Check Safari before restoring saved workspaces.');
    }
    if (!Number.isInteger(win?.id) || win.incognito || win.type !== 'normal') {
      throw new Error('Snapshots were saved, but the new normal window could not be confirmed. Check Safari before restoring.');
    }
    first.dropWindow = {state: 'created', id: win.id};
    // Commit the shared destination for every workspace together before any URL opens.
    const all = await read();
    for (const record of records) {
      record.restore.windowId = win.id;
      record.updatedAt = new Date().toISOString();
      all[record.id] = verifiedRecord(record, record.id);
    }
    await api.storage.local.set({[C.KEY]: all});
    const stored = await read();
    for (const record of records) if (JSON.stringify(canonical(stored[record.id])) !== JSON.stringify(canonical(record))) throw new Error('Snapshots were saved, but the restore window could not be verified. Check Safari before retrying.');
    const restored = [];
    for (const record of records) {
      restored.push((await restore({id: record.id, windowId: win.id})).workspace);
    }
    return {imported: records.length, workspaces: restored, windowId: win.id};
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
  // Live groups describe existing browser tabs; they are not recovery snapshots.
  // Session storage survives event-page suspension without carrying browser tab IDs
  // into the next browser session. Older Safari falls back to local + onStartup reset.
  const LIVE_KEY = 'workspaces.live.v1';
  const liveStorage = api.storage.session || api.storage.local;
  let liveResetFailed = false;
  const safeId = value => Number.isSafeInteger(value) && value >= 0;
  const groupId = value => value === 'ungrouped' || uuid(value);
  function validateLiveGroups(groups) {
    if (!Array.isArray(groups) || groups.length > 100) throw new Error('Invalid live workspace groups.');
    const groupIds = new Set(), tabIds = new Set();
    for (const group of groups) {
      if (!object(group) || !groupId(group.id) || groupIds.has(group.id) || typeof group.name !== 'string' ||
          !group.name.trim() || group.name.length > 80 || (group.reason !== undefined && (typeof group.reason !== 'string' || group.reason.length > 2000)) ||
          !Array.isArray(group.tabs) || group.tabs.length > 500) throw new Error('Invalid live workspace groups.');
      groupIds.add(group.id);
      for (const tab of group.tabs) {
        if (!object(tab) || !safeId(tab.id) || tabIds.has(tab.id) || typeof tab.url !== 'string' || tab.url.length > 8192 ||
            !C.restorable(tab.url) || (tab.excluded !== undefined && typeof tab.excluded !== 'boolean')) throw new Error('Invalid live workspace tab assignment.');
        tabIds.add(tab.id);
      }
      if (group.lastTabId !== undefined && (!safeId(group.lastTabId) || !group.tabs.some(tab => tab.id === group.lastTabId))) throw new Error('Invalid live workspace history.');
    }
    if (tabIds.size > 500) throw new Error('A live workspace window supports at most 500 tabs.');
    return groups;
  }
  async function readLive() {
    if (liveResetFailed) throw new Error('Live workspaces could not be reset for this browser session. Saved snapshots are unchanged.');
    const all = (await liveStorage.get(LIVE_KEY))[LIVE_KEY];
    if (all === undefined) return {};
    if (!object(all)) throw new Error('Live workspace data is unreadable. Saved snapshots are unchanged.');
    for (const [key, record] of Object.entries(all)) {
      if (!object(record) || !safeId(record.windowId) || String(record.windowId) !== key || !uuid(record.revision)) throw new Error('Live workspace data is unreadable. Saved snapshots are unchanged.');
      validateLiveGroups(record.groups);
    }
    return all;
  }
  async function writeLive(all) {
    await liveStorage.set({[LIVE_KEY]: all});
    const stored = await readLive();
    if (JSON.stringify(canonical(stored)) !== JSON.stringify(canonical(all))) throw new Error('Could not verify live workspaces. Refresh before switching tabs.');
  }
  async function liveInventory(windowId) {
    const raw = await api.tabs.query({windowId});
    const metadata = new Map(raw.filter(tab => object(tab)).map(tab => [tab.id,tab]));
    return C.inventory(raw).map(tab => ({...tab,active:Boolean(metadata.get(tab.id)?.active),pendingUrl:metadata.get(tab.id)?.pendingUrl}));
  }
  const matchesLive = (tab, saved, windowId) => tab && tab.id === saved.id && tab.windowId === windowId &&
    tab.url === saved.url && !tab.incognito && !tab.pinned && C.restorable(tab.url);
  async function liveView(windowId) {
    await normalWindow(windowId);
    const all = await readLive(), record = all[windowId];
    if (!record) return {all, record:null, revision:null, groups:[]};
    const inventory = await liveInventory(windowId);
    const current = new Map(inventory.map(tab => [tab.id, tab]));
    let changed = false;
    const groups = record.groups.map(group => {
      const tabs = group.tabs.filter(saved => {
        const tab = current.get(saved.id);
        const valid = matchesLive(tab, saved, windowId) && tab.eligible;
        if (!valid) changed = true;
        return valid;
      });
      const result = {...group,tabs};
      if (result.lastTabId !== undefined && !tabs.some(tab => tab.id === result.lastTabId)) delete result.lastTabId;
      return result;
    });
    if (changed) {
      record.groups = groups; // Pruning is not a competing manual edit.
      await writeLive(all);
    }
    // Pending navigation is temporarily hidden, but retained in the registry until
    // its final URL is known. This does not discard a group on a transient request.
    const visible = groups.map(group => ({...group,tabs:group.tabs.flatMap(saved => {
      const tab = current.get(saved.id);
      return tab.pendingUrl ? [] : [{id:tab.id,url:tab.url,title:tab.title,active:Boolean(tab.active),excluded:Boolean(saved.excluded)}];
    })}));
    return {all,record,revision:record.revision,groups:visible};
  }
  async function getLiveGroups({windowId}) {
    const {revision,groups} = await liveView(windowId);
    return {revision,groups};
  }
  async function setLiveGroups({windowId,expectedRevision,groups}) {
    await normalWindow(windowId);
    validateLiveGroups(groups);
    if (expectedRevision !== null && !uuid(expectedRevision)) throw new Error('Invalid live workspace revision. Refresh the manager.');
    const all = await readLive(), previous = all[windowId];
    if ((previous?.revision ?? null) !== expectedRevision) throw new Error('Live workspaces changed in another manager. Refresh before replacing them.');
    const live = new Map((await liveInventory(windowId)).map(tab => [tab.id,tab]));
    const normalized = groups.map(group => {
      const tabs = group.tabs.map(saved => {
        const tab = live.get(saved.id);
        if (!matchesLive(tab,saved,windowId) || !tab.eligible || tab.pendingUrl) throw new Error('Tabs changed while organising. Refresh before publishing live workspaces.');
        return {id:saved.id,url:saved.url,excluded:Boolean(saved.excluded)};
      });
      const old = previous?.groups.find(item => item.id === group.id);
      const active = tabs.find(saved => live.get(saved.id)?.active);
      const lastTabId = active?.id ?? (tabs.some(tab => tab.id === old?.lastTabId) ? old.lastTabId : undefined);
      return {id:group.id,name:group.name.trim(),reason:group.reason || '',tabs,...(lastTabId !== undefined ? {lastTabId} : {})};
    });
    all[windowId] = {windowId,revision:crypto.randomUUID(),groups:normalized};
    await writeLive(all);
    return getLiveGroups({windowId});
  }
  async function focusLiveGroup({windowId,expectedRevision,groupId:targetGroupId,tabId}) {
    if (!uuid(expectedRevision) || !groupId(targetGroupId) || (tabId !== undefined && !safeId(tabId))) throw new Error('Refresh live workspaces before switching tabs.');
    const {all,record,revision,groups} = await liveView(windowId);
    if (!record || revision !== expectedRevision) throw new Error('Live workspaces changed. Refresh before switching tabs.');
    const visible = groups.find(group => group.id === targetGroupId);
    const savedGroup = record.groups.find(group => group.id === targetGroupId);
    if (!visible || !visible.tabs.length) throw new Error('This workspace has no available live tabs. Refresh the list.');
    const chosen = tabId !== undefined ? visible.tabs.find(tab => tab.id === tabId)
      : visible.tabs.find(tab => tab.id === savedGroup.lastTabId) || visible.tabs[0];
    if (!chosen) throw new Error('This tab is no longer in this workspace. Refresh the list.');
    savedGroup.lastTabId = chosen.id;
    await writeLive(all); // A failed state write changes no browser tab selection.
    const tab = await api.tabs.get(chosen.id);
    if (!matchesLive(tab,chosen,windowId) || tab.pendingUrl) throw new Error('This tab changed or is navigating. Refresh the list before switching.');
    await api.tabs.update(chosen.id,{active:true});
    return {tabId:chosen.id};
  }
  api.tabs.onActivated?.addListener(info => {
    const task = queue.then(async () => {
      if (!safeId(info?.windowId) || !safeId(info?.tabId)) return;
      await normalWindow(info.windowId);
      const all = await readLive(), record = all[info.windowId];
      if (!record) return;
      const group = record.groups.find(group => group.tabs.some(tab => tab.id === info.tabId));
      const saved = group?.tabs.find(tab => tab.id === info.tabId);
      if (!saved || group.lastTabId === info.tabId) return;
      const tab = await api.tabs.get(info.tabId);
      if (!matchesLive(tab,saved,info.windowId) || tab.pendingUrl) return;
      group.lastTabId = info.tabId; await writeLive(all);
    });
    queue = task.catch(() => {});
  });
  api.runtime.onStartup?.addListener(() => {
    // Also clear session storage: browser restoration must not inherit prior tab IDs.
    const task = queue.then(async () => {
      try { await writeLive({}); }
      catch { liveResetFailed = true; }
    });
    queue = task.catch(() => { liveResetFailed = true; });
  });
  api.windows.onRemoved?.addListener(windowId => {
    const task = queue.then(async () => {
      const all = await readLive();
      if (all[windowId]) { delete all[windowId]; await writeLive(all); }
    });
    queue = task.catch(() => {});
  });
  async function handle(message) {
    switch (message.type) {
      case 'live-groups-get': return getLiveGroups(message);
      case 'live-groups-set': return setLiveGroups(message);
      case 'live-groups-focus': return focusLiveGroup(message);
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
      case 'drop-backup': return dropBackup(message);
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
    if (['live-groups-get','live-groups-set','live-groups-focus'].includes(message.type) &&
        !['popup.html','dashboard.html'].includes(sender.url.slice(api.runtime.getURL('').length).split(/[?#]/)[0])) return undefined;
    const result = queue.then(async () => {
      try { return {ok: true, ...await handle(message)}; }
      catch (error) { return {ok: false, error: error.message || 'Operation failed.'}; }
    });
    queue = result.catch(() => {});
    return result;
  });
  // Event pages stay alive while Safari processes messages; no page content is injected.
})();

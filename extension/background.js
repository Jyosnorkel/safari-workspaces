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
  // Popup AI runs in the coordinator so closing the popup cannot turn a paid
  // response into an automatic retry. Only explicit connect/suggest calls use HTTP.
  const POPUP_AI_KEY = 'workspaces.popup-ai.v1';
  const POPUP_TOKEN_KEY = 'workspaces.popup-ai-token.v1';
  let popupAIFlight = null;
  const tokenValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const popupError = message => new Error(message);
  function safeUsage(value) {
    if (!object(value)) return undefined;
    const result = {};
    for (const field of ['enabled','configured','busy']) if (typeof value[field]==='boolean') result[field]=value[field];
    for (const field of ['attemptsToday','remainingToday','remainingThisMinute','perMinute','perDay','requestsPerSuggestion','maxOutputTokens','dailyResetAt','retryAt']) {
      if (value[field]===null || (typeof value[field]==='number' && Number.isFinite(value[field]) && value[field]>=0)) result[field]=value[field];
    }
    if (value.timezone==='UTC') result.timezone='UTC';
    return result;
  }
  async function readPopupAI() {
    if (liveResetFailed) throw popupError('AI review could not be reset for this browser session.');
    const all = (await liveStorage.get(POPUP_AI_KEY))[POPUP_AI_KEY];
    if (all===undefined) return {};
    if (!object(all)) throw popupError('Local AI review is unreadable. No suggestions were sent.');
    for (const [key,record] of Object.entries(all)) {
      if (!safeId(Number(key)) || String(Number(key))!==key || !object(record) ||
          !['idle','requesting','review','error','accepted'].includes(record.state) || !Array.isArray(record.inventory) || record.inventory.length>100 ||
          !uuid(record.inventoryToken) || !Array.isArray(record.usedIds) || record.usedIds.length>100 || !record.usedIds.every(uuid) ||
          (record.revision!==null && !uuid(record.revision))) throw popupError('Local AI review is unreadable. No suggestions were sent.');
      const ids=new Set();
      for(const tab of record.inventory) {
        if(!object(tab)||!safeId(tab.id)||ids.has(tab.id)||typeof tab.url!=='string'||tab.url.length>32768||!C.restorable(tab.url)||typeof tab.title!=='string'||tab.title.length>8192||typeof tab.included!=='boolean') throw popupError('Local AI inventory is invalid. Refresh before requesting suggestions.');
        ids.add(tab.id);
      }
      if(record.requestId!==undefined&&!uuid(record.requestId)) throw popupError('Local AI request identity is invalid.');
      if(record.selectedIds!==undefined&&(!Array.isArray(record.selectedIds)||!record.selectedIds.every(id=>safeId(id)&&ids.has(id))||new Set(record.selectedIds).size!==record.selectedIds.length)) throw popupError('Local AI selection is invalid.');
      if(record.proposal!==undefined) C.suggestions(record.proposal,record.inventory.filter(tab=>record.selectedIds?.includes(tab.id)).map(tab=>({...tab,eligible:true})));
    }
    return all;
  }
  async function writePopupAI(all) {
    await liveStorage.set({[POPUP_AI_KEY]:all});
    if(!same(await readPopupAI(),all)) throw popupError('Could not verify the local AI review. No automatic retry will be made.');
  }
  async function popupTokens() {
    if(!api.storage.session) return {};
    const tokens=(await api.storage.session.get(POPUP_TOKEN_KEY))[POPUP_TOKEN_KEY];
    if(tokens===undefined)return {};
    if(!object(tokens)||Object.entries(tokens).some(([key,value])=>!safeId(Number(key))||String(Number(key))!==key||!tokenValid(value))) throw popupError('Session pairing is unreadable. Forget the saved connection and connect again.');
    return tokens;
  }
  async function rememberPopupToken(windowId,token,remember) {
    if(remember && !api.storage.session) throw popupError('This Safari version cannot remember pairing safely for a browser session. Leave that option unchecked.');
    if(!api.storage.session)return;
    const tokens=await popupTokens();
    if(remember)tokens[windowId]=token;else delete tokens[windowId];
    await api.storage.session.set({[POPUP_TOKEN_KEY]:tokens});
    if(!same(await popupTokens(),tokens)) throw popupError('Could not verify session pairing. Connect again without remembering it.');
  }
  async function popupInventory(windowId) {
    await normalWindow(windowId);
    const live=await getLiveGroups({windowId});
    const exclusions=new Set(live.groups.flatMap(group=>group.tabs.filter(tab=>tab.excluded).map(tab=>tab.id)));
    const tabs=(await liveInventory(windowId)).filter(tab=>tab.eligible && !tab.pendingUrl);
    if(tabs.length>100)throw popupError('Popup AI supports up to 100 eligible tabs. Use a smaller window before requesting suggestions.');
    return {revision:live.revision,inventory:tabs.map(tab=>({id:tab.id,url:tab.url,title:tab.title.slice(0,8192),included:!exclusions.has(tab.id)}))};
  }
  function newPopupState(view,previous={}) {
    return {state:'idle',inventoryToken:crypto.randomUUID(),inventory:view.inventory,revision:view.revision,
      usedIds:previous.usedIds || [],connected:Boolean(previous.connected),...(previous.usage?{usage:previous.usage}:{})};
  }
  async function popupPublic(record,windowId) {
    const selected=record.selectedIds || record.inventory.filter(tab=>tab.included).map(tab=>tab.id);
    const tabs=C.aiInventory(record.inventory.map(tab=>({...tab,eligible:true}))).map(tab=>({...tab,id:Number(tab.id),included:record.inventory.find(item=>String(item.id)===tab.id).included}));
    const remembered=Boolean((await popupTokens())[windowId]);
    let stale=false;
    if(record.state==='review') {
      try {await recheckPopupInput(record,windowId);}
      catch {stale=true;}
    }
    return {state:record.state,tabs,input:C.aiInventory(record.inventory.filter(tab=>selected.includes(tab.id)).map(tab=>({...tab,eligible:true}))),
      inventoryToken:record.inventoryToken,inventoryId:record.inventoryToken,revision:record.revision,connected:record.connected,remembered,stale,
      ...(record.requestId?{requestId:record.requestId}:{}),...(record.proposal?{proposal:{...record.proposal,tabs:C.aiInventory(record.inventory.filter(tab=>record.selectedIds.includes(tab.id)).map(tab=>({...tab,eligible:true})))}}:{}),
      ...(record.usage?{usage:record.usage}:{}),...(record.error?{error:record.error}:{})};
  }
  async function getPopupAIState({windowId}) {
    await normalWindow(windowId);
    const all=await readPopupAI();let record=all[windowId];
    if(record?.state==='requesting' && popupAIFlight?.requestId!==record.requestId) {
      record.state='error';record.error='The previous request was interrupted. No request will repeat automatically. Check usage before deliberately requesting again.';record.connected=false;
      await writePopupAI(all);
    }
    if(!record || ['idle','accepted','error'].includes(record.state)) {
      const next=await popupInventory(windowId);
      if(!record || record.revision!==next.revision || !same(record.inventory,next.inventory)) {
        const error=record?.error, oldState=record?.state;
        record=newPopupState(next,record);if(error){record.state=oldState;record.error=error;}
        all[windowId]=record;await writePopupAI(all);
      }
    }
    return popupPublic(record,windowId);
  }
  async function connectPopupAI({windowId,token,rememberSession=false}) {
    await normalWindow(windowId);
    if(typeof rememberSession!=='boolean'||!tokenValid(token))throw popupError('Enter the 64-character local pairing token, not your Meta API key.');
    if(rememberSession && !api.storage.session)throw popupError('Session pairing is unavailable. Leave Remember for this browser session unchecked.');
    if(!globalThis.WorkspaceAI?.status)throw popupError('The AI connector is unavailable in this build.');
    const all=await readPopupAI();const record=all[windowId] || newPopupState(await popupInventory(windowId));
    if(record.state==='requesting')throw popupError('A suggestion is already running.');
    const response=await WorkspaceAI.status({token});
    if(!response?.ok||!response.usage)throw popupError('The local service returned an invalid status.');
    await rememberPopupToken(windowId,token,rememberSession);
    record.connected=true;record.usage=safeUsage(response.usage);delete record.error;
    all[windowId]=record;await writePopupAI(all);return popupPublic(record,windowId);
  }
  async function refreshPopupAI({windowId,token}) {
    await normalWindow(windowId);
    const all=await readPopupAI(),record=all[windowId] || newPopupState(await popupInventory(windowId));
    if(record.state==='requesting')throw popupError('A suggestion is already running.');
    token=token || (await popupTokens())[windowId];
    if(!tokenValid(token))throw popupError('Enter the local pairing token to refresh service status.');
    if(!globalThis.WorkspaceAI?.status)throw popupError('The AI connector is unavailable in this build.');
    try {
      const response=await WorkspaceAI.status({token});
      if(!response?.ok||!response.usage)throw popupError('The local service returned an invalid status.');
      record.connected=true;record.usage=safeUsage(response.usage);delete record.error;
      all[windowId]=record;await writePopupAI(all);
    } catch(error) {
      record.connected=false;all[windowId]=record;await writePopupAI(all);
      throw error;
    }
    return getPopupAIState({windowId});
  }
  async function forgetPopupAI({windowId}) {
    await normalWindow(windowId);await rememberPopupToken(windowId,'',false);
    const all=await readPopupAI();if(all[windowId]){all[windowId].connected=false;delete all[windowId].usage;await writePopupAI(all);}
    return getPopupAIState({windowId});
  }
  async function recheckPopupInput(record,windowId) {
    await normalWindow(windowId);
    if((await getLiveGroups({windowId})).revision!==record.revision)throw popupError('Workspace groups changed. Refresh AI input before requesting or accepting suggestions.');
    const live=new Map((await liveInventory(windowId)).map(tab=>[tab.id,tab]));
    for(const saved of record.inventory.filter(tab=>record.selectedIds?.includes(tab.id))) {
      const tab=live.get(saved.id);
      if(!tab||!tab.eligible||tab.pendingUrl||tab.windowId!==windowId||tab.url!==saved.url||tab.title.slice(0,8192)!==saved.title)throw popupError('A selected tab changed or is navigating. Refresh AI input before requesting or accepting suggestions.');
    }
  }
  async function preparePopupSuggestion(message) {
    const {windowId,requestId,expectedRevision,tabIds,consent}=message;
    await normalWindow(windowId);
    if(!uuid(requestId)||consent!==true||!Array.isArray(tabIds)||!tabIds.length||tabIds.length>100)throw popupError('Choose tabs and explicitly agree to send their metadata before requesting suggestions.');
    const all=await readPopupAI(),record=all[windowId];
    if(!record)throw popupError('Open AI organise and review the current input first.');
    if(record.usedIds.includes(requestId))return {repeated:true,state:await popupPublic(record,windowId)};
    if(popupAIFlight || record.state==='requesting')throw popupError('A suggestion is already running. No second request was sent.');
    if(record.state==='review')throw popupError('Accept or discard the current suggestion before requesting another.');
    if(record.inventoryToken!==(message.inventoryId ?? message.inventoryToken)||record.revision!==expectedRevision)throw popupError('AI input changed. Refresh and review it before requesting suggestions.');
    const selected=tabIds.map(id=>typeof id==='string' && /^(0|[1-9][0-9]*)$/.test(id)?Number(id):id);
    if(!selected.every(safeId)||new Set(selected).size!==selected.length||selected.some(id=>!record.inventory.some(tab=>tab.id===id)))throw popupError('The AI selection contains an unknown or duplicate tab.');
    const token=message.token || (await popupTokens())[windowId];
    if(!tokenValid(token))throw popupError('Connect with the local pairing token first.');
    if(!record.connected || !record.usage?.enabled || !record.usage?.configured)throw popupError('Connect and enable the configured local Meta service first.');
    if(!globalThis.WorkspaceAI?.suggest)throw popupError('The AI connector is unavailable in this build.');
    record.selectedIds=selected;
    record.inventory=record.inventory.map(tab=>({...tab,included:selected.includes(tab.id)}));
    await recheckPopupInput(record,windowId);
    const payload=C.aiInventory(record.inventory.filter(tab=>selected.includes(tab.id)).map(tab=>({...tab,eligible:true})));
    if(new TextEncoder().encode(JSON.stringify(payload)).length>12000)throw popupError('The selected input is too large. Include fewer tabs.');
    record.state='requesting';record.requestId=requestId;record.usedIds=[...record.usedIds,requestId].slice(-100);delete record.error;delete record.proposal;
    all[windowId]=record;await writePopupAI(all);
    popupAIFlight={windowId,requestId};
    const settings=(await api.storage.local.get('tabby.settings.v1'))['tabby.settings.v1'];
    const preferences=typeof settings?.preferences==='string'?settings.preferences.slice(0,1200):'';
    return {windowId,requestId,token,payload,preferences,autoApply:message.autoApply === true};
  }
  async function performPopupSuggestion(job) {
    if(job.repeated)return {...job.state,repeated:true};
    let response,error;
    try {response=await WorkspaceAI.suggest({token:job.token,tabs:job.payload,preferences:job.preferences,consent:true});}
    catch(caught){error=caught;}
    job.token='';
    const commit=queue.then(async()=>{
      const all=await readPopupAI(),record=all[job.windowId];
      if(!record||record.requestId!==job.requestId||record.state!=='requesting')throw popupError('AI review changed while the request was running. No suggestions were applied.');
      if(error){record.state='error';record.error=typeof error.message==='string'?error.message.slice(0,500):'Suggestions failed. No automatic retry was made.';record.connected=false;if(error.usage)record.usage=safeUsage(error.usage);}
      else {
        try {
          const eligible=record.inventory.filter(tab=>record.selectedIds.includes(tab.id)).map(tab=>({...tab,eligible:true}));
          const validated=C.suggestions(response?.result,eligible);
          record.proposal={groups:validated.groups.map(({name,reason,tabIds})=>({name,reason,tabIds})),ungrouped:validated.ungrouped};
          record.state='review';record.usage=safeUsage(response?.usage) || record.usage;
        } catch {record.state='error';record.error='The model returned invalid groups. Existing workspaces are unchanged.';record.connected=false;}
      }
      await writePopupAI(all);
      if (job.autoApply && record.state === 'review') {
        try { return await acceptPopupAI({windowId:job.windowId,requestId:job.requestId,expectedRevision:record.revision,groups:record.proposal.groups}); }
        catch { record.state='error';record.error='Tabs or groups changed. Refresh and try again. Existing groups were kept.';await writePopupAI(all); }
      }
      return popupPublic(record,job.windowId);
    });
    queue=commit.catch(()=>{});
    try{return await commit;}finally{if(popupAIFlight?.requestId===job.requestId)popupAIFlight=null;}
  }
  async function acceptPopupAI({windowId,requestId,expectedRevision,groups}) {
    await normalWindow(windowId);const all=await readPopupAI(),record=all[windowId];
    if(!record||record.requestId!==requestId)throw popupError('This AI review is no longer available.');
    if(record.state==='accepted')return {...await popupPublic(record,windowId),repeated:true};
    if(record.state!=='review'||expectedRevision!==record.revision)throw popupError('Refresh the current AI review before accepting.');
    await recheckPopupInput(record,windowId);
    const selected=record.inventory.filter(tab=>record.selectedIds.includes(tab.id)),eligible=selected.map(tab=>({...tab,eligible:true}));
    const validated=C.suggestions({groups},eligible);
    const live=await getLiveGroups({windowId});
    const chosen=new Set(record.selectedIds),next=live.groups.map(group=>({id:group.id,name:group.name,reason:group.reason || '',tabs:group.tabs.filter(tab=>!chosen.has(tab.id)).map(({id,url,excluded})=>({id,url,excluded:Boolean(excluded)}))}));
    let ungrouped=next.find(group=>group.id==='ungrouped');if(!ungrouped){ungrouped={id:'ungrouped',name:'Ungrouped',reason:'',tabs:[]};next.unshift(ungrouped);}
    for(const group of validated.groups)next.push({id:crypto.randomUUID(),name:group.name,reason:group.reason,tabs:group.tabIds.map(id=>{const tab=selected.find(tab=>String(tab.id)===id);return {id:tab.id,url:tab.url,excluded:false};})});
    for(const id of validated.ungrouped){const tab=selected.find(tab=>String(tab.id)===id);ungrouped.tabs.push({id:tab.id,url:tab.url,excluded:false});}
    const published=await setLiveGroups({windowId,expectedRevision:record.revision,groups:next.filter(group=>group.id==='ungrouped'||group.tabs.length)});
    record.state='accepted';record.revision=published.revision;record.connected=Boolean(record.connected);delete record.proposal;delete record.selectedIds;
    all[windowId]=record;await writePopupAI(all);
    return {...await popupPublic(record,windowId),liveGroups:published.groups,liveRevision:published.revision};
  }
  async function discardPopupAI({windowId,requestId}) {
    await normalWindow(windowId);const all=await readPopupAI(),record=all[windowId];
    if(record?.state==='requesting')throw popupError('A suggestion is still running. Wait before discarding it.');
    if(record?.requestId && record.requestId!==requestId)throw popupError('The current AI review changed. Refresh first.');
    const next=newPopupState(await popupInventory(windowId),record);all[windowId]=next;await writePopupAI(all);return popupPublic(next,windowId);
  }

  // Reordering has its own browser-session journal; no snapshot or restore URLs change.
  const CLUSTER_KEY = 'workspaces.cluster.v1';
  const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  function checkedTopology(raw, windowId) {
    if (!Array.isArray(raw) || raw.length > 500) throw new Error('Clustering supports at most 500 tabs in one normal window.');
    const sorted = [...raw].sort((a,b)=>a.index-b.index), ids = new Set();
    return sorted.map((tab,index)=> {
      if (!object(tab) || !safeId(tab.id) || ids.has(tab.id) || tab.windowId !== windowId || tab.index !== index || tab.incognito) throw new Error('Tab identity or order is unavailable. Refresh before clustering.');
      ids.add(tab.id);
      return {id:tab.id,index,windowId,url:typeof tab.url==='string'?tab.url:null,pinned:Boolean(tab.pinned),incognito:false,pendingUrl:typeof tab.pendingUrl==='string'?tab.pendingUrl:null};
    });
  }
  async function topology(windowId) {
    await normalWindow(windowId);
    return checkedTopology(await api.tabs.query({windowId}),windowId);
  }
  function simulateMove(tabs, id, index) {
    const result = tabs.map(tab=>({...tab})), from = result.findIndex(tab=>tab.id===id);
    if (from < 0 || !safeId(index) || index >= result.length) throw new Error('Invalid cluster journal. No further tabs were moved.');
    result.splice(index,0,result.splice(from,1)[0]);
    return result.map((tab,index)=>({...tab,index}));
  }
  function clusterSteps(before,target,movable) {
    let current = before;
    const steps = [];
    for (let index=0;index<target.length;index++) {
      if (current[index].id === target[index].id) continue;
      const id = target[index].id;
      if (!movable.includes(id)) throw new Error('A protected tab would move. Refresh before clustering.');
      steps.push({id,index}); current = simulateMove(current,id,index);
    }
    if (steps.length > 500 || !same(current,target)) throw new Error('Invalid cluster plan.');
    return steps;
  }
  function validateClusterPlan(plan,windowId) {
    if (!object(plan) || !uuid(plan.id) || !uuid(plan.revision) || !['cluster','undo'].includes(plan.kind) ||
        !['ready','applying','complete','partial','interrupted'].includes(plan.state) || !safeId(plan.moved) ||
        !Array.isArray(plan.movable) || plan.movable.length > 500 || new Set(plan.movable).size !== plan.movable.length ||
        !plan.movable.every(safeId) || !safeId(plan.protectedCount) || !safeId(plan.segments) ||
        !Array.isArray(plan.groups) || plan.groups.length > 100 || plan.groups.some(group=>!object(group)||typeof group.name!=='string'||group.name.length>80||!safeId(group.count))) throw new Error('Cluster recovery data is invalid. No tabs were moved.');
    const before = checkedTopology(plan.before,windowId), target = checkedTopology(plan.target,windowId);
    if (!same(before,plan.before) || !same(target,plan.target) || before.length !== target.length || plan.movable.some(id=>!before.some(tab=>tab.id===id && !tab.pinned && !tab.pendingUrl && C.restorable(tab.url))) ||
        before.some(tab=>!target.some(item=>same({...tab,index:0},{...item,index:0}))) ||
        before.some(tab=>!plan.movable.includes(tab.id) && target[tab.index]?.id!==tab.id) ||
        !same(clusterSteps(before,target,plan.movable),plan.steps) || plan.moved > plan.steps.length ||
        (plan.state==='complete' && plan.moved!==plan.steps.length)) throw new Error('Cluster recovery data is invalid. No tabs were moved.');
    // A protected anchor is a boundary, including during intermediate moves.
    const segments = new Map(); let segment = 0;
    for (const tab of before) { if (!plan.movable.includes(tab.id)) segment++; else segments.set(tab.id,segment); }
    segment = 0;
    for (const tab of target) { if (!plan.movable.includes(tab.id)) segment++; else if (segments.get(tab.id)!==segment) throw new Error('Cluster recovery crosses a protected tab boundary.'); }
    return plan;
  }
  async function readClusters() {
    if (liveResetFailed) throw new Error('Live operations could not be reset for this browser session.');
    const all = (await liveStorage.get(CLUSTER_KEY))[CLUSTER_KEY];
    if (all === undefined) return {};
    if (!object(all)) throw new Error('Cluster recovery data is unreadable. No tabs were moved.');
    for (const [id,record] of Object.entries(all)) {
      const windowId = Number(id);
      if (!safeId(windowId) || String(windowId)!==id || !object(record) || !Array.isArray(record.plans) || record.plans.length>20 || new Set(record.plans.map(plan=>plan.id)).size!==record.plans.length ||
          !record.plans.some(plan=>plan.id===record.lastPlanId) || (record.lastAppliedId!==undefined && !record.plans.some(plan=>plan.id===record.lastAppliedId))) throw new Error('Cluster recovery data is unreadable. No tabs were moved.');
      record.plans.forEach(plan=>validateClusterPlan(plan,windowId));
    }
    return all;
  }
  async function writeClusters(all) {
    await liveStorage.set({[CLUSTER_KEY]:all});
    if (!same(await readClusters(),all)) throw new Error('Could not verify the reorder journal. Stopped before further tab changes.');
  }
  async function clusterSummary(plan, record, windowId) {
    let canUndo = false;
    if (plan.kind==='cluster' && plan.state==='complete' && record.lastAppliedId===plan.id && plan.steps.length) {
      try { canUndo = (await readLive())[windowId]?.revision===plan.revision && same(await topology(windowId),plan.target); } catch {}
    }
    return {planId:plan.id,kind:plan.kind,state:plan.state,moved:plan.moved,tabCount:plan.movable.length,moveCount:plan.steps.length,
      protectedCount:plan.protectedCount,segments:plan.segments,groups:plan.groups,canUndo,...(plan.error?{error:plan.error}:{})};
  }
  function addClusterPlan(all,windowId,plan) {
    const previous = all[windowId] || {plans:[]};
    const plans = [...previous.plans,plan].slice(-20);
    all[windowId] = {plans,lastPlanId:plan.id,...(plans.some(item=>item.id===previous.lastAppliedId)?{lastAppliedId:previous.lastAppliedId}:{})};
    return all[windowId];
  }
  async function previewCluster({windowId,expectedRevision,requestId}) {
    await normalWindow(windowId);
    if (!uuid(requestId) || !uuid(expectedRevision)) throw new Error('Refresh groups before clustering tabs.');
    const all = await readClusters(), previous = all[windowId]?.plans.find(plan=>plan.id===requestId);
    if (previous) return {...await clusterSummary(previous,all[windowId],windowId),repeated:true};
    const live = (await readLive())[windowId];
    if (!live || live.revision!==expectedRevision) throw new Error('Groups changed. Refresh before clustering.');
    const before = await topology(windowId), current = new Map(before.map(tab=>[tab.id,tab]));
    const orderedGroups = [...live.groups.filter(group=>group.id!=='ungrouped'),...live.groups.filter(group=>group.id==='ungrouped')];
    const rank = new Map(), descriptions = [];
    for (const [groupIndex,group] of orderedGroups.entries()) {
      let count = 0;
      for (const [tabIndex,saved] of group.tabs.entries()) {
        const tab = current.get(saved.id);
        if (!tab || tab.url!==saved.url || tab.pinned || tab.incognito) throw new Error('Tabs changed. Refresh before clustering.');
        if (!saved.excluded && !tab.pendingUrl && C.restorable(tab.url)) { rank.set(tab.id,[groupIndex,tabIndex]); count++; }
      }
      if (count) descriptions.push({name:group.name,count});
    }
    const movable = before.filter(tab=>rank.has(tab.id)).map(tab=>tab.id), target = before.map(tab=>({...tab}));
    let segments = 0;
    for (let start=0;start<before.length;) {
      if (!rank.has(before[start].id)) { start++; continue; }
      let end=start; while(end<before.length && rank.has(before[end].id)) end++;
      const sorted = before.slice(start,end).sort((a,b)=>rank.get(a.id)[0]-rank.get(b.id)[0] || rank.get(a.id)[1]-rank.get(b.id)[1]);
      sorted.forEach((tab,offset)=>target[start+offset]={...tab,index:start+offset}); segments++;start=end;
    }
    const plan = {id:requestId,revision:expectedRevision,kind:'cluster',state:'ready',moved:0,before,target,movable,
      protectedCount:before.length-movable.length,segments,groups:descriptions,steps:clusterSteps(before,target,movable)};
    const record=addClusterPlan(all,windowId,plan);await writeClusters(all);
    return clusterSummary(plan,record,windowId);
  }
  async function previewClusterUndo({windowId,planId,requestId}) {
    await normalWindow(windowId);
    if (!uuid(planId) || !uuid(requestId)) throw new Error('Invalid reorder recovery request.');
    const all = await readClusters(), record = all[windowId], previous=record?.plans.find(plan=>plan.id===requestId);
    if (previous) return {...await clusterSummary(previous,record,windowId),repeated:true};
    const original=record?.plans.find(plan=>plan.id===planId);
    if (!original || !(await clusterSummary(original,record,windowId)).canUndo) throw new Error('Tab order or groups changed. Undo is unavailable; refresh before clustering again.');
    const plan={...original,id:requestId,kind:'undo',state:'ready',moved:0,before:original.target,target:original.before,
      steps:clusterSteps(original.target,original.before,original.movable)};
    delete plan.error;
    const updated=addClusterPlan(all,windowId,plan);await writeClusters(all);return clusterSummary(plan,updated,windowId);
  }
  async function applyCluster({windowId,planId}) {
    await normalWindow(windowId);
    if (!uuid(planId)) throw new Error('Invalid reorder plan.');
    const all=await readClusters(), record=all[windowId], plan=record?.plans.find(plan=>plan.id===planId);
    if (!plan) throw new Error('Reorder plan not found. Preview the current order again.');
    if (plan.state!=='ready') {
      if (plan.state==='applying') { plan.state='interrupted';plan.error='A previous reorder was interrupted. Refresh and preview a new plan to continue deliberately.';await writeClusters(all); }
      return {...await clusterSummary(plan,record,windowId),repeated:true};
    }
    if (record.lastPlanId!==planId) throw new Error('A newer reorder preview exists. Preview again before applying.');
    if (typeof api.tabs.move!=='function') throw new Error('This Safari version does not expose tab movement. No tabs were changed.');
    if ((await readLive())[windowId]?.revision!==plan.revision || !same(await topology(windowId),plan.before)) throw new Error('Tabs or groups changed after preview. Refresh before clustering.');
    plan.state='applying';record.lastAppliedId=plan.id;await writeClusters(all);
    let expected=plan.before;
    try {
      for (const step of plan.steps) {
        if ((await readLive())[windowId]?.revision!==plan.revision || !same(await topology(windowId),expected)) throw new Error('Tabs or groups changed during reordering. Stopped before the next move.');
        const tab=await api.tabs.get(step.id), saved=expected.find(tab=>tab.id===step.id);
        if (tab.index!==saved?.index || !same(checkedTopology([ {...tab,index:0} ],windowId)[0],{...saved,index:0}) || tab.pinned || tab.incognito || tab.pendingUrl || !C.restorable(tab.url)) throw new Error('A tab changed before its move. Stopped reordering.');
        await api.tabs.move(step.id,{windowId,index:step.index});
        expected=simulateMove(expected,step.id,step.index);
        if (!same(await topology(windowId),expected)) throw new Error('Safari did not confirm the expected order. Stopped reordering.');
        plan.moved++;await writeClusters(all);
      }
      plan.state='complete';await writeClusters(all);
    } catch {
      plan.state='partial';plan.error='Reordering stopped before completion. Tabs remain open. Refresh and preview again; automatic replay is disabled.';
      try { await writeClusters(all); } catch { throw new Error('Reordering stopped and progress could not be verified. Tabs remain open. Refresh and inspect their order before a new preview.'); }
    }
    return clusterSummary(plan,record,windowId);
  }
  async function clusterStatus({windowId}) {
    await normalWindow(windowId);
    const record=(await readClusters())[windowId];
    if (!record) return {operation:null};
    const plan=record.plans.find(plan=>plan.id===(record.lastAppliedId || record.lastPlanId));
    const operation=await clusterSummary(plan,record,windowId);
    if (operation.state==='applying') { operation.state='interrupted';operation.error='Reordering was interrupted. Refresh and preview a new plan; nothing will replay automatically.'; }
    return {operation};
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
      try { await writeLive({}); await writeClusters({}); await writePopupAI({}); if(api.storage.session)await api.storage.session.set({[POPUP_TOKEN_KEY]:{}}); }
      catch { liveResetFailed = true; }
    });
    queue = task.catch(() => { liveResetFailed = true; });
  });
  api.windows.onRemoved?.addListener(windowId => {
    const task = queue.then(async () => {
      const all = await readLive();
      if (all[windowId]) { delete all[windowId]; await writeLive(all); }
      const popupReviews=await readPopupAI();if(popupReviews[windowId]){delete popupReviews[windowId];await writePopupAI(popupReviews);}
      await rememberPopupToken(windowId,'',false);
      const clusters = await readClusters();
      if (clusters[windowId]) { delete clusters[windowId]; await writeClusters(clusters); }
    });
    queue = task.catch(() => {});
  });
  async function handle(message) {
    switch (message.type) {
      case 'popup-ai-state': return getPopupAIState(message);
      case 'popup-ai-connect': return connectPopupAI(message);
      case 'popup-ai-refresh': return refreshPopupAI(message);
      case 'popup-ai-forget': return forgetPopupAI(message);
      case 'popup-ai-disconnect': return forgetPopupAI(message);
      case 'popup-ai-accept': return acceptPopupAI(message);
      case 'popup-ai-discard': return discardPopupAI(message);
      case 'cluster-preview': return previewCluster(message);
      case 'cluster-undo-preview': return previewClusterUndo(message);
      case 'cluster-apply': return applyCluster(message);
      case 'cluster-status': return clusterStatus(message);
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
    if (['popup-ai-state','popup-ai-connect','popup-ai-refresh','popup-ai-forget','popup-ai-disconnect','popup-ai-suggest','popup-ai-accept','popup-ai-discard','live-groups-get','live-groups-set','live-groups-focus','cluster-preview','cluster-undo-preview','cluster-apply','cluster-status'].includes(message.type) &&
        !['popup.html','dashboard.html'].includes(sender.url.slice(api.runtime.getURL('').length).split(/[?#]/)[0])) return undefined;
    if (message.type==='popup-ai-suggest') {
      const admission=queue.then(()=>preparePopupSuggestion(message));
      queue=admission.catch(()=>{});
      return admission.then(performPopupSuggestion).then(state=>({ok:true,...state}),error=>({ok:false,error:error.message || 'Suggestions failed. No automatic retry was made.'}));
    }
    const result = queue.then(async () => {
      try { return {ok: true, ...await handle(message)}; }
      catch (error) { return {ok: false, error: error.message || 'Operation failed.'}; }
    });
    queue = result.catch(() => {});
    return result;
  });
  // Event pages stay alive while Safari processes messages; no page content is injected.
})();

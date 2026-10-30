/* Shared, dependency-free domain rules. Browser calls live in background.js. */
(() => {
  const KEY = 'workspaces.v1';
  const MAX_TABS = 500;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const tabId = value => Number.isSafeInteger(value) && value >= 0;
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const title = value => typeof value === 'string' && value.trim() ? value : 'Untitled page';
  function restorable(url) {
    if (typeof url !== 'string') return false;
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
  }
  function inventory(tabs) {
    if (!Array.isArray(tabs)) throw new Error('Safari returned an invalid tab inventory. Scan again.');
    const visible = tabs.filter(t => record(t) && !t.incognito);
    const counts = new Map();
    for (const t of visible) if (tabId(t.id)) counts.set(t.id, (counts.get(t.id) || 0) + 1);
    return visible.slice().sort((a, b) => (tabId(a.index) ? a.index : Infinity) - (tabId(b.index) ? b.index : Infinity)).map(t => {
      const url = typeof t.url === 'string' ? t.url : '';
      const validIdentity = tabId(t.id) && tabId(t.index) && tabId(t.windowId) && counts.get(t.id) === 1;
      const reason = t.pinned ? 'Pinned tab — left open' : !restorable(url) ? 'Restricted page or URL unavailable'
        : !validIdentity ? 'Tab identity or order unavailable — scan again' : '';
      return {id: t.id, title: title(t.title), url, index: t.index, windowId: t.windowId,
        pinned: Boolean(t.pinned), eligible: !reason, reason};
    });
  }
  function snapshot(name, tabs, id, now = new Date().toISOString()) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Use a workspace name between 1 and 80 characters.');
    if (!Array.isArray(tabs) || !tabs.length || tabs.length > MAX_TABS) throw new Error(`Select between 1 and ${MAX_TABS} tabs.`);
    const ids = new Set();
    const windowIds = new Set();
    for (const t of tabs) {
      if (!record(t) || !tabId(t.id) || ids.has(t.id) || !restorable(t.url) || t.incognito || t.pinned) throw new Error('The selection contains duplicate, private, pinned or unsupported tabs. Scan again.');
      if (!tabId(t.index) || !tabId(t.windowId)) throw new Error('Tab identity or order unavailable. Scan again.');
      ids.add(t.id); windowIds.add(t.windowId);
    }
    if (windowIds.size !== 1) throw new Error('Select tabs from one normal Safari window.');
    if (!uuid(id)) throw new Error('The workspace needs a valid persistent ID.');
    if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) throw new Error('The workspace timestamp is invalid.');
    return {version: 1, id, name: name.trim(), createdAt: now, updatedAt: now,
      tabs: [...tabs].sort((a,b) => a.index-b.index).map(t => ({id: crypto.randomUUID(), title: title(t.title), url: t.url, index: t.index})),
      close: {state: 'not-requested', results: []}, restore: {state: 'not-started', results: {}}};
  }
  function eligibleTabs(tabs) {
    if (!Array.isArray(tabs) || tabs.length > MAX_TABS) throw new Error('The scanned tab inventory is invalid. Scan again.');
    const ids = new Set();
    return tabs.filter(t => {
      if (!record(t) || t.eligible !== true) return false;
      if (!tabId(t.id) || !restorable(t.url) || t.incognito || t.pinned || ids.has(t.id)) throw new Error('The scanned tab inventory is invalid. Scan again.');
      ids.add(t.id); return true;
    });
  }
  function modelTabId(value) {
    if (tabId(value)) return String(value);
    if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && tabId(Number(value))) return value;
    throw new Error('The model returned an invalid tab ID. Suggestions were not applied.');
  }
  // Only IDs from the scanned inventory can enter a suggestion. URLs never come from AI.
  function suggestions(raw, tabs) {
    if (!record(raw) || !Array.isArray(raw.groups) || raw.groups.length > 30) throw new Error('The model returned an invalid group list.');
    const allowed = new Set(eligibleTabs(tabs).map(t => String(t.id)));
    const seen = new Set();
    const groups = Array.from(raw.groups).map((group, index) => {
      if (!record(group) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80 || !Array.isArray(group.tabIds) || !group.tabIds.length || group.tabIds.length > allowed.size) throw new Error('The model returned an invalid group.');
      if (group.reason !== undefined && typeof group.reason !== 'string') throw new Error('The model returned an invalid explanation.');
      const tabIds = group.tabIds.map(modelTabId);
      for (const id of tabIds) {
        if (!allowed.has(id) || seen.has(id)) throw new Error('The model invented a tab ID or assigned one more than once. Suggestions were not applied.');
        seen.add(id);
      }
      return {id: `suggestion-${index}`, name: group.name.trim(), reason: (group.reason || '').slice(0,240), tabIds};
    });
    return {groups, ungrouped: [...allowed].filter(id => !seen.has(id))};
  }
  function aiInventory(tabs) {
    return eligibleTabs(tabs).map(t => {
      const url = new URL(t.url); // Strip credentials, query parameters and fragments from model input.
      return {id: String(t.id), title: title(t.title).slice(0,250), url: `${url.origin}${url.pathname}`};
    });
  }
  globalThis.WorkspaceCore = {KEY, restorable, inventory, snapshot, suggestions, aiInventory};
})();

/* Shared, dependency-free domain rules. Browser calls live in background.js. */
(() => {
  const KEY = 'workspaces.v1';
  function restorable(url) {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
  }
  function inventory(tabs) {
    return tabs.filter(t => !t.incognito).sort((a, b) => a.index - b.index).map(t => ({
      id: t.id, title: t.title || 'Untitled page', url: t.url || '', index: t.index,
      windowId: t.windowId, pinned: Boolean(t.pinned),
      eligible: Number.isInteger(t.id) && restorable(t.url) && !t.pinned,
      reason: t.pinned ? 'Pinned tab — left open' : !restorable(t.url) ? 'Restricted page or URL unavailable' : ''
    }));
  }
  function snapshot(name, tabs, id, now = new Date().toISOString()) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Use a workspace name between 1 and 80 characters.');
    if (!Array.isArray(tabs) || !tabs.length) throw new Error('Select at least one tab.');
    const ids = new Set();
    for (const t of tabs) {
      if (!Number.isInteger(t.id) || ids.has(t.id) || !restorable(t.url) || t.incognito || t.pinned) throw new Error('The selection contains duplicate, private, pinned or unsupported tabs. Scan again.');
      ids.add(t.id);
    }
    return {version: 1, id, name: name.trim(), createdAt: now, updatedAt: now,
      tabs: [...tabs].sort((a,b) => a.index-b.index).map(t => ({id: crypto.randomUUID(), title: t.title || 'Untitled page', url: t.url, index: t.index})),
      close: {state: 'not-requested', results: []}, restore: {state: 'not-started', results: {}}};
  }
  // Only IDs from the scanned inventory can enter a suggestion. URLs never come from AI.
  function suggestions(raw, tabs) {
    if (!raw || !Array.isArray(raw.groups) || raw.groups.length > 30) throw new Error('The model returned an invalid group list.');
    const allowed = new Set(tabs.filter(t => t.eligible).map(t => String(t.id)));
    const seen = new Set();
    const groups = raw.groups.map((group, index) => {
      if (!group || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80 || !Array.isArray(group.tabIds) || !group.tabIds.length) throw new Error('The model returned an invalid group.');
      const tabIds = group.tabIds.map(id => String(id));
      for (const id of tabIds) {
        if (!allowed.has(id) || seen.has(id)) throw new Error('The model invented a tab ID or assigned one more than once. Suggestions were not applied.');
        seen.add(id);
      }
      return {id: `suggestion-${index}`, name: group.name.trim(), reason: typeof group.reason === 'string' ? group.reason.slice(0,240) : '', tabIds};
    });
    return {groups, ungrouped: [...allowed].filter(id => !seen.has(id))};
  }
  function aiInventory(tabs) {
    return tabs.filter(t => t.eligible).map(t => {
      const url = new URL(t.url); // Strip credentials, query parameters and fragments from model input.
      return {id: String(t.id), title: t.title.slice(0,250), url: `${url.origin}${url.pathname}`};
    });
  }
  globalThis.WorkspaceCore = {KEY, restorable, inventory, snapshot, suggestions, aiInventory};
})();

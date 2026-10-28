(() => {
  const api = globalThis.browser;
  const C = WorkspaceCore;
  const $ = id => document.getElementById(id);
  let tabs = [], windowId, busy = false, generation = 0;
  let groups = [{id: 'ungrouped', name: 'Ungrouped', reason: ''}];
  const assignments = new Map(), excluded = new Set(), requests = new Map();
  const e = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function notice(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  async function send(type, values = {}) {
    const response = await api.runtime.sendMessage({channel: 'workspace', type, ...values});
    if (!response?.ok) throw new Error(response?.error || 'Safari’s extension coordinator did not respond. Reload the extension and try again.');
    return response;
  }
  async function run(work) {
    if (busy) return;
    busy = true;
    document.querySelector('main').inert = true;
    document.querySelector('main').setAttribute('aria-busy', 'true');
    document.querySelector('aside').inert = true;
    try { await work(); }
    catch (error) { notice(error.message, true); }
    finally {
      busy = false;
      document.querySelector('main').inert = false;
      document.querySelector('main').removeAttribute('aria-busy');
      document.querySelector('aside').inert = false;
    }
  }
  function confirm(title, text, accept) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-accept').textContent = accept;
    const dialog = $('confirm');
    dialog.returnValue = 'cancel';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), {once: true});
      dialog.showModal();
    });
  }
  const assigned = groupId => tabs.filter(t => (assignments.get(t.id) || 'ungrouped') === groupId);
  const selected = groupId => assigned(groupId).filter(t => t.eligible && !excluded.has(t.id));
  function button(label, action, className = '') {
    const node = e('button', className, label); node.type = 'button';
    node.addEventListener('click', () => run(action)); return node;
  }
  function renderGroups() {
    $('groups').replaceChildren();
    if (!tabs.length) {
      $('groups').append(e('div','empty','No tabs scanned yet. Scan this window to organize your work.'));
      return;
    }
    for (const group of groups) {
      const card = e('section','group'), header = e('div','group-header');
      const name = e('input'); name.type = 'text'; name.maxLength = 80; name.value = group.name;
      name.setAttribute('aria-label', `Name for ${group.name}`);
      name.addEventListener('input', () => {group.name = name.value; requests.clear();});
      header.append(name,e('span','count',`${selected(group.id).length} selected`));
      card.append(header);
      if (group.reason) card.append(e('p','group-reason', group.reason));
      const list = e('div','tabs');
      for (const tab of assigned(group.id)) {
        const row = e('div','tab'), checkbox = e('input');
        checkbox.type = 'checkbox'; checkbox.disabled = !tab.eligible;
        checkbox.checked = tab.eligible && !excluded.has(tab.id);
        checkbox.setAttribute('aria-label', `Include ${tab.title}`);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) excluded.delete(tab.id); else excluded.add(tab.id);
          requests.clear(); renderGroups();
        });
        const content = e('div','tab-content');
        const title = e('div','tab-title', tab.title); title.title = tab.title;
        const url = e('div','tab-url',tab.reason || tab.url); url.title = tab.url;
        content.append(title,url);
        if (tab.eligible) {
          const move = e('select'); move.setAttribute('aria-label', `Group for ${tab.title}`);
          for (const target of groups) {
            const option = e('option','',target.name || 'Unnamed group'); option.value = target.id;
            option.selected = target.id === group.id; move.append(option);
          }
          move.addEventListener('change', () => {
            assignments.set(tab.id,move.value); requests.clear(); renderGroups();
          });
          content.append(move);
        }
        row.append(checkbox,content); list.append(row);
      }
      if (!assigned(group.id).length) list.append(e('div','empty','Move tabs here using the group menu on any tab.'));
      card.append(list);
      const actions = e('div','group-footer');
      const save = button('Save snapshot', () => saveGroup(group,false));
      const close = button('Save & close selected', () => saveGroup(group,true),'primary');
      save.disabled = close.disabled = !selected(group.id).length;
      actions.append(save,close); card.append(actions); $('groups').append(card);
    }
  }
  async function saveGroup(group, close) {
    const selection = selected(group.id);
    if (!selection.length) throw new Error('Select at least one tab.');
    if (!group.name.trim()) throw new Error('Give the group a name first.');
    const text = close
      ? `Save ${selection.length} tabs in “${group.name}”, verify the snapshot, then close those tabs? Save any unsaved forms or work first. Restoring reopens URLs only. Tabs that changed after scanning will not be closed.`
      : `Save ${selection.length} tabs in “${group.name}”? The selected tabs will stay open.`;
    if (!await confirm(close ? 'Save your place, then close?' : 'Save a workspace?',text,close ? 'Save & close' : 'Save snapshot')) return;
    // Reuse this ID until the selection changes. Retrying after a lost response cannot close a second time.
    const key = JSON.stringify({generation, groupId: group.id, name: group.name, close, tabs: selection.map(t => [t.id, t.url])});
    if (!requests.has(key)) requests.set(key,crypto.randomUUID());
    notice(close ? 'Saving and verifying your snapshot before closing tabs…' : 'Saving your snapshot…');
    const {workspace, repeated, closedTabIds} = await send('save',{name:group.name,tabs:selection,windowId,close,requestId:requests.get(key)});
    await loadSaved();
    if (close) {
      const closed = workspace.close.results.filter(r => r.state === 'closed').length;
      notice(`${workspace.name}: ${workspace.tabs.length} tabs saved; ${closed} closed. ${workspace.tabs.length-closed} left open.${repeated ? ' This request was already processed.' : ''}`);
      // Keep all review edits. Remove only tabs confirmed closed, including late-navigation failures.
      const removed = new Set(closedTabIds || []);
      tabs = tabs.filter(t => !removed.has(t.id)); renderGroups();
    } else notice(`${workspace.name}: saved ${workspace.tabs.length} tabs locally. Tabs remain open.${repeated ? ' Already saved; no duplicate created.' : ''}`);
  }
  async function scan() {
    if (tabs.length && !await confirm('Rescan this window?','This replaces the current unsaved review and group assignments. Saved workspaces are kept.','Rescan')) return;
    notice('Reading tabs in this Safari window…');
    const response = await send('scan',{windowId});
    tabs = response.tabs; groups = [{id:'ungrouped',name:'Ungrouped',reason:''}];
    assignments.clear(); excluded.clear(); requests.clear(); generation++;
    const eligible = tabs.filter(t=>t.eligible).length;
    $('scan-info').textContent = `${tabs.length} tabs scanned · ${eligible} eligible · ${tabs.length-eligible} left untouched`;
    notice(eligible ? 'Ready to organize. Create a group, then move tabs using their menus.' : 'No eligible web tabs found. Open some regular websites in this window, then scan again.');
    renderGroups();
  }
  async function loadSaved() {
    const {workspaces} = await send('list');
    $('saved-count').textContent = workspaces.length;
    $('workspaces').replaceChildren();
    if (!workspaces.length) $('workspaces').append(e('div','empty','No saved workspaces yet. Your first saved group will appear here.'));
    for (const workspace of workspaces) {
      const card = e('article','workspace');
      card.append(e('h3','',workspace.name));
      card.append(e('p','',`${workspace.tabs.length} tabs · ${new Date(workspace.createdAt).toLocaleString()}`));
      const results = workspace.restore.results;
      const opened = Object.values(results).filter(r=>r.state==='opened').length;
      const closeCount = workspace.close.results.filter(r=>r.state==='closed').length;
      card.append(e('small','',`Save/close: ${workspace.close.state} (${closeCount} closed) · Restore: ${workspace.restore.state} (${opened}/${workspace.tabs.length})`));
      if (workspace.close.state === 'closing') card.append(e('p','recovery','Closing was interrupted. All URLs are saved. Check which original tabs remain before restoring to avoid duplicates.'));
      const pending = workspace.tabs.filter(t=>results[t.id]?.state==='pending');
      for (const tab of pending) {
        const recovery = e('div','recovery');
        recovery.append(e('p','',`Uncertain restore: ${tab.title}. Check Safari before choosing whether this tab opened.`));
        for (const [label,resolution] of [['It opened','opened'],['It did not open','failed']]) {
          recovery.append(button(label, async () => {
            if (!await confirm('Resolve this restore?',`Mark “${tab.title}” as ${resolution === 'opened' ? 'already opened (do not reopen)' : 'not opened (allow retry)'}?`,'Confirm')) return;
            await send('resolve',{id:workspace.id,tabId:tab.id,resolution}); await loadSaved(); notice('Recovery choice saved.');
          }));
        }
        card.append(recovery);
      }
      const actions = e('div','actions');
      const complete = workspace.restore.state === 'complete';
      const restore = button(complete ? 'Restore another copy ↗' : opened ? 'Restore remaining tabs' : 'Restore workspace ↗',async () => {
        const amount = complete ? workspace.tabs.length : workspace.tabs.length-opened;
        const text = complete
          ? `Start a new restore session and open another copy of all ${amount} tabs? Tabs from previous restores may still be open. This is a deliberate new copy.`
          : `Open ${amount} saved URLs in this window? Already confirmed restores are skipped. The snapshot stays saved. Original tabs may still be open.`;
        if (!await confirm(complete ? 'Open another copy?' : 'Restore this workspace?',text,complete ? 'Open another copy' : 'Restore')) return;
        notice('Restoring saved URLs. Keep this window open…');
        try {
          const response = await send('restore',{id:workspace.id,windowId,...(complete ? {newSessionId:crypto.randomUUID(),previousSessionId:workspace.restore.sessionId || null} : {})});
          const count = Object.values(response.workspace.restore.results).filter(r=>r.state==='opened').length;
          notice(`${workspace.name}: ${count}/${workspace.tabs.length} tabs restored. ${response.workspace.restore.state === 'complete' ? 'Snapshot kept for reference.' : 'Review failures and retry the remaining tabs.'}`);
        } finally { await loadSaved(); }
      },'primary');
      restore.disabled = pending.length > 0;
      actions.append(restore); card.append(actions);
      const detail = e('details'), summary = e('summary','', 'Saved tabs & recovery details');
      const list = e('ol');
      for (const tab of workspace.tabs) {
        const item = e('li','', `${tab.title} — ${tab.url}`);
        const result = results[tab.id];
        if (result) item.append(e('p','',`Restore: ${result.state}${result.error ? ` — ${result.error}` : ''}`));
        list.append(item);
      }
      detail.append(summary,list); card.append(detail); $('workspaces').append(card);
    }
  }
  $('scan').addEventListener('click',()=>run(scan));
  $('refresh').addEventListener('click',()=>run(async()=>{await loadSaved(); notice('Saved workspaces refreshed.');}));
  $('new-group').addEventListener('click',()=> {
    if (busy) return;
    if (!tabs.length) return notice('Scan this window before creating a group.',true);
    groups.push({id:crypto.randomUUID(),name:`Workspace ${groups.length}`,reason:''}); renderGroups();
    $('groups').lastElementChild.querySelector('input').focus();
  });
  renderGroups();
  run(async()=> {
    if (!api?.runtime?.sendMessage) throw new Error('This page must be opened from the Safari Workspaces extension toolbar. Enable the extension in Safari Settings → Extensions.');
    const win = await api.windows.getCurrent(); windowId = win.id;
    if (win.incognito) throw new Error('Private browsing is excluded. Open the manager in a normal Safari window.');
    await loadSaved(); notice('Connected to Safari. Scan this window to begin.');
  });
})();

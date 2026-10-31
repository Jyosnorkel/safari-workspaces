(() => {
  const api = globalThis.browser;
  const C = WorkspaceCore;
  const $ = id => document.getElementById(id);
  let tabs = [], windowId, busy = false, generation = 0, reviewRevision = 0;
  let pairedToken = '', usage = null, pendingSuggestions = null, draggedTab = null;
  const collapsedGroups = new Set();
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
  const ai = () => globalThis.WorkspaceAI;
  const aiTabs = () => tabs.filter(tab => tab.eligible && !excluded.has(tab.id));
  const attemptsPerSuggestion = () => Number.isSafeInteger(usage?.requestsPerSuggestion) && usage.requestsPerSuggestion > 0 ? usage.requestsPerSuggestion : 2;
  function aiStatus(message, error = false) {
    $('ai-status').textContent = message;
    $('ai-status').classList.toggle('error', error);
  }
  function reviewChanged(message = 'Your review changed. Previous suggestions were discarded; request fresh suggestions when ready.') {
    reviewRevision++; requests.clear(); clearDrag();
    if (pendingSuggestions) { pendingSuggestions = null; renderSuggestions(); aiStatus(message); }
    updateAIControls();
  }
  function updateAIControls() {
    const payload = C.aiInventory(aiTabs());
    $('ai-data-count').textContent = `Preview the exact model input · ${payload.length} tabs`;
    $('ai-data-preview').textContent = JSON.stringify(payload, null, 2);
    const retryAt = usage?.retryAt ? new Date(usage.retryAt).getTime() : 0;
    const cooling = retryAt > Date.now();
    const daily = Number.isFinite(usage?.remainingToday) ? usage.remainingToday : 0;
    const minute = Number.isFinite(usage?.remainingThisMinute) ? usage.remainingThisMinute : 0;
    const cost = attemptsPerSuggestion();
    const ready = pairedToken && usage?.enabled && usage?.configured && !usage?.busy && !cooling && daily >= cost && minute >= cost;
    $('suggest').disabled = busy || !ready || !payload.length || !$('ai-consent').checked;
    $('suggest').textContent = cooling ? `✦ Cooldown · ${Math.ceil((retryAt - Date.now()) / 1000)}s` : '✦ Suggest with Meta';
    $('suggest').title = !pairedToken ? 'Connect the local service first.' : !usage?.configured ? 'Configure Meta in the local service first.' : usage?.busy ? 'The service is busy. Refresh its status when ready.' : daily < cost ? 'Not enough remote attempts remain today.' : cooling || minute < cost ? 'Wait for the minute cooldown, then refresh status.' : !payload.length ? 'Scan and include an eligible tab first.' : !$('ai-consent').checked ? 'Review and agree to the data disclosure first.' : 'Request suggestions without changing your current groups.';
    $('ai-refresh').disabled = busy || !pairedToken;
    $('ai-disconnect').disabled = busy || !pairedToken;
    $('ai-badge').textContent = pairedToken && usage ? usage.configured ? 'Service connected' : 'Provider not configured' : 'Disconnected';
    $('ai-badge').classList.toggle('connected', Boolean(pairedToken && usage));
    if (!usage) { $('ai-usage').textContent = 'Usage is available after connecting. A full suggestion uses two remote attempts: token count and generation.'; return; }
    const reset = usage.dailyResetAt ? new Date(usage.dailyResetAt).toLocaleString() : 'unavailable';
    const cooldown = cooling ? ` Cooldown ends ${new Date(retryAt).toLocaleTimeString()}.` : minute < cost && daily >= cost ? ' Refresh status when the minute cooldown has ended.' : '';
    $('ai-usage').textContent = `${usage.attemptsToday ?? '—'} remote attempts used today · ${daily} remaining today · ${minute} remaining this minute. Limits: ${usage.perMinute ?? 2}/minute and ${usage.perDay ?? 20}/day (${usage.timezone || 'UTC'}). A full suggestion uses ${cost} attempts (token count + generation): at most ${Math.floor((usage.perDay ?? 20) / cost)} full suggestions/day at these limits. Daily reset: ${reset}.${cooldown}`;
  }
  async function checkService(token = pairedToken) {
    if (!ai()?.status) throw new Error('The AI connector is unavailable in this build. Manual workspaces remain usable.');
    const response = await ai().status({token});
    if (!response?.ok || !response.usage) throw new Error('The local service returned an invalid status.');
    return response.usage;
  }
  async function connectAI() {
    const token = $('ai-token').value.trim();
    if (!token) throw new Error('Enter the local pairing token, not your Meta API key.');
    aiStatus('Requesting access to the local service only…');
    if (api?.permissions?.request && !await api.permissions.request({origins: ['http://127.0.0.1/*']})) {
      pairedToken = ''; usage = null;
      aiStatus('Local-service access was denied. Manual workspaces remain available. Connect again if you want to grant local access.', true);
      updateAIControls(); return;
    }
    try {
      const status = await checkService(token);
      pairedToken = token; usage = status;
      aiStatus(status.enabled && status.configured ? 'Connected. Review the exact input and agree to the disclosure before requesting suggestions. This status check made no model call.' : 'Local service connected, but Meta suggestions are disabled or the provider is not configured. Configure the service before requesting suggestions.');
    } catch (error) {
      pairedToken = ''; usage = null;
      aiStatus(`Could not connect: ${error.message}. Check the running service, pairing token, and exact allowed dashboard origin.`, true);
    }
    updateAIControls();
  }
  async function refreshAI() {
    try { usage = await checkService(); aiStatus('Local service status refreshed. No model request was made.'); }
    catch (error) { usage = null; aiStatus(`Could not refresh service status: ${error.message}`, true); }
    updateAIControls();
  }
  async function suggestAI() {
    const requestTabs = aiTabs().map(tab => ({...tab}));
    if (!pairedToken || !usage?.enabled || !usage?.configured || !$('ai-consent').checked || !requestTabs.length) throw new Error('Connect the service, include tabs and agree to the disclosure first.');
    const baseline = reviewRevision;
    const payload = C.aiInventory(requestTabs);
    if (!await confirm('Send these tabs for Meta suggestions?', `Send ${payload.length} tab titles and sanitized URL paths through http://127.0.0.1:8788 to its configured Meta model provider? Titles and paths may be sensitive. This uses up to ${attemptsPerSuggestion()} remote attempts. Page text is not sent. Your manual groups stay unchanged. A valid response replaces any older unaccepted suggestion preview.`, 'Send & suggest')) return;
    if (baseline !== reviewRevision) throw new Error('Your review changed. Review the updated input before requesting suggestions.');
    $('ai-consent').checked = false;
    aiStatus('Requesting Meta suggestions: token count and generation. Your manual groups are unchanged…');
    notice('Waiting for suggestions. No tabs will be opened or closed.');
    try {
      const response = await ai().suggest({token: pairedToken, tabs: payload, consent: true});
      if (response?.usage) usage = response.usage;
      const validated = C.suggestions(response?.result, requestTabs);
      if (baseline !== reviewRevision) throw new Error('Your review changed during the request. Suggestions were not applied.');
      const proposedGroups = validated.groups.map(group => ({...group, id: `proposal-${crypto.randomUUID()}`}));
      const proposedAssignments = new Map();
      for (let i = 0; i < validated.groups.length; i++) for (const id of validated.groups[i].tabIds) proposedAssignments.set(String(id), proposedGroups[i].id);
      pendingSuggestions = {groups: proposedGroups, assignments: proposedAssignments, tabs: requestTabs, revision: baseline};
      renderSuggestions();
      aiStatus(`Received ${proposedGroups.length} proposed groups. Review, rename or move tabs below, then accept explicitly. Your manual groups are unchanged.`);
      notice('Suggestions are ready to review. They have not changed your groups or snapshots.');
    } catch (error) {
      if (error.usage) usage = error.usage;
      else usage = null; // Require an explicit status refresh; do not make hidden follow-up calls.
      const retry = error.retryAt ? ` Retry after ${new Date(error.retryAt).toLocaleString()}; refresh status before trying again.` : '';
      aiStatus(`Suggestions failed: ${error.message}${error.code ? ` (${error.code})` : ''}.${retry} Your manual groups and saved workspaces are unchanged.`, true);
      notice('Suggestions were not applied. You can keep organizing tabs manually.', true);
    }
    updateAIControls();
  }
  function renderSuggestions() {
    $('ai-review').hidden = !pendingSuggestions;
    $('ai-candidates').replaceChildren();
    if (!pendingSuggestions) return;
    const candidate = pendingSuggestions;
    $('ai-review-summary').textContent = `${candidate.groups.length} proposed groups for ${candidate.tabs.length} included tabs. Move uncertain tabs to “Leave ungrouped”.`;
    const buckets = [...candidate.groups, {id: 'proposal-ungrouped', name: 'Leave ungrouped', reason: 'These tabs will remain visibly ungrouped.'}];
    for (const group of buckets) {
      const members = candidate.tabs.filter(tab => (candidate.assignments.get(String(tab.id)) || 'proposal-ungrouped') === group.id);
      const card = e('article', 'group'), header = e('div', 'group-header');
      if (group.id === 'proposal-ungrouped') header.append(e('h3', '', group.name));
      else {
        const input = e('input'); input.type = 'text'; input.value = group.name; input.maxLength = 80;
        input.setAttribute('aria-label', `Proposed group name: ${group.name}`);
        input.addEventListener('input', () => { group.name = input.value; });
        input.addEventListener('change', renderSuggestions);
        header.append(input);
      }
      header.append(e('span', 'count', `${members.length} tabs`)); card.append(header);
      if (group.reason) card.append(e('p', 'group-reason', group.reason));
      const list = e('div', 'tabs');
      for (const tab of members) {
        const row = e('div', 'tab'), content = e('div', 'tab-content');
        content.append(e('div', 'tab-title', tab.title), e('div', 'tab-url', C.aiInventory([tab])[0].url));
        const move = e('select'); move.setAttribute('aria-label', `Proposed group for ${tab.title}`);
        for (const target of buckets) {
          const option = e('option', '', target.name || 'Unnamed proposal'); option.value = target.id; option.selected = target.id === group.id; move.append(option);
        }
        move.addEventListener('change', () => { candidate.assignments.set(String(tab.id), move.value); renderSuggestions(); });
        content.append(move); row.append(content); list.append(row);
      }
      if (!members.length) list.append(e('div', 'empty', 'Empty proposals are omitted when accepted.'));
      card.append(list); $('ai-candidates').append(card);
    }
  }
  async function acceptSuggestions() {
    const candidate = pendingSuggestions;
    if (!candidate) return;
    if (candidate.revision !== reviewRevision) { reviewChanged(); throw new Error('Your review changed. Request fresh suggestions.'); }
    const raw = {groups: candidate.groups.map(group => ({name: group.name.trim(), reason: group.reason, tabIds: candidate.tabs.filter(tab => candidate.assignments.get(String(tab.id)) === group.id).map(tab => String(tab.id))})).filter(group => group.tabIds.length)};
    const validated = C.suggestions(raw, candidate.tabs);
    if (!await confirm('Accept reviewed suggestions?', `Apply these group assignments to ${candidate.tabs.length} included tabs? Existing unchecked tabs keep their groups. This updates only the review; no tabs are saved, closed or restored.`, 'Accept groups')) return;
    if (candidate.revision !== reviewRevision) throw new Error('Your review changed. Suggestions were not applied.');
    const added = validated.groups.map(group => ({...group, id: crypto.randomUUID()}));
    for (const tab of candidate.tabs) assignments.delete(tab.id);
    for (let i = 0; i < validated.groups.length; i++) for (const id of validated.groups[i].tabIds) {
      const original = candidate.tabs.find(tab => String(tab.id) === String(id)); assignments.set(original.id, added[i].id);
    }
    groups.push(...added.map(({id, name, reason}) => ({id, name, reason})));
    groups = groups.filter(group => group.id === 'ungrouped' || tabs.some(tab => assignments.get(tab.id) === group.id));
    pendingSuggestions = null; reviewRevision++; requests.clear(); renderSuggestions(); renderGroups();
    aiStatus('Reviewed suggestions accepted. You can still rename, move or exclude tabs before saving.');
    notice('Your reviewed groups are ready. Nothing was saved or closed automatically.');
  }
  async function send(type, values = {}) {
    const response = await api.runtime.sendMessage({channel: 'workspace', type, ...values});
    if (!response?.ok) throw new Error(response?.error || 'Safari’s extension coordinator did not respond. Reload the extension and try again.');
    return response;
  }
  async function run(work) {
    if (busy) return;
    busy = true; clearDrag();
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
      updateAIControls();
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
  const DRAG_TYPE = 'application/x-safari-workspaces-tab';
  const groupFor = tabId => assignments.get(tabId) || 'ungrouped';
  const draggableTab = tab => tab?.eligible && !tab.pinned && !tab.incognito && Number.isSafeInteger(tab.id) && C.restorable(tab.url);
  function clearDrag() {
    draggedTab = null;
    $('group-chips').classList.toggle('is-dragging',false);
    for (const chip of $('group-chips').children) chip.classList.toggle('is-drop-target', false);
  }
  function validDrop(groupId, transfer, readToken = false) {
    if (busy || !draggedTab || draggedTab.generation !== generation || draggedTab.revision !== reviewRevision || !groups.some(group => group.id === groupId)) return false;
    const tab = tabs.find(tab => tab.id === draggedTab.tabId);
    if (!draggableTab(tab) || groupFor(tab.id) !== draggedTab.fromGroup || !Array.from(transfer?.types || []).includes(DRAG_TYPE)) return false;
    // During dragover, browsers protect the data store; read its opaque token only on drop.
    if (readToken) { try { return transfer.getData(DRAG_TYPE) === draggedTab.token; } catch { return false; } }
    return true;
  }
  function moveTab(tabId, targetId) {
    const tab = tabs.find(tab => tab.id === tabId), target = groups.find(group => group.id === targetId);
    if (busy || !draggableTab(tab) || !target || groupFor(tabId) === targetId) return false;
    assignments.set(tabId, targetId);
    reviewChanged(); renderGroups();
    notice(`Moved “${tab.title}” to “${target.name || 'Unnamed group'}”.${excluded.has(tabId) ? ' It remains unchecked.' : ''} No browser tabs were moved or changed.`);
    return true;
  }
  function toggleGroup(groupId, focusId) {
    if (busy || !groups.some(group => group.id === groupId)) return;
    if (collapsedGroups.has(groupId)) collapsedGroups.delete(groupId); else collapsedGroups.add(groupId);
    renderGroups();
    $(focusId)?.focus();
  }
  function bindGroupToggle(control, groupId, focusId) {
    control.addEventListener('click', () => toggleGroup(groupId, focusId));
    control.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault(); toggleGroup(groupId, focusId);
      }
    });
  }
  function renderGroupChips() {
    $('group-chips').replaceChildren();
    $('group-chips').hidden = !tabs.length;
    for (const group of groups) {
      if (!tabs.length) break;
      const chip = e('button','group-chip'); chip.type = 'button';
      const count = assigned(group.id).length, collapsed = collapsedGroups.has(group.id), name = group.name || 'Unnamed group';
      chip.setAttribute('id', `group-chip-${group.id}`);
      chip.setAttribute('data-group-id', group.id);
      chip.setAttribute('aria-expanded', String(!collapsed));
      chip.setAttribute('aria-controls', `group-body-${group.id}`);
      chip.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${name}, ${count} tabs`);
      chip.title = 'Click to collapse or expand this group. Drop a tab handle here to move it into this group.';
      chip.classList.toggle('is-collapsed', collapsed);
      chip.append(e('span','group-chip-name',name), e('span','group-chip-count',String(count)), e('span','group-chip-arrow',collapsed ? '▸' : '▾'));
      bindGroupToggle(chip,group.id,`group-chip-${group.id}`);
      const over = event => {
        event.preventDefault(); // Never allow external URL drops to navigate the dashboard.
        const allowed = validDrop(group.id,event.dataTransfer) && draggedTab.fromGroup !== group.id;
        chip.classList.toggle('is-drop-target',allowed);
        if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
      };
      chip.addEventListener('dragenter',over); chip.addEventListener('dragover',over);
      chip.addEventListener('dragleave',()=>chip.classList.toggle('is-drop-target',false));
      chip.addEventListener('drop',event=>{
        event.preventDefault();
        const source = draggedTab;
        if (validDrop(group.id,event.dataTransfer,true)) moveTab(source.tabId,group.id);
        clearDrag();
      });
      $('group-chips').append(chip);
    }
  }
  function dragHandle(tab, sourceGroupId) {
    const handleGeneration = generation, handleRevision = reviewRevision;
    const handle = e('button','drag-handle','⠿'); handle.type = 'button'; handle.draggable = true;
    handle.setAttribute('aria-label',`Drag ${tab.title} to a group chip`);
    handle.setAttribute('aria-describedby','group-chip-help');
    handle.setAttribute('data-tab-id',String(tab.id));
    handle.title = 'Drag to a group chip. Use the group menu to move this tab without dragging.';
    handle.addEventListener('dragstart',event=>{
      clearDrag();
      const current = tabs.find(item=>item.id===tab.id);
      if (busy || handleGeneration !== generation || handleRevision !== reviewRevision || !event.dataTransfer || !draggableTab(current) || groupFor(tab.id)!==sourceGroupId) { event.preventDefault(); return; }
      const token = crypto.randomUUID();
      try { event.dataTransfer.setData(DRAG_TYPE,token); event.dataTransfer.effectAllowed='move'; }
      catch { event.preventDefault(); return; }
      draggedTab = {tabId:tab.id,fromGroup:sourceGroupId,token,generation,revision:reviewRevision};
      $('group-chips').classList.toggle('is-dragging',true);
    });
    handle.addEventListener('dragend',clearDrag);
    handle.addEventListener('click',()=>{ if (!busy) notice('Drag this handle to a group chip, or use this tab’s group menu to move it without dragging.'); });
    return handle;
  }
  function renderGroups() {
    for (const id of collapsedGroups) if (!groups.some(group=>group.id===id)) collapsedGroups.delete(id);
    renderGroupChips();
    updateAIControls();
    $('groups').replaceChildren();
    if (!tabs.length) {
      $('groups').append(e('div','empty','No tabs scanned yet. Scan this window to organize your work.'));
      return;
    }
    for (const group of groups) {
      const card = e('section','group'), header = e('div','group-header');
      const collapsed = collapsedGroups.has(group.id);
      card.setAttribute('id',`manual-group-${group.id}`); card.setAttribute('aria-label',group.name || 'Unnamed group');
      card.classList.toggle('is-collapsed',collapsed);
      const body = e('div','group-body'); body.setAttribute('id',`group-body-${group.id}`); body.hidden = collapsed;
      const name = e('input'); name.type = 'text'; name.maxLength = 80; name.value = group.name;
      name.setAttribute('aria-label', `Name for ${group.name}`);
      name.addEventListener('input', () => {group.name = name.value; reviewChanged(); renderGroupChips();});
      name.addEventListener('change',renderGroups);
      header.append(name,e('span','count',`${assigned(group.id).length} tabs · ${selected(group.id).length} selected`));
      const toggle = e('button','group-toggle',collapsed ? 'Expand ▸' : 'Collapse ▾'); toggle.type='button';
      toggle.setAttribute('id',`group-toggle-${group.id}`); toggle.setAttribute('aria-label',`${collapsed ? 'Expand' : 'Collapse'} ${group.name || 'Unnamed group'}`);
      toggle.setAttribute('aria-expanded',String(!collapsed)); toggle.setAttribute('aria-controls',`group-body-${group.id}`);
      bindGroupToggle(toggle,group.id,`group-toggle-${group.id}`); header.append(toggle);
      card.append(header);
      const selectionActions = e('div','group-select-actions');
      for (const [label,include] of [['Select all',true],['Select none',false]]) selectionActions.append(button(label,async()=>{
        for (const tab of assigned(group.id).filter(tab=>tab.eligible)) if (include) excluded.delete(tab.id); else excluded.add(tab.id);
        reviewChanged(); renderGroups();
      }));
      if (group.id !== 'ungrouped' && !assigned(group.id).length) selectionActions.append(button('Remove empty group',async()=>{ groups=groups.filter(item=>item.id!==group.id); reviewChanged(); renderGroups(); }));
      body.append(selectionActions);
      if (group.reason) body.append(e('p','group-reason', group.reason));
      const list = e('div','tabs');
      for (const tab of assigned(group.id)) {
        const row = e('div','tab'), checkbox = e('input');
        checkbox.type = 'checkbox'; checkbox.disabled = !tab.eligible;
        checkbox.checked = tab.eligible && !excluded.has(tab.id);
        checkbox.setAttribute('aria-label', `Include ${tab.title}`);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) excluded.delete(tab.id); else excluded.add(tab.id);
          reviewChanged(); renderGroups();
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
            moveTab(tab.id,move.value);
          });
          content.append(move);
        }
        row.append(checkbox);
        if (draggableTab(tab)) { row.classList.toggle('draggable-tab',true); row.append(dragHandle(tab,group.id)); }
        row.append(content); list.append(row);
      }
      if (!assigned(group.id).length) list.append(e('div','empty','Move tabs here using the group menu on any tab.'));
      body.append(list);
      const actions = e('div','group-footer');
      const save = button('Save snapshot', () => saveGroup(group,false));
      const close = button('Save & close selected', () => saveGroup(group,true),'primary');
      save.disabled = close.disabled = !selected(group.id).length;
      actions.append(save,close); body.append(actions); card.append(body); $('groups').append(card);
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
      tabs = tabs.filter(t => !removed.has(t.id)); reviewChanged('Tabs changed. Previous AI suggestions were discarded; scan again before requesting a suggestion.'); renderGroups();
    } else notice(`${workspace.name}: saved ${workspace.tabs.length} tabs locally. Tabs remain open.${repeated ? ' Already saved; no duplicate created.' : ''}`);
  }
  async function scan() {
    if (tabs.length && !await confirm('Rescan this window?','This replaces the current unsaved review and group assignments. Saved workspaces are kept.','Rescan')) return;
    notice('Reading tabs in this Safari window…');
    const response = await send('scan',{windowId});
    tabs = response.tabs; groups = [{id:'ungrouped',name:'Ungrouped',reason:''}];
    assignments.clear(); excluded.clear(); requests.clear(); collapsedGroups.clear(); clearDrag(); generation++;
    reviewChanged('A new scan replaced the inventory. Previous suggestions were discarded.'); $('ai-consent').checked = false;
    const eligible = tabs.filter(t=>t.eligible).length;
    $('scan-info').textContent = `${tabs.length} tabs scanned · ${eligible} eligible · ${tabs.length-eligible} left untouched`;
    notice(eligible ? 'Ready to organize. Create a group, then move tabs using their menus.' : 'No eligible web tabs found. Open some regular websites in this window, then scan again.');
    renderGroups();
  }
  async function snapshotWindow() {
    const name = `Window ${new Date().toLocaleString()}`.slice(0,80);
    const {workspace, skipped} = await send('snapshot-window', {windowId, name, requestId: crypto.randomUUID()});
    await loadSaved();
    notice(`Saved ${workspace.tabs.length} web tabs. ${skipped} restricted or unavailable tabs skipped. All tabs remain open. Export a backup for a separate copy.`);
  }
  async function exportBackup(id) {
    const {json} = await send('export-backup', id ? {id} : {});
    const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
    const link = e('a'); link.href = url;
    link.download = `safari-workspaces-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notice('Backup download requested. Keep the JSON file somewhere safe; it contains full URLs and titles.');
  }
  $('snapshot-window').addEventListener('click', () => run(snapshotWindow));
  $('export-all').addEventListener('click', () => run(() => exportBackup()));
  $('import-backup').addEventListener('click', () => { if (!busy) $('backup-file').click(); });
  $('backup-file').addEventListener('change', () => run(async () => {
    const file = $('backup-file').files[0]; $('backup-file').value = '';
    if (!file) return;
    if (file.size > C.MAX_BACKUP_BYTES) throw new Error('Choose a backup file smaller than 10 MB.');
    const json = await file.text();
    const workspaces = C.decodeBackup(json);
    const count = workspaces.reduce((sum, workspace) => sum + workspace.tabs.length, 0);
    if (!await confirm('Import these snapshots?', `Save ${workspaces.length} workspaces containing ${count} URLs on this Mac? Existing snapshots are kept. No tabs will open or close. Importing the same file again adds another copy.`, 'Import snapshots')) return;
    const result = await send('import-backup', {json});
    await loadSaved(); notice(`Imported ${result.imported} snapshots. Review saved URLs before choosing Restore.`);
  }));
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
      actions.append(button('Export backup', () => exportBackup(workspace.id)), restore); card.append(actions);
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
    groups.push({id:crypto.randomUUID(),name:`Workspace ${groups.length}`,reason:''}); reviewChanged(); renderGroups();
    $('groups').lastElementChild.querySelector('input').focus();
  });
  $('ai-origin').textContent = ai()?.clientOrigin || (globalThis.location.origin !== 'null' ? globalThis.location.origin : `${globalThis.location.protocol}//${globalThis.location.host}`);
  $('ai-token').addEventListener('input',()=>{ if (pairedToken) { pairedToken=''; usage=null; aiStatus('Pairing token changed. Connect to check the new token before requesting suggestions.'); updateAIControls(); } });
  $('ai-connect').addEventListener('click',()=>run(connectAI));
  $('ai-refresh').addEventListener('click',()=>run(refreshAI));
  $('ai-disconnect').addEventListener('click',()=>{
    if (busy) return;
    pairedToken=''; usage=null; $('ai-token').value=''; $('ai-consent').checked=false;
    aiStatus('Disconnected. The pairing token was cleared from this page. Manual workspaces and existing review remain available.'); updateAIControls();
  });
  $('ai-consent').addEventListener('change',updateAIControls);
  $('suggest').addEventListener('click',()=>run(suggestAI));
  $('ai-discard').addEventListener('click',()=>{ if (busy) return; pendingSuggestions=null; renderSuggestions(); aiStatus('Suggestions discarded. Your manual groups are unchanged.'); });
  $('ai-accept').addEventListener('click',()=>run(acceptSuggestions));
  // Only update the local countdown; never poll the service or retry model calls.
  setInterval(updateAIControls,1000);
  renderGroups();
  run(async()=> {
    if (!api?.runtime?.sendMessage) throw new Error('This page must be opened from the Safari Workspaces extension toolbar. Enable the extension in Safari Settings → Extensions.');
    const win = await api.windows.getCurrent(); windowId = win.id;
    if (win.incognito) throw new Error('Private browsing is excluded. Open the manager in a normal Safari window.');
    await loadSaved(); notice('Connected to Safari. Scan this window to begin.');
  });
})();

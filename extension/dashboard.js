(() => {
  const api = globalThis.browser;
  const C = WorkspaceCore;
  // Appearance is shared with the popup; invalid/missing settings follow macOS.
  const applyTheme = value => {
    if (document.documentElement) document.documentElement.dataset.theme = ['light','dark','system'].includes(value) ? value : 'system';
  };
  applyTheme('system');
  try {
    const loading = api?.storage?.local?.get('tabby.settings.v1');
    loading?.then(value => applyTheme(value?.['tabby.settings.v1']?.theme)).catch(() => {});
    api?.storage?.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes?.['tabby.settings.v1']) applyTheme(changes['tabby.settings.v1'].newValue?.theme);
    });
  } catch { /* Storage availability never blocks manual workspace controls. */ }

  const $ = id => document.getElementById(id);
  let tabs = [], windowId, busy = false, generation = 0, reviewRevision = 0;
  let pairedToken = '', usage = null, pendingSuggestions = null, draggedTab = null, connectionUpdated = false;
  const collapsedGroups = new Set();
  const tabOrder = new Map();
  let groups = [{id: 'ungrouped', name: 'Ungrouped', reason: ''}];
  const assignments = new Map(), excluded = new Set(), requests = new Map();
  // The switcher registry is separate from saved snapshots and AI proposals.
  let liveReady = false, liveRevision = null, liveDirty = false, liveConflict = false;
  let liveScheduled = false, liveTask = Promise.resolve(true), liveFingerprint = '';
  let clusterOperation = null;
  const manualSelection=globalThis.TabbySelection?.create({announce:(count,clear)=>TabbySelection.toolbar($('status'),count,clear)});

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
    queueLivePublish();
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
    const hasNamedTabs = groups.some(group => group.id !== 'ungrouped' && tabs.some(tab => assignments.get(tab.id) === group.id && draggableTab(tab) && !excluded.has(tab.id)));
    $('cluster-tabs').disabled = busy || !liveReady || liveConflict || Boolean(pendingSuggestions) || !hasNamedTabs;
    $('cluster-tabs').title = pendingSuggestions ? 'Accept or discard AI suggestions before arranging Safari tabs.' : 'Arrange checked tabs by your reviewed groups. Protected tabs stay in place.';
    $('undo-cluster').hidden = !clusterOperation?.canUndo;
    $('undo-cluster').disabled = busy;

    $('suggest').textContent = cooling ? `Cooldown · ${Math.ceil((retryAt - Date.now()) / 1000)}s` : 'AI organise';
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
    connectionUpdated = response.connection?.updated === true;
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
      if($('ai-remember')?.checked){
        if(!api.storage.session)throw new Error('Session pairing is unavailable. Uncheck session pairing and connect again.');
        await api.storage.session.set({['tabby.dashboard.pairing.'+windowId]:token});
      }else if(api.storage.session)await api.storage.session.remove('tabby.dashboard.pairing.'+windowId);
      aiStatus(status.enabled && status.configured ? `${connectionUpdated ? 'Safari’s connection address was updated automatically. ' : ''}Connected. Review the exact input and agree to the disclosure before requesting suggestions. This status check made no model call.` : 'Local service connected, but Meta suggestions are disabled or the provider is not configured. Configure the service before requesting suggestions.');
    } catch (error) {
      pairedToken = ''; usage = null;
      aiStatus(`Could not connect: ${error.message}. Check the running service and local pairing token. The updated service refreshes Safari’s address automatically.`, true);
    }
    updateAIControls();
  }
  async function refreshAI() {
    try { usage = await checkService(); aiStatus(`${connectionUpdated ? 'Safari’s connection address was updated automatically. ' : ''}Local service status refreshed. No model request was made.`); }
    catch (error) { usage = null; aiStatus(`Could not refresh service status: ${error.message}`, true); }
    updateAIControls();
  }
  async function suggestAI() {
    const requestTabs = aiTabs().map(tab => ({...tab}));
    if (!pairedToken || !usage?.enabled || !usage?.configured || !$('ai-consent').checked || !requestTabs.length) throw new Error('Connect the service, include tabs and agree to the disclosure first.');
    const baseline = reviewRevision;
    const payload = C.aiInventory(requestTabs);
    if (!await confirm('Send these tabs for Meta suggestions?', `Send ${payload.length} tab titles and sanitized URL paths through http://127.0.0.1:8788 to its configured Meta model provider? Titles and paths may be sensitive. This uses up to ${attemptsPerSuggestion()} remote attempts. Page text is not sent. Your manual groups stay unchanged. Your saved grouping preferences are included. A valid response replaces any older unaccepted suggestion preview and applies directly if selected.`, 'Send & suggest')) return;
    if (baseline !== reviewRevision) throw new Error('Your review changed. Review the updated input before requesting suggestions.');
    $('ai-consent').checked = false;
    aiStatus('Requesting Meta suggestions: token count and generation. Your manual groups are unchanged…');
    notice('Waiting for suggestions. No tabs will be opened or closed.');
    try {
      const savedSettings = await api.storage.local.get('tabby.settings.v1');
      const preferences = String(savedSettings?.['tabby.settings.v1']?.preferences || '').slice(0,1200);
      const response = await ai().suggest({token: pairedToken, tabs: payload, preferences, consent: true});
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
      if($('ai-apply-direct')?.checked)await acceptSuggestions({direct:true});
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
      bindProposalTarget(card,candidate,group.id);
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
        bindProposalRow(row,tab,candidate,group.id);
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
  async function acceptSuggestions({direct=false} = {}) {
    const candidate = pendingSuggestions;
    if (!candidate) return;
    if (candidate.revision !== reviewRevision) { reviewChanged(); throw new Error('Your review changed. Request fresh suggestions.'); }
    const raw = {groups: candidate.groups.map(group => ({name: group.name.trim(), reason: group.reason, tabIds: candidate.tabs.filter(tab => candidate.assignments.get(String(tab.id)) === group.id).map(tab => String(tab.id))})).filter(group => group.tabIds.length)};
    const validated = C.suggestions(raw, candidate.tabs);
    if (!direct && !await confirm('Accept reviewed suggestions?', `Apply these group assignments to ${candidate.tabs.length} included tabs? Existing unchecked tabs keep their groups. This updates only the review; no tabs are saved, closed or restored.`, 'Accept groups')) return;
    if (candidate.revision !== reviewRevision) throw new Error('Your review changed. Suggestions were not applied.');
    const added = validated.groups.map(group => ({...group, id: crypto.randomUUID()}));
    candidate.tabs.forEach((tab,index)=>tabOrder.set(tab.id,index));
    for (const tab of candidate.tabs) assignments.delete(tab.id);
    for (let i = 0; i < validated.groups.length; i++) for (const id of validated.groups[i].tabIds) {
      const original = candidate.tabs.find(tab => String(tab.id) === String(id)); assignments.set(original.id, added[i].id);
    }
    groups.push(...added.map(({id, name, reason}) => ({id, name, reason})));
    groups = groups.filter(group => group.id === 'ungrouped' || tabs.some(tab => assignments.get(tab.id) === group.id));
    pendingSuggestions = null; reviewRevision++; requests.clear(); renderSuggestions(); renderGroups();
    queueLivePublish();
    aiStatus('Reviewed suggestions accepted. You can still rename, move or exclude tabs before saving.');
    notice('Your reviewed groups are ready. Nothing was saved or closed automatically.');
  }
  async function send(type, values = {}) {
    const response = await api.runtime.sendMessage({channel: 'workspace', type, ...values});
    if (!response?.ok) throw new Error(response?.error || 'Safari’s extension coordinator did not respond. Reload the extension and try again.');
    return response;
  }
  function liveStatus(text, error = false) {
    const node = $('live-status');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('error', error);
    if ($('live-reload')) $('live-reload').hidden = !error;
  }
  function liveGroups() {
    return groups.map(group => ({id:group.id, name:group.name.trim(), reason:group.reason || '',
      tabs:assigned(group.id).filter(tab=>draggableTab(tab) && !tab.pendingUrl)
        .map(tab=>({id:tab.id,url:tab.url,excluded:excluded.has(tab.id)}))}));
  }
  function queueLivePublish() {
    if (!liveReady || liveConflict) return Promise.resolve(false);
    liveDirty = true;
    if (liveScheduled) return liveTask;
    liveScheduled = true;
    // Coalesce a synchronous rename/move/render without delaying a popup refresh.
    liveTask = Promise.resolve().then(async()=> {
      try {
        while (liveDirty && !liveConflict) {
          liveDirty = false;
          const payload = liveGroups(), fingerprint = JSON.stringify(payload);
          if (fingerprint === liveFingerprint) continue;
          // Keep a partially typed group name in the editor, not in the switcher.
          if (payload.some(group=>!group.name)) {
            liveDirty = true;
            liveStatus('Name every group to update the toolbar switcher.', true);
            return false;
          }
          try {
            const response = await send('live-groups-set',{windowId,expectedRevision:liveRevision,groups:payload});
            liveRevision = response.revision;
            liveFingerprint = fingerprint;
            liveStatus('Groups are available in the toolbar switcher.');
          } catch (error) {
            liveDirty = true;
            liveConflict = /changed in another manager/i.test(error.message);
            liveStatus(liveConflict
              ? 'Another manager changed the toolbar groups. Your edits are kept here. Load shared groups to replace this review explicitly.'
              : 'Could not update toolbar groups. Your edits are kept here. Refresh tabs to try sharing them again.', true);
            return false;
          }
        }
        return true;
      } finally { liveScheduled = false; }
    });
    return liveTask;
  }
  async function hydrateLiveGroups({replace = false} = {}) {
    try {
      const response = await send('live-groups-get',{windowId});
      if (!Array.isArray(response.groups)) throw new Error('Invalid live group list.');
      liveRevision = response.revision ?? null;
      // Reading an unchanged registry must not invalidate a different manager.
      liveFingerprint = JSON.stringify(response.groups.map(group=>({id:group.id,name:group.name.trim(),reason:group.reason || '',
        tabs:group.tabs.map(tab=>({id:tab.id,url:tab.url,excluded:tab.excluded === true}))})));
      if (response.groups.length || replace) {
        const available = new Map(tabs.filter(tab=>draggableTab(tab) && !tab.pendingUrl).map(tab=>[tab.id,tab]));
        const seen = new Set();
        groups = response.groups.map(group=>({id:group.id,name:group.name,reason:group.reason || ''}));
        if (!groups.some(group=>group.id==='ungrouped')) groups.unshift({id:'ungrouped',name:'Ungrouped',reason:''});
        assignments.clear(); excluded.clear(); tabOrder.clear();
        if (replace) { pendingSuggestions = null; reviewRevision++; requests.clear(); collapsedGroups.clear(); clearDrag(); renderSuggestions(); }
        for (const group of response.groups) for (const [index,member] of group.tabs.entries()) {
          const tab = available.get(member.id);
          if (!tab || tab.url!==member.url || seen.has(tab.id)) continue;
          seen.add(tab.id); assignments.set(tab.id,group.id); tabOrder.set(tab.id,index);
          if (member.excluded) excluded.add(tab.id);
        }
        renderGroups();
      }
      liveReady = true; liveConflict = false; liveDirty = false;
      // Current Safari metadata may include new tabs absent from the registry.
      if (await queueLivePublish()) liveStatus('Groups are available in the toolbar switcher.');
    } catch {
      liveReady = false;
      liveStatus('Toolbar groups could not be loaded. Your current review is kept here. Use Load shared groups to try again.', true);
    }
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
  const assigned = groupId => tabs.filter(t => (assignments.get(t.id) || 'ungrouped') === groupId).sort((a,b)=>(tabOrder.get(a.id) ?? a.index)-(tabOrder.get(b.id) ?? b.index));
  const selected = groupId => assigned(groupId).filter(t => t.eligible && !excluded.has(t.id));
  function button(label, action, className = '') {
    const node = e('button', className, label); node.type = 'button';
    node.addEventListener('click', () => run(action)); return node;
  }
  const DRAG_TYPE = 'application/x-safari-workspaces-tab';
  const tabLabel = count => `${count} ${count === 1 ? 'tab' : 'tabs'}`;
  const groupFor = tabId => assignments.get(tabId) || 'ungrouped';
  const draggableTab = tab => tab?.eligible && !tab.pinned && !tab.incognito && Number.isSafeInteger(tab.id) && C.restorable(tab.url);
  function clearDrag() {
    draggedTab = null;
    $('group-chips').classList.toggle('is-dragging',false);
    for (const chip of $('group-chips').children) chip.classList.toggle('is-drop-target', false);
    const clearMarkers = node => { node.classList.toggle('is-drop-target',false); node.classList.toggle('drop-before',false); for (const child of node.children) clearMarkers(child); };
    for (const card of [...$('groups').children,...$('ai-candidates').children]) clearMarkers(card);
  }
  function validDrop(groupId, transfer, readToken = false) {
    if (busy || !draggedTab || draggedTab.scope !== 'manual' || draggedTab.generation !== generation || draggedTab.revision !== reviewRevision || !groups.some(group => group.id === groupId)) return false;
    const dragIds=draggedTab.tabIds || [draggedTab.tabId];
    if(dragIds.some(id=>!draggableTab(tabs.find(tab=>tab.id===id)) || (draggedTab.fromGroups && groupFor(id)!==draggedTab.fromGroups[id])))return false;
    const tab = tabs.find(tab => tab.id === draggedTab.tabId);
    if (!draggableTab(tab) || groupFor(tab.id) !== draggedTab.fromGroup || !Array.from(transfer?.types || []).includes(DRAG_TYPE)) return false;
    // During dragover, browsers protect the data store; read its opaque token only on drop.
    if (readToken) { try { return transfer.getData(DRAG_TYPE) === draggedTab.token; } catch { return false; } }
    return true;
  }
  function moveTab(tabId, targetId) {
    const tab = tabs.find(tab => tab.id === tabId), target = groups.find(group => group.id === targetId);
    if (busy || !draggableTab(tab) || !target || groupFor(tabId) === targetId) return false;
    assigned(targetId).forEach((item,index)=>tabOrder.set(item.id,index));
    tabOrder.set(tabId,assigned(targetId).length);
    assignments.set(tabId, targetId);
    reviewChanged(); renderGroups();
    notice(`Moved “${tab.title}” to “${target.name || 'Unnamed group'}”.${excluded.has(tabId) ? ' It remains unchecked.' : ''} No browser tabs were moved or changed.`);
    return true;
  }
  function moveSelectedTabs(ids,targetId,beforeId){
    if(busy || !groups.some(group=>group.id===targetId) || ids.includes(beforeId))return false;
    const moving=groups.flatMap(group=>assigned(group.id)).filter(tab=>ids.includes(tab.id));
    if(moving.length!==ids.length || moving.some(tab=>!draggableTab(tab)))return false;
    if(beforeId===undefined && moving.every(tab=>groupFor(tab.id)===targetId))return false;
    const ordered=assigned(targetId).filter(tab=>!ids.includes(tab.id));
    const index=beforeId===undefined?ordered.length:ordered.findIndex(tab=>tab.id===beforeId);
    if(index<0)return false;
    ordered.splice(index,0,...moving);for(const tab of moving)assignments.set(tab.id,targetId);
    ordered.forEach((tab,position)=>tabOrder.set(tab.id,position));
    reviewChanged();renderGroups();notice(`${moving.length} tab${moving.length===1?'':'s'} moved.${moving.some(tab=>excluded.has(tab.id))?' Unchecked tabs remain unchecked.':''} Safari’s tab bar is unchanged.`);return true;
  }
  function toggleGroup(groupId, focusId) {
    if (busy || !groups.some(group => group.id === groupId)) return;
    if (collapsedGroups.has(groupId)) collapsedGroups.delete(groupId); else collapsedGroups.add(groupId);
    renderGroups();
    $(focusId || `group-toggle-${groupId}`)?.focus();
  }
  function bindGroupToggle(control, groupId, focusId) {
    control.addEventListener('click', event => {
      if (event.target !== control && ['INPUT','BUTTON','SELECT','TEXTAREA'].includes(String(event.target?.tagName).toUpperCase())) return;
      toggleGroup(groupId, focusId);
    });
    control.addEventListener('keydown', event => {
      if (event.target !== control && ['INPUT','BUTTON','SELECT','TEXTAREA'].includes(String(event.target?.tagName).toUpperCase())) return;
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
      chip.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${name}, ${tabLabel(count)}`);
      chip.title = 'Click to collapse or expand this group. Drop a tab handle here to move it into this group.';
      chip.classList.toggle('is-collapsed', collapsed);
      chip.append(e('span','group-chip-name',name), e('span','group-chip-count',String(count)));
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
        if (validDrop(group.id,event.dataTransfer,true)) moveSelectedTabs(source.tabIds || [source.tabId],group.id);
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
    handle.title = 'Drag onto a row to place this tab before it. Option + Up/Down reorders with the keyboard. Drag the row itself to move groups.';
    handle._startDrag = event=>{
      clearDrag();
      const current = tabs.find(item=>item.id===tab.id);
      if (busy || handleGeneration !== generation || handleRevision !== reviewRevision || !event.dataTransfer || !draggableTab(current) || groupFor(tab.id)!==sourceGroupId) { event.preventDefault(); return; }
      const token = crypto.randomUUID();
      try { event.dataTransfer.setData(DRAG_TYPE,token); event.dataTransfer.effectAllowed='move'; }
      catch { event.preventDefault(); return; }
      const tabIds=(manualSelection?.dragIds(tab.id) || [tab.id]).filter(id=>draggableTab(tabs.find(item=>item.id===id)));
      draggedTab = {tabId:tab.id,tabIds,fromGroups:Object.fromEntries(tabIds.map(id=>[id,groupFor(id)])),fromGroup:sourceGroupId,token,generation,revision:reviewRevision,scope:'manual', mode:'order'};
      $('group-chips').classList.toggle('is-dragging',true);
    };
    handle.addEventListener('dragstart', event=>{ event.stopPropagation?.(); handle._startDrag(event); });
    handle.addEventListener('keydown',event=>{
      if (!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key) || busy || handleGeneration !== generation || handleRevision !== reviewRevision) return;
      event.preventDefault();
      const ordered = assigned(sourceGroupId), index = ordered.findIndex(item=>item.id===tab.id), next = index + (event.key==='ArrowUp' ? -1 : 1);
      if (next < 0 || next >= ordered.length) return;
      [ordered[index],ordered[next]]=[ordered[next],ordered[index]];
      ordered.forEach((item,position)=>tabOrder.set(item.id,position));
      reviewChanged(); renderGroups();
      for (const card of $('groups').children) for (const section of card.children) for (const list of section.children) for (const row of list.children) for (const control of row.children) if (control.getAttribute?.('data-tab-id')===String(tab.id)) control.focus();
      notice('Tab order updated. Use Option and Up or Down on the grip to reorder.');
    });
    handle.addEventListener('dragend',clearDrag);
    handle.addEventListener('click',()=>{ if (!busy) notice('Drag this handle to a group chip, or use this tab’s group menu to move it without dragging.'); });
    return handle;
  }
  function validProposalDrop(candidate, groupId, transfer, token = false) {
    if (busy || !draggedTab || draggedTab.scope !== 'proposal' || pendingSuggestions !== candidate || draggedTab.candidate !== candidate || candidate.revision !== reviewRevision || draggedTab.generation !== generation || !Array.from(transfer?.types || []).includes(DRAG_TYPE)) return false;
    if (![...candidate.groups.map(group=>group.id),'proposal-ungrouped'].includes(groupId)) return false;
    if (!candidate.tabs.some(tab=>tab.id===draggedTab.tabId && draggableTab(tab)) || (candidate.assignments.get(String(draggedTab.tabId)) || 'proposal-ungrouped') !== draggedTab.fromGroup) return false;
    return !token || transfer.getData(DRAG_TYPE) === draggedTab.token;
  }
  function bindProposalTarget(node,candidate,groupId,beforeId) {
    node.addEventListener('dragover',event=>{
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault();
      const allowed = validProposalDrop(candidate,groupId,event.dataTransfer);
      if(allowed){
        event.stopPropagation?.();
        for(const target of document.querySelectorAll?.('.is-drop-target, .drop-before') || []){target.classList.toggle('is-drop-target',false);target.classList.toggle('drop-before',false);}
      }

      node.classList.toggle('is-drop-target',allowed);
      if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    });
    node.addEventListener('dragleave',()=>node.classList.toggle('is-drop-target',false));
    node.addEventListener('drop',event=>{
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault(); event.stopPropagation?.();
      if (validProposalDrop(candidate,groupId,event.dataTransfer,true)) {
        if (draggedTab.mode === 'order' && draggedTab.fromGroup === groupId && beforeId !== undefined && beforeId !== draggedTab.tabId) {
          const moving = candidate.tabs.find(tab=>tab.id===draggedTab.tabId);
          candidate.tabs = candidate.tabs.filter(tab=>tab.id!==moving.id);
          candidate.tabs.splice(candidate.tabs.findIndex(tab=>tab.id===beforeId),0,moving);
        } else candidate.assignments.set(String(draggedTab.tabId),groupId);
        clearDrag(); renderSuggestions();
        notice('Proposed group updated. Accept reviewed suggestions when ready; current groups remain unchanged.');
      }
      clearDrag();
    });
  }
  function bindProposalRow(row,tab,candidate,groupId) {
    row.draggable = true; row.classList.toggle('draggable-proposal',true);
    row.setAttribute('aria-label',`Move proposed ${tab.title}`);
    row.addEventListener('dragstart',event=>{
      if (event.target !== row && ['INPUT','SELECT','BUTTON','OPTION'].includes(String(event.target?.tagName).toUpperCase())) { event.preventDefault(); return; }
      clearDrag();
      if (busy || pendingSuggestions !== candidate || candidate.revision !== reviewRevision || !draggableTab(tab) || !event.dataTransfer) { event.preventDefault(); return; }
      const token = crypto.randomUUID();
      event.dataTransfer.setData(DRAG_TYPE,token); event.dataTransfer.effectAllowed='move';
      draggedTab = {scope:'proposal',candidate,tabId:tab.id,fromGroup:groupId,token,generation,revision:reviewRevision};
    });
    row.addEventListener('dragend',clearDrag);
    bindProposalTarget(row,candidate,groupId,tab.id);
    const grip = e('button','drag-handle','⠿'); grip.type='button'; grip.draggable=true;
    grip.setAttribute('aria-label',`Reorder proposed ${tab.title}`);
    grip.title='Drag to another row in this proposed group to place this tab before it.';
    grip.addEventListener('dragstart',event=>{
      event.stopPropagation?.(); clearDrag();
      if (busy || pendingSuggestions !== candidate || candidate.revision !== reviewRevision || !event.dataTransfer || !draggableTab(tab)) {event.preventDefault();return;}
      const token=crypto.randomUUID(); event.dataTransfer.setData(DRAG_TYPE,token); event.dataTransfer.effectAllowed='move';
      draggedTab={scope:'proposal',candidate,tabId:tab.id,fromGroup:groupId,token,generation,revision:reviewRevision,mode:'order'};
    });
    grip.addEventListener('dragend',clearDrag); row.append(grip);
  }
  function bindRowDrag(row, tab, groupId) {
    row.draggable = true;
    row.setAttribute('aria-label', `Move ${tab.title}`);
    const origin = dragHandle(tab, groupId);
    row.addEventListener('dragstart', event => {
      if (event.target !== row && ['INPUT','SELECT','BUTTON','OPTION'].includes(String(event.target?.tagName).toUpperCase())) { event.preventDefault(); return; }
      // Reuse the same nonce and stale-review checks as the keyboard-accessible grip.
      row._startDrag(event);
      if (draggedTab) draggedTab.mode = 'move';
    });
    row._startDrag = origin._startDrag;
    row.addEventListener('dragend', clearDrag);
    bindManualTarget(row, groupId, tab.id);
  }
  function bindManualTarget(node, groupId, beforeId) {
    node.addEventListener('dragover', event => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault();
      const valid = validDrop(groupId,event.dataTransfer);
      if(valid){
        event.stopPropagation?.();
        for(const target of document.querySelectorAll?.('.is-drop-target, .drop-before') || []){target.classList.toggle('is-drop-target',false);target.classList.toggle('drop-before',false);}
      }

      const reorder = valid && beforeId !== undefined && beforeId !== draggedTab.tabId;
      node.classList.toggle('is-drop-target', Boolean(valid && beforeId === undefined && draggedTab.fromGroup !== groupId));
      node.classList.toggle('drop-before',Boolean(reorder));
      if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    });
    node.addEventListener('dragleave', () => {node.classList.toggle('is-drop-target', false);node.classList.toggle('drop-before',false);});
    node.addEventListener('drop', event => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault(); event.stopPropagation?.();
      if (validDrop(groupId,event.dataTransfer,true)) {
        const source = draggedTab;
        moveSelectedTabs(source.tabIds || [source.tabId],groupId,beforeId);
      }
      node.classList.toggle('is-drop-target',false); node.classList.toggle('drop-before',false); clearDrag();
    });
  }
  function renderGroups() {
    for (const id of collapsedGroups) if (!groups.some(group=>group.id===id)) collapsedGroups.delete(id);
    renderGroupChips();
    updateAIControls();
    $('groups').replaceChildren();
    manualSelection?.beginRender();manualSelection?.setItems(groups.flatMap(group=>assigned(group.id).map(tab=>tab.id)));
    if (!tabs.length) {
      $('groups').append(e('div','empty','No tabs scanned yet. Scan this window to organize your work.'));
      return;
    }
    for (const group of groups) {
      const card = e('section','group'), header = e('div','group-header');
      const collapsed = collapsedGroups.has(group.id);
      card.setAttribute('id',`manual-group-${group.id}`); card.setAttribute('aria-label',group.name || 'Unnamed group');
      card.classList.toggle('is-collapsed',collapsed);
      bindManualTarget(card,group.id);
      const body = e('div','group-body'); body.setAttribute('id',`group-body-${group.id}`); body.hidden = collapsed;
      const name = e('input'); name.type = 'text'; name.maxLength = 80; name.value = group.name;
      name.setAttribute('aria-label', `Name for ${group.name}`);
      name.addEventListener('input', () => {group.name = name.value; reviewChanged(); renderGroupChips();});
      name.addEventListener('change',renderGroups);
      header.append(name,e('span','count',`${tabLabel(assigned(group.id).length)} · ${selected(group.id).length} included`));
      header.setAttribute('id',`group-toggle-${group.id}`); header.setAttribute('role','button'); header.setAttribute('tabindex','0');
      header.setAttribute('aria-label',`${collapsed ? 'Expand' : 'Collapse'} ${group.name || 'Unnamed group'}`);
      header.setAttribute('aria-expanded',String(!collapsed)); header.setAttribute('aria-controls',`group-body-${group.id}`);
      header.title = 'Click to show or hide tabs. Edit the name to rename this group.';
      bindGroupToggle(header,group.id,`group-toggle-${group.id}`);
      if (group.id !== 'ungrouped') {
        const remove = button('×',async()=>{
          const members=assigned(group.id), ungrouped=assigned('ungrouped');
          if(!groups.some(item=>item.id==='ungrouped'))groups.unshift({id:'ungrouped',name:'Ungrouped',reason:''});
          members.forEach((tab,index)=>{assignments.set(tab.id,'ungrouped');tabOrder.set(tab.id,ungrouped.length+index);});
          groups=groups.filter(item=>item.id!==group.id);collapsedGroups.delete('ungrouped');
          reviewChanged();renderGroups();notice('Group removed. Its tabs moved to Ungrouped; no browser tabs changed.');
        },'group-remove');
        remove.setAttribute('aria-label',`Remove ${group.name}; move tabs to Ungrouped`);remove.title='Remove group; keep its tabs in Ungrouped';card.append(remove);
      }
      card.append(header);
      const selectionActions = e('div','group-select-actions');
      for (const [label,include] of [['Include all',true],['Exclude all',false]]) selectionActions.append(button(label,async()=>{
        for (const tab of assigned(group.id).filter(tab=>tab.eligible)) if (include) excluded.delete(tab.id); else excluded.add(tab.id);
        reviewChanged(); renderGroups();
      }));
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
        if (draggableTab(tab)) { row.classList.toggle('draggable-tab',true); bindRowDrag(row,tab,group.id); row.append(dragHandle(tab,group.id)); }
        row.append(content);
        manualSelection?.bind(row,tab.id,()=>run(async()=>{
          const live=await api.tabs.get(tab.id);
          if(!live || live.incognito || live.windowId!==windowId || live.url!==tab.url)throw new Error('This tab changed. Refresh tabs and try again.');
          await api.tabs.update(tab.id,{active:true});notice(`Switched to ${tab.title}.`);
        }));
        list.append(row);
      }
      if (!assigned(group.id).length) list.append(e('div','empty','Move tabs here using the group menu on any tab.'));
      body.append(list);
      const actions = e('div','group-footer');
      const save = button('Save snapshot', () => saveGroup(group,false));
      const close = button('Save & close included', () => saveGroup(group,true),'primary');
      save.disabled = close.disabled = !selected(group.id).length;
      actions.append(save,close); body.append(actions); card.append(body); $('groups').append(card);
    }
  }
  async function saveGroup(group, close) {
    const selection = selected(group.id);
    if (!selection.length) throw new Error('Include at least one tab.');
    if (!group.name.trim()) throw new Error('Give the group a name first.');
    const text = close
      ? `Save ${selection.length} tabs in “${group.name}”, verify the snapshot, then close those tabs? Save any unsaved forms or work first. Restoring reopens URLs only. Tabs that changed after scanning will not be closed.`
      : `Save ${selection.length} tabs in “${group.name}”? The selected tabs will stay open.`;
    if (!await confirm(close ? 'Save your place, then close?' : 'Save a workspace?',text,close ? 'Save & close' : 'Save snapshot')) return;
    // Reuse this ID until the selection changes. Retrying after a lost response cannot close a second time.
    const key = JSON.stringify({generation, groupId: group.id, name: group.name, close, tabs: selection.map(t => [t.id, t.url])});
    if (!requests.has(key)) requests.set(key,crypto.randomUUID());
    if(groups.some(item=>item.id!=='ungrouped') && (!liveReady || !await queueLivePublish()))throw new Error('Load shared groups or refresh before saving so your organisation is preserved.');
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
  const editingReview = () => {
    const active = document.activeElement;
    return Boolean(active && (['INPUT','SELECT','TEXTAREA'].includes(String(active.tagName).toUpperCase()) || active.isContentEditable));
  };
  const inventoryValue = inventory => JSON.stringify(inventory.map(tab => [tab.id,tab.windowId,tab.url,tab.title,tab.index,tab.eligible,tab.pinned,tab.incognito,tab.pendingUrl]));
  async function scan({automatic = false} = {}) {
    if (automatic && (draggedTab || editingReview() || document.hidden)) return;
    const baseline = reviewRevision;
    if (!automatic) notice('Refreshing tabs in this Safari window…');
    const response = await send('scan',{windowId});
    // A refresh must never replace an edit made while Safari was answering.
    if (baseline !== reviewRevision || (automatic && (draggedTab || editingReview() || document.hidden))) return;
    const refreshed = response.tabs;
    const changed = inventoryValue(tabs) !== inventoryValue(refreshed);
    if (changed) {
      const previous = new Map(tabs.map(tab => [tab.id,tab]));
      const retained = new Set(refreshed.filter(tab => {
        const old = previous.get(tab.id);
        return old && old.url === tab.url && old.windowId === tab.windowId && old.eligible === tab.eligible && old.pinned === tab.pinned && old.incognito === tab.incognito;
      }).map(tab => tab.id));
      for (const map of [assignments,tabOrder]) for (const id of map.keys()) if (!retained.has(id)) map.delete(id);
      for (const id of excluded) if (!retained.has(id)) excluded.delete(id);
      tabs = refreshed; generation++;
      reviewChanged('Tabs changed. Previous AI suggestions were discarded; your existing group edits were kept.');
      $('ai-consent').checked = false;
      renderGroups();
    }
    globalThis.DashboardControls?.updateInventory(tabs,windowId);
    const eligible = tabs.filter(tab=>tab.eligible).length;
    $('scan-info').textContent = `${tabs.length} tabs · ${eligible} eligible · Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · Refreshes every 5 minutes while manager is visible`;
    if (!automatic) notice(eligible ? 'Tabs refreshed. Existing groups and exclusions were kept; new or changed tabs are ungrouped.' : 'No eligible web tabs found. Open regular websites in this window, then refresh.');
    if (liveReady) await queueLivePublish();
  }
  function revealAI() {
    globalThis.DashboardPages?.show('organise');
    $('ai').open = true;
    if (!pairedToken) $('connection-settings').open = true;
    $('ai').scrollIntoView?.({block:'start',behavior:'smooth'});
    if(pairedToken)$('ai-consent').focus({preventScroll:true});
  }
  async function snapshotWindow() {
    if(groups.some(group=>group.id!=='ungrouped') && (!liveReady || !await queueLivePublish()))throw new Error('Load shared groups or refresh before saving so your organisation is preserved.');
    const name = `Window ${new Date().toLocaleString()}`.slice(0,80);
    const {workspace, skipped} = await send('snapshot-window', {windowId, name, requestId: crypto.randomUUID()});
    await loadSaved();
    notice(`Saved ${workspace.tabs.length} web tabs. ${skipped} restricted or unavailable tabs skipped. All tabs remain open. Export a backup for a separate copy.`);
  }
  async function exportBackup(id) {
    const {filename} = await send('download-backup', id ? {id} : {});
    notice(`Saved ${filename} to Downloads. Contains full URLs and titles.`);
  }
  $('snapshot-window').addEventListener('click', () => run(snapshotWindow));
  $('export-all').addEventListener('click', () => run(() => exportBackup()));
  $('import-backup').addEventListener('click', () => { if (!busy) $('backup-file').click(); });
  // Dropping is a deliberate restore gesture; the file picker remains import-only.
  const fileDrag = transfer => Array.from(transfer?.types || []).includes('Files');
  document.body.addEventListener('dragover', event => {
    event.preventDefault(); // External URLs must never navigate away from the manager.
    if (!fileDrag(event.dataTransfer)) return;
    document.body.classList.toggle('backup-drop-active', !busy);
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  });
  document.body.addEventListener('dragleave', event => {
    if (!event.relatedTarget) document.body.classList.toggle('backup-drop-active', false);
  });
  document.body.addEventListener('drop', event => {
    event.preventDefault();
    document.body.classList.toggle('backup-drop-active', false);
    if(busy)return;
    if(!fileDrag(event.dataTransfer)){
      const types=Array.from(event.dataTransfer?.types || []);
      if(!types.includes(DRAG_TYPE) && !draggedTab)notice('Invalid format. Drop one Tabby JSON backup file.',true);
      return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    run(async () => {
      if (files.length !== 1) throw new Error('Drop one Tabby JSON backup at a time.');
      const file = files[0];
      if (file.size > C.MAX_BACKUP_BYTES) throw new Error('Choose a backup file smaller than 10 MB.');
      const json = await file.text();
      const decoded = C.decodeBackup(json);
      const total = decoded.reduce((sum, workspace) => sum + workspace.tabs.length, 0);
      notice(`Saving backup and opening ${total} saved URLs in a new window…`);
      try {
        const result = await send('drop-backup', {json, requestId: crypto.randomUUID(), windowId});
        const opened = result.workspaces.reduce((sum, workspace) => sum + Object.values(workspace.restore.results).filter(item => item.state === 'opened').length, 0);
        notice(result.repeated && !Number.isInteger(result.windowId) ? 'Snapshots saved. Safari did not confirm the new window; check Safari before restoring from Saved workspaces.' : `${opened}/${total} URLs opened in a new window. Snapshots kept. ${opened < total ? 'Review saved workspaces for recovery.' : 'Your existing windows remain open.'}`);
      } finally { await loadSaved(); }
    });
  });
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
      const wrapper = e('div','snapshot-entry');
      const card = e('details','workspace snapshot-card'), summary = e('summary','snapshot-summary');
      const date = new Date(workspace.createdAt);
      const hosts = new Set(workspace.tabs.map(tab=>{try{return new URL(tab.url).hostname;}catch{return '';}}));
      summary.title = `${workspace.name} — ${date.toLocaleString()} — tabs includes duplicates; sites counts distinct hostnames`;
      summary.setAttribute('aria-label',`${workspace.name}, ${date.toLocaleString()}, ${workspace.tabs.length} tabs, ${hosts.size} sites`);
      summary.append(e('span','snapshot-date',date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})),e('span','snapshot-stats',`${workspace.tabs.length} tabs · ${hosts.size} sites`));
      card.append(summary,e('h3','snapshot-name',workspace.name));
      const exportButton = button('Export JSON',()=>exportBackup(workspace.id),'snapshot-export');
      const remove = button('×',async()=>{
        await send('snapshot-trash',{id:workspace.id});await loadSaved();
        notice('Snapshot deleted.');
        $('status').append(button('Undo',async()=>{await send('snapshot-undo-delete',{id:workspace.id});await loadSaved();notice('Snapshot restored.');},'snapshot-undo'));
      },'snapshot-delete');
      remove.title='Delete snapshot';remove.setAttribute('aria-label',`Delete snapshot: ${workspace.name}`);
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
          : `Open ${amount} saved URLs in ${workspace.restore.windowId ? 'the original restore window' : 'this window'}? Already confirmed restores are skipped. The snapshot stays saved. Original tabs may still be open.`;
        if (!await confirm(complete ? 'Open another copy?' : 'Restore this workspace?',text,complete ? 'Open another copy' : 'Restore')) return;
        notice('Restoring saved URLs. Keep this window open…');
        try {
          const response = await send('restore',{id:workspace.id,windowId:complete ? windowId : (workspace.restore.windowId ?? windowId),...(complete ? {newSessionId:crypto.randomUUID(),previousSessionId:workspace.restore.sessionId || null} : {})});
          const count = Object.values(response.workspace.restore.results).filter(r=>r.state==='opened').length;
          const organization=response.workspace.restore.organization;
          const groupNotice=organization?.state==='skipped'?' Existing destination groups were kept; restored tabs may appear in Ungrouped.':organization?.state==='error'?' Tabs opened, but organisation could not be restored. Refresh groups and check recovery.':'';
          notice(`${workspace.name}: ${count}/${workspace.tabs.length} tabs restored. ${response.workspace.restore.state === 'complete' ? 'Snapshot kept for reference.' : 'Review failures and retry the remaining tabs.'}${groupNotice}`);
        } finally { await loadSaved(); }
      },'primary');
      restore.disabled = pending.length > 0;
      actions.append(restore); card.append(actions);
      const list = e('div','snapshot-tabs');
      const savedSelection=globalThis.TabbySelection?.create({announce:(count,clear)=>TabbySelection.toolbar($('status'),count,clear)});
      savedSelection?.setItems(workspace.tabs.map(tab=>tab.id));
      let lastSavedGroup;
      for (const tab of workspace.tabs) {
        if(workspace.groups?.length){const group=workspace.groups.find(group=>group.tabIds.includes(tab.id)),name=group?.name || 'Ungrouped';if(name!==lastSavedGroup){list.append(e('h3','snapshot-group-heading',name));lastSavedGroup=name;}}
        let requestId;
        const item=e('button','snapshot-tab');item.type='button';
        const openSaved=()=>run(async()=>{
          requestId ||= crypto.randomUUID();
          await send('snapshot-open-tab',{id:workspace.id,tabId:tab.id,windowId,requestId});
          requestId=undefined;notice('Saved tab opened in this window.');
        });
        if(savedSelection)savedSelection.bind(item,tab.id,openSaved);else item.addEventListener('click',openSaved);
        item.title=`Open in this window: ${tab.url}`;
        item.setAttribute('aria-label',`Open saved tab in this window: ${tab.title || 'Untitled tab'}`);
        let host=tab.url;try{host=new URL(tab.url).hostname;}catch{}
        item.append(e('strong','snapshot-tab-title',tab.title || 'Untitled tab'),e('small','snapshot-tab-host',host));
        const result = results[tab.id];
        if (result) item.append(e('p','',`Restore: ${result.state}${result.error ? ` — ${result.error}` : ''}`));
        list.append(item);
      }
      card.append(list);wrapper.append(card,exportButton,remove);$('workspaces').append(wrapper);
    }
  }
  async function loadClusterStatus() {
    const response = await send('cluster-status',{windowId});
    clusterOperation = response.operation || null;
    const stopped = clusterOperation && ['partial','interrupted'].includes(clusterOperation.state);
    $('cluster-status').textContent = stopped ? `The last reorder stopped after ${clusterOperation.moved || 0} confirmed move${clusterOperation.moved === 1 ? '' : 's'}. Refresh tabs and review their order before trying again.` : '';
    updateAIControls();
  }
  async function applyClusterPlan(plan, undo = false) {
    notice(undo ? 'Restoring the previous tab order…' : 'Arranging tabs in Safari…');
    try {
      clusterOperation = await send('cluster-apply',{windowId,planId:plan.planId});
      if (clusterOperation.state === 'complete') {
        notice(undo ? 'Previous tab order restored. All tabs remain open.' : `Tabs arranged by workspace. Protected tabs stayed in place. All tabs remain open.`);
      } else notice(`Reordering stopped after ${clusterOperation.moved || 0} confirmed move${clusterOperation.moved === 1 ? '' : 's'}. ${clusterOperation.error || 'Tabs changed while arranging.'} Review the tab bar before trying again.`,true);
    } finally {
      // Never repeat a move after an uncertain response. Read its journal instead.
      await loadClusterStatus();
      await scan({automatic:true});
    }
  }
  $('cluster-tabs').addEventListener('click',()=>run(async()=> {
    if (pendingSuggestions) throw new Error('Accept or discard AI suggestions before arranging Safari tabs.');
    if (!await queueLivePublish()) throw new Error('Refresh or load shared groups before arranging Safari tabs.');
    const plan = await send('cluster-preview',{windowId,expectedRevision:liveRevision,requestId:crypto.randomUUID()});
    if (!plan.moveCount) { notice('These tabs are already in workspace order. Protected tabs may separate a group.'); return; }
    const names = plan.groups.map(group=>`${group.name} (${group.count})`).join(', ');
    if (!await confirm('Cluster tabs in Safari?',`Arrange ${plan.tabCount} checked tabs by workspace: ${names}? This changes their real order in this window. Named groups come first, then Ungrouped; order within each group follows your review. Pinned, unchecked and restricted tabs stay fixed and may separate a group. No tabs are opened, closed or reloaded.`, 'Arrange tabs')) return;
    await applyClusterPlan(plan);
  }));
  $('undo-cluster').addEventListener('click',()=>run(async()=> {
    if (!clusterOperation?.canUndo) return;
    const plan = await send('cluster-undo-preview',{windowId,planId:clusterOperation.planId,requestId:crypto.randomUUID()});
    if (!await confirm('Undo the last tab reorder?','Restore the previous tab order in this window? Undo is available only while the tabs, their URLs and their current order still match the completed reorder. No tabs are opened or closed.','Restore order')) return;
    await applyClusterPlan(plan,true);
  }));
  $('live-reload')?.addEventListener('click',()=>run(async()=> {
    if (!await confirm('Load shared groups?', 'Replace this unsaved group review with the groups currently used by the toolbar switcher? Local group edits, exclusions and unaccepted AI suggestions will be discarded. Saved snapshots and browser tabs are unchanged.', 'Load shared groups')) return;
    await hydrateLiveGroups({replace:true});
  }));
  $('scan').addEventListener('click',()=>run(()=>scan()));
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
    if($('ai-remember'))$('ai-remember').checked=false;
    api.storage.session?.remove('tabby.dashboard.pairing.'+windowId).catch(()=>aiStatus('Could not clear saved session pairing. Try disconnecting again.',true));
    aiStatus('Disconnected. The pairing token was cleared from this page. Manual workspaces and existing review remain available.'); updateAIControls();
  });
  $('ai-consent').addEventListener('change',updateAIControls);
  $('suggest').addEventListener('click',()=>run(suggestAI));
  $('ai-discard').addEventListener('click',()=>{ if (busy) return; pendingSuggestions=null; renderSuggestions(); aiStatus('Suggestions discarded. Your manual groups are unchanged.'); });
  $('ai-accept').addEventListener('click',()=>run(acceptSuggestions));
  // Only update the local countdown; never poll the service or retry model calls.
  setInterval(updateAIControls,1000);
  setInterval(()=> {
    if (!busy && !draggedTab && !editingReview() && !document.hidden && Number.isInteger(windowId)) run(()=>scan({automatic:true}));
  },5 * 60 * 1000);
  api?.runtime?.onMessage?.addListener((message,sender)=> {
    if (message?.channel !== 'workspace-dashboard' || message.windowId !== windowId || sender?.id !== api.runtime.id) return undefined;
    if (!['refresh-inventory','ai-organise','live-groups-changed'].includes(message.type)) return undefined;
    const origin = api.runtime.getURL('');
    if (!sender.url?.startsWith(origin) || !['popup.html','dashboard.html'].includes(sender.url.slice(origin.length).split(/[?#]/)[0])) return undefined;
    if (message.type === 'live-groups-changed') {
      liveConflict = true;
      liveStatus('Groups changed in the toolbar popup. Your edits are kept here. Use Load shared groups to load the accepted groups.',true);
      updateAIControls();
      return Promise.resolve({ok:true});
    }
    if (busy || draggedTab || editingReview()) return Promise.resolve({ok:false,error:'Review is busy. Refresh again when ready.'});
    let result = {ok:false,error:'Could not refresh tabs. Check the manager for details.'};
    return run(async()=> { await scan(); if (message.type === 'ai-organise') revealAI(); result = {ok:await queueLivePublish()}; if (!result.ok) result.error = 'Toolbar groups could not be updated. Your review is kept in the manager.'; }).then(()=>result);
  });
  globalThis.addEventListener?.('hashchange',()=> { if (globalThis.location.hash === '#ai') revealAI(); });
  renderGroups();
  run(async()=> {
    if (!api?.runtime?.sendMessage) throw new Error('This page must be opened from the Tabby extension toolbar. Enable the extension in Safari Settings → Extensions.');
    const win = await api.windows.getCurrent(); windowId = win.id;
    if (win.incognito || (win.type && win.type !== 'normal')) throw new Error('Private browsing is excluded. Open the manager in a normal Safari window.');
    await loadSaved(); await scan(); await hydrateLiveGroups(); await loadClusterStatus();
    if(api.storage.session){
      const remembered=(await api.storage.session.get('tabby.dashboard.pairing.'+windowId))['tabby.dashboard.pairing.'+windowId];
      if(typeof remembered==='string' && remembered){pairedToken=remembered;$('ai-token').value=remembered;if($('ai-remember'))$('ai-remember').checked=true;aiStatus('Session pairing loaded. Refresh status to connect; no model request made.');updateAIControls();}
    }
    if (globalThis.location.hash === '#ai') revealAI();
  });
})();

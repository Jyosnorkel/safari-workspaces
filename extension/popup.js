const button = document.getElementById('open');
const status = document.getElementById('status');
let opening = false, aiBusy = false;
let liveRevision = 0;
let workspaceButtons = [];
let popupDrag = null;
const expandedGroups = new Set();
const liveSelection=globalThis.TabbySelection?.create({announce:(count,clear)=>TabbySelection.toolbar(status,count,clear)});
const homeMultiSelection=globalThis.TabbySelection?.create({announce:(count,clear)=>TabbySelection.toolbar(status,count,clear)});

function isDashboard(candidate, dashboardURL) {
  if (typeof candidate !== 'string') return false;
  try {
    const current = new URL(candidate);
    const expected = new URL(dashboardURL);
    // The dashboard uses hash links such as #saved. Reuse that tab too.
    return current.protocol === expected.protocol && current.host === expected.host && current.pathname === expected.pathname;
  } catch { return false; }
}

function setBusy(value) {
  opening = value;
  for (const id of ['open','save-snapshot','ai-organise','refresh-tabs']) {
    const control = document.getElementById(id);
    if (control) control.disabled = value || aiBusy;
  }
  for (const control of workspaceButtons) control.disabled = value || aiBusy;
  for (const control of (document.querySelectorAll?.('.home-tab') || [])) control.disabled = value || aiBusy;
}
async function currentWindow() {
  const api = globalThis.browser;
  if (!api?.windows?.getCurrent || !api?.runtime?.getURL) throw new Error('Open this popup from the enabled Safari extension.');
  const win = await api.windows.getCurrent();
  if (win.incognito) throw new Error('Use a normal Safari window. Private browsing is excluded.');
  if (!Number.isInteger(win.id) || (win.type && win.type !== 'normal')) throw new Error('Open a normal Safari window, then try again.');
  return win;
}
async function send(type, values) {
  const response = await browser.runtime.sendMessage({channel:'workspace',type,...values});
  if (!response?.ok) throw new Error(response?.error || 'Safari could not complete this action. Try refreshing tabs.');
  return response;
}
async function action(work) {
  if (opening || aiBusy) return;
  setBusy(true);
  try { await work(); }
  catch (error) { status.textContent = error.message || 'Could not complete this action. Try again.'; }
  finally { setBusy(false); }
}
async function openManager(ai = false) {
  status.textContent = ai ? 'Opening AI organise. Review the tabs and data sharing before requesting suggestions…' : 'Opening your workspace manager…';
  const win = await currentWindow(), api = globalThis.browser;
  const url = api.runtime.getURL('dashboard.html');
  const existing = (await api.tabs.query({windowId:win.id})).find(tab => Number.isInteger(tab.id) && isDashboard(tab.url,url));
  if (existing) {
    if (ai) {
      let response;
      try { response = await api.runtime.sendMessage({channel:'workspace-dashboard',type:'ai-organise',windowId:win.id}); } catch {}
      if (!response?.ok) { await api.tabs.update(existing.id,{active:true,url:url+'#ai'}); return; }
    }
    await api.tabs.update(existing.id,{active:true});
  } else await api.tabs.create({windowId:win.id,url:url + (ai ? '#ai' : ''),active:true});
  status.textContent = 'Workspace manager opened.';
}
button.addEventListener('click', () => action(() => openManager()));
document.getElementById('ai-organise')?.addEventListener?.('click', () => action(async () => {
  if (!globalThis.PopupAI?.open) throw new Error('AI controls could not load. Refresh the extension and try again.');
  await globalThis.PopupAI.open();
}));
function popupNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function loadLiveGroups(windowId) {
  const container = document.getElementById('live-groups');
  if (!container) return;
  const response = await send('live-groups-get',{windowId});
  const scrollPane=document.querySelector?.('main'),savedScroll=scrollPane?.scrollTop;
  popupDrag = null;
  liveRevision = response.revision;
  workspaceButtons = [];
  container.replaceChildren();
  const publish = async groups => {
    await send('live-groups-set',{windowId,expectedRevision:liveRevision,groups:groups.map(({id,name,reason,tabs})=>({id,name,reason:reason || '',tabs:tabs.map(({id,url,excluded})=>({id,url,excluded:Boolean(excluded)}))}))});
    await loadLiveGroups(windowId);
    await browser.runtime.sendMessage({channel:'workspace-dashboard',type:'live-groups-changed',windowId}).catch(()=>{});
  };
  const addForm = popupNode('form','workspace-add');
  const nameInput = popupNode('input'); nameInput.type='text';nameInput.maxLength=80;nameInput.placeholder='New group name';nameInput.setAttribute('aria-label','New group name');
  const addButton = popupNode('button','','Add group');addButton.type='submit';
  addForm.append(nameInput,addButton);
  addForm.addEventListener('submit',event=> {event.preventDefault();if(!nameInput.value.trim()){status.textContent='Enter a name for your new group.';nameInput.focus?.();return;}action(async()=> {await publish([...response.groups,{id:crypto.randomUUID(),name:nameInput.value.trim(),tabs:[]}]);status.textContent='Group added.';});});
  workspaceButtons.push(addButton,nameInput);
  const groups = response.groups;
  liveSelection?.beginRender();liveSelection?.setItems(groups.flatMap(group=>group.tabs.map(tab=>tab.id)));
  if (!groups.length) {
    container.append(addForm,popupNode('p','workspace-empty','Add a group or use AI organise to get started.'));
    return;
  }
  for (const group of groups) {
    const card = popupNode('section','live-workspace');
    const validDrag = event => popupDrag && !opening && !aiBusy && popupDrag.revision === liveRevision && Array.from(event.dataTransfer?.types || []).includes('application/x-tabby-row');
    const dropTab = (event, beforeId = null) => {
      if (!validDrag(event)) return;
      event.preventDefault(); event.stopPropagation();
      const drag = popupDrag; popupDrag = null;
      card.classList.remove('is-drop-target');
      if ((drag.tabIds || [drag.tabId]).includes(beforeId)) return;
      action(async () => {
        const next = response.groups.map(item => ({id:item.id,name:item.name,reason:item.reason || '',tabs:item.tabs.map(({id,url,excluded})=>({id,url,excluded:Boolean(excluded)}))}));
        const ids=drag.tabIds || [drag.tabId], moving=next.flatMap(item=>item.tabs).filter(tab=>ids.includes(tab.id));
        const target = next.find(item => item.id === group.id);
        if(!target || moving.length!==ids.length)throw new Error('Refresh tabs before moving these rows.');
        for(const item of next)item.tabs=item.tabs.filter(tab=>!ids.includes(tab.id));
        const before = beforeId === null ? target.tabs.length : target.tabs.findIndex(item => item.id === beforeId);
        if (before < 0) throw new Error('Refresh tabs before moving these rows.');
        target.tabs.splice(before,0,...moving);
        await send('live-groups-set',{windowId,expectedRevision:drag.revision,groups:next});
        expandedGroups.add(group.id);
        await loadLiveGroups(windowId);
        await browser.runtime.sendMessage({channel:'workspace-dashboard',type:'live-groups-changed',windowId}).catch(()=>{});
        status.textContent = `Tab moved in ${group.name}.`;
      });
    };
    card.addEventListener('dragover',event => {
      if (!validDrag(event)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
      for(const node of container.querySelectorAll('.is-drop-target, .drop-before'))node.classList.remove('is-drop-target','drop-before');
      card.classList.add('is-drop-target');
    });
    card.addEventListener('dragleave',()=>card.classList.remove('is-drop-target'));
    card.addEventListener('drop',event=>dropTab(event));
    const header = popupNode('div','workspace-header');
    const focus = popupNode('button','workspace-focus'); focus.type = 'button';
    focus.setAttribute('aria-label',`Switch to ${group.name}, ${group.tabs.length} tabs`);
    focus.append(popupNode('span','workspace-name',group.name),popupNode('span','workspace-count',String(group.tabs.length)));
    focus.title = `${group.name} — click to show or hide tabs`;
    const toggle = focus;
    const list = popupNode('div','workspace-tabs'); list.hidden = !expandedGroups.has(group.id);
    toggle.setAttribute('aria-expanded',String(!list.hidden));
    toggle.setAttribute('aria-label',`${list.hidden ? 'Show' : 'Hide'} tabs in ${group.name}`);
    list.id = `workspace-tabs-${group.id}`;
    toggle.setAttribute('aria-controls',list.id);
    toggle.addEventListener('click',()=> {
      if (opening || aiBusy) return;
      list.hidden = !list.hidden;
      if (list.hidden) expandedGroups.delete(group.id); else expandedGroups.add(group.id);
        toggle.setAttribute('aria-expanded',String(!list.hidden));
      toggle.setAttribute('aria-label',`${list.hidden ? 'Show' : 'Hide'} tabs in ${group.name}`);
    });
    header.append(focus);
    let removeControl;
    if (group.id !== 'ungrouped') {
      const remove = popupNode('button','workspace-remove','×');remove.type='button';remove.title='Remove group; keep its tabs in Ungrouped';remove.setAttribute('aria-label',`Remove ${group.name}; move tabs to Ungrouped`);
      remove.addEventListener('click',()=>action(async()=> {
        const next=response.groups.filter(item=>item.id!==group.id).map(item=>({...item,tabs:[...item.tabs]}));
        let ungrouped=next.find(item=>item.id==='ungrouped');
        if(!ungrouped){ungrouped={id:'ungrouped',name:'Ungrouped',tabs:[]};next.push(ungrouped);}
        ungrouped.tabs.push(...group.tabs);expandedGroups.add('ungrouped');await publish(next);status.textContent='Group removed. Tabs moved to Ungrouped.';
      }));removeControl=remove;workspaceButtons.push(remove);
    }
    card.append(header,list);
    if(removeControl)card.append(removeControl);
    workspaceButtons.push(focus);
    for (const tab of group.tabs) {
      const jump = popupNode('button','workspace-tab'); jump.type = 'button';
      jump.draggable = true;
      jump.title = `${tab.title || 'Untitled tab'}\nDrag to a group, or above another tab to reorder${tab.excluded ? '\nExcluded from group actions' : ''}`;
      jump.addEventListener('dragstart',event => {
        if (opening || aiBusy) { event.preventDefault(); return; }
        popupDrag = {tabId:tab.id,tabIds:liveSelection?.dragIds(tab.id) || [tab.id],groupId:group.id,revision:liveRevision};
        event.dataTransfer.setData('application/x-tabby-row','internal');
        event.dataTransfer.effectAllowed = 'move';
      });
      jump.addEventListener('dragend',()=> { popupDrag = null; for (const node of container.querySelectorAll('.is-drop-target, .drop-before')) node.classList.remove('is-drop-target','drop-before'); });
      jump.addEventListener('dragover',event=> {
        if (!validDrag(event)) return;
        event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
        for(const node of container.querySelectorAll('.is-drop-target, .drop-before'))node.classList.remove('is-drop-target','drop-before');
        jump.classList.add('drop-before');
      });
      jump.addEventListener('dragleave',()=>jump.classList.remove('drop-before'));
      jump.addEventListener('drop',event=>{jump.classList.remove('drop-before');dropTab(event,tab.id);});
      const title = tab.title || 'Untitled tab';
      jump.setAttribute('aria-label',`Switch to tab: ${title}`);
      if (tab.active) jump.setAttribute('aria-current','page');
      jump.append(popupNode('span','workspace-tab-title',title));
      // Text only: never turn saved/model-provided URLs into navigation instructions.
      let host = ''; try { host = new URL(tab.url).hostname; } catch {}
      jump.append(popupNode('small','workspace-tab-host',host));
      const activate=()=>action(async()=> {
        await send('live-groups-focus',{windowId,groupId:group.id,tabId:tab.id,expectedRevision:liveRevision});
        status.textContent = `Switched to ${title}.`;
      });
      if(liveSelection)liveSelection.bind(jump,tab.id,activate);else jump.addEventListener('click',activate);
      workspaceButtons.push(jump);list.append(jump);
    }
    container.append(card);
  }
  container.append(addForm);
  if(scrollPane && Number.isFinite(savedScroll))scrollPane.scrollTop=savedScroll;
}
// Home search uses the latest explicit local scan; activation never opens a URL.
let homeInventory = [], homeWindowId, homeSelection = -1, homeMatches = [];
function renderHomeTabs() {
  const list = document.getElementById('home-tab-list');
  if (!list) return;
  const query = (document.getElementById('home-tab-search')?.value || '').trim().toLocaleLowerCase();
  homeMatches = homeInventory.filter(tab => `${tab.title || ''} ${tab.url || ''}`.toLocaleLowerCase().includes(query));
  homeSelection = Math.max(-1, Math.min(homeSelection, homeMatches.length - 1));
  list.replaceChildren();
  homeMultiSelection?.beginRender();homeMultiSelection?.setItems(homeMatches.map(tab=>tab.id));
  const count = document.getElementById('home-tab-results');
  if (count) count.textContent = `${homeMatches.length} of ${homeInventory.length} tabs`;
  if (!homeMatches.length) list.append(popupNode('p','workspace-empty',query ? 'No matching tabs.' : 'No tabs available. Refresh tabs to try again.'));
  homeMatches.forEach((tab,index) => {
    const row = popupNode('button','workspace-tab home-tab'); row.type = 'button';
    row.classList.toggle('is-selected',index === homeSelection);
    row.title = tab.url || tab.title || 'Untitled tab';
    row.setAttribute('aria-label',`Switch to tab: ${tab.title || 'Untitled tab'}`);
    if (tab.active) row.setAttribute('aria-current','page');
    let host = ''; try { host = new URL(tab.url).hostname; } catch {}
    row.append(popupNode('span','workspace-tab-title',tab.title || 'Untitled tab'),popupNode('small','workspace-tab-host',host || 'Safari tab'));
    row.disabled = opening || aiBusy;
    if(homeMultiSelection)homeMultiSelection.bind(row,tab.id,()=>activateHomeTab(tab));else row.addEventListener('click',()=>activateHomeTab(tab));
    list.append(row);
  });
}
function activateHomeTab(tab) {
  return action(async()=> {
    const live = await browser.tabs.get(tab.id);
    if (live.incognito || live.windowId !== homeWindowId || live.url !== tab.url) throw new Error('This tab changed. Refresh tabs and try again.');
    await browser.tabs.update(tab.id,{active:true});
    status.textContent = `Switched to ${tab.title || 'tab'}.`;
  });
}
const homeSearch = document.getElementById('home-tab-search');
homeSearch?.addEventListener?.('input',()=>{homeSelection=-1;renderHomeTabs();});
homeSearch?.addEventListener?.('keydown',event=>{
  if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
  if (['ArrowDown','ArrowUp'].includes(event.key) && homeMatches.length) {
    event.preventDefault();
    homeSelection = homeSelection < 0 ? (event.key === 'ArrowDown' ? 0 : homeMatches.length-1) : (homeSelection + (event.key === 'ArrowDown' ? 1 : -1) + homeMatches.length) % homeMatches.length;
    renderHomeTabs();
    document.getElementById('home-tab-list')?.children[homeSelection]?.scrollIntoView?.({block:'nearest'});
  } else if (event.key === 'Enter' && homeMatches.length) {
    event.preventDefault();activateHomeTab(homeMatches[Math.max(0,homeSelection)]);
  }
});
async function refreshTabs() {
  const win = await currentWindow();
  status.textContent = 'Refreshing tabs…';
  const result = await send('scan',{windowId:win.id});
  homeWindowId=win.id;homeInventory=result.tabs.filter(tab=>Number.isInteger(tab.id) && !tab.incognito);homeSelection=-1;renderHomeTabs();
  const eligible = result.tabs.filter(tab => tab.eligible).length;
  document.getElementById('tab-count').textContent = `${result.tabs.length} tabs · ${eligible} available to organise`;
  document.getElementById('scan-time').textContent = `Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  // A loaded manager merges fresh metadata without replacing the user's grouping.
  await browser.runtime.sendMessage({channel:'workspace-dashboard',type:'refresh-inventory',windowId:win.id}).catch(() => {});
  await send('live-groups-sync-scan',{windowId:win.id});
  await loadLiveGroups(win.id);
  await globalThis.PopupAI?.refreshInventory?.();
  status.textContent = 'Tabs refreshed. No data sent to AI.';
}
document.getElementById('refresh-tabs')?.addEventListener?.('click', () => action(refreshTabs));
let snapshotRequestId;
document.getElementById('save-snapshot')?.addEventListener?.('click', () => action(async () => {
  const win = await currentWindow();
  snapshotRequestId ||= crypto.randomUUID();
  status.textContent = 'Saving this window…';
  const {workspace} = await send('snapshot-window',{windowId:win.id,name:`Window ${new Date().toLocaleString()}`.slice(0,80),requestId:snapshotRequestId});
  status.textContent = `Saved ${workspace.tabs.length} tabs. All tabs remain open.`;
  snapshotRequestId = undefined;
}));
// Refresh on popup opening, locally only. The manager refreshes every five minutes.
if (globalThis.browser?.runtime?.sendMessage && document.getElementById('refresh-tabs')?.addEventListener) action(refreshTabs);

// The toolbar popup uses the same durable import/restore operation as the dashboard.
// Safari may dismiss this popup when the new window is focused; the background
// coordinator owns the operation and its recovery journal, not this page.
const dropArea = document.getElementById('backup-drop');
const isFileDrag = transfer => Array.from(transfer?.types || []).includes('Files');
document.body.addEventListener('dragover', event => {
  event.preventDefault();
  const allowed = !opening && !aiBusy && isFileDrag(event.dataTransfer);
  dropArea.classList.toggle('is-over', allowed);
  if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
});
document.body.addEventListener('dragleave', event => {
  if (!event.relatedTarget) dropArea.classList.toggle('is-over', false);
});
document.body.addEventListener('drop', async event => {
  event.preventDefault();
  dropArea.classList.toggle('is-over', false);
  if (opening || aiBusy) return;
  if (!isFileDrag(event.dataTransfer)) {
    if (!Array.from(event.dataTransfer?.types || []).includes('application/x-tabby-row')) status.textContent='Invalid format. Drop a Tabby JSON backup file.';
    return;
  }
  setBusy(true);
  try {
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) throw new Error('Drop one Tabby JSON backup at a time.');
    const file = files[0];
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.');
    const api = globalThis.browser;
    if (!api?.windows?.getCurrent || !api?.runtime?.sendMessage) throw new Error('Open this popup from the enabled Safari extension.');
    const win = await api.windows.getCurrent();
    if (win.incognito || !Number.isInteger(win.id) || (win.type && win.type !== 'normal')) throw new Error('Use a normal Safari window. Private browsing is excluded.');
    status.textContent = 'Checking and saving backup, then opening a new window…';
    const json = await file.text();
    try { if(globalThis.WorkspaceCore)globalThis.WorkspaceCore.decodeBackup(json); }
    catch { throw new Error('Invalid format. Choose a valid Tabby JSON backup. No tabs were opened.'); }
    const response = await api.runtime.sendMessage({channel:'workspace', type:'drop-backup', json, requestId:crypto.randomUUID(), windowId:win.id});
    if (!response?.ok) throw new Error(response?.error || 'Could not restore this backup. Check Saved workspaces for recovery before trying again.');
    const records = response.workspaces || [];
    const total = records.reduce((count, record) => count + record.tabs.length, 0);
    const opened = records.reduce((count, record) => count + Object.values(record.restore.results).filter(result => result.state === 'opened').length, 0);
    status.textContent = `${opened}/${total} saved URLs opened. Snapshots kept in Saved workspaces.${opened < total ? ' Open the manager to review recovery.' : ''}`;
  } catch (error) {
    status.textContent = error.message || 'Backup could not be restored. Open Saved workspaces to check recovery.';
  } finally {
    setBusy(false);
  }
});

// Popup AI has its own in-flight lock, independent of short toolbar actions.
globalThis.PopupAIHooks = {
  setBusy(value) { aiBusy = Boolean(value); setBusy(opening); },
  async onAccepted() {
    const win = await currentWindow();
    await loadLiveGroups(win.id);
    await browser.runtime.sendMessage({channel:'workspace-dashboard',type:'live-groups-changed',windowId:win.id}).catch(()=>{});
  }
};


// Popup navigation and local preferences; no background inference or tab mutations.
if (document.querySelectorAll && document.getElementById('settings-open')) (() => {
  const key='tabby.settings.v1', defaults={theme:'system',preferences:'',autosave:0,compact:false};
  let settings={...defaults},view='home';
  const $=id=>document.getElementById(id);
  function theme(){document.documentElement.dataset.theme=settings.theme;document.body.classList.toggle('compact',settings.compact);}
  async function snapshots(){
    const list=$('snapshot-list');list.textContent='Loading…';
    try {
      const result=await send('list',{});list.replaceChildren();
      if(!result.workspaces.length)list.append(popupNode('p','workspace-help','No snapshots yet. Save your first snapshot from Home.'));
      for(const snapshot of result.workspaces){
        const wrapper=popupNode('div','snapshot-entry');
        const card=popupNode('details','snapshot-card'),summary=popupNode('summary');
        const domains=new Set(snapshot.tabs.map(tab=>{try{return new URL(tab.url).hostname;}catch{return '';}}));
        const date=new Date(snapshot.createdAt);
        const dateLabel=date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
        summary.setAttribute('aria-label',`${date.toLocaleString()} · ${snapshot.tabs.length} tabs · ${domains.size} sites`);
        summary.title=`${date.toLocaleString()} — tabs includes duplicates; sites counts distinct hostnames`;
        summary.append(popupNode('span','snapshot-date',dateLabel),popupNode('span','snapshot-stats',`${snapshot.tabs.length} tabs · ${domains.size} sites`));
        card.append(summary);
        const exportButton=popupNode('button','snapshot-export','Export JSON');exportButton.type='button';
        exportButton.addEventListener('click',()=>action(async()=>{
          exportButton.disabled=true;
          try {
            const {filename}=await send('download-backup',{id:snapshot.id});
            status.textContent=`Saved ${filename} to Downloads. Contains full tab URLs and titles.`;
          } finally {exportButton.disabled=false;}
        }));
        const remove=popupNode('button','snapshot-delete','×');remove.type='button';remove.title='Delete snapshot';remove.setAttribute('aria-label',`Delete snapshot from ${date.toLocaleString()}`);
        remove.addEventListener('click',()=>action(async()=>{
          await send('snapshot-trash',{id:snapshot.id});await snapshots();
          status.textContent='Snapshot deleted. ';const undo=popupNode('button','snapshot-undo','Undo');undo.type='button';
          undo.addEventListener('click',()=>action(async()=>{await send('snapshot-undo-delete',{id:snapshot.id});await snapshots();status.textContent='Snapshot restored.';}));status.append(undo);
        }));
        const savedSelection=globalThis.TabbySelection?.create({announce:(count,clear)=>TabbySelection.toolbar(status,count,clear)});
        savedSelection?.setItems(snapshot.tabs.map(tab=>tab.id));
        let lastSavedGroup;
        for(const tab of snapshot.tabs){
          if(snapshot.groups?.length){const group=snapshot.groups.find(group=>group.tabIds.includes(tab.id)),name=group?.name || 'Ungrouped';if(name!==lastSavedGroup){card.append(popupNode('h3','snapshot-group-heading',name));lastSavedGroup=name;}}
          const row=popupNode('button','snapshot-tab');row.type='button';row.title=`Open in this window: ${tab.url}`;
          let requestId;
          const openSaved=()=>action(async()=>{
            requestId ||= crypto.randomUUID();
            const win=await currentWindow();
            await send('snapshot-open-tab',{id:snapshot.id,tabId:tab.id,windowId:win.id,requestId});
            requestId=undefined;status.textContent='Saved tab opened in this window.';
          });
          if(savedSelection)savedSelection.bind(row,tab.id,openSaved);else row.addEventListener('click',openSaved);
          let host=tab.url;try{host=new URL(tab.url).hostname;}catch{}
          row.append(popupNode('strong','snapshot-tab-title',tab.title || 'Untitled tab'),popupNode('small','snapshot-tab-host',host));
          card.append(row);
        }
        wrapper.append(card,exportButton,remove);list.append(wrapper);
      }
    }catch(error){list.textContent=error.message;}
  }
  function show(next){
    view=next;
    const pane=document.querySelector?.('main'); if(pane)pane.scrollTop=0;
    for(const id of ['home-view','home-extras'])$(id).hidden=next!=='home';
    $('home-groups').hidden=next!=='organise';
    $('popup-ai-panel').hidden=next!=='organise';$('snapshots-view').hidden=next!=='snapshots';$('settings-view').hidden=next!=='settings';
    for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-current',button.dataset.view===next?'page':'false');
    if(next==='organise')globalThis.PopupAI?.open();
    if(next==='snapshots')snapshots();
  }
  document.addEventListener?.('keydown',event=>{
    if(event.isComposing || event.altKey)return;
    if(event.metaKey && event.shiftKey && !event.ctrlKey && event.key.toLowerCase()==='f'){
      event.preventDefault();
      if(!event.repeat)window.close();
      return;
    }
    if(opening || aiBusy)return;
    const editing=['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable;
    if(((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='f') || (event.key==='/' && !editing && !event.metaKey && !event.ctrlKey)){
      event.preventDefault();if(view!=='home')show('home');homeSearch?.focus();homeSearch?.select?.();
    }
  });
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{if(!opening&&!aiBusy)show(button.dataset.view);});
  $('settings-open').addEventListener('click',()=>{if(!opening&&!aiBusy)show(view==='settings'?'home':'settings');});
  $('ai-organise').addEventListener('click',()=>{if(!aiBusy)show('organise');});
  $('popup-ai-close').addEventListener('click',()=>{if(!aiBusy)show('home');});
  $('settings-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const next={theme:$('setting-theme').value,preferences:$('setting-preferences').value.trim().slice(0,1200),autosave:Number($('setting-autosave').value),compact:$('setting-compact').checked};
    try{await browser.storage.local.set({[key]:next});settings=next;theme();status.textContent='Settings saved.';}catch{status.textContent='Settings could not be saved. Try again.';}
  });
  (async()=>{
    try{
      const saved=(await browser.storage.local.get(key))[key];
      if(saved && ['system','light','dark'].includes(saved.theme) && typeof saved.preferences==='string' && [0,5,15,30,60].includes(saved.autosave))settings={...defaults,...saved};
      $('setting-theme').value=settings.theme;$('setting-preferences').value=settings.preferences;$('setting-autosave').value=String(settings.autosave);$('setting-compact').checked=settings.compact;theme();show('home');
      for(let wait=0;opening && wait<50;wait++)await new Promise(resolve=>setTimeout(resolve,100));
      if(settings.autosave){
        const win=await currentWindow(),stampKey=`tabby.autosave.${win.id}`,last=(await browser.storage.local.get(stampKey))[stampKey] || 0;
        if(Date.now()-last>=settings.autosave*60000 && !opening&&!aiBusy){await action(async()=>{await send('snapshot-window',{windowId:win.id,name:`Autosave ${new Date().toLocaleString()}`.slice(0,80),requestId:crypto.randomUUID()});await browser.storage.local.set({[stampKey]:Date.now()});status.textContent='Autosave snapshot saved. All tabs remain open.';});}
      }
    }catch{status.textContent='Could not load settings or autosave. Manual actions remain available.';}
  })();
})();

/* Popup AI review. Only the background coordinator can request inference. */
(() => {
  const api = globalThis.browser;
  const $ = id => document.getElementById(id);
  const panel = $('popup-ai-panel');
  if (!panel) return;
  let hooks = globalThis.PopupAIHooks || {}, windowId, state = null, pageToken = '';
  let localBusy = false, editable = [], draft = null, draftRequestId = null, uncertainRequest = false;
  let selected = new Set(), inventoryFingerprint = '', pollTimer = null;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const message = (text, error = false) => {
    $('popup-ai-status').textContent = text;
    $('popup-ai-status').classList.toggle('error',error);
  };
  const busy = () => localBusy || state?.state === 'requesting';
  const input = () => (state?.tabs || []).filter(tab=>selected.has(String(tab.id))).map(tab=>({id:String(tab.id),title:tab.title,url:tab.url}));
  function updateControls() {
    const locked = busy(), usage = state?.usage;
    for (const id of ['popup-ai-token','popup-ai-remember','popup-ai-connect','popup-ai-refresh','popup-ai-forget','popup-ai-close','popup-ai-discard','popup-ai-accept']) $(id).disabled = locked;
    for (const element of editable) element.disabled = locked || (element.type==='checkbox' && Boolean(draft));
    $('popup-ai-consent').disabled = locked || Boolean(draft);
    $('popup-ai-accept').disabled = locked || !draft || Boolean(state?.stale);
    $('popup-ai-forget').disabled = locked || !(pageToken || state?.remembered || state?.connected);
    const attempts = usage?.requestsPerSuggestion || 2;
    const cooling = Number(usage?.retryAt || 0) > Date.now();
    $('popup-ai-generate').disabled = locked || uncertainRequest || Boolean(draft) || !state?.connected || !(pageToken || state?.remembered) || !usage?.enabled || !usage?.configured || usage?.busy || cooling || (usage?.remainingToday ?? 0) < attempts || (usage?.remainingThisMinute ?? 0) < attempts || !selected.size || !$('popup-ai-consent').checked;
    $('popup-ai-generate').textContent = state?.state === 'requesting' ? 'Requesting suggestions…' : 'Send tabs & suggest groups';
    $('popup-ai-preview').textContent = JSON.stringify(input(),null,2);
    hooks.setBusy?.(locked);
  }
  function renderUsage() {
    const usage=state?.usage;
    if (!usage) { $('popup-ai-usage').textContent='Connect to see service status and request limits. No AI request is made by opening this panel.';return; }
    const attempts=usage.requestsPerSuggestion || 2;
    const reset=usage.dailyResetAt ? new Date(usage.dailyResetAt).toLocaleString() : 'unavailable';
    const cooldown=Number(usage.retryAt || 0)>Date.now() ? ` Cooldown until ${new Date(usage.retryAt).toLocaleTimeString()}.` : '';
    $('popup-ai-usage').textContent=`${usage.remainingToday ?? '—'} remote attempts left today · ${usage.remainingThisMinute ?? '—'} this minute. Limits ${usage.perMinute ?? 2}/minute, ${usage.perDay ?? 20}/day. A suggestion uses ${attempts} attempts (token count + generation), at most ${Math.floor((usage.perDay ?? 20)/attempts)} full suggestions/day. Reset ${reset}.${cooldown} These are local service limits, not an account-wide spending cap.`;
  }
  function renderTabs() {
    const list=$('popup-ai-tabs');list.replaceChildren();
    for (const tab of state?.tabs || []) {
      const row=node('label','popup-ai-tab');
      const check=node('input');check.type='checkbox';check.checked=selected.has(String(tab.id));
      check.setAttribute('aria-label',`Send ${tab.title} for AI grouping`);
      check.addEventListener('change',()=> {
        if (busy()) return;
        if (check.checked) selected.add(String(tab.id));else selected.delete(String(tab.id));
        $('popup-ai-consent').checked=false;updateControls();
      });
      const text=node('span');text.append(node('span','popup-ai-tab-title',tab.title),node('small','popup-ai-tab-url',tab.url));
      row.append(check,text);list.append(row);editable.push(check);
    }
    if (!state?.tabs?.length) list.append(node('p','workspace-empty','No eligible tabs. Open regular web pages, then refresh tabs.'));
  }
  function proposalDraft(proposal) {
    const groups=proposal.groups.map((group,index)=>({...group,id:`proposal-${index}`}));
    const assignments=new Map();
    for (const group of groups) for (const id of group.tabIds) assignments.set(String(id),group.id);
    return {groups,assignments};
  }
  function renderReview() {
    const review=$('popup-ai-review'),list=$('popup-ai-groups');list.replaceChildren();review.hidden=!draft;
    if (!draft) return;
    const tabs=state?.proposal?.tabs || state?.tabs || [];
    const wanted=new Set((state?.proposal?.groups || []).flatMap(group=>group.tabIds.map(String)).concat((state?.proposal?.ungrouped || []).map(String)));
    const buckets=[...draft.groups,{id:'ungrouped',name:'Leave ungrouped',reason:''}];
    for (const group of buckets) {
      const card=node('section','popup-ai-group');
      if (group.id==='ungrouped') card.append(node('h3','',group.name));
      else {
        const name=node('input');name.type='text';name.value=group.name;name.maxLength=80;
        name.setAttribute('aria-label',`Suggested group name ${draft.groups.indexOf(group)+1}`);
        name.addEventListener('input',()=>{if(!busy())group.name=name.value;});editable.push(name);card.append(name);
        if (group.reason) card.append(node('p','popup-ai-reason',group.reason));
      }
      let count=0;
      for (const tab of tabs) {
        if (!wanted.has(String(tab.id)) || (draft.assignments.get(String(tab.id)) || 'ungrouped')!==group.id) continue;
        count++;
        const row=node('div','popup-ai-proposal-tab');row.append(node('span','',tab.title));
        const select=node('select');select.setAttribute('aria-label',`Suggested group for ${tab.title}`);
        for (const target of buckets) {
          const option=node('option','',target.name || 'Unnamed group');option.value=target.id;option.selected=target.id===group.id;select.append(option);
        }
        select.addEventListener('change',()=>{if(!busy()){draft.assignments.set(String(tab.id),select.value);render();}});
        editable.push(select);row.append(select);card.append(row);
      }
      if (!count) card.append(node('p','workspace-empty',group.id==='ungrouped'?'All included tabs are assigned.':'Empty groups are omitted when accepted.'));
      list.append(card);
    }
  }
  function render() {
    editable=[];renderTabs();renderUsage();renderReview();updateControls();
  }
  function receive(response) {
    const previousState=state?.state;
    const next=response.state;
    // Route responses expose state as fields; no pairing token comes back.
    state=response;
    uncertainRequest=false;
    const fingerprint=JSON.stringify((state.tabs || []).map(tab=>[tab.id,tab.title,tab.url,tab.included]));
    if (fingerprint!==inventoryFingerprint) {
      selected=new Set((state.tabs || []).filter(tab=>tab.included!==false).map(tab=>String(tab.id)));
      inventoryFingerprint=fingerprint;$('popup-ai-consent').checked=false;
    }
    if (state.proposal && state.requestId!==draftRequestId) { draft=proposalDraft(state.proposal);draftRequestId=state.requestId; }
    if (!state.proposal) {draft=null;draftRequestId=null;}
    if (next==='requesting') message('Requesting suggestions. You can dismiss this popup and reopen it to review the result. No automatic retry.');
    else if (next==='review' && state.stale) message('Tabs or groups changed. Discard these suggestions and refresh the input before requesting again.',true);
    else if (next==='review' && previousState!=='review') message('Review the suggested groups, then accept them. Existing groups remain unchanged until acceptance.');
    else if (next==='error') message(state.error || 'Suggestions failed. Existing groups are unchanged.',true);
    else if (next==='accepted') message('Groups applied. Use Open workspaces below to switch between them.');
    render();schedulePoll();
  }
  async function send(type,values={}) {
    const result=await api.runtime.sendMessage({channel:'workspace',type,windowId,...values});
    if (!result?.ok) throw new Error(result?.error || 'The AI coordinator did not respond. Reopen this popup to check the request before trying again.');
    return result;
  }
  async function run(work) {
    if (busy()) return;
    localBusy=true;updateControls();
    try {await work();}
    catch(error){message(error.message || 'Could not complete this action. Existing groups are unchanged.',true);}
    finally{localBusy=false;updateControls();}
  }
  function schedulePoll() {
    if (pollTimer) {clearTimeout(pollTimer);pollTimer=null;}
    if (state?.state!=='requesting') return;
    pollTimer=setTimeout(async()=> {
      pollTimer=null;
      try { receive(await send('popup-ai-state')); }
      catch(error){message(`Could not read the request state: ${error.message} Reopen this popup before retrying.`,true);}
    },1500);
  }
  async function refreshInventory() {
    if (!Number.isInteger(windowId)) return;
    if (localBusy) return;
    receive(await send('popup-ai-state'));
  }
  async function open() {
    panel.hidden=false;panel.scrollIntoView?.({block:'start'});
    if (!Number.isInteger(windowId)) await initialise();
    else await refreshInventory();
    if (!pageToken && !state?.remembered && $('popup-ai-setup')) $('popup-ai-setup').open=true;
    (pageToken || state?.remembered ? $('popup-ai-consent') : $('popup-ai-token')).focus();
  }
  async function initialise() {
    try {
      const win=await api.windows.getCurrent();
      if(win.incognito || !Number.isInteger(win.id) || (win.type && win.type!=='normal'))throw new Error('AI grouping is available only in a normal Safari window.');
      windowId=win.id;
      receive(await send('popup-ai-state'));
      if(['requesting','review','error'].includes(state.state)){panel.hidden=false;}
    } catch(error){message(error.message || 'Could not load popup AI. Refresh this extension and try again.',true);}
  }
  $('popup-ai-origin').textContent=globalThis.WorkspaceAI?.clientOrigin || globalThis.location?.origin || '';
  $('popup-ai-close').addEventListener('click',()=>{if(!busy())panel.hidden=true;});
  $('popup-ai-consent').addEventListener('change',updateControls);
  $('popup-ai-connect').addEventListener('click',()=>run(async()=> {
    const token=$('popup-ai-token').value.trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Enter the local pairing token, not your Meta API key.');
    if(api.permissions?.request && !await api.permissions.request({origins:['http://127.0.0.1/*']}))throw new Error('Local-service access was denied. No model request was made.');
    pageToken='';
    const result=await send('popup-ai-connect',{token,rememberSession:$('popup-ai-remember').checked});
    pageToken=token;$('popup-ai-token').value='';receive(result);message('Connected. Select tabs and agree to send their metadata before generating suggestions.');
  }));
  $('popup-ai-refresh').addEventListener('click',()=>run(async()=> {
    receive(await send('popup-ai-refresh',pageToken?{token:pageToken}:{}));
    if (!state?.stale) message('Input and local service status refreshed. No model request was made.');
  }));
  $('popup-ai-forget').addEventListener('click',()=>run(async()=> {
    receive(await send('popup-ai-disconnect'));pageToken='';$('popup-ai-token').value='';$('popup-ai-remember').checked=false;$('popup-ai-consent').checked=false;message('Disconnected. The popup pairing token was cleared.');
  }));
  $('popup-ai-generate').addEventListener('click',()=>run(async()=> {
    if (!$('popup-ai-consent').checked) throw new Error('Review the selected titles and URL paths and agree before sending.');
    if (!selected.size) throw new Error('Select at least one eligible tab.');
    const requestId=crypto.randomUUID(),tabIds=[...selected];
    $('popup-ai-consent').checked=false;
    message('Sending the selected metadata for one suggestion request…');
    try {
      receive(await send('popup-ai-suggest',{requestId,expectedRevision:state.revision,inventoryToken:state.inventoryToken,tabIds,consent:true,...(pageToken?{token:pageToken}:{})}));
    } catch (error) {
      // A lost response is not permission to request another paid generation.
      try {
        const recovered=await send('popup-ai-state');
        receive(recovered);
        if (recovered.requestId===requestId) return;
      } catch { uncertainRequest=true; }
      throw error;
    }
  }));
  $('popup-ai-discard').addEventListener('click',()=>run(async()=> {
    receive(await send('popup-ai-discard',{requestId:state.requestId}));message('Suggestions discarded. Existing groups were kept.');
  }));
  $('popup-ai-accept').addEventListener('click',()=>run(async()=> {
    if (!draft || !state.requestId) return;
    const groups=draft.groups.map(group=>({name:group.name.trim(),reason:group.reason || '',tabIds:[...draft.assignments].filter(([,id])=>id===group.id).map(([id])=>id)})).filter(group=>group.tabIds.length);
    if(groups.some(group=>!group.name))throw new Error('Give every nonempty group a name before accepting.');
    receive(await send('popup-ai-accept',{requestId:state.requestId,expectedRevision:state.revision,groups}));
    await hooks.onAccepted?.(windowId);
  }));
  globalThis.PopupAI=Object.freeze({open,refreshInventory,isBusy:busy,configure:options=>{hooks={...hooks,...options};updateControls();}});
  initialise();
})();

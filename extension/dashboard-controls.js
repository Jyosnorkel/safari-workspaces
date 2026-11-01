// Shared popup preferences and current-window search. No model calls or URL opening.
(() => {
  const api=globalThis.browser, $=id=>document.getElementById(id), key='tabby.settings.v1';
  if(!$('dashboard-settings-form') || !api?.storage?.local)return;
  const defaults={theme:'system',preferences:'',autosave:0,compact:false};
  let settings={...defaults},inventory=[],windowId,selection=0,matches=[],activating=false,autosaveChecked=false;
  const message=text=>{$('dashboard-settings-status').textContent=text;};
  function apply(value){
    settings={...defaults,...value};
    if(!['light','dark','system'].includes(settings.theme))settings.theme='system';
    if(![0,5,15,30,60].includes(settings.autosave))settings.autosave=0;
    document.documentElement.dataset.theme=settings.theme;
    document.body.classList.toggle('compact',Boolean(settings.compact));
    for(const name of ['theme','preferences','autosave'])$('dashboard-setting-'+name).value=String(settings[name] || (name==='autosave'?0:''));
    $('dashboard-setting-compact').checked=Boolean(settings.compact);
  }
  const node=(tag,className,text)=>{const n=document.createElement(tag);n.className=className;n.textContent=text;return n;};
  function render(){
    const query=$('dashboard-tab-search').value.trim().toLocaleLowerCase();
    matches=inventory.filter(tab=>`${tab.title || ''} ${tab.url || ''}`.toLocaleLowerCase().includes(query));
    selection=Math.max(0,Math.min(selection,matches.length-1));
    $('dashboard-tab-count').textContent=`${matches.length} of ${inventory.length} tabs`;
    const list=$('dashboard-tab-list');list.replaceChildren();
    if(!matches.length)list.append(node('p','hint',query?'No matching tabs.':'No tabs available. Refresh tabs to try again.'));
    matches.forEach((tab,index)=>{
      const row=node('button','dashboard-search-tab','');row.type='button';row.title=tab.url || '';
      row.classList.toggle('is-selected',index===selection);row.disabled=activating;
      if(tab.active)row.setAttribute('aria-current','page');
      row.append(node('span','workspace-tab-title',tab.title || 'Untitled tab'));
      let host='Safari tab';try{host=new URL(tab.url).hostname || host;}catch{}
      row.append(node('small','workspace-tab-host',host));row.addEventListener('click',()=>activate(tab));list.append(row);
    });
  }
  async function activate(tab){
    if(activating)return;activating=true;render();
    try{
      const live=await api.tabs.get(tab.id);
      if(!live || live.incognito || live.windowId!==windowId || live.url!==tab.url)throw Error('This tab changed. Refresh tabs and try again.');
      await api.tabs.update(tab.id,{active:true});
      $('dashboard-tab-count').textContent=`Switched to ${tab.title || 'tab'}.`;
    }catch(error){$('dashboard-tab-count').textContent=error.message;}
    finally{activating=false;for(const row of $('dashboard-tab-list').children)row.disabled=false;}
  }
  async function autosave(){
    if(autosaveChecked || !Number.isInteger(windowId))return;autosaveChecked=true;
    try{
      const loaded=await api.storage.local.get(key);apply(loaded[key] || {});
      if(!settings.autosave)return;
      const stampKey=`tabby.autosave.${windowId}`,last=(await api.storage.local.get(stampKey))[stampKey] || 0;
      if(Date.now()-last<settings.autosave*60000)return;
      const response=await api.runtime.sendMessage({channel:'workspace',type:'snapshot-window',windowId,name:`Window ${new Date().toLocaleString()}`.slice(0,80),requestId:crypto.randomUUID()});
      if(!response?.ok)throw Error(response?.error || 'Autosave failed.');
      await api.storage.local.set({[stampKey]:Date.now()});message('Autosaved this window. Refresh saved snapshots to see it.');
    }catch(error){message(`Autosave unavailable: ${error.message}`);}
  }
  globalThis.DashboardControls={updateInventory(tabs,id){inventory=tabs.filter(tab=>Number.isInteger(tab.id)&&!tab.incognito);windowId=id;selection=0;render();autosave();}};
  $('dashboard-tab-search').addEventListener('input',()=>{selection=0;render();});
  $('dashboard-tab-search').addEventListener('keydown',event=>{
    if(event.isComposing || event.metaKey || event.ctrlKey || event.altKey)return;
    if(['ArrowUp','ArrowDown'].includes(event.key) && matches.length){event.preventDefault();selection=(selection+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;render();$('dashboard-tab-list').children[selection]?.scrollIntoView?.({block:'nearest'});}
    else if(event.key==='Enter' && matches.length){event.preventDefault();activate(matches[selection]);}
  });
  document.addEventListener('keydown',event=>{
    if(event.isComposing || event.altKey || event.shiftKey)return;
    const editing=['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable;
    if(((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f') || (event.key==='/'&&!editing&&!event.metaKey&&!event.ctrlKey)){
      event.preventDefault();globalThis.DashboardPages?.show('home');$('dashboard-tab-search').focus();$('dashboard-tab-search').select();
    }
  });
  $('dashboard-settings-form').addEventListener('submit',async event=>{
    event.preventDefault();const next={theme:$('dashboard-setting-theme').value,preferences:$('dashboard-setting-preferences').value.trim().slice(0,1200),autosave:Number($('dashboard-setting-autosave').value),compact:$('dashboard-setting-compact').checked};
    try{await api.storage.local.set({[key]:next});apply(next);message('Settings saved. Shared with the popup.');}catch{message('Settings could not be saved. Try again.');}
  });
  api.storage.onChanged?.addListener((changes,area)=>{if(area==='local' && changes[key])apply(changes[key].newValue || {});});
  api.storage.local.get(key).then(value=>apply(value[key] || {})).catch(()=>message('Settings could not load. Defaults are shown.'));
})();

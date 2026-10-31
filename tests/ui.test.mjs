// Tests run the real dashboard script against a deliberately fake DOM and AI service.
// They do not use Safari, create real tabs, or call Meta.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const core = readFileSync(new URL('../extension/core.js',import.meta.url),'utf8');
const source = readFileSync(new URL('../extension/dashboard.js',import.meta.url),'utf8');
const html = readFileSync(new URL('../extension/dashboard.html',import.meta.url),'utf8');
const all = node => [node,...node.children.flatMap(all)];
class Element {
  constructor(tag='div') { this.tagName=tag; this.children=[]; this.listeners=new Map(); this.attributes={}; this.value=''; this.checked=false; this.disabled=false; this.hidden=false; this._text=''; this.className=''; this.files=[];
    this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(' ').filter(Boolean)); if(on)classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');}};
  }
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parent=this;}
  replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(type,fn,options){const list=this.listeners.get(type)||[];list.push({fn,once:options?.once});this.listeners.set(type,list);}
  dispatch(type,extra={}){const event={target:this,currentTarget:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};const list=[...(this.listeners.get(type)||[])];this.listeners.set(type,list.filter(l=>!l.once));for(const {fn} of list)fn(event);return event;}
  click(){if(!this.disabled)this.dispatch('click');}
  focus(){}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  get lastElementChild(){return this.children.at(-1);}
  querySelector(selector){return all(this).find(node=>node.tagName===selector)||null;}
}
const sample = (id,overrides={})=>({id,index:id,windowId:1,title:`Page ${id}`,url:`https://example.test/path/${id}?private=value#fragment`,eligible:true,pinned:false,...overrides});
const baseUsage = ()=>({enabled:true,configured:true,busy:false,attemptsToday:0,remainingToday:20,remainingThisMinute:2,perMinute:2,perDay:20,timezone:'UTC',requestsPerSuggestion:2,dailyResetAt:Date.now()+86400000,retryAt:null});
async function harness(options={}) {
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  nodes.get('ai-review').hidden=true;
  const main=new Element('main'),aside=new Element('aside'),body=new Element('body');
  const h={storageWrites:0,calls:[],statusCalls:0,suggestCalls:0,permissionCalls:0,sent:[],usage:baseUsage(),permission:true,tabs:[sample(1),sample(2),sample(3,{eligible:false,pinned:true})],autoConfirm:true,...options};
  const findById=id=>nodes.get(id)||[...nodes.values()].flatMap(all).find(node=>node.attributes.id===id);
  const document={getElementById:findById,createElement:tag=>new Element(tag),querySelector:selector=>selector==='main'?main:selector==='aside'?aside:null,body};
  nodes.get('confirm').showModal=()=>{ if(h.autoConfirm)queueMicrotask(()=>{nodes.get('confirm').returnValue='accept';nodes.get('confirm').dispatch('close');}); };
  const browser={permissions:{request:async permission=>{h.permissionCalls++;h.requestedPermission=permission;return h.permission;}},windows:{getCurrent:async()=>({id:1,incognito:false})},runtime:{sendMessage:async message=>{
    h.sent.push(structuredClone(message));
    if(message.type==='list')return {ok:true,workspaces:h.workspaces||[]};
    if(message.type==='scan')return {ok:true,tabs:structuredClone(h.tabs)};
    if(message.type==='snapshot-window')return {ok:true,workspace:{tabs:h.tabs},skipped:0};
    if(message.type==='export-backup')return {ok:true,json:'{"workspaces":[]}'};
    if(message.type==='import-backup')return {ok:true,imported:1};
    throw new Error(`Unexpected fake browser operation: ${message.type}`);
  }}};
  const WorkspaceAI={clientOrigin:'safari-web-extension://fake-test',status:async ({token})=>{
    h.statusCalls++;h.calls.push({type:'status',token});
    if(h.statusError)throw h.statusError;
    return {ok:true,usage:structuredClone(h.usage),connection:{updated:h.connectionUpdated===true}};
  },suggest:async request=>{
    h.suggestCalls++;h.calls.push({type:'suggest',...structuredClone(request)});
    if(h.deferred)return await h.deferred;
    if(h.suggestError)throw h.suggestError;
    return {ok:true,result:h.result||{groups:[{name:'Research',reason:'Related task',tabIds:['1','2']}]},usage:{...h.usage,attemptsToday:2,remainingToday:18,remainingThisMinute:0,retryAt:Date.now()+60000}};
  }};
  const url={createObjectURL:()=>{h.downloads=(h.downloads||0)+1;return 'blob:fake-backup';},revokeObjectURL:()=>{}};
  class FakeURL extends URL {}
  Object.assign(FakeURL,url);
  h.context=vm.createContext({document,browser,WorkspaceAI,crypto:webcrypto,URL:FakeURL,localStorage:{setItem:()=>h.storageWrites++,getItem:()=>null},Blob,location:{origin:'null',protocol:'safari-web-extension:',host:'fake-test'},console,setInterval:fn=>{h.countdown=fn;},setTimeout:()=>{},queueMicrotask});
  vm.runInContext(core,h.context);vm.runInContext(source,h.context);
  h.node=findById;
  h.find=(root,predicate)=>all(nodes.get(root)).find(predicate);
  h.findAll=(root,predicate)=>all(nodes.get(root)).filter(predicate);
  h.label=(root,text)=>h.find(root,node=>node.attributes['aria-label']===text);
  h.click=async id=>{nodes.get(id).click();await settle();};
  h.change=async(node,value,type='change')=>{if(node.type==='checkbox')node.checked=value;else node.value=value;node.dispatch(type);await settle();};
  h.scan=async()=>{await h.click('scan');};
  h.connect=async()=>{h.node('ai-token').value='a'.repeat(64);await h.click('ai-connect');};
  h.consent=async()=>{h.node('ai-consent').checked=true;h.node('ai-consent').dispatch('change');await settle();};
  await settle();return h;
}
async function settle(){for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));}
const named = (h,root,name)=>h.find(root,node=>node.tagName==='input'&&node.value===name);

test('AI starts disconnected with no background service calls; backup controls remain bound',async()=>{
  const h=await harness();assert.equal(h.statusCalls,0);assert.equal(h.suggestCalls,0);assert.equal(h.node('suggest').disabled,true);
  assert.equal(h.node('ai-origin').textContent,'safari-web-extension://fake-test');
  await h.click('snapshot-window');assert(h.sent.some(m=>m.type==='snapshot-window'));
  await h.click('export-all');assert(h.sent.some(m=>m.type==='export-backup'));assert.equal(h.downloads,1);
});
test('permission denial leaves manual grouping usable and sends no service requests',async()=>{
  const h=await harness({permission:false});await h.scan();await h.connect();
  assert.equal(h.permissionCalls,1);assert.deepEqual(Array.from(h.requestedPermission.origins),['http://127.0.0.1/*']);
  assert.equal(h.statusCalls,0);assert.match(h.node('ai-status').textContent,/denied/);assert.equal(h.node('suggest').disabled,true);
  await h.click('new-group');assert(named(h,'groups','Workspace 1'));
});
test('connect only checks local status; consent plus confirmation is required for suggestion',async()=>{
  const h=await harness();await h.scan();await h.connect();
  assert.equal(h.statusCalls,1);assert.equal(h.suggestCalls,0);assert.equal(h.storageWrites,0);assert.equal(h.node('suggest').disabled,true);
  assert.match(h.node('ai-usage').textContent,/at most 10 full suggestions/);
  await h.consent();assert.equal(h.node('suggest').disabled,false);
  h.autoConfirm=false;await h.click('suggest');assert.equal(h.suggestCalls,0);
  h.node('confirm').returnValue='cancel';h.node('confirm').dispatch('close');await settle();assert.equal(h.suggestCalls,0);
});
test('suggestion input excludes unchecked/pinned tabs and strips URL secrets; output stays staged',async()=>{
  const h=await harness({result:{groups:[{name:'Work',reason:'One tab',tabIds:['1']}]}});await h.scan();
  await h.change(h.label('groups','Include Page 2'),false);await h.connect();await h.consent();await h.click('suggest');
  const request=h.calls.find(c=>c.type==='suggest');assert.equal(request.consent,true);assert.equal(request.tabs.length,1);
  assert.equal(request.tabs[0].url,'https://example.test/path/1');assert.equal(request.tabs[0].title,'Page 1');
  assert.equal(h.node('ai-review').hidden,false);assert(named(h,'groups','Ungrouped'));assert.equal(named(h,'groups','Work'),undefined);
  assert.equal(h.node('ai-consent').checked,false);assert.equal(h.node('suggest').disabled,true);
  assert.match(h.node('suggest').textContent,/Cooldown/);assert.equal(h.sent.some(m=>['save','restore'].includes(m.type)),false);
});
test('rename/move/ungrouped proposals apply only on acceptance and preserve excluded manual tabs',async()=>{
  const h=await harness({tabs:[sample(1),sample(2),sample(3)],result:{groups:[{name:'Proposed',reason:'Task',tabIds:['1','2']}]}});
  await h.scan();await h.click('new-group');
  const manual=named(h,'groups','Workspace 1');await h.change(manual,'My manual group','input');await h.change(manual,'My manual group');
  const select=h.label('groups','Group for Page 3');const groupId=select.children.find(o=>o.textContent==='My manual group').value;
  await h.change(select,groupId);await h.change(h.label('groups','Include Page 3'),false);
  await h.connect();await h.consent();await h.click('suggest');
  await h.change(named(h,'ai-candidates','Proposed'),'Renamed proposal','input');
  const move=h.label('ai-candidates','Proposed group for Page 2');await h.change(move,'proposal-ungrouped');
  assert(named(h,'groups','My manual group'));assert.equal(named(h,'groups','Renamed proposal'),undefined);
  await h.click('ai-accept');assert.equal(h.node('ai-review').hidden,true);
  assert(named(h,'groups','Renamed proposal'));assert(named(h,'groups','My manual group'));
  assert.equal(h.label('groups','Include Page 3').checked,false);
  assert.equal(h.label('groups','Group for Page 3').children.find(option=>option.selected).value,groupId);
  assert.equal(h.label('groups','Group for Page 2').children.find(option=>option.selected).value,'ungrouped');
  assert.equal(h.sent.some(m=>['save','restore'].includes(m.type)),false);
});
test('discard and invalid responses preserve manual review; no hidden retry or status refresh occurs',async()=>{
  const h=await harness();await h.scan();await h.click('new-group');await h.connect();await h.consent();await h.click('suggest');
  await h.click('ai-discard');assert.equal(h.node('ai-review').hidden,true);assert(named(h,'groups','Workspace 1'));
  h.usage=baseUsage();await h.click('ai-refresh');h.result={groups:[{name:'Invented',tabIds:['999']}]};
  await h.consent();await h.click('suggest');assert.equal(h.node('ai-review').hidden,true);assert(named(h,'groups','Workspace 1'));assert.match(h.node('ai-status').textContent,/failed/);
  const statuses=h.statusCalls;h.countdown();assert.equal(h.statusCalls,statuses);
  h.usage=baseUsage();await h.click('ai-refresh');const before=h.statusCalls;
  h.suggestError=Object.assign(new Error('Fake provider timeout'),{code:'provider_timeout'});await h.consent();await h.click('suggest');
  assert.equal(h.statusCalls,before);assert.equal(h.suggestCalls,3);assert(named(h,'groups','Workspace 1'));
});
test('manual edits invalidate pending proposals; changed requests cannot overwrite the latest review',async()=>{
  const h=await harness();await h.scan();await h.connect();await h.consent();await h.click('suggest');
  await h.change(named(h,'groups','Ungrouped'),'My newer work','input');
  assert.equal(h.node('ai-review').hidden,true);assert.match(h.node('ai-status').textContent,/discarded/);
  await h.click('ai-accept');assert(named(h,'groups','My newer work'));
  let resolve;h.deferred=new Promise(r=>resolve=r);h.usage=baseUsage();await h.click('ai-refresh');await h.consent();
  h.node('suggest').click();await settle();
  await h.change(named(h,'groups','My newer work'),'Changed during request','input');
  resolve({ok:true,result:{groups:[{name:'Old suggestion',tabIds:['1','2']}]},usage:baseUsage()});await settle();
  assert.equal(h.node('ai-review').hidden,true);assert(named(h,'groups','Changed during request'));assert.match(h.node('ai-status').textContent,/changed during/);
});
test('disconnect clears pairing token and usage; service-unavailable states leave manual operations available',async()=>{
  const h=await harness();await h.scan();await h.connect();await h.click('ai-disconnect');
  assert.equal(h.node('ai-token').value,'');assert.equal(h.node('suggest').disabled,true);assert.equal(h.node('ai-refresh').disabled,true);
  h.statusError=new Error('Fake service offline');await h.connect();assert.match(h.node('ai-status').textContent,/Could not connect/);
  await h.click('new-group');assert(named(h,'groups','Workspace 1'));
});


test('disabled provider, exhausted budget and busy service cannot enable suggestion requests',async()=>{
  for(const changes of [{enabled:false},{configured:false},{busy:true},{remainingToday:1},{remainingThisMinute:0,retryAt:Date.now()+60000}]){
    const h=await harness({usage:{...baseUsage(),...changes}});await h.scan();await h.connect();await h.consent();
    assert.equal(h.node('suggest').disabled,true);await h.click('suggest');assert.equal(h.suggestCalls,0);
  }
});
test('cancelling acceptance leaves manual groups and the editable candidate intact',async()=>{
  const h=await harness();await h.scan();await h.connect();await h.consent();await h.click('suggest');
  h.autoConfirm=false;await h.click('ai-accept');
  h.node('confirm').returnValue='cancel';h.node('confirm').dispatch('close');await settle();
  assert.equal(h.node('ai-review').hidden,false);assert(named(h,'groups','Ungrouped'));assert.equal(named(h,'groups','Research'),undefined);
  assert.equal(h.sent.some(m=>['save','restore'].includes(m.type)),false);
});


const dragType='application/x-safari-workspaces-tab';
function transfer(seed={}){const data=new Map(Object.entries(seed));return {get types(){return [...data.keys()];},getData:type=>data.get(type)||'',setData:(type,value)=>data.set(type,value),effectAllowed:'none',dropEffect:'none'};}
const chipFor=(h,name)=>h.find('group-chips',node=>node.tagName==='button'&&node.children[0]?.textContent===name);
const groupIdOf=chip=>chip.attributes['data-group-id'];
const selectedGroup=(h,title)=>h.label('groups',`Group for ${title}`).children.find(option=>option.selected).value;
async function startDrag(h,title){const data=transfer();const handle=h.label('groups',`Drag ${title} to a group chip`);assert(handle,`Missing drag handle for ${title}`);const event=handle.dispatch('dragstart',{dataTransfer:data});await settle();return {data,handle,event};}
async function drop(h,chip,data){const over=chip.dispatch('dragover',{dataTransfer:data});const event=chip.dispatch('drop',{dataTransfer:data});await settle();return {over,event};}

test('chip counts include all assigned tabs; cross-group drag preserves unchecked state and makes no browser calls',async()=>{
  const h=await harness();await h.scan();await h.click('new-group');
  const targetId=groupIdOf(chipFor(h,'Workspace 1'));
  assert.equal(chipFor(h,'Ungrouped').children[1].textContent,'3');
  await h.change(h.label('groups','Include Page 1'),false);
  const sent=h.sent.length;const drag=await startDrag(h,'Page 1');
  assert.equal(drag.event.defaultPrevented,false);assert.deepEqual(drag.data.types,[dragType]);
  assert.match(drag.data.getData(dragType),/^[a-f0-9-]{36}$/);assert.equal(drag.data.getData('text/plain'),'');
  const result=await drop(h,chipFor(h,'Workspace 1'),drag.data);
  assert(result.over.defaultPrevented);assert(result.event.defaultPrevented);
  assert.equal(selectedGroup(h,'Page 1'),targetId);assert.equal(h.label('groups','Include Page 1').checked,false);
  assert.equal(chipFor(h,'Workspace 1').children[1].textContent,'1');assert.match(chipFor(h,'Workspace 1').attributes['aria-label'],/, 1 tab$/);assert.match(chipFor(h,'Ungrouped').attributes['aria-label'],/, 2 tabs$/);assert.equal(chipFor(h,'Ungrouped').children[1].textContent,'2');
  assert.equal(h.sent.length,sent);assert.equal(h.suggestCalls,0);assert.match(h.node('status').textContent,/remains unchecked/);
});
test('collapse is associated with its body, persists through renaming/moving and supports native-button keyboard toggles',async()=>{
  const h=await harness();await h.scan();await h.click('new-group');
  const id=groupIdOf(chipFor(h,'Workspace 1'));let chip=chipFor(h,'Workspace 1');
  assert.equal(chip.tagName,'button');assert.equal(chip.attributes['aria-controls'],`group-body-${id}`);
  chip.click();await settle();assert.equal(h.node(`group-body-${id}`).hidden,true);assert.equal(h.node(`manual-group-${id}`).hidden,true);assert.equal(chipFor(h,'Workspace 1').attributes['aria-expanded'],'false');
  assert.match(h.node(`group-toggle-${id}`).textContent,/Expand/);
  await h.change(named(h,'groups','Workspace 1'),'Renamed','input');await h.change(named(h,'groups','Renamed'),'Renamed');
  assert.equal(chipFor(h,'Renamed').attributes['aria-expanded'],'false');assert.equal(h.node(`group-body-${id}`).hidden,true);
  const drag=await startDrag(h,'Page 1');await drop(h,chipFor(h,'Renamed'),drag.data);
  assert.equal(h.node(`group-body-${id}`).hidden,true);assert.equal(chipFor(h,'Renamed').children[1].textContent,'1');
  let key=chipFor(h,'Renamed').dispatch('keydown',{key:'Enter'});await settle();assert(key.defaultPrevented);assert.equal(h.node(`group-body-${id}`).hidden,false);assert.equal(h.node(`manual-group-${id}`).hidden,false);
  key=h.node(`group-toggle-${id}`).dispatch('keydown',{key:' '});await settle();assert(key.defaultPrevented);assert.equal(h.node(`group-body-${id}`).hidden,true);
  await h.scan();assert.equal(chipFor(h,'Ungrouped').attributes['aria-expanded'],'true');assert.equal(chipFor(h,'Renamed'),undefined);
});
test('external, forged and invalid-target drops are ignored without navigating or changing assignments',async()=>{
  const h=await harness();await h.scan();await h.click('new-group');
  const target=chipFor(h,'Workspace 1');let result=await drop(h,target,transfer({'text/uri-list':'https://external.test/'}));assert(result.event.defaultPrevented);
  await drop(h,target,transfer({[dragType]:'forged-token'}));assert.equal(selectedGroup(h,'Page 1'),'ungrouped');
  const drag=await startDrag(h,'Page 1');await drop(h,target,transfer({[dragType]:'wrong-token'}));assert.equal(selectedGroup(h,'Page 1'),'ungrouped');
  const removedChip=chipFor(h,'Workspace 1');await h.click('new-group');
  const remove=h.find('groups',node=>node.tagName==='button'&&node.textContent==='Remove empty group');remove.click();await settle();
  const liveDrag=await startDrag(h,'Page 1');await drop(h,removedChip,liveDrag.data);assert.equal(selectedGroup(h,'Page 1'),'ungrouped');
  assert.equal(h.sent.some(m=>['save','restore'].includes(m.type)),false);
});
test('protected rows have no drag handle and stale scans or ended drags cannot move a tab',async()=>{
  const h=await harness({tabs:[sample(1),sample(2,{eligible:false,pinned:true}),sample(3,{eligible:false,url:'safari://settings'})]});await h.scan();await h.click('new-group');
  assert.equal(h.label('groups','Drag Page 2 to a group chip'),undefined);assert.equal(h.label('groups','Drag Page 3 to a group chip'),undefined);
  const oldTarget=chipFor(h,'Workspace 1');const drag=await startDrag(h,'Page 1');await h.scan();await drop(h,oldTarget,drag.data);assert.equal(selectedGroup(h,'Page 1'),'ungrouped');
  await h.click('new-group');const ended=await startDrag(h,'Page 1');ended.handle.dispatch('dragend');await drop(h,chipFor(h,'Workspace 1'),ended.data);assert.equal(selectedGroup(h,'Page 1'),'ungrouped');
});
test('collapse and same-group drop preserve AI preview; an actual drag move invalidates it',async()=>{
  const h=await harness();await h.scan();await h.click('new-group');await h.connect();await h.consent();await h.click('suggest');
  assert.equal(h.node('ai-review').hidden,false);chipFor(h,'Workspace 1').click();await settle();assert.equal(h.node('ai-review').hidden,false);
  let drag=await startDrag(h,'Page 1');await drop(h,chipFor(h,'Ungrouped'),drag.data);assert.equal(h.node('ai-review').hidden,false);
  drag=await startDrag(h,'Page 1');await drop(h,chipFor(h,'Workspace 1'),drag.data);assert.equal(h.node('ai-review').hidden,true);assert.match(h.node('ai-status').textContent,/discarded/);
});
test('busy dashboard rejects stale drag events and keyboard collapse without changing the review',async()=>{
  const h=await harness();await h.scan();await h.click('new-group');const id=groupIdOf(chipFor(h,'Workspace 1'));
  const drag=await startDrag(h,'Page 1');h.autoConfirm=false;
  // Hold the fake scan confirmation open to simulate an in-flight UI operation.
  h.node('scan').click();await settle();
  const rejected=h.label('groups','Drag Page 1 to a group chip').dispatch('dragstart',{dataTransfer:transfer()});assert(rejected.defaultPrevented);
  await drop(h,chipFor(h,'Workspace 1'),drag.data);assert.equal(selectedGroup(h,'Page 1'),'ungrouped');
  chipFor(h,'Workspace 1').dispatch('keydown',{key:'Enter'});assert.equal(h.node(`group-body-${id}`).hidden,false);
  h.node('confirm').returnValue='cancel';h.node('confirm').dispatch('close');await settle();
});


test('successful local reconnect reports automatic address refresh without a model call',async()=>{
 const h=await harness({connectionUpdated:true});await h.connect();
 assert.match(h.node('ai-status').textContent,/address was updated automatically/);
 assert.equal(h.statusCalls,1);assert.equal(h.suggestCalls,0);assert.equal(h.storageWrites,0);
});

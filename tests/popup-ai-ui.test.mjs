// Real popup AI UI with a fake DOM and fake coordinator. No Safari/Meta calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../extension/popup-ai.js',import.meta.url),'utf8');
const ids=['popup-ai-panel','popup-ai-close','popup-ai-status','popup-ai-origin','popup-ai-token','popup-ai-remember','popup-ai-connect','popup-ai-refresh','popup-ai-forget','popup-ai-usage','popup-ai-tabs','popup-ai-preview','popup-ai-consent','popup-ai-generate','popup-ai-review','popup-ai-groups','popup-ai-accept','popup-ai-discard','popup-ai-setup'];
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.hidden=false;this.disabled=false;this.checked=false;this.value='';this._text='';this.classList={toggle(){}};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 setAttribute(name,value){this.attributes[name]=String(value);}
 addEventListener(type,handler){this.listeners[type]=handler;}
 async click(){if(!this.disabled)await this.listeners.click?.();}
 async change(value,event='change'){if(this.type==='checkbox')this.checked=value;else this.value=value;await this.listeners[event]?.();}
 focus(){this.focused=true;}
 scrollIntoView(){}
}
const all=node=>[node,...node.children.flatMap(all)];
const usage=()=>({enabled:true,configured:true,busy:false,remainingToday:20,remainingThisMinute:2,perMinute:2,perDay:20,requestsPerSuggestion:2,retryAt:null,dailyResetAt:Date.now()+86400000});
const tabs=()=>[{id:1,title:'Work document',url:'https://example.test/work',included:true},{id:2,title:'Excluded tab',url:'https://example.test/excluded',included:false},{id:3,title:'Notes',url:'https://example.org/notes',included:true}];
const baseline=()=>({ok:true,state:'idle',tabs:tabs(),input:[],inventoryToken:'inventory-1',revision:'revision-1',connected:false,remembered:false});
const staged=()=>({state:'review',requestId:'stage-request',proposal:{groups:[{name:'Work',reason:'Related task',tabIds:['1','3']}],ungrouped:[]}});
async function settle(){for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));}
async function harness(options={}) {
 const nodes=new Map(ids.map(id=>[id,new Element()]));nodes.get('popup-ai-panel').hidden=true;nodes.get('popup-ai-review').hidden=true;for(const id of ['popup-ai-consent','popup-ai-remember'])nodes.get(id).type='checkbox';
 const h={sent:[],busy:[],accepted:[],permission:true,permissionCalls:0,current:baseline(),timers:[],...options};
 const browser={windows:{getCurrent:async()=>({id:7,type:'normal',incognito:false})},permissions:{request:async permission=>{h.permissionCalls++;h.requestedPermission=permission;return h.permission;}},runtime:{sendMessage:async message=>{
  h.sent.push(structuredClone(message));
  if(h.failState && message.type==='popup-ai-state')throw Error('State unavailable');
  if(message.type==='popup-ai-state')return structuredClone(h.current);
  if(message.type==='popup-ai-refresh'){h.current={...h.current,usage:usage(),connected:true};return structuredClone(h.current);}
  if(message.type==='popup-ai-connect'){h.current={...h.current,connected:true,remembered:message.rememberSession,usage:usage()};return structuredClone(h.current);}
  if(message.type==='popup-ai-disconnect'){h.current={...h.current,connected:false,remembered:false,usage:undefined};return structuredClone(h.current);}
  if(message.type==='popup-ai-suggest'){
   h.lastRequest=message;
   if(h.suggestDeferred)return await h.suggestDeferred;
   if(h.suggestError)throw Error(h.suggestError);
   h.current={...h.current,...staged(),requestId:message.requestId};return structuredClone(h.current);
  }
  if(message.type==='popup-ai-accept'){
   if(h.acceptError)return {ok:false,error:h.acceptError};
   h.current={...h.current,state:'accepted',proposal:undefined};return structuredClone(h.current);
  }
  if(message.type==='popup-ai-discard'){h.current={...h.current,state:'idle',proposal:undefined};return structuredClone(h.current);}
  throw Error(`Unexpected fake coordinator route ${message.type}`);
 }}};
 h.context=vm.createContext({browser,crypto:webcrypto,Date,console,location:{origin:'safari-web-extension://test'},WorkspaceAI:{clientOrigin:'safari-web-extension://test'},PopupAIHooks:{setBusy:value=>h.busy.push(value),onAccepted:windowId=>h.accepted.push(windowId)},setTimeout:(fn,ms)=>{const timer={fn,ms};h.timers.push(timer);return timer;},clearTimeout(){},document:{getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag)}});
 vm.runInContext(source,h.context);await settle();h.node=id=>nodes.get(id);h.find=(root,label)=>all(nodes.get(root)).find(element=>element.attributes['aria-label']===label);h.click=async id=>{await nodes.get(id).click();await settle();};
 h.connect=async(remember=false)=>{h.node('popup-ai-token').value='a'.repeat(64);h.node('popup-ai-remember').checked=remember;await h.click('popup-ai-connect');};
 h.consent=async()=>{await h.node('popup-ai-consent').change(true);await settle();};
 return h;
}
test('popup AI startup/open only reads local state and never launches the dashboard or provider',async()=>{
 const h=await harness();assert.deepEqual(h.sent.map(message=>message.type),['popup-ai-state']);assert.equal(h.node('popup-ai-panel').hidden,true);
 await h.context.PopupAI.open();assert.equal(h.node('popup-ai-panel').hidden,false);assert.equal(h.node('popup-ai-token').focused,undefined);assert(h.sent.every(message=>message.type==='popup-ai-state'));assert.equal(h.permissionCalls,0);assert.equal(h.node('popup-ai-generate').disabled,true);
});
test('connection clears token field, remembers only explicit checkbox, and consent is per selected input',async()=>{
 const h=await harness();await h.connect();assert.equal(h.node('popup-ai-token').value,'');assert.equal(h.sent.find(message=>message.type==='popup-ai-connect').rememberSession,false);assert.equal(h.node('popup-ai-generate').disabled,true);
 const preview=JSON.parse(h.node('popup-ai-preview').textContent);assert.deepEqual(preview.tabs.map(tab=>tab.id),['1','3']);assert.equal(preview.tabs[0].url,'https://example.test/work');assert.match(h.node('popup-ai-usage').textContent,/at most 10 full suggestions\/day/);
 await h.consent();assert.equal(h.node('popup-ai-generate').disabled,false);
 await h.find('popup-ai-tabs','Send Notes for AI grouping').change(false);assert.equal(h.node('popup-ai-consent').checked,false);assert.equal(h.node('popup-ai-generate').disabled,true);
 await h.consent();await h.click('popup-ai-generate');const request=h.sent.find(message=>message.type==='popup-ai-suggest');assert.deepEqual(request.tabIds,['1']);assert.equal(request.token,'a'.repeat(64));assert.equal(request.consent,true);assert.equal(request.expectedRevision,'revision-1');assert.equal(request.inventoryToken,'inventory-1');assert.equal(h.node('popup-ai-consent').checked,false);
 const remembered=await harness();await remembered.connect(true);assert.equal(remembered.sent.find(message=>message.type==='popup-ai-connect').rememberSession,true);
});
test('denied permission and invalid tokens never start connection/inference',async()=>{
 const invalid=await harness();invalid.node('popup-ai-token').value='not-a-token';await invalid.click('popup-ai-connect');assert.equal(invalid.sent.some(message=>message.type==='popup-ai-connect'),false);assert.equal(invalid.permissionCalls,0);
 const h=await harness({permission:false});await h.connect();assert.equal(h.sent.some(message=>message.type==='popup-ai-connect'||message.type==='popup-ai-suggest'),false);assert.match(h.node('popup-ai-status').textContent,/denied/);assert.deepEqual(Array.from(h.requestedPermission.origins),['http://127.0.0.1/*']);
});
test('suggestions remain editable until explicit accept and preserve ungrouped corrections',async()=>{
 const h=await harness();await h.connect();await h.consent();await h.click('popup-ai-generate');assert.equal(h.node('popup-ai-review').hidden,false);assert.equal(h.sent.some(message=>message.type==='popup-ai-accept'),false);
 await h.find('popup-ai-groups','Suggested group name 1').change('My project','input');await h.find('popup-ai-groups','Suggested group for Notes').change('ungrouped');
 await h.click('popup-ai-accept');const accepted=h.sent.find(message=>message.type==='popup-ai-accept');assert.equal(accepted.groups[0].name,'My project');assert.deepEqual(accepted.groups[0].tabIds,['1']);assert.equal(accepted.requestId,h.lastRequest.requestId);assert.deepEqual(h.accepted,[7]);assert.match(h.node('popup-ai-status').textContent,/Groups applied/);
});
test('reopened popup recovers staged result locally without a new model call or token',async()=>{
 const h=await harness({current:{...baseline(),...staged(),connected:true,usage:usage()}});assert.equal(h.node('popup-ai-panel').hidden,false);assert.equal(h.node('popup-ai-review').hidden,false);assert.equal(h.node('popup-ai-generate').disabled,true);assert(h.sent.every(message=>message.type==='popup-ai-state'));
 await h.click('popup-ai-discard');assert.equal(h.node('popup-ai-review').hidden,true);assert.equal(h.sent.some(message=>message.type==='popup-ai-suggest'),false);
});
test('busy requests lock duplicate sends and local polling never requests inference',async()=>{
 let resolve;const deferred=new Promise(r=>resolve=r);const h=await harness({suggestDeferred:deferred});await h.connect();await h.consent();
 const sending=h.node('popup-ai-generate').click();await settle();assert.equal(h.node('popup-ai-generate').disabled,true);await h.node('popup-ai-generate').click();assert.equal(h.sent.filter(message=>message.type==='popup-ai-suggest').length,1);assert.equal(h.busy.at(-1),true);
 resolve({...h.current,...staged(),requestId:h.lastRequest.requestId});await sending;await settle();assert.equal(h.busy.at(-1),false);
 const pending=await harness({current:{...baseline(),state:'requesting',requestId:'pending'}});assert.equal(pending.timers.length,1);pending.current={...pending.current,...staged()};await pending.timers[0].fn();assert.equal(pending.sent.some(message=>message.type==='popup-ai-suggest'),false);assert.equal(pending.node('popup-ai-review').hidden,false);
});
test('lost request response reads recovery state and never retries inference',async()=>{
 const h=await harness({suggestError:'Response lost'});await h.connect();await h.consent();await h.click('popup-ai-generate');assert.equal(h.sent.filter(message=>message.type==='popup-ai-suggest').length,1);assert.equal(h.sent.filter(message=>message.type==='popup-ai-state').length,2);assert.match(h.node('popup-ai-status').textContent,/Response lost/);assert.equal(h.node('popup-ai-consent').checked,false);
});
test('accept errors keep edited proposals and do not signal acceptance',async()=>{
 const h=await harness({current:{...baseline(),...staged()},acceptError:'Groups changed. Refresh before accepting.'});await h.find('popup-ai-groups','Suggested group name 1').change('Keep my correction','input');await h.click('popup-ai-accept');assert.match(h.node('popup-ai-status').textContent,/Groups changed/);assert.equal(h.find('popup-ai-groups','Suggested group name 1').value,'Keep my correction');assert.deepEqual(h.accepted,[]);
});


test('stale proposals cannot be accepted and draft review blocks another generation',async()=>{
 const stale=await harness({current:{...baseline(),...staged(),stale:true,remembered:true,connected:true,usage:usage()}});assert.equal(stale.node('popup-ai-accept').disabled,true);assert.match(stale.node('popup-ai-status').textContent,/Discard these suggestions/);await stale.click('popup-ai-accept');assert.equal(stale.sent.some(message=>message.type==='popup-ai-accept'),false);
 const h=await harness({current:{...baseline(),...staged(),remembered:true,connected:true,usage:usage()}});await h.consent();assert.equal(h.node('popup-ai-generate').disabled,true);assert.equal(h.node('popup-ai-consent').disabled,true);
});
test('explicit refresh uses the page token without another generation or requiring another paste',async()=>{
 const h=await harness();await h.connect();await h.click('popup-ai-refresh');const request=h.sent.find(message=>message.type==='popup-ai-refresh');assert.equal(request.token,'a'.repeat(64));assert.equal(h.sent.some(message=>message.type==='popup-ai-suggest'),false);assert.match(h.node('popup-ai-status').textContent,/No model request/);
 h.current={...h.current,connected:false,state:'error',error:'Provider unavailable'};await h.context.PopupAI.refreshInventory();await h.consent();assert.equal(h.node('popup-ai-generate').disabled,true);
});

test('background AI state refresh preserves Organise scroll position',async()=>{
 const h=await harness();const pane={scrollTop:250};h.context.document.querySelector=()=>pane;
 await h.context.PopupAI.open();pane.scrollTop=250;await h.context.PopupAI.refreshInventory();
 assert.equal(pane.scrollTop,250);assert.equal(h.node('popup-ai-token').focused,undefined);
});

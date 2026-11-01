import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8');
test('dashboard creation activates the new tab without explicitly closing the popup window',async()=>{
  let click, created, closeCalls=0;
  const button={addEventListener:(_,fn)=>click=fn}, status={textContent:''};
  vm.runInNewContext(source,{
    document:{body:{addEventListener(){}},getElementById:id=>id==='open'?button:status},
    window:{close:()=>closeCalls++},
    browser:{windows:{getCurrent:async()=>({id:1,incognito:false})},runtime:{getURL:path=>`safari-web-extension://test/${path}`},tabs:{query:async()=>[],create:async options=>{created=options;}}}
  });
  await click();
  assert.equal(created.url,'safari-web-extension://test/dashboard.html');
  assert.equal(created.active,true);
  assert.equal(closeCalls,0);
  assert.equal(status.textContent,'Workspace manager opened.');
});

function dropHarness(options={}) {
  const handlers={}, classes=new Set(), button={addEventListener(){},disabled:false},status={textContent:''};
  const area={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
  const h={sent:[],button,status,classes,window:{id:7,type:'normal',incognito:false},...options};
  vm.runInNewContext(source,{URL,crypto:{randomUUID:()=> '5c6d9a98-c1ca-4d15-b673-ac94a190dd27'},
    document:{body:{addEventListener:(type,fn)=>handlers[type]=fn},getElementById:id=>id==='open'?button:id==='backup-drop'?area:status},
    browser:{windows:{getCurrent:async()=>h.window},runtime:{sendMessage:async message=>{h.sent.push(message);if(h.failure)return {ok:false,error:h.failure};return {ok:true,workspaces:[{tabs:[{}],restore:{results:{one:{state:'opened'}}}}]};}}}
  });
  h.event=(types=['Files'],files=[{size:2,text:async()=> '{}'}])=>({dataTransfer:{types,files},preventDefault(){this.prevented=true;}});
  h.drop=event=>handlers.drop(event);h.over=event=>handlers.dragover(event);return h;
}
test('toolbar popup highlights file drags and sends the existing background backup operation once',async()=>{
 const h=dropHarness();const over=h.event();h.over(over);assert(over.prevented);assert(h.classes.has('is-over'));
 const event=h.event();await Promise.all([h.drop(event),h.drop(h.event())]);
 assert(event.prevented);assert.equal(h.sent.length,1);assert.equal(h.sent[0].type,'drop-backup');assert.equal(h.sent[0].windowId,7);assert.equal(h.sent[0].json,'{}');assert.match(h.sent[0].requestId,/^[a-f0-9-]{36}$/);assert.match(h.status.textContent,/1\/1 saved URLs opened/);assert.equal(h.button.disabled,false);
});
test('popup rejects multiple, oversized, private-window and non-file drops without a restore request',async()=>{
 for(const kind of ['multiple','oversized','private','url']) {
  const h=dropHarness(kind==='private'?{window:{id:7,type:'normal',incognito:true}}:{});
  const event=kind==='multiple'?h.event(['Files'],[{},{}]):kind==='oversized'?h.event(['Files'],[{size:10485761}]):kind==='url'?h.event(['text/uri-list'],[]):h.event();
  await h.drop(event);assert(event.prevented);assert.equal(h.sent.length,0);assert.equal(h.button.disabled,false);
 }
});
test('popup shows background validation/recovery errors and remains usable',async()=>{
 const h=dropHarness({failure:'Invalid backup. No tabs were changed.'});await h.drop(h.event());
 assert.equal(h.sent.length,1);assert.match(h.status.textContent,/Invalid backup/);assert.equal(h.button.disabled,false);
});

async function actionHarness() {
 const nodes=new Map(),sent=[],created=[];let aiOpens=0;
 for(const id of ['open','status','save-snapshot','ai-organise','refresh-tabs','tab-count','scan-time','backup-drop'])nodes.set(id,{textContent:'',disabled:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},classList:{toggle(){}}});
 const browser={windows:{getCurrent:async()=>({id:1,type:'normal'})},runtime:{getURL:path=>`safari-web-extension://test/${path}`,sendMessage:async message=>{sent.push(message);if(message.type==='scan')return {ok:true,tabs:[{eligible:true},{eligible:false}]};if(message.type==='snapshot-window')return {ok:true,workspace:{tabs:[{},{}]}};return undefined;}},tabs:{query:async()=>[],create:async options=>created.push(options)}};
 vm.runInNewContext(source,{URL,PopupAI:{open:async()=>{aiOpens++;}},crypto:{randomUUID:()=> '5c6d9a98-c1ca-4d15-b673-ac94a190dd27'},document:{getElementById:id=>nodes.get(id),body:{addEventListener(){}}},browser});
 for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
 return {nodes,sent,created,get aiOpens(){return aiOpens;},click:id=>nodes.get(id).listeners.click()};
}
test('popup refreshes local inventory on opening and snapshot saves without closing or AI calls',async()=>{
 const h=await actionHarness();assert.match(h.nodes.get('tab-count').textContent,/2 tabs · 1 available/);assert.equal(h.sent.filter(m=>m.type==='scan').length,1);
 await h.click('save-snapshot');const saves=h.sent.filter(m=>m.type==='snapshot-window');assert.equal(saves.length,1);assert.equal(saves[0].windowId,1);assert.match(h.nodes.get('status').textContent,/All tabs remain open/);
 await h.click('refresh-tabs');assert.equal(h.sent.filter(m=>m.type==='scan').length,2);assert.equal(h.sent.some(m=>['suggest','save','restore'].includes(m.type)),false);
});
test('popup AI organise opens inline controls without opening the dashboard or submitting model input',async()=>{
 const h=await actionHarness();await h.click('ai-organise');assert.equal(h.created.length,0);assert.equal(h.aiOpens,1);assert.equal(h.sent.some(m=>m.type==='suggest'),false);
});

test('confirmed popup rows move between groups and reorder with revision and exclusions preserved',async()=>{
 class Node {
  constructor(){this.children=[];this.listeners={};this.classList={add(){},remove(){},toggle(){}};}
  append(...nodes){this.children.push(...nodes);} replaceChildren(){this.children=[];}
  setAttribute(){} addEventListener(type,fn){this.listeners[type]=fn;} querySelectorAll(){return [];}
 }
 const nodes=new Map(['open','status','live-groups','backup-drop'].map(id=>[id,new Node()]));
 let groups=[{id:'a',name:'A',tabs:[{id:1,url:'https://a.test',excluded:true},{id:2,url:'https://b.test'}]},{id:'b',name:'B',tabs:[{id:3,url:'https://c.test'}]}],writes=[];
 const context={URL,document:{body:new Node(),getElementById:id=>nodes.get(id),createElement:()=>new Node()},browser:{runtime:{sendMessage:async m=>{
  if(m.type==='live-groups-get')return {ok:true,revision:'rev',groups};
  if(m.type==='live-groups-set'){writes.push(m);groups=m.groups;return {ok:true};}return {ok:true};
 }}}};
 vm.createContext(context);vm.runInContext(source,context);await vm.runInContext('loadLiveGroups(7)',context);
 const event=()=>({preventDefault(){},stopPropagation(){},dataTransfer:{types:['application/x-tabby-row'],setData(){}}});
 let cards=nodes.get('live-groups').children;
 cards[0].children[1].children[0].listeners.dragstart(event());cards[1].listeners.drop(event());
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(Array.from(groups[1].tabs,t=>t.id),[3,1]);assert.equal(groups[1].tabs[1].excluded,true);assert.equal(writes[0].expectedRevision,'rev');
 cards=nodes.get('live-groups').children;
 cards[1].children[1].children[1].listeners.dragstart(event());cards[1].children[1].children[0].listeners.drop(event());
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(Array.from(groups[1].tabs,t=>t.id),[1,3]);
 cards=nodes.get('live-groups').children;cards[0].listeners.drop(event());assert.equal(writes.length,2);
 const form=cards[cards.length-1];form.children[0].value='Manual';
 context.crypto={randomUUID:()=> 'new-group'};
 form.listeners.submit(event());for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert(groups.some(group=>group.name==='Manual' && group.tabs.length===0));
 cards=nodes.get('live-groups').children;
 cards[1].children[0].children[2].listeners.click();for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert(!groups.some(group=>group.id==='b'));
 assert.deepEqual(Array.from(groups.find(group=>group.id==='ungrouped').tabs,t=>t.id),[1,3]);
});

test('popup navigation keeps snapshot details collapsed and saves appearance and grouping preferences',async()=>{
 class Node{constructor(){this.children=[];this.listeners={};this.dataset={};this.classList={toggle(){}};this.value='';}append(...n){this.children.push(...n);}replaceChildren(){this.children=[];}setAttribute(){}addEventListener(t,f){this.listeners[t]=f;}}
 const ids=['open','status','settings-open','settings-view','settings-form','setting-theme','setting-preferences','setting-autosave','setting-compact','home-view','home-groups','home-extras','popup-ai-panel','popup-ai-close','ai-organise','snapshots-view','snapshot-list','backup-drop'];
 const nodes=new Map(ids.map(id=>[id,new Node()])),nav=['home','organise','snapshots'].map(view=>{const n=new Node();n.dataset.view=view;return n;}),writes=[];
 const document={documentElement:new Node(),body:new Node(),getElementById:id=>nodes.get(id),querySelectorAll:()=>nav,createElement:()=>new Node()};
 const browser={storage:{local:{get:async()=>({}),set:async data=>writes.push(data)}},runtime:{sendMessage:async()=>({ok:true,workspaces:[{createdAt:'2026-11-01T12:00:00Z',tabs:[{title:'Example',url:'https://example.com'}]}]})}};
 vm.runInNewContext(source,{document,browser,URL,setTimeout});
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 nav[2].listeners.click();for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(nodes.get('home-view').hidden,true);assert.equal(nodes.get('snapshots-view').hidden,false);
 const card=nodes.get('snapshot-list').children[0];assert.equal(card.open,undefined);assert.match(card.children[0].textContent,/1 tabs · 1 sites/);
 nodes.get('settings-open').listeners.click();assert.equal(nodes.get('settings-view').hidden,false);
 nodes.get('setting-theme').value='dark';nodes.get('setting-preferences').value='Five specific groups';nodes.get('setting-autosave').value='15';nodes.get('setting-compact').checked=true;
 await nodes.get('settings-form').listeners.submit({preventDefault(){}});
 assert.equal(document.documentElement.dataset.theme,'dark');assert.equal(writes[0]['tabby.settings.v1'].preferences,'Five specific groups');assert.equal(writes[0]['tabby.settings.v1'].autosave,15);
});

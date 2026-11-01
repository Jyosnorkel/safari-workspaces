import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../extension/dashboard-controls.js',import.meta.url),'utf8');
async function harness(saved={}){
 class Node{
  constructor(){this.children=[];this.listeners={};this.value='';this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};this.dataset={};}
  append(...n){this.children.push(...n);}replaceChildren(){this.children=[];}setAttribute(){}addEventListener(type,fn){this.listeners[type]=fn;}focus(){this.focused=true;}select(){this.selected=true;}scrollIntoView(){}
 }
 const ids=['dashboard-settings-form','dashboard-settings-status','dashboard-setting-theme','dashboard-setting-preferences','dashboard-setting-autosave','dashboard-setting-compact','dashboard-tab-search','dashboard-tab-list','dashboard-tab-count'];
 const nodes=new Map(ids.map(id=>[id,new Node()])),handlers={},writes=[],updates=[],sent=[],live=new Map();
 const document={documentElement:new Node(),body:new Node(),getElementById:id=>nodes.get(id),createElement:()=>new Node(),addEventListener:(type,fn)=>handlers[type]=fn};
 let stored={...saved},changed;
 const api={storage:{local:{get:async key=>({[key]:key==='tabby.settings.v1'?stored:0}),set:async data=>{writes.push(data);if(data['tabby.settings.v1'])stored=data['tabby.settings.v1'];}},onChanged:{addListener:fn=>changed=fn}},tabs:{get:async id=>live.get(id),update:async(id,data)=>updates.push({id,...data})},runtime:{sendMessage:async message=>{sent.push(message);return{ok:true};}}};
 const context={document,browser:api,URL,crypto:{randomUUID:()=> 'request-id'}};
 vm.createContext(context);vm.runInContext(source,context);
 const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};await flush();
 const inventory=[{id:1,windowId:7,title:'Research Project',url:'https://docs.example/one'},{id:2,windowId:7,title:'Reading list',url:'https://news.example/RESEARCH'},{id:3,windowId:7,title:'Private Research',url:'https://private.example',incognito:true}];
 inventory.forEach(tab=>live.set(tab.id,{...tab}));
 return{nodes,document,handlers,writes,updates,sent,live,inventory,flush,update:(tabs=inventory)=>context.DashboardControls.updateInventory(tabs,7),changed:(...args)=>changed(...args)};
}
test('dashboard saves shared appearance/preferences/compact settings and default autosave makes no snapshot request',async()=>{
 const h=await harness();h.update();await h.flush();assert.equal(h.sent.length,0);assert.equal(h.nodes.get('dashboard-setting-autosave').value,'0');
 h.nodes.get('dashboard-setting-theme').value='dark';h.nodes.get('dashboard-setting-preferences').value='  Group by project  ';h.nodes.get('dashboard-setting-autosave').value='0';h.nodes.get('dashboard-setting-compact').checked=true;
 await h.nodes.get('dashboard-settings-form').listeners.submit({preventDefault(){}});
 assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0])),{'tabby.settings.v1':{theme:'dark',preferences:'Group by project',autosave:0,compact:true}});
 assert.equal(h.document.documentElement.dataset.theme,'dark');assert(h.document.body.classes.has('compact'));
 h.changed({'tabby.settings.v1':{newValue:{theme:'light',preferences:'New preference',autosave:0,compact:false}}},'local');
 assert.equal(h.document.documentElement.dataset.theme,'light');assert(!h.document.body.classes.has('compact'));assert.equal(h.nodes.get('dashboard-setting-preferences').value,'New preference');
});
test('dashboard search matches title and URL from latest scan and excludes private tabs',async()=>{
 const h=await harness();h.update();await h.flush();const search=h.nodes.get('dashboard-tab-search'),list=h.nodes.get('dashboard-tab-list');assert.equal(list.children.length,2);
 search.value='NEWS.EXAMPLE';search.listeners.input();assert.equal(list.children.length,1);assert.equal(list.children[0].children[0].textContent,'Reading list');
 search.value='research';search.listeners.input();assert.equal(list.children.length,2);
 h.update([{id:4,windowId:7,title:'Fresh Research',url:'https://fresh.example'}]);assert.equal(list.children.length,1);assert.equal(list.children[0].children[0].textContent,'Fresh Research');assert.equal(h.updates.length,0);
});
test('dashboard keyboard opens selected existing tab only after live window, URL and private checks',async()=>{
 const h=await harness();h.update();await h.flush();const search=h.nodes.get('dashboard-tab-search'),event=key=>({key,preventDefault(){}});
 search.listeners.keydown(event('ArrowDown'));search.listeners.keydown(event('Enter'));await h.flush();assert.deepEqual(h.updates,[{id:2,active:true}]);h.updates.length=0;
 for(const changed of [{windowId:8},{url:'https://changed.example'},{incognito:true}]){
  h.live.set(1,{...h.inventory[0],...changed});h.update();await h.nodes.get('dashboard-tab-list').children[0].listeners.click();await h.flush();assert.equal(h.updates.length,0);assert.match(h.nodes.get('dashboard-tab-count').textContent,/changed/);
 }
 const shortcut={key:'f',metaKey:true,target:{tagName:'BODY'},preventDefault(){this.prevented=true;}};h.handlers.keydown(shortcut);assert(shortcut.prevented);assert(search.focused);
 h.handlers.keydown({key:'/',target:{tagName:'TEXTAREA'},preventDefault(){throw Error('Must preserve ordinary text entry');}});
});

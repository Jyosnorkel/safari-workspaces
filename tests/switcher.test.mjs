// Actual popup script with fictional browser APIs; no Safari or Meta calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../extension/tab-selection.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8');
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.hidden=false;this.disabled=false;this._text='';this.classList={toggle(){}};}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this._text='';this.children=children;}
 addEventListener(type,fn){this.listeners[type]=fn;}
 setAttribute(name,value){this.attributes[name]=value;}
 click(){if(!this.disabled)return this.listeners.click?.();} dblclick(){return this.listeners.dblclick?.();}
}
const all = node => [node,...node.children.flatMap(all)];
const sampleGroups = () => [{id:'research',name:'Research <script>',lastTabId:2,tabs:[{id:1,url:'https://example.test/one',title:'Notes <b>one</b>',active:false},{id:2,url:'https://example.test/two',title:'Working document',active:true}]},{id:'empty',name:'Empty',tabs:[]}];
async function harness(options={}) {
 const ids=['open','status','save-snapshot','ai-organise','refresh-tabs','tab-count','scan-time','backup-drop','live-groups'];
 const nodes=new Map(ids.map(id=>[id,new Node()]));const h={sent:[],groups:sampleGroups(),...options};
 const browser={windows:{getCurrent:async()=>({id:7,type:'normal'})},runtime:{getURL:path=>`safari-web-extension://test/${path}`,sendMessage:async message=>{
  h.sent.push(structuredClone(message));
  if(message.channel==='workspace-dashboard')return undefined;
  if(message.type==='live-groups-sync-scan')return {ok:true};if(message.type==='scan')return {ok:true,tabs:[{eligible:true},{eligible:true}]};
  if(message.type==='live-groups-get')return {ok:true,revision:'current-revision',groups:h.groups};
  if(message.type==='live-groups-focus')return h.focusError?{ok:false,error:h.focusError}:{ok:true,tabId:message.tabId??2};
  throw new Error(`Unexpected operation ${message.type}`);
 }},tabs:{create:async()=>{throw Error('Switcher must not create tabs');}}};
 vm.runInNewContext(source,{URL,browser,document:{getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag),body:new Node('body')}});
 for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
 h.node=id=>nodes.get(id);h.find=label=>all(nodes.get('live-groups')).find(node=>node.attributes['aria-label']===label);
 return h;
}
test('switcher shows live group counts and titles safely, with a full-width accessible disclosure',async()=>{
 const h=await harness();const container=h.node('live-groups');assert.equal(container.children.length,3); // Empty groups remain valid drop destinations.
 assert.match(container.textContent,/Research <script>/);assert.match(container.textContent,/Notes <b>one<\/b>/);
 const toggle=h.find('Show tabs in Research <script>');assert.equal(toggle.attributes['aria-expanded'],'false');
 const list=container.children[0].children[1];assert.equal(list.hidden,true);await toggle.click();assert.equal(list.hidden,false);assert.equal(toggle.attributes['aria-expanded'],'true');
 assert.equal(h.find('Switch to tab: Working document').attributes['aria-current'],'page');assert.equal(h.sent.some(message=>message.type==='live-groups-focus'),false);
});
test('workspace and tab clicks use the current revision without opening or restoring URLs',async()=>{
 const h=await harness();await h.find('Show tabs in Research <script>').click();
 assert.equal(h.sent.some(message=>message.type==='live-groups-focus'),false);
 let request;
 await h.find('Switch to tab: Notes <b>one</b>').dblclick();request=h.sent.filter(message=>message.type==='live-groups-focus').at(-1);assert.equal(request.tabId,1);
 assert.equal(h.sent.some(message=>['restore','drop-backup','suggest','save'].includes(message.type)),false);
});
test('stale activation is visible and empty workspaces explain how to start',async()=>{
 const h=await harness({focusError:'This tab changed. Refresh workspaces before switching.'});await h.find('Switch to tab: Notes <b>one</b>').dblclick();assert.match(h.node('status').textContent,/This tab changed/);
 const empty=await harness({groups:[]});assert.match(empty.node('live-groups').textContent,/Add a group or use AI organise/);
});

test('actual popup and coordinator agree on a validated live switch without reopening URLs',async()=>{
 const nodes=new Map(['open','status','save-snapshot','ai-organise','refresh-tabs','tab-count','scan-time','backup-drop','live-groups'].map(id=>[id,new Node()]));
 const revision='ad948f00-c253-4ae6-9d40-3d61148c5878',groupId='c604a75c-131d-44c0-9ab1-2cec8c36c380';
 const tabs=[1,2].map((id,index)=>({id,index,windowId:7,url:`https://example.test/${id}`,title:`Page ${id}`,active:id===1,pinned:false,incognito:false}));
 const store={'workspaces.live.v1':{7:{windowId:7,revision,groups:[{id:groupId,name:'Research',tabs:tabs.map(({id,url})=>({id,url})),lastTabId:2}]}}};
 const updates=[];let receiver;
 const browser={windows:{getCurrent:async()=>({id:7,type:'normal'}),get:async id=>({id,type:'normal'})},
  storage:{local:{get:async key=>({[key]:structuredClone(store[key])}),set:async values=>Object.assign(store,structuredClone(values))}},
  tabs:{query:async()=>structuredClone(tabs),get:async id=>structuredClone(tabs.find(tab=>tab.id===id)),update:async(id,changes)=>updates.push({id,...changes}),create:async()=>{throw Error('Must not open URLs');}},
  runtime:{id:'test',getURL:path=>`safari-web-extension://test/${path}`,onMessage:{addListener:fn=>receiver=fn},sendMessage:async message=>receiver(message,{id:'test',url:'safari-web-extension://test/popup.html'})}};
 const context=vm.createContext({URL,crypto:{randomUUID:()=>revision},console,browser,document:{getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag),body:new Node('body')}});
 vm.runInContext(readFileSync(new URL('../extension/core.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../extension/background.js',import.meta.url),'utf8'),context);
 vm.runInContext(source,context);
 for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
 const focus=all(nodes.get('live-groups')).find(node=>node.attributes['aria-label']==='Show tabs in Research');assert(focus);
 await focus.click();assert.equal(updates.length,0);
 const second=all(nodes.get('live-groups')).find(node=>node.attributes['aria-label']==='Switch to tab: Page 2');await second.dblclick();assert.deepEqual(updates,[{id:2,active:true}]);
 const jump=all(nodes.get('live-groups')).find(node=>node.attributes['aria-label']==='Switch to tab: Page 1');tabs[0].url='https://example.test/changed';await jump.dblclick();
 assert.equal(updates.length,1);assert.match(nodes.get('status').textContent,/no longer in this workspace|changed|Refresh/);
});

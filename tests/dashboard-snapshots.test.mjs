import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const selectionSource=readFileSync(new URL('../extension/tab-selection.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../extension/dashboard.js',import.meta.url),'utf8');
const start=source.indexOf('  async function loadSaved() {'),end=source.indexOf('  async function loadClusterStatus()',start);
function harness(){
 class Node{constructor(tag,cls,text){this.tag=tag;this.className=cls;this.textContent=text;this.children=[];this.attributes={};this.listeners={};this.classList={toggle(){}};}addEventListener(k,f){this.listeners[k]=f;}dblclick(){return this.listeners.dblclick?.();}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}setAttribute(k,v){this.attributes[k]=v;}}
 const nodes=new Map(['saved-count','workspaces','status'].map(id=>[id,new Node()])),sent=[],exports=[];
 const record={id:'snapshot',name:'Research',createdAt:'2026-11-01T12:00:00Z',tabs:[{id:'saved-tab',title:'Source',url:'https://example.com/source'}],restore:{state:'idle',results:{}},close:{state:'saved',results:[]}};
 let trashed=false,uncertain=true;
 const context={document:{createElement:tag=>new Node(tag)},run:async fn=>fn(),URL,crypto:{randomUUID:()=> 'stable-request'},windowId:7,$:id=>nodes.get(id),e:(...args)=>new Node(...args),button:(label,action,cls)=>Object.assign(new Node('button',cls,label),{click:action}),notice:text=>{nodes.get('status').textContent=text;},exportBackup:id=>exports.push(id),send:async(type,values)=>{sent.push({type,...values});if(type==='list')return{workspaces:trashed?[]:[record]};if(type==='snapshot-trash')trashed=true;if(type==='snapshot-undo-delete')trashed=false;if(type==='snapshot-open-tab'&&uncertain){uncertain=false;throw Error('Uncertain open');}return{};}};
 vm.createContext(context);vm.runInContext(selectionSource+'\n'+source.slice(start,end)+';globalThis.load=loadSaved;',context);
 return {nodes,sent,exports,load:()=>context.load(),record};
}
test('dashboard snapshots start collapsed with compact metadata and independent export/delete/undo actions',async()=>{
 const h=harness();await h.load();let entry=h.nodes.get('workspaces').children[0],card=entry.children[0];
 assert.equal(card.tag,'details');assert.equal(card.open,undefined);assert.equal(card.children[0].children[1].textContent,'1 tabs · 1 sites');
 await entry.children[1].click();assert.deepEqual(h.exports,['snapshot']);
 await entry.children[2].click();assert(h.sent.some(m=>m.type==='snapshot-trash'));assert.equal(h.nodes.get('workspaces').children[0].className,'empty');
 await h.nodes.get('status').children[0].click();assert(h.sent.some(m=>m.type==='snapshot-undo-delete'));assert.equal(h.nodes.get('workspaces').children[0].className,'snapshot-entry');
});
test('saved rows open only stored tab IDs in the current window and preserve request identity after uncertainty',async()=>{
 const h=harness();await h.load();const card=h.nodes.get('workspaces').children[0].children[0],row=card.children.at(-1).children[0];
 await assert.rejects(row.dblclick(),/Uncertain/);await row.dblclick();
 const requests=h.sent.filter(m=>m.type==='snapshot-open-tab');assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(requests[0].windowId,7);assert.equal(requests[0].tabId,'saved-tab');assert(!('url' in requests[0]));
});

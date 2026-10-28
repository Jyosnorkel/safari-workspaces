import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const core = readFileSync(new URL('../extension/core.js', import.meta.url),'utf8');
const background = readFileSync(new URL('../extension/background.js', import.meta.url),'utf8');
const clone = value => structuredClone(value);
const tab = (id, overrides = {}) => ({id, windowId: 1, index: id, title: `Page ${id}`, url: `https://example.com/${id}`, incognito: false, pinned: false, ...overrides});
function harness(initialTabs = [tab(1),tab(2)], initialStore = {}) {
  const h = {store: clone(initialStore), tabs: new Map(initialTabs.map(t=>[t.id,clone(t)])), events: [], writes:0, gets:0, nextId:100, failWrite:0, failReadback:false, failCreate:new Set(), failRemove:new Set(), private:false, windowType:'normal'};
  const browser = {
    runtime: {id:'test', getURL:path=>`safari-web-extension://test/${path}`, onMessage:{addListener: fn=>h.listener=fn}},
    storage: {local: {
      get: async key => { h.gets++; return {[key]:clone(h.store[key])}; },
      set: async values => {
        h.writes++; h.events.push('write');
        if (h.writes === h.failWrite) throw new Error('Storage full');
        if (h.onWrite) await h.onWrite(values);
        if (!h.failReadback) Object.assign(h.store,clone(values));
      }
    }},
    windows: {get:async id=>({id, incognito:h.private, type:h.windowType})},
    tabs: {
      query:async ({windowId})=>[...h.tabs.values()].filter(t=>t.windowId===windowId).map(clone),
      get:async id=> {h.events.push(`get:${id}`); if (h.onGet) h.onGet(id); const t=h.tabs.get(id); if (!t) throw new Error('Tab closed'); return clone(t);},
      remove:async id=>{h.events.push(`remove:${id}`); if(h.failRemove.has(id)) throw new Error('Close denied'); h.tabs.delete(id);},
      create:async options=>{h.events.push(`create:${options.url}`); if(h.failCreate.has(options.url)) throw new Error('Create denied'); const t=tab(h.nextId++,options); h.tabs.set(t.id,t); return clone(t);}
    }
  };
  h.context=vm.createContext({browser,crypto:webcrypto,URL,console});
  vm.runInContext(core,h.context); vm.runInContext(background,h.context);
  h.C=h.context.WorkspaceCore;
  h.send=(type,values={})=>h.listener({channel:'workspace',type,...values},{id:'test',url:'safari-web-extension://test/dashboard.html'});
  h.save=(values={})=>h.send('save',{windowId:1,name:'Research',tabs:initialTabs,requestId:webcrypto.randomUUID(),...values});
  return h;
}

test('inventory excludes private and protects pinned/restricted tabs, with missing-title fallback',()=>{
  const h=harness(); const list=h.C.inventory([tab(3,{incognito:true}),tab(2,{pinned:true}),tab(1,{title:''}),tab(4,{url:'safari://settings'}),tab(5,{url:undefined})]);
  assert.equal(list.length,4); assert.equal(list[0].title,'Untitled page');
  assert.deepEqual(Array.from(list,t=>t.eligible),[true,false,false,false]);
});
test('snapshot preserves duplicate URLs and order with durable tab IDs',()=>{
  const h=harness(); const a=tab(2,{url:'https://example.com/same'}), b=tab(1,{url:a.url});
  const s=h.C.snapshot(' Reading ',[a,b],webcrypto.randomUUID());
  assert.equal(s.name,'Reading'); assert.equal(s.tabs.length,2); assert.equal(s.tabs[0].index,1);
  assert.notEqual(s.tabs[0].id,s.tabs[1].id); assert.notEqual(s.tabs[0].id,'1');
  assert.throws(()=>h.C.snapshot('Bad',[a,a],'id'),/duplicate/);
});
test('failed storage and failed verification close no tabs',async()=>{
  for (const mode of ['failWrite','failReadback']) {
    const h=harness(); h[mode]=mode==='failWrite'?1:true;
    const result=await h.save({close:true}); assert.equal(result.ok,false);
    assert.equal(h.tabs.size,2); assert.equal(h.events.some(e=>e.startsWith('remove:')),false);
  }
});
test('verified full snapshot precedes close; request replay is idempotent',async()=>{
  const h=harness(); const requestId=webcrypto.randomUUID();
  const first=await h.save({close:true,requestId}); assert.equal(first.ok,true);
  assert.equal(h.tabs.size,0); assert.equal(first.workspace.close.state,'closed');
  assert(h.events.indexOf('write') < h.events.indexOf('remove:1'));
  const count=h.writes; const again=await h.save({close:true,requestId});
  assert.equal(again.repeated,true); assert.equal(h.writes,count);
});
test('stale scan aborts before any close',async()=>{
  const h=harness(); h.tabs.get(2).url='https://example.org/new';
  assert.equal((await h.save({close:true})).ok,false); assert.equal(h.tabs.size,2);
});
test('navigation after saving is left open, while snapshot retains original URL',async()=>{
  const h=harness(); h.onWrite=()=>{h.tabs.get(2).url='https://example.org/new';};
  const r=await h.save({close:true}); assert.equal(r.ok,true); assert.equal(r.workspace.close.state,'partial');
  assert.equal(h.tabs.has(2),true); assert.equal(r.workspace.tabs[1].url,'https://example.com/2');
});
test('partial close and progress-write failure retain complete recovery data',async()=>{
  const h=harness(); h.failRemove.add(2);
  const r=await h.save({close:true}); assert.equal(r.workspace.close.state,'partial'); assert.equal(r.workspace.tabs.length,2);
  const j=harness(); j.failWrite=2;
  const failed=await j.save({close:true}); assert.equal(failed.ok,false); assert.equal(j.tabs.has(2),true);
  assert.equal(Object.values(j.store[j.C.KEY])[0].tabs.length,2);
});
test('restore retains snapshot, preserves order and retries only failed entries',async()=>{
  const h=harness(); const saved=await h.save(); const id=saved.workspace.id;
  h.failCreate.add('https://example.com/2');
  const r=await h.send('restore',{id,windowId:1}); assert.equal(r.ok,true); assert.equal(r.workspace.restore.state,'partial');
  h.failCreate.clear(); const retry=await h.send('restore',{id,windowId:1});
  assert.equal(retry.workspace.restore.state,'complete');
  assert.equal(h.events.filter(e=>e==='create:https://example.com/1').length,1);
  assert.equal(Object.values(h.store[h.C.KEY]).length,1);
  const count=h.events.length; await h.send('restore',{id,windowId:1});
  assert.equal(h.events.length,count);
});
test('concurrent restore requests do not open duplicates',async()=>{
  const h=harness(); const {workspace}=await h.save();
  const results=await Promise.all([h.send('restore',{id:workspace.id,windowId:1}),h.send('restore',{id:workspace.id,windowId:1})]);
  assert(results.every(r=>r.ok)); assert.equal(h.events.filter(e=>e.startsWith('create:')).length,2);
});
test('interrupted restore requires explicit resolution and survives coordinator restart',async()=>{
  const h=harness(); const {workspace}=await h.save(); h.failWrite=h.writes+3;
  const result=await h.send('restore',{id:workspace.id,windowId:1}); assert.equal(result.ok,false);
  const restarted=harness([],h.store);
  const retry=await restarted.send('restore',{id:workspace.id,windowId:1});
  assert.equal(retry.ok,false); assert.match(retry.error,/interrupted/);
  assert.equal(restarted.events.some(e=>e.startsWith('create:')),false);
  const uncertain=Object.entries((await restarted.send('list')).workspaces[0].restore.results).find(([,r])=>r.state==='pending')[0];
  assert.equal((await restarted.send('resolve',{id:workspace.id,tabId:uncertain,resolution:'opened'})).ok,true);
  assert.equal((await restarted.send('restore',{id:workspace.id,windowId:1})).ok,true);
  assert.equal(restarted.events.filter(e=>e.startsWith('create:')).length,1);
});
test('private window cannot scan, save or restore',async()=>{
  const h=harness(); const {workspace}=await h.save(); h.private=true;
  assert.equal((await h.send('scan',{windowId:1})).ok,false);
  assert.equal((await h.save({close:true})).ok,false);
  assert.equal((await h.send('restore',{id:workspace.id,windowId:1})).ok,false);
});
test('AI validation rejects invented and duplicate assignments; missing IDs stay ungrouped',()=>{
  const h=harness(); const tabs=h.C.inventory([tab(1),tab(2)]);
  assert.throws(()=>h.C.suggestions({groups:[{name:'Bad',tabIds:[999]}]},tabs),/invented/);
  assert.throws(()=>h.C.suggestions({groups:[{name:'Bad',tabIds:[1,1]}]},tabs),/once/);
  const result=h.C.suggestions({groups:[{name:'Work',tabIds:[1]}]},tabs); assert.equal(result.ungrouped[0],'2');
  const input=h.C.aiInventory(h.C.inventory([tab(1,{url:'https://user:password@example.com/path?q=secret#token'})]));
  assert.equal(input[0].url,'https://example.com/path');
});
test('untrusted page senders cannot call the coordinator',()=>{
  const h=harness(); assert.equal(h.listener({channel:'workspace',type:'list'},{id:'test',url:'https://example.com'}),undefined);
});

test('completed snapshots support deliberate new sessions, but same request and stale managers cannot duplicate them',async()=>{
  const h=harness(); const {workspace}=await h.save(); const id=workspace.id;
  const first=await h.send('restore',{id,windowId:1});
  const previousSessionId=first.workspace.restore.sessionId, newSessionId=webcrypto.randomUUID();
  const request={id,windowId:1,previousSessionId,newSessionId};
  const copies=await Promise.all([h.send('restore',request),h.send('restore',request)]);
  assert(copies.every(r=>r.ok)); assert.equal(copies[1].repeated,true);
  assert.equal(h.events.filter(e=>e.startsWith('create:')).length,4);
  assert.equal(copies[0].workspace.restoreHistory.length,1);
  assert.equal(copies[0].workspace.tabs.length,2);
  const stale=await h.send('restore',{...request,newSessionId:webcrypto.randomUUID()});
  assert.equal(stale.ok,false); assert.match(stale.error,/changed in another/);
});


test('pending navigation aborts save before writes or closes, even when the old URL matches',async()=>{
  const h=harness(); h.tabs.get(2).pendingUrl='https://example.org/destination';
  const result=await h.save({close:true});
  assert.equal(result.ok,false); assert.match(result.error,/navigating/);
  assert.equal(h.writes,0); assert.equal(h.tabs.size,2);
  assert.equal(h.events.some(e=>e.startsWith('remove:')),false);
});
test('navigation starting after snapshot leaves that tab open with its recovery URL saved',async()=>{
  const h=harness(); h.onWrite=()=>{h.tabs.get(2).pendingUrl='https://example.org/destination';};
  const result=await h.save({close:true});
  assert.equal(result.ok,true); assert.equal(result.workspace.close.state,'partial');
  assert.equal(h.tabs.has(1),false); assert.equal(h.tabs.has(2),true);
  assert.equal(result.workspace.close.results[1].state,'left-open');
  assert.match(result.workspace.close.results[1].error,/navigating/);
  assert.equal(result.workspace.tabs[1].url,'https://example.com/2');
});
test('malformed saved snapshots and journals cannot start any restore or recovery writes',async()=>{
  const mutations=[
    r=>{r.tabs[0].url='javascript:alert(1)';},
    r=>{r.tabs[1].id=r.tabs[0].id;},
    r=>{r.tabs[0].id='not-a-durable-id';},
    r=>{r.tabs[1].index=r.tabs[0].index;},
    r=>{r.tabs[0].title={text:'not-a-title'};},
    r=>{r.restore.results[r.tabs[0].id]={state:'unknown'};},
    r=>{r.restore.results[webcrypto.randomUUID()]={state:'opened'};},
    r=>{r.restore.state='complete';},
    r=>{r.restore.results=[];},
    r=>{r.restore=null;},
    r=>{r.close.results=[{tabId:webcrypto.randomUUID(),state:'closed'}];},
    r=>{r.restoreHistory='invalid';},
    r=>{r.name={};},
    r=>{r.id=webcrypto.randomUUID();}
  ];
  for(const mutate of mutations){
    const original=harness(); const {workspace}=await original.save();
    const stored=original.store[original.C.KEY][workspace.id]; mutate(stored);
    const h=harness([],original.store); const before=clone(h.store);
    const restored=await h.send('restore',{id:workspace.id,windowId:1});
    assert.equal(restored.ok,false); assert.match(restored.error,/snapshot or recovery journal is invalid/);
    assert.equal(h.events.some(e=>e.startsWith('create:')),false); assert.equal(h.writes,0);
    const resolved=await h.send('resolve',{id:workspace.id,tabId:workspace.tabs[0].id,resolution:'opened'});
    assert.equal(resolved.ok,false); assert.equal(h.writes,0); assert.deepEqual(h.store,before);
  }
});
test('malformed storage envelope and malformed request IDs change no tabs',async()=>{
  const h=harness(); h.store[h.C.KEY]=[];
  assert.equal((await h.save({close:true})).ok,false); assert.equal(h.tabs.size,2);
  const j=harness();
  const invalid=await j.save({close:true,requestId:'------------------------------------'});
  assert.equal(invalid.ok,false); assert.equal(j.writes,0); assert.equal(j.tabs.size,2);
});
test('non-normal windows cannot scan, save or restore',async()=>{
  const h=harness(); const {workspace}=await h.save(); h.windowType='popup';
  assert.equal((await h.send('scan',{windowId:1})).ok,false);
  assert.equal((await h.save({close:true})).ok,false);
  assert.equal((await h.send('restore',{id:workspace.id,windowId:1})).ok,false);
});

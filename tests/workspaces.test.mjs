import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const core = readFileSync(new URL('../extension/core.js', import.meta.url),'utf8');
const background = readFileSync(new URL('../extension/background.js', import.meta.url),'utf8');
const clone = value => structuredClone(value);
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).reverse().map(key => [key,reverseKeys(value[key])]));
  return value;
}
const tab = (id, overrides = {}) => ({id, windowId: 1, index: id, title: `Page ${id}`, url: `https://example.com/${id}`, incognito: false, pinned: false, ...overrides});
function harness(initialTabs = [tab(1),tab(2)], initialStore = {}) {
  const h = {store: clone(initialStore), tabs: new Map(initialTabs.map(t=>[t.id,clone(t)])), events: [], writes:0, gets:0, nextId:100, failWrite:0, failReadback:false, failCreate:new Set(), failRemove:new Set(), private:false, windowType:'normal'};
  const browser = {
    runtime: {id:'test', getURL:path=>`safari-web-extension://test/${path}`, onMessage:{addListener: fn=>h.listener=fn}},
    storage: {local: {
      get: async key => { h.gets++; return {[key]:h.reorderKeys ? reverseKeys(clone(h.store[key])) : clone(h.store[key])}; },
      set: async values => {
        h.writes++; h.events.push('write');
        if (h.writes === h.failWrite) throw new Error('Storage full');
        if (h.onWrite) await h.onWrite(values);
        if (!h.failReadback) Object.assign(h.store,clone(values));
        if (h.corruptStored && h.store['workspaces.v1']) {
          const record=Object.values(h.store['workspaces.v1'])[0];
          if (h.corruptStored==='title') record.tabs[0].title='Changed after saving';
          if (h.corruptStored==='order') record.tabs.reverse();
        }
      }
    }},
    windows: {get:async id=>({id, incognito:h.private, type:h.windowType}),
      create:async options=>{h.events.push('window:create'); if(h.failWindow) throw new Error('Window unavailable'); return {id:2,type:'normal',incognito:false};}},
    tabs: {
      query:async ({windowId})=>[...h.tabs.values()].filter(t=>t.windowId===windowId).map(clone),
      get:async id=> {h.events.push(`get:${id}`); if (h.onGet) h.onGet(id); const t=h.tabs.get(id); if (!t) throw new Error('Tab closed'); return clone(t);},
      remove:async id=>{h.events.push(`remove:${id}`); if(h.failRemove.has(id)) throw new Error('Close denied'); h.tabs.delete(id);},
      create:async options=>{h.events.push(`create:${options.url}`); if(h.failCreate.has(options.url)) throw new Error('Create denied'); const t=tab(h.nextId++,options); h.tabs.set(t.id,t); return clone(t);}
    }
  };
  h.context=vm.createContext({browser,crypto:webcrypto,URL,TextEncoder,console});
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


test('storage property reordering does not reject an otherwise complete snapshot',async()=>{
  const h=harness(); h.reorderKeys=true;
  const result=await h.save({close:true});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.workspace.close.state,'closed');
  assert.equal(h.tabs.size,0);
});

for (const mutation of ['title','order']) {
  test(`storage verification still rejects changed ${mutation} before any close`,async()=>{
    const h=harness(); h.corruptStored=mutation;
    const result=await h.save({close:true});
    assert.equal(result.ok,false); assert.match(result.error,/verify/);
    assert.equal(h.tabs.size,2);
    assert.equal(h.events.some(event=>event.startsWith('remove:')),false);
  });
}
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


test('whole-window snapshot preserves pinned web tabs, duplicates and order without closing anything', async () => {
  const h = harness([tab(2,{pinned:true,url:'https://example.com/same'}),tab(1,{url:'https://example.com/same'}),tab(3,{incognito:true}),tab(4,{url:'safari-web-extension://test/dashboard.html'})]);
  const response = await h.send('snapshot-window',{windowId:1,name:'Window backup',requestId:webcrypto.randomUUID()});
  assert.equal(response.ok,true); assert.equal(response.workspace.tabs.length,2);
  assert.equal(response.workspace.tabs[0].index,1);
  assert.equal(response.workspace.close.state,'not-requested'); assert.equal(h.tabs.size,4);
  assert.equal(h.events.some(event=>event.startsWith('remove:')),false);
});
test('backup export/import round trip keeps URLs, title text and duplicates but resets operation journals', async () => {
  const h = harness([tab(1,{title:'<script>alert(1)</script>',url:'https://example.com/path?q=private#fragment'}),tab(2,{url:'https://example.com/path?q=private#fragment'})]);
  const original = (await h.save()).workspace;
  const exported = await h.send('export-backup'); assert.equal(exported.ok,true);
  const portable = JSON.parse(exported.json);
  assert.equal(portable.version,1); assert.equal(portable.workspaces[0].tabs[0].id,undefined);
  assert.equal(portable.workspaces[0].close,undefined);
  assert.equal((await h.send('import-backup',{json:exported.json})).imported,1);
  const records = (await h.send('list')).workspaces;
  const imported = records.find(record=>record.id!==original.id);
  assert.equal(imported.tabs[0].url,original.tabs[0].url); assert.equal(imported.tabs[0].title,original.tabs[0].title);
  assert.notEqual(imported.tabs[0].id,original.tabs[0].id);
  assert.equal(imported.tabs.length,2); assert.equal(imported.restore.state,'not-started');
  assert.equal(h.tabs.size,2); assert.equal(h.events.some(event=>/^(remove|create):/.test(event)),false);
});
test('invalid backup files are rejected before any write or tab mutation',async () => {
  const h = harness(); await h.save();
  const json = (await h.send('export-backup')).json;
  const baseline = h.writes;
  const bad = JSON.parse(json); bad.workspaces.push({...bad.workspaces[0],tabs:[{title:'Unsafe',url:'javascript:alert(1)'}]});
  for (const input of ['not json',JSON.stringify({...JSON.parse(json),version:999}),JSON.stringify(bad),'x'.repeat(10*1024*1024+1)]) {
    assert.equal((await h.send('import-backup',{json:input})).ok,false);
    assert.equal(h.writes,baseline);
  }
  assert.equal(h.tabs.size,2);
});
test('snapshot-only write failure leaves every original tab open',async () => {
  const h = harness(); h.failWrite=1;
  assert.equal((await h.send('snapshot-window',{windowId:1,name:'Backup',requestId:webcrypto.randomUUID()})).ok,false);
  assert.equal(h.tabs.size,2); assert.equal(h.events.some(event=>event.startsWith('remove:')),false);
});

test('portable backup bounds reject oversized collections and unreadable exports without writes', async () => {
  const h=harness(); const original=(await h.save()).workspace;
  const portable=JSON.parse((await h.send('export-backup')).json);
  for (const mutate of [
    value=>value.workspaces[0].tabs[0].url='file:///private/example',
    value=>value.workspaces[0].tabs[0].title='x'.repeat(8193),
    value=>value.workspaces[0].tabs=Array(501).fill(value.workspaces[0].tabs[0]),
    value=>value.workspaces=Array(101).fill(value.workspaces[0])
  ]) {
    const value=clone(portable); mutate(value); const before=h.writes;
    assert.equal((await h.send('import-backup',{json:JSON.stringify(value)})).ok,false);
    assert.equal(h.writes,before);
  }
  h.store[h.C.KEY][original.id].tabs[0].url='javascript:alert(1)';
  assert.equal((await h.send('export-backup')).ok,false);
});
test('private windows and empty eligible windows cannot create a window snapshot',async () => {
  const h=harness([tab(1,{url:'safari://settings'})]);
  const values={windowId:1,name:'Backup',requestId:webcrypto.randomUUID()};
  assert.equal((await h.send('snapshot-window',values)).ok,false);
  h.private=true; assert.equal((await h.send('snapshot-window',values)).ok,false);
  assert.equal(h.writes,0); assert.equal(h.tabs.size,1);
});


test('dropped backup persists before new window and restores file order without touching existing tabs', async()=>{
  const h=harness();
  const saved=await h.save(); const json=h.C.encodeBackup([saved.workspace]); h.events=[];
  const result=await h.send('drop-backup',{json,requestId:webcrypto.randomUUID(),windowId:1});
  assert.equal(result.ok,true); assert.equal(result.windowId,2); assert.equal(result.imported,1);
  assert.equal(result.workspaces[0].restore.state,'complete');
  assert(h.events.indexOf('write') < h.events.indexOf('window:create'));
  assert.deepEqual(h.events.filter(e=>e.startsWith('create:')),['create:https://example.com/1','create:https://example.com/2']);
  assert.equal(h.tabs.get(1).windowId,1); assert.equal(h.tabs.get(2).windowId,1);
  assert.equal(h.events.some(e=>e.startsWith('remove:')),false);
  assert.equal(h.tabs.get(100).windowId,2);
});
test('dropped backup replays and concurrent messages never open duplicate windows or URLs',async()=>{
  const h=harness(); const {workspace}=await h.save(); const json=h.C.encodeBackup([workspace]);
  const request={json,requestId:webcrypto.randomUUID(),windowId:1};
  const results=await Promise.all([h.send('drop-backup',request),h.send('drop-backup',request)]);
  assert(results.every(r=>r.ok)); assert.equal(results[1].repeated,true);
  assert.equal(h.events.filter(e=>e==='window:create').length,1);
  assert.equal(h.events.filter(e=>e.startsWith('create:')).length,2);
});
test('invalid drops and failed storage never create a window',async()=>{
  for(const mode of ['invalid','write','readback']) {
    const h=harness(); const {workspace}=await h.save(); const json=h.C.encodeBackup([workspace]); h.events=[];
    if(mode==='write') h.failWrite=h.writes+1;
    if(mode==='readback') h.failReadback=true;
    const result=await h.send('drop-backup',{json:mode==='invalid'?'{}':json,requestId:webcrypto.randomUUID(),windowId:1});
    assert.equal(result.ok,false); assert.equal(h.events.includes('window:create'),false);
    assert.equal(h.tabs.size,2);
  }
});
test('uncertain dropped-backup window creation retains snapshots and replay does not create again',async()=>{
  const h=harness(); const {workspace}=await h.save(); const request={json:h.C.encodeBackup([workspace]),requestId:webcrypto.randomUUID(),windowId:1};
  h.failWindow=true;
  assert.equal((await h.send('drop-backup',request)).ok,false);
  assert.equal(Object.values(h.store[h.C.KEY]).length,2);
  const restarted=harness([],h.store);
  const replay=await restarted.send('drop-backup',request);
  assert.equal(replay.repeated,true); assert.equal(restarted.events.includes('window:create'),false);
});
test('dropped backup partial restore keeps complete snapshot and per-tab failures',async()=>{
  const h=harness(); const {workspace}=await h.save(); h.failCreate.add('https://example.com/2');
  const result=await h.send('drop-backup',{json:h.C.encodeBackup([workspace]),requestId:webcrypto.randomUUID(),windowId:1});
  assert.equal(result.ok,true); assert.equal(result.workspaces[0].restore.state,'partial');
  assert.equal(result.workspaces[0].tabs.length,2); assert.equal(result.workspaces[0].restore.windowId,2);
});
test('manual review order is saved and restored without rearranging live tabs',async()=>{
  const h=harness(); const {workspace}=await h.save({tabs:[tab(2),tab(1)]});
  assert.deepEqual(Array.from(workspace.tabs,t=>t.url),['https://example.com/2','https://example.com/1']);
  assert.equal(h.tabs.get(1).index,1); assert.equal(h.tabs.get(2).index,2);
  await h.send('restore',{id:workspace.id,windowId:1});
  assert.deepEqual(h.events.filter(e=>e.startsWith('create:')),['create:https://example.com/2','create:https://example.com/1']);
});
test('drop interruption after window creation cannot replay the browser side effect',async()=>{
  const h=harness(); const {workspace}=await h.save();
  const request={json:h.C.encodeBackup([workspace]),requestId:webcrypto.randomUUID(),windowId:1};
  h.failWrite=h.writes+3; // import, pending-window journal, then confirmed-window journal
  assert.equal((await h.send('drop-backup',request)).ok,false);
  assert.equal(h.events.filter(e=>e==='window:create').length,1);
  const restarted=harness([],h.store);
  const replay=await restarted.send('drop-backup',request);
  assert.equal(replay.repeated,true); assert.equal(restarted.events.length,0);
});
test('multi-workspace drop keeps file order and duplicate URLs in one new window',async()=>{
  const h=harness(); const {workspace}=await h.save();
  const second={...workspace,name:'Second',tabs:[{...workspace.tabs[0],url:'https://example.com/1'}]};
  const result=await h.send('drop-backup',{json:h.C.encodeBackup([workspace,second]),requestId:webcrypto.randomUUID(),windowId:1});
  assert.equal(result.imported,2); assert.equal(h.events.filter(e=>e==='window:create').length,1);
  assert.deepEqual(h.events.filter(e=>e.startsWith('create:')),['create:https://example.com/1','create:https://example.com/2','create:https://example.com/1']);
});
test('multi-workspace interruption retains shared destination before any URL opens',async()=>{
  const h=harness(); const {workspace}=await h.save();
  const request={json:h.C.encodeBackup([workspace,{...workspace,name:'Second'}]),requestId:webcrypto.randomUUID(),windowId:1};
  h.failWrite=h.writes+5; // import, pending window, shared destination, restoring, pending tab
  assert.equal((await h.send('drop-backup',request)).ok,false);
  const imported=Object.values(h.store[h.C.KEY]).filter(w=>w.dropRequestId===request.requestId);
  assert.equal(imported.length,2); assert(imported.every(w=>w.restore.windowId===2));
  assert.equal(h.events.some(e=>e.startsWith('create:')),false);
  const restarted=harness([],h.store); const replay=await restarted.send('drop-backup',request);
  assert.equal(replay.repeated,true); assert.equal(replay.windowId,2);
  assert.equal(restarted.events.length,0);
});
test('malformed saved restore destination is rejected before browser operations',async()=>{
  const h=harness(); const {workspace}=await h.save();
  h.store[h.C.KEY][workspace.id].restore.windowId='2'; h.events=[];
  const result=await h.send('restore',{id:workspace.id,windowId:1});
  assert.equal(result.ok,false); assert.equal(h.events.length,0);
});

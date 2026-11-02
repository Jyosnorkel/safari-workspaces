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
function harness(initialTabs = [tab(1),tab(2)], initialStore = {}, options = {}) {
  const h = {store: clone(initialStore), tabs: new Map(initialTabs.map(t=>[t.id,clone(t)])), events: [], writes:0, gets:0, nextId:100, failWrite:0, failReadback:false, failCreate:new Set(), failRemove:new Set(), private:false, windowType:'normal', sessionStore:clone(options.sessionStore || {})};
  const browser = {
    runtime: {sendNativeMessage:async(host,message)=>{h.native={host,message};return h.nativeResult || {ok:true,filename:'tabby-test.json'};},id:'test', getURL:path=>`safari-web-extension://test/${path}`, onMessage:{addListener: fn=>h.listener=fn},onStartup:{addListener:fn=>h.startup=fn}},
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
    windows: {onRemoved:{addListener:fn=>h.windowRemoved=fn},get:async id=>({id, incognito:h.private, type:h.windowType}),
      create:async options=>{h.events.push('window:create'); if(h.failWindow) throw new Error('Window unavailable'); return {id:2,type:'normal',incognito:false};}},
    tabs: {
      onActivated:{addListener:fn=>h.activated=fn},
      update:async (id,changes)=>{h.events.push(`activate:${id}`);if(h.failUpdate)throw new Error('Activation denied');const current=h.tabs.get(id);if(!current)throw new Error('Tab closed');for(const t of h.tabs.values())if(t.windowId===current.windowId)t.active=false;Object.assign(current,changes);return clone(current);},
      query:async ({windowId})=>{if(h.onQuery)h.onQuery();return [...h.tabs.values()].filter(t=>t.windowId===windowId).map(clone);},
      move:async (id,{windowId,index})=>{h.events.push(`move:${id}:${index}`);h.moveCalls=(h.moveCalls||0)+1;if(h.onMove)h.onMove(id,index);if(h.failMove===h.moveCalls)throw new Error('Move denied');const list=[...h.tabs.values()].filter(t=>t.windowId===windowId).sort((a,b)=>a.index-b.index);const from=list.findIndex(t=>t.id===id);if(from<0)throw new Error('Wrong window');list.splice(index,0,list.splice(from,1)[0]);list.forEach((t,index)=>t.index=index);return clone(h.tabs.get(id));},
      get:async id=> {h.events.push(`get:${id}`); if (h.onGet) h.onGet(id); const t=h.tabs.get(id); if (!t) throw new Error('Tab closed'); return clone(t);},
      remove:async id=>{h.events.push(`remove:${id}`); if(h.failRemove.has(id)) throw new Error('Close denied'); h.tabs.delete(id);},
      create:async options=>{h.events.push(`create:${options.url}`); if(h.failCreate.has(options.url)) throw new Error('Create denied'); const t=tab(h.nextId++,options); h.tabs.set(t.id,t); return clone(t);}
    }
  };
  if(options.session) browser.storage.session={get:async key=>({[key]:clone(h.sessionStore[key])}),set:async values=>Object.assign(h.sessionStore,clone(values))};
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

const LIVE_KEY='workspaces.live.v1';
const liveGroups=(tabs=[tab(1),tab(2)],id='ungrouped')=>[{id,name:id==='ungrouped'?'Ungrouped':'Research',reason:'Related task',tabs:tabs.map(tab=>({id:tab.id,url:tab.url,excluded:tab.id===2}))}];
const publish=(h,groups=liveGroups(),expectedRevision=null)=>h.send('live-groups-set',{windowId:1,expectedRevision,groups});

test('live groups persist separately, return current metadata and do not create recovery snapshots',async()=>{
 const h=harness();const empty=await h.send('live-groups-get',{windowId:1});assert.equal(empty.revision,null);assert.equal(empty.groups.length,0);
 const result=await publish(h);assert.equal(result.ok,true);assert.match(result.revision,/^[a-f0-9-]{36}$/);assert.equal(result.groups[0].tabs[1].excluded,true);
 assert.equal(h.store[h.C.KEY],undefined);assert(h.store[LIVE_KEY]);assert.equal(h.events.some(e=>e.startsWith('activate:')||e.startsWith('create:')||e.startsWith('remove:')),false);
 h.tabs.get(1).title='Fresh title';const restarted=harness([...h.tabs.values()],h.store);
 const view=await restarted.send('live-groups-get',{windowId:1});assert.equal(view.groups[0].tabs[0].title,'Fresh title');assert.equal(view.groups[0].reason,'Related task');
});
test('live group publication validates the whole inventory and preserves the previous edit on malformed or protected data',async()=>{
 const h=harness();const first=await publish(h);const before=clone(h.store);const writes=h.writes;
 for(const groups of [
  [...liveGroups(),...liveGroups()],
  liveGroups([tab(1),tab(1)]),
  liveGroups([tab(999)]),
  [{id:'bad',name:'Bad',tabs:[]}],
  [{id:'ungrouped',name:'',tabs:[]}],
  [{id:'ungrouped',name:'Too much',reason:'x'.repeat(2001),tabs:[]}],
  liveGroups([tab(1,{url:'javascript:alert(1)'})]),
  [{id:'ungrouped',name:'Invalid flag',tabs:[{id:1,url:tab(1).url,excluded:'yes'}]}]
 ]) {const result=await publish(h,groups,first.revision);assert.equal(result.ok,false);}
 assert.deepEqual(h.store,before);assert.equal(h.writes,writes);
 for(const overrides of [{pinned:true},{incognito:true},{pendingUrl:'https://example.org/new'},{windowId:2}]) {
  Object.assign(h.tabs.get(1),tab(1),overrides);assert.equal((await publish(h,liveGroups(),first.revision)).ok,false);
 }
 assert.equal(h.events.some(e=>e.startsWith('activate:')),false);
});
test('live groups CAS rejects older dashboards and concurrent publications without lost edits',async()=>{
 const h=harness();const first=await publish(h);const a=liveGroups();a[0].name='First edit';const b=liveGroups();b[0].name='Stale edit';
 const results=await Promise.all([publish(h,a,first.revision),publish(h,b,first.revision)]);
 assert.equal(results[0].ok,true);assert.equal(results[1].ok,false);assert.match(results[1].error,/changed in another manager/);
 assert.equal((await h.send('live-groups-get',{windowId:1})).groups[0].name,'First edit');
});
test('popup listing prunes stale memberships but keeps edit revision for a refreshed dashboard publication',async()=>{
 const h=harness([tab(1),tab(2),tab(3),tab(4),tab(5)]);const first=await publish(h,liveGroups([...h.tabs.values()]));
 h.tabs.get(1).url='https://example.org/navigation';h.tabs.get(2).pinned=true;h.tabs.get(3).windowId=2;h.tabs.delete(4);
 const view=await h.send('live-groups-get',{windowId:1});assert.equal(view.revision,first.revision);assert.deepEqual(Array.from(view.groups[0].tabs,t=>t.id),[5]);
 const updated=await publish(h,liveGroups([tab(5)]),first.revision);assert.equal(updated.ok,true);
});
test('pending navigation is hidden temporarily without discarding unchanged live group membership',async()=>{
 const h=harness();const first=await publish(h);h.tabs.get(1).pendingUrl='https://example.org/pending';
 const pending=await h.send('live-groups-get',{windowId:1});assert.deepEqual(Array.from(pending.groups[0].tabs,t=>t.id),[2]);assert.equal(h.store[LIVE_KEY][1].groups[0].tabs.length,2);
 delete h.tabs.get(1).pendingUrl;const finished=await h.send('live-groups-get',{windowId:1});assert.equal(finished.revision,first.revision);assert.equal(finished.groups[0].tabs.length,2);
});
test('workspace click returns to most recently activated member without changing edit revision',async()=>{
 const h=harness();const first=await publish(h);h.activated({windowId:1,tabId:2});
 const view=await h.send('live-groups-get',{windowId:1});assert.equal(view.revision,first.revision);assert.equal(view.groups[0].lastTabId,2);
 const focused=await h.send('live-groups-focus',{windowId:1,groupId:'ungrouped',expectedRevision:view.revision});
 assert.equal(focused.ok,true);assert.equal(focused.tabId,2);assert.equal(h.tabs.get(2).active,true);
 assert.equal(h.events.some(e=>e.startsWith('create:')||e.startsWith('remove:')||e==='window:create'),false);
});
test('specific tab focus rejects stale revisions, unknown membership, changed URL and pending navigation',async()=>{
 const h=harness();const first=await publish(h);const target={windowId:1,groupId:'ungrouped',tabId:1,expectedRevision:first.revision};
 assert.equal((await h.send('live-groups-focus',{...target,expectedRevision:webcrypto.randomUUID()})).ok,false);
 assert.equal((await h.send('live-groups-focus',{...target,tabId:999})).ok,false);
 h.onGet=id=>{if(id===1)h.tabs.get(1).url='https://example.org/changed-after-list';};
 assert.equal((await h.send('live-groups-focus',target)).ok,false);assert.equal(h.events.some(e=>e.startsWith('activate:')),false);
 h.onGet=id=>{if(id===1)h.tabs.get(1).pendingUrl='https://example.org/pending';};h.tabs.get(1).url=tab(1).url;
 assert.equal((await h.send('live-groups-focus',target)).ok,false);assert.equal(h.events.some(e=>e.startsWith('activate:')),false);
});
test('live activation fails before browser changes on failed writes and returns useful API failures',async()=>{
 const h=harness();const first=await publish(h);const target={windowId:1,groupId:'ungrouped',tabId:1,expectedRevision:first.revision};
 h.failWrite=h.writes+1;assert.equal((await h.send('live-groups-focus',target)).ok,false);assert.equal(h.events.some(e=>e.startsWith('activate:')),false);
 h.failWrite=0;h.failUpdate=true;const result=await h.send('live-groups-focus',target);assert.equal(result.ok,false);assert.match(result.error,/Activation denied/);
 assert.equal(h.tabs.size,2);
});
test('private live routes and unrelated extension-page senders cannot expose or activate live groups',async()=>{
 const h=harness();await publish(h);h.private=true;
 for(const type of ['live-groups-get','live-groups-set','live-groups-focus'])assert.equal((await h.send(type,{windowId:1,expectedRevision:null,groups:[]})).ok,false);
 h.private=false;const view=await h.send('live-groups-get',{windowId:1});
 const message={channel:'workspace',type:'live-groups-focus',windowId:1,groupId:'ungrouped',expectedRevision:view.revision};
 for(const url of ['https://example.com/dashboard.html','safari-web-extension://test/other.html','safari-web-extension://other/popup.html'])assert.equal(h.listener(message,{id:'test',url}),undefined);
 assert.equal(h.events.some(e=>e.startsWith('activate:')),false);
});
test('session storage is preferred and browser startup/window removal clear only live groups',async()=>{
 const h=harness(undefined,{}, {session:true});const first=await publish(h);assert.equal(first.ok,true);assert(h.sessionStore[LIVE_KEY]);assert.equal(h.store[LIVE_KEY],undefined);
 const recovered=harness([...h.tabs.values()],{}, {session:true,sessionStore:h.sessionStore});assert.equal((await recovered.send('live-groups-get',{windowId:1})).revision,first.revision);
 h.startup();assert.equal((await h.send('live-groups-get',{windowId:1})).groups.length,0);
 const fallback=harness();const {workspace}=await fallback.save();await publish(fallback);fallback.windowRemoved(1);
 assert.equal((await fallback.send('live-groups-get',{windowId:1})).groups.length,0);assert(fallback.store[fallback.C.KEY][workspace.id]);
 await publish(fallback);fallback.startup();assert.equal((await fallback.send('live-groups-get',{windowId:1})).revision,null);assert(fallback.store[fallback.C.KEY][workspace.id]);
});
test('failed browser-session reset blocks live selection rather than reusing stale tab IDs',async()=>{
 const h=harness();const first=await publish(h);h.failWrite=h.writes+1;h.startup();
 const view=await h.send('live-groups-get',{windowId:1});assert.equal(view.ok,false);assert.match(view.error,/could not be reset/);
 const focus=await h.send('live-groups-focus',{windowId:1,expectedRevision:first.revision,groupId:'ungrouped'});assert.equal(focus.ok,false);assert.equal(h.events.some(e=>e.startsWith('activate:')),false);
});


const CLUSTER_KEY='workspaces.cluster.v1';
const groupA='12d73287-59b3-4a2a-af83-9efac412ba18',groupB='d52f7d0d-0717-41a1-a532-48f7c86f1f44';
async function clusterFixture(extra=[]) {
 const initial=[tab(1,{index:0}),tab(2,{index:1}),tab(3,{index:2}),tab(4,{index:3}),...extra];
 const h=harness(initial);
 const groups=[{id:groupA,name:'A',tabs:[{id:4,url:tab(4).url},{id:2,url:tab(2).url}]},{id:groupB,name:'B',tabs:[{id:1,url:tab(1).url},{id:3,url:tab(3).url}]}];
 const published=await h.send('live-groups-set',{windowId:1,expectedRevision:null,groups});assert.equal(published.ok,true);
 h.preview=values=>h.send('cluster-preview',{windowId:1,expectedRevision:published.revision,requestId:webcrypto.randomUUID(),...values});
 h.order=()=>[...h.tabs.values()].filter(tab=>tab.windowId===1).sort((a,b)=>a.index-b.index).map(tab=>tab.id);
 return h;
}
test('cluster preview is durable/read-only; apply clusters named groups in review order and preserves IDs',async()=>{
 const h=await clusterFixture();const preview=await h.preview();assert.equal(preview.ok,true);assert.equal(preview.state,'ready');assert.equal(preview.moveCount,2);assert.deepEqual(h.order(),[1,2,3,4]);assert(h.store[CLUSTER_KEY]);
 const applied=await h.send('cluster-apply',{windowId:1,planId:preview.planId});assert.equal(applied.ok,true);assert.equal(applied.state,'complete');assert.equal(applied.canUndo,true);assert.deepEqual(h.order(),[4,2,1,3]);
 assert.equal(h.tabs.size,4);assert.equal(h.events.some(event=>/^(remove|create|window:create|activate):/.test(event)),false);
});
test('clustering leaves pinned/excluded/restricted/dashboard anchors fixed throughout and uses same-window moves',async()=>{
 const initial=[tab(9,{index:0,pinned:true}),tab(1,{index:1}),tab(2,{index:2}),tab(8,{index:3,url:'safari-web-extension://test/dashboard.html'}),tab(3,{index:4}),tab(4,{index:5}),tab(7,{index:6})];
 const h=harness(initial);const published=await h.send('live-groups-set',{windowId:1,expectedRevision:null,groups:[{id:groupA,name:'A',tabs:[{id:2,url:tab(2).url},{id:4,url:tab(4).url}]},{id:'ungrouped',name:'Ungrouped',tabs:[{id:1,url:tab(1).url},{id:3,url:tab(3).url},{id:7,url:tab(7).url,excluded:true}]}]});assert.equal(published.ok,true);
 const anchors=()=>{assert.equal(h.tabs.get(9).index,0);assert.equal(h.tabs.get(8).index,3);assert.equal(h.tabs.get(7).index,6);};
 h.onQuery=anchors;h.onMove=id=>assert(![9,8,7].includes(id));
 const preview=await h.send('cluster-preview',{windowId:1,expectedRevision:published.revision,requestId:webcrypto.randomUUID()});assert.equal(preview.protectedCount,3);assert.equal(preview.segments,2);
 const applied=await h.send('cluster-apply',{windowId:1,planId:preview.planId});assert.equal(applied.state,'complete');anchors();assert.deepEqual([...h.tabs.values()].sort((a,b)=>a.index-b.index).map(tab=>tab.id),[9,2,1,8,4,3,7]);
});
test('stale preview topology, group revisions and invalid IDs prevent all clustering moves',async()=>{
 for(const change of ['url','pending','pinned','new-tab','order','revision']) {
  const h=await clusterFixture();const preview=await h.preview();
  if(change==='url')h.tabs.get(1).url='https://example.org/navigated';if(change==='pending')h.tabs.get(1).pendingUrl='https://example.org/pending';if(change==='pinned')h.tabs.get(1).pinned=true;
  if(change==='new-tab')h.tabs.set(5,tab(5,{index:4}));if(change==='order'){h.tabs.get(1).index=1;h.tabs.get(2).index=0;}if(change==='revision')h.store[LIVE_KEY][1].revision=webcrypto.randomUUID();
  const applied=await h.send('cluster-apply',{windowId:1,planId:preview.planId});assert.equal(applied.ok,false,change);assert.equal(h.moveCalls||0,0,change);
 }
 const h=await clusterFixture();assert.equal((await h.preview({requestId:'bad'})).ok,false);
});
test('failed clustering journal write/readback prevents every movement',async()=>{
 for(const mode of ['failWrite','failReadback']) {
  const h=await clusterFixture();h[mode]=mode==='failWrite'?h.writes+1:true;const preview=await h.preview();assert.equal(preview.ok,false);assert.equal(h.moveCalls||0,0);
 }
 const h=await clusterFixture();const preview=await h.preview();h.failWrite=h.writes+1;const applied=await h.send('cluster-apply',{windowId:1,planId:preview.planId});assert.equal(applied.ok,false);assert.equal(h.moveCalls||0,0);
});
test('cluster replay and concurrent apply never repeat a tab permutation',async()=>{
 const h=await clusterFixture();const preview=await h.preview();const args={windowId:1,planId:preview.planId};const [first,second]=await Promise.all([h.send('cluster-apply',args),h.send('cluster-apply',args)]);
 assert.equal(first.state,'complete');assert.equal(second.repeated,true);assert.equal(h.moveCalls,preview.moveCount);assert.deepEqual(h.order(),[4,2,1,3]);
});
test('partial move failure keeps the journal and never resumes automatically, including after coordinator recreation',async()=>{
 const h=await clusterFixture();const preview=await h.preview();h.failMove=2;const first=await h.send('cluster-apply',{windowId:1,planId:preview.planId});assert.equal(first.state,'partial');assert.equal(first.moved,1);assert.equal(first.canUndo,false);
 const recovered=harness([...h.tabs.values()],h.store);const again=await recovered.send('cluster-apply',{windowId:1,planId:preview.planId});assert.equal(again.repeated,true);assert.equal(again.state,'partial');assert.equal(recovered.moveCalls||0,0);assert.equal(recovered.tabs.size,4);
 const status=await recovered.send('cluster-status',{windowId:1});assert.equal(status.operation.state,'partial');
});
test('clustering stops between moves when topology changes and leaves remaining tabs open',async()=>{
 const h=await clusterFixture();const preview=await h.preview();h.onWrite=()=>{if(h.moveCalls===1)h.tabs.get(3).pendingUrl='https://example.org/pending';};
 const applied=await h.send('cluster-apply',{windowId:1,planId:preview.planId});assert.equal(applied.state,'partial');assert.equal(h.moveCalls,1);assert.equal(h.tabs.size,4);
});
test('undo restores exact prior order once, and becomes unavailable after any order/identity/group change',async()=>{
 const h=await clusterFixture();const preview=await h.preview();await h.send('cluster-apply',{windowId:1,planId:preview.planId});
 const undo=await h.send('cluster-undo-preview',{windowId:1,planId:preview.planId,requestId:webcrypto.randomUUID()});assert.equal(undo.kind,'undo');assert.equal(undo.state,'ready');assert.equal(undo.canUndo,false);
 const result=await h.send('cluster-apply',{windowId:1,planId:undo.planId});assert.equal(result.state,'complete');assert.equal(result.canUndo,false);assert.deepEqual(h.order(),[1,2,3,4]);
 const changed=await clusterFixture();const second=await changed.preview();await changed.send('cluster-apply',{windowId:1,planId:second.planId});changed.tabs.get(1).url='https://example.org/changed';
 assert.equal((await changed.send('cluster-status',{windowId:1})).operation.canUndo,false);assert.equal((await changed.send('cluster-undo-preview',{windowId:1,planId:second.planId,requestId:webcrypto.randomUUID()})).ok,false);
});
test('private windows, untrusted page senders, newer previews and corrupt journals cannot cluster',async()=>{
 const h=await clusterFixture();const preview=await h.preview();h.private=true;assert.equal((await h.send('cluster-apply',{windowId:1,planId:preview.planId})).ok,false);h.private=false;
 assert.equal(h.listener({channel:'workspace',type:'cluster-apply',windowId:1,planId:preview.planId},{id:'test',url:'safari-web-extension://test/other.html'}),undefined);
 await h.preview();assert.equal((await h.send('cluster-apply',{windowId:1,planId:preview.planId})).ok,false);assert.equal(h.moveCalls||0,0);
 const corrupt=await clusterFixture();const plan=await corrupt.preview();corrupt.store[CLUSTER_KEY][1].plans[0].target.reverse();assert.equal((await corrupt.send('cluster-apply',{windowId:1,planId:plan.planId})).ok,false);assert.equal(corrupt.moveCalls||0,0);
});

test('private/non-normal cluster previews and replayed journals expose no operation data',async()=>{
 const h=await clusterFixture();const requestId=webcrypto.randomUUID(),preview=await h.preview({requestId});await h.send('cluster-apply',{windowId:1,planId:preview.planId});
 for(const mode of ['private','non-normal']) {
  h.private=mode==='private';h.windowType=mode==='non-normal'?'popup':'normal';
  for(const [type,values] of [['cluster-preview',{expectedRevision:h.store[LIVE_KEY][1].revision,requestId}],['cluster-apply',{planId:preview.planId}],['cluster-undo-preview',{planId:preview.planId,requestId}],['cluster-status',{}]]) {
   const result=await h.send(type,{windowId:1,...values});assert.equal(result.ok,false);assert.equal(result.groups,undefined);assert.equal(result.operation,undefined);
  }
 }
});
test('tab index or URL changes during the immediate pre-move read stop clustering before movement',async()=>{
 for(const change of ['index','url']) {
  const h=await clusterFixture();const preview=await h.preview();
  h.onGet=id=>{if(id===4){if(change==='index')h.tabs.get(id).index=1;else h.tabs.get(id).url='https://example.org/new';}};
  const result=await h.send('cluster-apply',{windowId:1,planId:preview.planId});assert.equal(result.state,'partial');assert.equal(h.moveCalls||0,0);
 }
});

 test('native download receives validated portable JSON and reports write failures without touching tabs',async()=>{
 const h=harness();const saved=await h.send('snapshot-window',{windowId:1,name:'Backup',requestId:webcrypto.randomUUID()});
 assert.equal(saved.ok,true);
 const result=await h.send('download-backup',{id:saved.workspace.id});assert.equal(result.filename,'tabby-test.json');
 assert.equal(h.native.host,'com.local.safaridevlab');assert.equal(JSON.parse(h.native.message.json).format,'safari-workspaces-backup');
 h.nativeResult={ok:false};assert.equal((await h.send('download-backup',{id:saved.workspace.id})).ok,false);assert.equal(h.tabs.size,2);
 });


test('snapshot removal is readback-verified, recoverable and preserves the saved record',async()=>{
 const h=harness();const saved=await h.send('snapshot-window',{windowId:1,name:'Keep data',requestId:webcrypto.randomUUID()});const id=saved.workspace.id;
 const before=clone(h.store['workspaces.v1'][id].tabs);
 assert.equal((await h.send('snapshot-trash',{id})).trashed,true);
 assert.equal((await h.send('list')).workspaces.length,0);assert.deepEqual(h.store['workspaces.v1'][id].tabs,before);
 assert.equal((await h.send('snapshot-trash',{id})).ok,true);
 assert.equal((await h.send('snapshot-undo-delete',{id})).trashed,false);
 assert.equal((await h.send('list')).workspaces[0].id,id);assert.equal(h.tabs.size,2);
});
test('snapshot removal rejects active operations and failed durable writes',async()=>{
 for(const state of ['closing','restoring']){
  const h=harness();const saved=await h.send('snapshot-window',{windowId:1,name:'Busy',requestId:webcrypto.randomUUID()});const id=saved.workspace.id;
  h.store['workspaces.v1'][id][state==='closing'?'close':'restore'].state=state;
  const result=await h.send('snapshot-trash',{id});assert.equal(result.ok,false);assert.equal(h.store['workspaces.v1'][id].trashedAt,undefined);
 }
 const h=harness();const saved=await h.send('snapshot-window',{windowId:1,name:'Failed write',requestId:webcrypto.randomUUID()});const id=saved.workspace.id;
 h.failWrite=h.writes+1;assert.equal((await h.send('snapshot-trash',{id})).ok,false);assert.equal((await h.send('list')).workspaces.length,1);
 h.failWrite=0;h.failReadback=true;assert.equal((await h.send('snapshot-trash',{id})).ok,false);assert.equal((await h.send('list')).workspaces.length,1);
 assert.equal((await h.send('snapshot-trash',{id:'invalid'})).ok,false);
});


test('saved-tab opening uses stored URL and suppresses concurrent, replayed and restart duplicate requests',async()=>{
 const h=harness();const snapshot=(await h.send('snapshot-window',{windowId:1,name:'Open one',requestId:webcrypto.randomUUID()})).workspace;
 const request={id:snapshot.id,tabId:snapshot.tabs[0].id,windowId:1,requestId:webcrypto.randomUUID(),url:'https://forged.test'};
 const [first,second]=await Promise.all([h.send('snapshot-open-tab',request),h.send('snapshot-open-tab',request)]);
 assert.equal(first.ok,true);assert.equal(second.repeated,true);assert.equal(h.tabs.size,3);assert.equal(h.tabs.get(first.tabId).url,snapshot.tabs[0].url);assert.equal(h.tabs.get(first.tabId).active,true);
 const restarted=harness([...h.tabs.values()],h.store);assert.equal((await restarted.send('snapshot-open-tab',request)).repeated,true);assert.equal(restarted.tabs.size,3);
 assert.equal((await h.send('snapshot-open-tab',{...request,tabId:snapshot.tabs[1].id})).ok,false);
 assert.deepEqual(h.store['workspaces.v1'][snapshot.id],clone(snapshot));
});
test('saved-tab opening rejects invalid IDs/private targets and does not retry an uncertain or failed attempt',async()=>{
 const h=harness();const snapshot=(await h.send('snapshot-window',{windowId:1,name:'Safety',requestId:webcrypto.randomUUID()})).workspace;
 const request={id:snapshot.id,tabId:snapshot.tabs[0].id,windowId:1,requestId:webcrypto.randomUUID()};
 assert.equal((await h.send('snapshot-open-tab',{...request,tabId:webcrypto.randomUUID()})).ok,false);
 h.private=true;assert.equal((await h.send('snapshot-open-tab',request)).ok,false);h.private=false;
 h.failWrite=h.writes+1;assert.equal((await h.send('snapshot-open-tab',request)).ok,false);assert.equal(h.tabs.size,2);h.failWrite=0;
 h.failCreate.add(snapshot.tabs[0].url);assert.equal((await h.send('snapshot-open-tab',request)).ok,false);h.failCreate.clear();
 assert.equal((await h.send('snapshot-open-tab',request)).ok,false);assert.equal(h.tabs.size,2);
});

test('whole-window snapshots preserve named groups order exclusions and duplicate URL identities through backup and restore',async()=>{
 const same='https://example.com/duplicate';
 const h=harness([tab(1,{url:same}),tab(2),tab(3,{url:same}),tab(4,{pinned:true})]);
 const groupId=webcrypto.randomUUID();
 assert.equal((await h.send('live-groups-set',{windowId:1,expectedRevision:null,groups:[{id:groupId,name:'Research',reason:'Manual task',tabs:[{id:3,url:same,excluded:true},{id:1,url:same}]},{id:'ungrouped',name:'Ungrouped',tabs:[{id:2,url:'https://example.com/2'}]}]})).ok,true);
 const saved=await h.send('snapshot-window',{windowId:1,name:'Grouped window',requestId:webcrypto.randomUUID()});assert(saved.ok);
 const record=saved.workspace;assert.deepEqual(Array.from(record.tabs,t=>t.url),[same,same,'https://example.com/2','https://example.com/4']);
 assert.equal(record.groups[0].name,'Research');assert.equal(record.groups[0].excludedTabIds[0],record.tabs[0].id);
 const json=h.C.encodeBackup([record]);const portable=JSON.parse(json);assert.deepEqual(portable.workspaces[0].groups[0].tabIndexes,[0,1]);assert(!json.includes(groupId));
 const imported=await h.send('import-backup',{json});assert(imported.ok);const copy=imported.workspaces[0];assert.notEqual(copy.tabs[0].id,record.tabs[0].id);assert.equal(copy.groups[0].tabIds[0],copy.tabs[0].id);
 const restored=await h.send('restore',{id:copy.id,windowId:2});assert(restored.ok);assert.equal(restored.workspace.restore.state,'complete');
 const live=await h.send('live-groups-get',{windowId:2});assert(live.ok);assert.equal(live.groups[0].name,'Research');assert.deepEqual(Array.from(live.groups[0].tabs,t=>t.excluded),[true,false]);assert.equal(live.groups[0].tabs.length,2);assert.notEqual(live.groups[0].tabs[0].id,live.groups[0].tabs[1].id);
 const created=h.events.filter(e=>e.startsWith('create:')).length;
 await h.send('restore',{id:copy.id,windowId:2});assert.equal(h.events.filter(e=>e.startsWith('create:')).length,created);
 assert.equal((await h.send('live-groups-get',{windowId:2})).groups.filter(g=>g.name==='Research').length,1);
});

test('snapshot backup rejects malformed group references before writing and legacy backups still restore',async()=>{
 const h=harness();const saved=(await h.save()).workspace;const backup=JSON.parse(h.C.encodeBackup([saved]));
 backup.workspaces[0].groups=[{name:'Bad',tabIndexes:[0,0]}];const before=h.writes;
 assert.equal((await h.send('import-backup',{json:JSON.stringify(backup)})).ok,false);assert.equal(h.writes,before);
 backup.workspaces[0].groups=[{name:'Bad',tabIndexes:[99]}];assert.equal((await h.send('import-backup',{json:JSON.stringify(backup)})).ok,false);
 delete backup.workspaces[0].groups;const legacy=await h.send('import-backup',{json:JSON.stringify(backup)});assert(legacy.ok);assert.equal(legacy.workspaces[0].groups,undefined);
});

test('partial grouped restores rebuild once and preserve later manual organisation on retry',async()=>{
 const h=harness();const id=webcrypto.randomUUID();
 await h.send('live-groups-set',{windowId:1,expectedRevision:null,groups:[{id,name:'Task',tabs:[{id:1,url:'https://example.com/1'},{id:2,url:'https://example.com/2'}]}]});
 const record=(await h.send('snapshot-window',{windowId:1,name:'Task window',requestId:webcrypto.randomUUID()})).workspace;
 h.failCreate.add('https://example.com/2');const partial=await h.send('restore',{id:record.id,windowId:2});assert(partial.ok);assert.equal(partial.workspace.restore.state,'partial');
 let live=await h.send('live-groups-get',{windowId:2});assert.equal(live.groups[0].tabs.length,1);
 const manualId=webcrypto.randomUUID();await h.send('live-groups-set',{windowId:2,expectedRevision:live.revision,groups:live.groups.map(g=>({...g,id:g.id==='ungrouped'?g.id:manualId,name:'My edit'}))});
 h.failCreate.clear();const retried=await h.send('restore',{id:record.id,windowId:2});assert(retried.ok);assert.equal(retried.workspace.restore.organization.state,'skipped');
 live=await h.send('live-groups-get',{windowId:2});assert.equal(live.groups[0].name,'My edit');assert.equal(live.groups.filter(g=>g.name==='Task').length,0);
});

test('completed restore resumes interrupted group publication without reopening tabs',async()=>{
 const h=harness();await h.send('live-groups-set',{windowId:1,expectedRevision:null,groups:[{id:webcrypto.randomUUID(),name:'Recovered task',tabs:[{id:1,url:'https://example.com/1'}]}]});
 const record=(await h.send('snapshot-window',{windowId:1,name:'Window',requestId:webcrypto.randomUUID()})).workspace;
 let fail=true;h.onWrite=values=>{if(values['workspaces.live.v1']?.[2] && fail){fail=false;throw Error('Interrupted group publication');}};
 const stopped=await h.send('restore',{id:record.id,windowId:2});assert.equal(stopped.ok,false);
 assert.equal(h.store['workspaces.v1'][record.id].restore.state,'complete');const creates=h.events.filter(e=>e.startsWith('create:')).length;
 let live=await h.send('live-groups-get',{windowId:2});assert(live.ok);assert.equal(h.events.filter(e=>e.startsWith('create:')).length,creates);assert.equal(live.groups[0].name,'Recovered task');
 const resumed=await h.send('restore',{id:record.id,windowId:2});assert(resumed.ok);assert.equal(h.events.filter(e=>e.startsWith('create:')).length,creates);
 const revision=live.revision;await h.send('restore',{id:record.id,windowId:2});live=await h.send('live-groups-get',{windowId:2});assert.equal(live.revision,revision);
 await h.send('live-groups-set',{windowId:2,expectedRevision:revision,groups:live.groups.map(g=>({...g,name:'My later change'}))});
 await h.send('restore',{id:record.id,windowId:2});assert.equal((await h.send('live-groups-get',{windowId:2})).groups[0].name,'My later change');
});

test('pending restored navigation regains saved groups before explicit scan reconciliation',async()=>{
 const h=harness();await h.send('live-groups-set',{windowId:1,expectedRevision:null,groups:[{id:webcrypto.randomUUID(),name:'Pending task',tabs:[{id:1,url:'https://example.com/1'},{id:2,url:'https://example.com/2'}]}]});
 const record=(await h.send('snapshot-window',{windowId:1,name:'Window',requestId:webcrypto.randomUUID()})).workspace;
 h.onQuery=()=>{for(const tab of h.tabs.values())if(tab.windowId===2)tab.pendingUrl=tab.url;};
 const restored=await h.send('restore',{id:record.id,windowId:2});assert(restored.ok);assert.equal(restored.workspace.restore.organization.state,'waiting');
 h.onQuery=null;for(const tab of h.tabs.values())if(tab.windowId===2)delete tab.pendingUrl;
 const synced=await h.send('live-groups-sync-scan',{windowId:2});assert(synced.ok);assert.equal(synced.groups[0].name,'Pending task');assert.equal(synced.groups[0].tabs.length,2);
 assert.equal(h.store['workspaces.v1'][record.id].restore.organization.state,'applied');
});


test('snapshot capture accepts the full100 named-group bound without inventing an empty Ungrouped bucket',async()=>{
 const h=harness([tab(1)]);
 const groups=Array.from({length:100},(_,index)=>({id:webcrypto.randomUUID(),name:`Group ${index+1}`,tabs:index===0?[{id:1,url:'https://example.com/1'}]:[]}));
 assert((await h.send('live-groups-set',{windowId:1,expectedRevision:null,groups})).ok);
 const result=await h.send('snapshot-window',{windowId:1,name:'Full group roster',requestId:webcrypto.randomUUID()});assert(result.ok);assert.equal(result.workspace.groups.length,100);assert(!result.workspace.groups.some(group=>group.ungrouped));
});

// Real coordinator with fictional tabs and fake AI client. No Safari/Meta calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const core=readFileSync(new URL('../extension/core.js',import.meta.url),'utf8');
const background=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
const clone=value=>structuredClone(value);
const token='a'.repeat(64),otherToken='b'.repeat(64);
const tab=(id,extra={})=>({id,index:id-1,windowId:1,title:`Page ${id}`,url:`https://example.test/path/${id}?secret=value#fragment`,pinned:false,incognito:false,...extra});
const usage=()=>({enabled:true,configured:true,busy:false,attemptsToday:0,remainingToday:20,remainingThisMinute:2,perMinute:2,perDay:20,requestsPerSuggestion:2,dailyResetAt:Date.now()+86400000,retryAt:null,timezone:'UTC'});
function harness(options={}) {
 const h={store:clone(options.store||{}),sessionStore:clone(options.sessionStore||{}),tabs:options.tabs||[tab(1),tab(2),tab(3,{pinned:true})],statusCalls:0,modelCalls:0,writes:0,...options};
 const local={get:async key=>({[key]:clone(h.store[key])}),set:async values=>{h.writes++;if(h.failWrite===h.writes)throw Error('Storage unavailable');Object.assign(h.store,clone(values));}};
 const session={get:async key=>({[key]:clone(h.sessionStore[key])}),set:async values=>{h.writes++;if(h.failWrite===h.writes)throw Error('Storage unavailable');Object.assign(h.sessionStore,clone(values));}};
 const browser={runtime:{id:'test',getURL:path=>`safari-web-extension://test/${path}`,onMessage:{addListener:fn=>h.listener=fn},onStartup:{addListener:fn=>h.startup=fn}},
  windows:{get:async id=>({id,type:'normal',incognito:Boolean(h.private)})},storage:{local,...(options.session?{session}:{})},
  tabs:{query:async({windowId})=>clone(h.tabs.filter(tab=>tab.windowId===windowId)),get:async id=>clone(h.tabs.find(tab=>tab.id===id))}};
 const WorkspaceAI={status:async request=>{h.statusCalls++;h.statusRequest=request;if(h.statusError)throw h.statusError;return {ok:true,usage:usage()};},suggest:async request=>{h.modelCalls++;h.modelRequest=clone(request);if(h.deferred)return await h.deferred;if(h.modelError)throw h.modelError;return {ok:true,result:h.result||{groups:[{name:'Research',reason:'One task',tabIds:['1','2']}]},usage:{...usage(),attemptsToday:2,remainingToday:18,remainingThisMinute:0}};}};
 const context=vm.createContext({browser,WorkspaceAI,crypto:webcrypto,URL,TextEncoder,console});vm.runInContext(core,context);vm.runInContext(background,context);
 h.send=(type,args={})=>h.listener({channel:'workspace',type,windowId:1,...args},{id:'test',url:'safari-web-extension://test/popup.html'});
 h.begin=async()=>{const state=await h.send('popup-ai-state');await h.send('popup-ai-connect',{token,rememberSession:Boolean(h.remember)});return state;};
 h.suggest=(state,extra={})=>h.send('popup-ai-suggest',{requestId:webcrypto.randomUUID(),expectedRevision:state.revision,inventoryToken:state.inventoryToken,tabIds:[1,2],consent:true,token,...extra});
 return h;
}
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
test('popup state reads locally, filters protected tabs and sanitizes exact metadata without model calls',async()=>{
 const h=harness();const state=await h.send('popup-ai-state');assert.equal(state.ok,true);assert.deepEqual(Array.from(state.tabs,t=>t.id),[1,2]);assert.equal(state.input[0].url,'https://example.test/path/1');assert.equal(h.statusCalls,0);assert.equal(h.modelCalls,0);assert.equal(state.connected,false);
 await h.send('popup-ai-connect',{token,rememberSession:false});assert.equal(h.statusCalls,1);assert.equal(h.modelCalls,0);assert.equal(JSON.stringify(h.store).includes(token),false);
 await h.send('popup-ai-state');assert.equal(h.statusCalls,1);assert.equal(h.modelCalls,0);
});
test('pairing remembers only explicit session choice and forget never writes a token locally',async()=>{
 const noSession=harness();let result=await noSession.send('popup-ai-connect',{token,rememberSession:true});assert.equal(result.ok,false);assert.equal(noSession.statusCalls,0);
 const h=harness({session:true});await h.begin();result=await h.send('popup-ai-connect',{token,rememberSession:true});assert.equal(result.remembered,true);assert.equal(JSON.stringify(result).includes(token),false);assert.equal(JSON.stringify(h.store).includes(token),false);
 const state=await h.send('popup-ai-state');assert.equal(state.remembered,true);const suggestion=await h.suggest(state,{token:undefined});assert.equal(suggestion.state,'review');assert.equal(h.modelRequest.token,token);
 await h.send('popup-ai-forget');assert.equal((await h.send('popup-ai-state')).remembered,false);assert.equal(JSON.stringify(h.sessionStore).includes(token),false);
});
test('consent, selected IDs, inventory binding and changed metadata reject before any model call',async()=>{
 const h=harness();const state=await h.begin();
 for(const extra of [{consent:false},{tabIds:[1,1]},{tabIds:[999]},{inventoryToken:webcrypto.randomUUID()},{token:otherToken,expectedRevision:webcrypto.randomUUID()}]){const result=await h.suggest(state,extra);assert.equal(result.ok,false);}
 h.tabs[0].title='Changed after preview';assert.equal((await h.suggest(state)).ok,false);h.tabs[0]=tab(1,{pendingUrl:'https://example.test/new'});assert.equal((await h.suggest(state)).ok,false);h.tabs[0]=tab(1,{url:'https://example.test/changed'});assert.equal((await h.suggest(state)).ok,false);assert.equal(h.modelCalls,0);
});
test('suggestions stay staged, repeated request IDs cannot trigger another inference and reviews survive popup recreation',async()=>{
 const h=harness();const state=await h.begin(),requestId=webcrypto.randomUUID();const result=await h.suggest(state,{requestId});assert.equal(result.ok,true);assert.equal(result.state,'review');assert.equal(result.proposal.groups[0].name,'Research');assert.equal(h.store['workspaces.live.v1'],undefined);
 const again=await h.suggest(state,{requestId});assert.equal(again.repeated,true);assert.equal(h.modelCalls,1);
 const reopened=harness({store:h.store});const read=await reopened.send('popup-ai-state');assert.equal(read.state,'review');assert.equal(read.proposal.groups[0].name,'Research');assert.equal(reopened.modelCalls,0);assert.equal(reopened.statusCalls,0);
});
test('inflight AI does not block local state reads, and concurrent requests cannot start another inference',async()=>{
 let resolve;const h=harness({deferred:new Promise(r=>resolve=r)});const state=await h.begin();const pending=h.suggest(state);await settle();
 const local=await h.send('popup-ai-state');assert.equal(local.state,'requesting');assert.equal(h.modelCalls,1);assert.equal((await h.suggest(state)).ok,false);
 resolve({ok:true,result:{groups:[{name:'Task',reason:'Fake',tabIds:['1']}]},usage:usage()});assert.equal((await pending).state,'review');assert.equal(h.modelCalls,1);
});
test('an interrupted coordinator never automatically resumes inference or replays the admitted request',async()=>{
 const first=harness();const state=await first.begin();const requestId=webcrypto.randomUUID();
 const record=first.store['workspaces.popup-ai.v1'][1];record.state='requesting';record.requestId=requestId;record.selectedIds=[1,2];record.usedIds=[requestId];
 const restarted=harness({store:first.store});const local=await restarted.send('popup-ai-state');assert.equal(local.state,'error');assert.match(local.error,/interrupted/);
 const replay=await restarted.suggest(state,{requestId});assert.equal(replay.repeated,true);assert.equal(restarted.modelCalls,0);
});
test('unknown/duplicated model IDs and failed provider calls preserve groups and never retry',async()=>{
 for(const options of [{result:{groups:[{name:'Bad',tabIds:['999']}]}},{result:{groups:[{name:'Bad',tabIds:['1','1']}]}},{modelError:new Error('Fake timeout')}]) {
  const h=harness(options);const state=await h.begin();const result=await h.suggest(state);assert.equal(result.state,'error');assert.equal(h.modelCalls,1);assert.equal(h.store['workspaces.live.v1'],undefined);await h.send('popup-ai-state');assert.equal(h.modelCalls,1);
 }
});
test('explicit edited acceptance preserves excluded manual tabs and rejects forged assignments',async()=>{
 const h=harness({tabs:[tab(1),tab(2),tab(3)]});const manualId=webcrypto.randomUUID();const live=await h.send('live-groups-set',{expectedRevision:null,groups:[{id:manualId,name:'Manual',tabs:[{id:1,url:tab(1).url},{id:2,url:tab(2).url},{id:3,url:tab(3).url,excluded:true}]}]});
 const state=await h.begin();assert.equal(state.tabs.find(tab=>tab.id===3).included,false);const proposal=await h.suggest(state);
 assert.equal((await h.send('popup-ai-accept',{requestId:proposal.requestId,expectedRevision:live.revision,groups:[{name:'Forged',tabIds:['3']}]})).ok,false);
 const accepted=await h.send('popup-ai-accept',{requestId:proposal.requestId,expectedRevision:live.revision,groups:[{name:'Edited',reason:'Reviewed',tabIds:['1']}]});assert.equal(accepted.state,'accepted');
 const groups=(await h.send('live-groups-get')).groups;assert.equal(groups.find(group=>group.id===manualId).tabs[0].id,3);assert.equal(groups.find(group=>group.id===manualId).tabs[0].excluded,true);assert.equal(groups.find(group=>group.name==='Edited').tabs[0].id,1);assert.equal(groups.find(group=>group.id==='ungrouped').tabs[0].id,2);
 const replay=await h.send('popup-ai-accept',{requestId:proposal.requestId,expectedRevision:live.revision,groups:[]});assert.equal(replay.repeated,true);assert.equal(h.modelCalls,1);
});
test('manual edits or navigation after a response block stale acceptance without replacing groups',async()=>{
 const h=harness();const state=await h.begin(),proposal=await h.suggest(state);await h.send('live-groups-set',{expectedRevision:null,groups:[{id:'ungrouped',name:'Manual edit',tabs:[{id:1,url:tab(1).url}]}]});
 const stale=await h.send('popup-ai-state');assert.equal(stale.stale,true);assert.equal((await h.send('popup-ai-accept',{requestId:proposal.requestId,expectedRevision:null,groups:proposal.proposal.groups})).ok,false);assert.equal((await h.send('live-groups-get')).groups[0].name,'Manual edit');
 const nav=harness();const input=await nav.begin(),result=await nav.suggest(input);nav.tabs[0].url='https://example.test/new';assert.equal((await nav.send('popup-ai-accept',{requestId:result.requestId,expectedRevision:null,groups:result.proposal.groups})).ok,false);assert.equal(nav.store['workspaces.live.v1'],undefined);
});
test('failed admission storage writes prevent a model call; private and unrelated senders cannot use popup AI',async()=>{
 const h=harness();const state=await h.begin();h.failWrite=h.writes+1;assert.equal((await h.suggest(state)).ok,false);assert.equal(h.modelCalls,0);
 h.private=true;for(const type of ['popup-ai-state','popup-ai-connect','popup-ai-suggest','popup-ai-discard','popup-ai-accept','popup-ai-forget'])assert.equal((await h.send(type,{token})).ok,false);
 for(const url of ['https://example.test/popup.html','safari-web-extension://test/other.html'])assert.equal(h.listener({channel:'workspace',type:'popup-ai-state',windowId:1},{id:'test',url}),undefined);
});

test('explicit status refresh reuses only page-supplied or remembered pairing and never infers',async()=>{
 const h=harness();await h.begin();let refreshed=await h.send('popup-ai-refresh',{token});assert.equal(refreshed.connected,true);assert.equal(h.statusCalls,2);assert.equal(h.modelCalls,0);
 refreshed=await h.send('popup-ai-refresh');assert.equal(refreshed.ok,false);assert.equal(h.statusCalls,2);
 const remembered=harness({session:true});await remembered.send('popup-ai-state');await remembered.send('popup-ai-connect',{token,rememberSession:true});
 refreshed=await remembered.send('popup-ai-refresh');assert.equal(refreshed.connected,true);assert.equal(refreshed.remembered,true);assert.equal(remembered.statusCalls,2);assert.equal(remembered.modelCalls,0);assert.equal(JSON.stringify(refreshed).includes(token),false);
 remembered.statusError=new Error('Fake service offline');assert.equal((await remembered.send('popup-ai-refresh')).ok,false);assert.equal((await remembered.send('popup-ai-state')).connected,false);
});

 test('popup auto-apply publishes validated suggestions without a review click',async()=> {
 const h=harness();const state=await h.begin();const result=await h.suggest(state,{autoApply:true});
 assert.equal(result.state,'accepted');assert.equal(h.modelCalls,1);
 const live=await h.send('live-groups-get');assert(live.groups.some(group=>group.tabs.length));
 });


test('explicit scan seeds eligible ungrouped tabs, preserves manual groups, and revises only for new membership',async()=>{
 const h=harness({tabs:[tab(1),tab(2),tab(3,{pinned:true}),tab(4,{incognito:true}),tab(5,{url:'safari://settings'}),tab(6,{pendingUrl:'https://example.test/next'}),tab(7,{url:'safari-web-extension://test/dashboard.html'})]});
 assert.equal((await h.send('live-groups-get')).revision,null);
 let live=await h.send('live-groups-sync-scan');assert.equal(live.ok,true);assert.deepEqual(Array.from(live.groups[0].tabs,t=>t.id),[1,2]);
 const initial=live.revision;assert.equal((await h.send('live-groups-sync-scan')).revision,initial);
 const id=webcrypto.randomUUID();live=await h.send('live-groups-set',{expectedRevision:initial,groups:[{id,name:'Manual',tabs:[{id:2,url:tab(2).url,excluded:true},{id:1,url:tab(1).url,excluded:false}]}]});
 const manualRevision=live.revision;h.tabs.push(tab(8));
 live=await h.send('live-groups-sync-scan');assert.notEqual(live.revision,manualRevision);assert.deepEqual(Array.from(live.groups[0].tabs,t=>t.id),[2,1]);assert.equal(live.groups[0].tabs[0].excluded,true);assert.deepEqual(Array.from(live.groups.find(g=>g.id==='ungrouped').tabs,t=>t.id),[8]);
 assert.equal((await h.send('live-groups-set',{expectedRevision:manualRevision,groups:[]})).ok,false);
 h.tabs[0].url='https://example.test/changed';live=await h.send('live-groups-sync-scan');assert.deepEqual(Array.from(live.groups[0].tabs,t=>t.id),[2]);assert.deepEqual(Array.from(live.groups.find(g=>g.id==='ungrouped').tabs,t=>t.id),[8,1]);
 assert.equal(h.modelCalls,0);
});

test('scan membership sync rejects private windows, untrusted pages and failed writes',async()=>{
 const privateWindow=harness({private:true});assert.equal((await privateWindow.send('live-groups-sync-scan')).ok,false);
 const h=harness();const untrusted=h.listener({channel:'workspace',type:'live-groups-sync-scan',windowId:1},{id:'test',url:'safari-web-extension://test/other.html'});assert.equal(untrusted,undefined);
 h.failWrite=1;assert.equal((await h.send('live-groups-sync-scan')).ok,false);assert.equal((await h.send('live-groups-get')).revision,null);assert.equal(h.modelCalls,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {UsageGuard} from '../server/usage-guard.mjs';
import {createAIService, readConfig} from '../server/ai-service.mjs';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(),'safari-ai-test-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const statePath=join(dir,'usage.json');
  let time=Date.parse('2026-10-28T12:00:00Z');
  return {statePath, dir, now:()=>time, advance:ms=>{time+=ms;}, guard:()=>new UsageGuard({statePath,now:()=>time,...options})};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const hasCode=code=>error=>error.code===code;
const fakeEnv={AI_LIVE_ENABLED:'true',META_API_PROVIDER_ID:'test-only',META_API_MODEL:'fake-model',META_API_KEY:'TEST-ONLY-DO-NOT-USE'};
const tabs=[{id:1,title:'Documentation',url:'https://user:secret@example.com/docs?q=secret#fragment'}];
// All adapters in this file are local fake functions. No network library or live key is used.
const fakeProvider=overrides=>({id:'test-only',countInputTokens:()=>100,generate:async()=>({groups:[{name:'Research',reason:'Related documentation',tabIds:['1']}]}),...overrides});

 test('defaults match human-selected limits and live access is disabled',()=>{
  const config=readConfig({}); assert.equal(config.enabled,false); assert.equal(config.perMinute,2); assert.equal(config.perDay,20);
  for(const value of ['0','-1','1.5','invalid','Infinity']) assert.throws(()=>readConfig({AI_REQUESTS_PER_DAY:value}),hasCode('invalid_config'));
});
test('two attempts per rolling minute with exact cooldown and no third provider call',async t=>{
  const f=await fixture(t); const guard=f.guard(); let calls=0;
  await guard.run(async()=>++calls); f.advance(20000); await guard.run(async()=>++calls);
  await assert.rejects(guard.run(async()=>++calls),hasCode('minute_limit')); assert.equal(calls,2);
  const status=await guard.status(); assert.equal(status.remainingThisMinute,0); assert.equal(status.retryAt,f.now()+40000);
  f.advance(40000); await guard.run(async()=>++calls); assert.equal(calls,3);
});
test('reservation is durably on disk before the provider starts',async t=>{
  const f=await fixture(t); await f.guard().run(async()=>{
    const state=JSON.parse(await readFile(f.statePath,'utf8'));assert.equal(state.daily,1);assert.equal(state.attempts.length,1);
  });
});
test('concurrent requests on one guard fail immediately instead of queueing',async t=>{
  const f=await fixture(t);const guard=f.guard(), hold=deferred();const pending=guard.run(()=>hold.promise);
  await assert.rejects(guard.run(async()=>{}),hasCode('concurrency_limit'));
  // Wait until the first operation is actually admitted before releasing it.
  await new Promise(resolve=>setTimeout(resolve,10));hold.resolve('done');assert.equal(await pending,'done');
});
test('separate guard instances share an exclusive on-disk lock',async t=>{
  const f=await fixture(t),entered=deferred(),hold=deferred();
  const pending=f.guard().run(()=>{entered.resolve();return hold.promise;});await entered.promise;
  const other=f.guard();await assert.rejects(other.run(async()=>{}),hasCode('concurrency_limit'));
  assert.equal((await other.status()).busy,true);hold.resolve();await pending;
  await other.run(async()=>{});assert.equal((await other.status()).attemptsToday,2);
});
test('provider errors count and are never retried',async t=>{
  const f=await fixture(t); let calls=0;
  await assert.rejects(f.guard().run(async()=>{calls++;throw new Error('test');}));
  assert.equal(calls,1);assert.equal((await f.guard().status()).attemptsToday,1);
});
test('timeout counts and holds concurrency until an abort-ignoring adapter settles',async t=>{
  const f=await fixture(t,{timeoutMs:10}),hold=deferred();const guard=f.guard();let signal;
  await assert.rejects(guard.run(s=>{signal=s;return hold.promise;}),hasCode('timeout'));
  assert.equal(signal.aborted,true);assert.equal((await guard.status()).attemptsToday,1);
  await assert.rejects(f.guard().run(async()=>{}),hasCode('concurrency_limit'));
  hold.resolve();await new Promise(resolve=>setTimeout(resolve,10));
  await f.guard().run(async()=>{});assert.equal((await guard.status()).attemptsToday,2);
});
test('daily attempts survive instance restart and failures; reset uses UTC midnight',async t=>{
  const f=await fixture(t);let calls=0;
  for(let i=0;i<20;i++){await f.guard().run(async()=>++calls);f.advance(60000);}
  const restarted=f.guard();await assert.rejects(restarted.run(async()=>++calls),hasCode('daily_limit'));assert.equal(calls,20);
  assert.equal((await restarted.status()).dailyResetAt,Date.parse('2026-10-29T00:00:00Z'));
  f.advance(Date.parse('2026-10-29T00:00:00Z')-f.now());await restarted.run(async()=>++calls);
  assert.equal((await restarted.status()).attemptsToday,1);assert.equal(calls,21);
});
test('rolling minute remains enforced across UTC midnight',async t=>{
  const f=await fixture(t);f.advance(Date.parse('2026-10-28T23:59:40Z')-f.now());
  await f.guard().run(async()=>{});f.advance(5000);await f.guard().run(async()=>{});f.advance(16000);
  await assert.rejects(f.guard().run(async()=>{}),hasCode('minute_limit'));
  assert.equal((await f.guard().status()).attemptsToday,0);
});
test('corrupt state and an orphan lock fail closed',async t=>{
  const f=await fixture(t);await writeFile(f.statePath,'not json');let called=false;
  await assert.rejects(f.guard().run(async()=>{called=true;}),hasCode('state_error'));assert.equal(called,false);
  await rm(f.statePath);await writeFile(`${f.statePath}.lock`,'');
  await assert.rejects(f.guard().run(async()=>{called=true;}),hasCode('concurrency_limit'));assert.equal(called,false);
});
test('unwritable reservation path prevents provider calls',async t=>{
  const f=await fixture(t);await mkdir(f.statePath);let called=false;
  await assert.rejects(f.guard().run(async()=>{called=true;}),hasCode('state_error'));assert.equal(called,false);
});
test('clock rollback does not reset the daily budget',async t=>{
  const f=await fixture(t);await f.guard().run(async()=>{});f.advance(-1);
  await assert.rejects(f.guard().run(async()=>{}),hasCode('clock_error'));
});
test('disabled, incomplete, or wrong-provider configuration causes no call or reservation',async t=>{
  const f=await fixture(t);let calls=0;
  for(const env of [{},{...fakeEnv,AI_LIVE_ENABLED:'false'},{...fakeEnv,META_API_KEY:''},{...fakeEnv,META_API_MODEL:''},{...fakeEnv,META_API_PROVIDER_ID:'other'}]){
    const service=createAIService({env,provider:fakeProvider({generate:async()=>++calls}),statePath:f.statePath,now:f.now});
    await assert.rejects(service.suggest(tabs,{consent:true}),hasCode('not_configured'));
    assert.equal((await service.status()).configured,false);
  }
  assert.equal(calls,0);await assert.rejects(readFile(f.statePath),{code:'ENOENT'});
});
test('consent, byte/token limits and invalid inventories reject before consuming budget',async t=>{
  const f=await fixture(t);let calls=0;
  const make=(env=fakeEnv,provider=fakeProvider({generate:async()=>++calls}))=>createAIService({env,provider,statePath:f.statePath,now:f.now});
  await assert.rejects(make().suggest(tabs),hasCode('consent_required'));
  await assert.rejects(make({...fakeEnv,AI_MAX_INPUT_BYTES:'1'}).suggest(tabs,{consent:true}),hasCode('input_limit'));
  await assert.rejects(make(fakeEnv,fakeProvider({countInputTokens:()=>4097})).suggest(tabs,{consent:true}),hasCode('input_limit'));
  await assert.rejects(make().suggest([{...tabs[0],incognito:true}],{consent:true}),hasCode('invalid_input'));
  await assert.rejects(make().suggest([tabs[0],tabs[0]],{consent:true}),hasCode('invalid_input'));
  assert.equal(calls,0);await assert.rejects(readFile(f.statePath),{code:'ENOENT'});
});
test('service sanitizes URLs, forwards output cap and signal, validates returned IDs',async t=>{
  const f=await fixture(t);let captured;
  const service=createAIService({env:fakeEnv,statePath:f.statePath,now:f.now,provider:fakeProvider({generate:async options=>{captured=options;return {groups:[{name:'Docs',reason:'Reading',tabIds:[1]}]};}})});
  const result=await service.suggest(tabs,{consent:true});assert.equal(captured.tabs[0].url,'https://example.com/docs');assert.equal(captured.maxOutputTokens,512);
  assert(captured.signal instanceof AbortSignal);assert.deepEqual(result.groups[0].tabIds,['1']);
  const status=JSON.stringify(await service.status());assert(!status.includes(fakeEnv.META_API_KEY));assert(!status.includes('Documentation'));
  assert(!(await readFile(f.statePath,'utf8')).includes('Documentation'));
});
test('provider exception is redacted and consumes one attempt without retry',async t=>{
  const f=await fixture(t);let calls=0;
  const service=createAIService({env:fakeEnv,statePath:f.statePath,now:f.now,provider:fakeProvider({generate:async()=>{calls++;throw new Error(fakeEnv.META_API_KEY);}})});
  await assert.rejects(service.suggest(tabs,{consent:true}),error=>error.code==='provider_error'&&!error.message.includes(fakeEnv.META_API_KEY));
  assert.equal(calls,1);assert.equal((await service.status()).attemptsToday,1);
});
test('malformed or invented model assignments consume attempt but never pass as suggestions',async t=>{
  const f=await fixture(t);const service=createAIService({env:fakeEnv,statePath:f.statePath,now:f.now,provider:fakeProvider({generate:async()=>({groups:[{name:'Invented',reason:'',tabIds:['999']} ]})})});
  await assert.rejects(service.suggest(tabs,{consent:true}),hasCode('invalid_response'));assert.equal((await service.status()).attemptsToday,1);
});

test('lowering per-minute config reports when enough prior reservations expire',async t=>{
  const f=await fixture(t,{perMinute:3});await f.guard().run(async()=>{});f.advance(10000);await f.guard().run(async()=>{});f.advance(10000);await f.guard().run(async()=>{});
  const lower=new UsageGuard({statePath:f.statePath,perMinute:1,now:f.now});
  assert.equal((await lower.status()).retryAt,f.now()+60000);
  f.advance(40000);await assert.rejects(lower.run(async()=>{}),hasCode('minute_limit'));
  f.advance(20000);await lower.run(async()=>{});
});

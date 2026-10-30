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

// Injected fake HTTP responses and local-only servers; never live Meta calls.
import {createMetaProvider,makeMetaRequest} from '../server/meta-provider.mjs';
import {createLoopbackServer} from '../server/loopback.mjs';
import {createConnection,readConnection} from '../server/connection.mjs';
import {stat,chmod} from 'node:fs/promises';
import vm from 'node:vm';
import http from 'node:http';
const jsonResponse=value=>new Response(JSON.stringify(value));
const remoteProvider=overrides=>fakeProvider({remoteTokenCount:true,countInputTokens:async()=>100,...overrides});
test('official key alias is supported with META_API_KEY precedence',()=>{
  assert.equal(readConfig({MODEL_API_KEY:'FAKE-ALIAS'}).apiKey,'FAKE-ALIAS');
  assert.equal(readConfig({META_API_KEY:'FAKE-PRIMARY',MODEL_API_KEY:'FAKE-ALIAS'}).apiKey,'FAKE-PRIMARY');
});
test('Meta adapter sends bounded stateless structured requests to fixed official endpoints',async()=>{
  const requests=[];
  const provider=createMetaProvider({fetchImpl:async(url,options)=>{requests.push({url,options});return jsonResponse(url.endsWith('/input_tokens')?{object:'response.input_tokens',input_tokens:123}:{status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"groups":[]}'}]}]});}});
  const controller=new AbortController(),options={tabs:[{id:'1',title:'Docs',url:'https://example.com/'}],model:'test-model',apiKey:'FAKE-TEST-KEY',maxOutputTokens:512,signal:controller.signal};
  assert.equal(await provider.countInputTokens(options),123);assert.deepEqual(await provider.generate(options),{groups:[]});
  assert.deepEqual(requests.map(r=>r.url),['https://api.meta.ai/v1/responses/input_tokens','https://api.meta.ai/v1/responses']);
  for(const {options} of requests){const body=JSON.parse(options.body);assert.equal(options.redirect,'error');assert.equal(options.signal,controller.signal);assert.equal(body.store,false);assert.equal(body.stream,false);assert.equal(body.max_output_tokens,512);assert.equal(body.text.format.strict,true);assert.deepEqual(body.tools,[]);assert.equal(body.reasoning.effort,'minimal');assert(!options.body.includes('FAKE-TEST-KEY'));}
  assert.deepEqual(JSON.parse(requests[0].options.body),JSON.parse(requests[1].options.body));
  assert.throws(()=>makeMetaRequest({...options,maxOutputTokens:15}),hasCode('invalid_config'));
});
test('Meta adapter refuses invalid counts, incomplete/refused/multiple outputs and oversized bodies without retry',async()=>{
  const options={tabs:[],model:'test',apiKey:'FAKE',maxOutputTokens:512};let calls=0;
  for(const result of [{input_tokens:2},{object:'response.input_tokens',input_tokens:-1}]){const p=createMetaProvider({fetchImpl:async()=>{calls++;return jsonResponse(result);}});await assert.rejects(p.countInputTokens(options));}
  for(const result of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal'}]}]},{status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{}'},{type:'output_text',text:'{}'}]}]},{status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'not JSON'}]}]}]){const p=createMetaProvider({fetchImpl:async()=>{calls++;return jsonResponse(result);}});await assert.rejects(p.generate(options));}
  const p=createMetaProvider({fetchImpl:async()=>{calls++;return new Response('x'.repeat(256001));}});await assert.rejects(p.generate(options));assert.equal(calls,7);
});
test('remote endpoints each persist admission while one lock serializes the whole suggestion',async t=>{
  const f=await fixture(t),entered=deferred(),hold=deferred();let generated=0;
  const service=createAIService({env:fakeEnv,statePath:f.statePath,now:f.now,provider:remoteProvider({countInputTokens:async()=>{entered.resolve();return hold.promise;},generate:async()=>{generated++;assert.equal(JSON.parse(await readFile(f.statePath,'utf8')).daily,2);return {groups:[]};}})});
  const pending=service.suggest(tabs,{consent:true});await entered.promise;assert.equal((await service.status()).attemptsToday,1);
  await assert.rejects(service.suggest(tabs,{consent:true}),hasCode('concurrency_limit'));hold.resolve(100);await pending;assert.equal(generated,1);assert.equal((await service.status()).attemptsToday,2);
  await assert.rejects(service.suggest(tabs,{consent:true}),hasCode('minute_limit'));
});
test('slow token count timestamps generation at actual admission, preventing three calls per minute',async t=>{
  const f=await fixture(t);let counts=0,generations=0;
  const service=createAIService({env:fakeEnv,statePath:f.statePath,now:f.now,provider:remoteProvider({countInputTokens:async()=>{counts++;f.advance(59000);return 100;},generate:async()=>{generations++;return {groups:[]};}})});
  await service.suggest(tabs,{consent:true});f.advance(2000);await assert.rejects(service.suggest(tabs,{consent:true}),hasCode('minute_limit'));assert.equal(counts,1);assert.equal(generations,1);
  const state=JSON.parse(await readFile(f.statePath,'utf8'));assert.equal(state.attempts[1]-state.attempts[0],59000);
});
test('failed or excessive remote counts consume only one attempt and never generate',async t=>{
  for(const mode of ['failure','large']){const f=await fixture(t);let generated=0,calls=0;const service=createAIService({env:fakeEnv,statePath:f.statePath,now:f.now,provider:remoteProvider({countInputTokens:async()=>{calls++;if(mode==='failure')throw Error('FAKE-KEY');return 4097;},generate:async()=>{generated++;}})});await assert.rejects(service.suggest(tabs,{consent:true}),hasCode(mode==='failure'?'provider_error':'input_limit'));assert.equal(calls,1);assert.equal(generated,0);assert.equal((await service.status()).attemptsToday,1);}
});
test('late remote count after timeout cannot reserve or start generation',async t=>{
  const f=await fixture(t),hold=deferred();let generated=0;const service=createAIService({env:{...fakeEnv,AI_TIMEOUT_MS:'10'},statePath:f.statePath,now:f.now,provider:remoteProvider({countInputTokens:()=>hold.promise,generate:async()=>{generated++;}})});
  await assert.rejects(service.suggest(tabs,{consent:true}),hasCode('timeout'));hold.resolve(100);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(generated,0);assert.equal((await service.status()).attemptsToday,1);
});
test('two-call suggestions do not waste the last daily attempt on counting',async t=>{
  const f=await fixture(t);let calls=0;const service=createAIService({env:{...fakeEnv,AI_REQUESTS_PER_DAY:'3'},statePath:f.statePath,now:f.now,provider:remoteProvider({countInputTokens:async()=>{calls++;return 100;}})});
  await service.suggest(tabs,{consent:true});f.advance(60000);await assert.rejects(service.suggest(tabs,{consent:true}),hasCode('daily_limit'));assert.equal(calls,1);
});
async function localFixture(t){
  const token='a'.repeat(64),origin='safari-web-extension://test-extension';let suggestions=0;
  const service={status:async()=>({configured:true,attemptsToday:suggestions}),suggest:async()=>{suggestions++;return {groups:[]};}};
  const {server,listen}=createLoopbackServer({service,token,allowedOrigin:origin,port:0});const address=await listen();t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {token,origin,base:`http://127.0.0.1:${address.port}`,headers:{Origin:origin,Authorization:`Bearer ${token}`},calls:()=>suggestions};
}
test('loopback requires exact Host, Origin and token, concealing status from strangers',async t=>{
  const f=await localFixture(t);
  for(const headers of [{},{...f.headers,Origin:'https://attacker.example'},{...f.headers,Authorization:'Bearer wrong'}]){const response=await fetch(f.base+'/v1/status',{headers});assert([401,403].includes(response.status));const body=await response.json();assert.equal(body.usage,undefined);assert(!JSON.stringify(body).includes(f.token));}
  // Node fetch protects Host; use a raw HTTP request to test DNS-rebinding defense.
  const wrongHost=await new Promise((resolve,reject)=>{const request=http.get(f.base+'/v1/status',{headers:{...f.headers,Host:'attacker.example'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);});
  assert.equal(wrongHost,403);
  const response=await fetch(f.base+'/v1/status',{headers:f.headers});assert.equal(response.status,200);assert.equal((await response.json()).usage.configured,true);assert.equal(f.calls(),0);
});
test('loopback handles exact preflight, rejects extra fields, admits authenticated suggestion',async t=>{
  const f=await localFixture(t);const p=await fetch(f.base+'/v1/suggestions',{method:'OPTIONS',headers:{Origin:f.origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'}});assert.equal(p.status,204);assert.equal(p.headers.get('Access-Control-Allow-Origin'),f.origin);
  const d=await fetch(f.base+'/v1/suggestions',{method:'OPTIONS',headers:{Origin:f.origin,'Access-Control-Request-Method':'DELETE'}});assert.equal(d.status,403);
  const extra=await fetch(f.base+'/v1/suggestions',{method:'POST',headers:{...f.headers,'Content-Type':'application/json'},body:JSON.stringify({tabs,consent:true,apiKey:'TEST-ONLY'})});assert.equal(extra.status,400);assert.equal(f.calls(),0);
  const good=await fetch(f.base+'/v1/suggestions',{method:'POST',headers:{...f.headers,'Content-Type':'application/json'},body:JSON.stringify({tabs,consent:true})});assert.equal(good.status,200);assert.equal(f.calls(),1);
});
test('loopback rejects oversized bodies before service invocation',async t=>{
  const f=await localFixture(t);const r=await fetch(f.base+'/v1/suggestions',{method:'POST',headers:{...f.headers,'Content-Type':'application/json'},body:'x'.repeat(20001)});assert.equal(r.status,413);assert.equal(f.calls(),0);
});
test('pairing persists private token, rejects accidental re-pair and loose file permissions',async t=>{
  const f=await fixture(t),path=join(f.dir,'connection.json');const a=await createConnection(path,'safari-web-extension://test');assert.match(a.token,/^[a-f0-9]{64}$/);assert.equal((await stat(path)).mode&0o077,0);assert.deepEqual(await createConnection(path,'safari-web-extension://test'),a);
  await assert.rejects(createConnection(path,'safari-web-extension://other'),hasCode('invalid_config'));await chmod(path,0o644);await assert.rejects(readConnection(path),hasCode('invalid_config'));
});
test('extension client uses authenticated fixed loopback, exposes limit errors and never retries',async()=>{
  const source=await readFile(new URL('../extension/ai.js',import.meta.url),'utf8'),requests=[];
  const context=vm.createContext({location:{origin:'null',protocol:'safari-web-extension:',host:'test'},AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options});return {ok:false,json:async()=>({ok:false,error:{code:'minute_limit',message:'Wait',retryAt:123},usage:{remainingThisMinute:0}})};}});
  vm.runInContext(source,context);const client=context.WorkspaceAI;assert.equal(client.clientOrigin,'safari-web-extension://test');await assert.rejects(client.status({token:'not-valid'}),hasCode('local_token_required'));assert.equal(requests.length,0);
  await assert.rejects(client.suggest({token:'b'.repeat(64),tabs:[{id:'1'}],consent:true}),error=>error.code==='minute_limit'&&error.retryAt===123&&error.usage.remainingThisMinute===0);assert.equal(requests.length,1);assert.equal(requests[0].url,'http://127.0.0.1:8788/v1/suggestions');assert.equal(requests[0].options.redirect,'error');
});


test('shared usage directory rejects relative overrides that would fork budgets across checkouts',async()=>{
 const {resolveStateDirectory}=await import('../server/connection.mjs');
 const home='/private/tmp/fake-home';
 const expected=join(home,'Library','Application Support','Safari Workspaces','AI');
 assert.equal(resolveStateDirectory(undefined,home),expected);
 assert.equal(resolveStateDirectory('',home),expected);
 assert.equal(resolveStateDirectory('/private/tmp/explicit-ledger',home),'/private/tmp/explicit-ledger');
 for(const override of ['state','../state','~/state',' ',{}])assert.throws(()=>resolveStateDirectory(override,home),/absolute path/);
});


test('POST status uses exact Origin and authentication without a provider call; unsafe origins remain blocked',async t=>{
 const f=await localFixture(t);
 const status=await fetch(f.base+'/v1/status',{method:'POST',headers:{...f.headers,'Content-Type':'application/json'},body:'{}'});
 assert.equal(status.status,200);assert.equal((await status.json()).usage.configured,true);
 for(const [origin,diagnostic] of [[undefined,/did not send an Origin/],['null',/opaque Origin/],['safari-web-extension://different',/differs from the paired/]]) {
  const headers={Authorization:`Bearer ${f.token}`,'Content-Type':'application/json'};
  if(origin!==undefined)headers.Origin=origin;
  const response=await fetch(f.base+'/v1/status',{method:'POST',headers,body:'{}'});
  assert.equal(response.status,403);const data=await response.json();
  assert.equal(data.error.code,'origin_denied');assert.match(data.error.message,diagnostic);assert.equal(data.usage,undefined);
  assert(!JSON.stringify(data).includes(f.token));
 }
 const bad=await fetch(f.base+'/v1/status',{method:'POST',headers:{...f.headers,'Content-Type':'application/json'},body:'{"consent":true}'});
 assert.equal(bad.status,400);assert.equal(f.calls(),0);
});
test('client status explicitly uses POST JSON to trigger non-GET Origin handling without inference',async()=>{
 const requests=[];
 const context=vm.createContext({location:{origin:'safari-web-extension://test'},AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
  requests.push({url,options});return {ok:true,json:async()=>({ok:true,usage:{configured:true}})};
 }});
 vm.runInContext(await readFile(new URL('../extension/ai.js',import.meta.url),'utf8'),context);
 await context.WorkspaceAI.status({token:'a'.repeat(64)});
 assert.equal(requests.length,1);assert.equal(requests[0].url,'http://127.0.0.1:8788/v1/status');
 assert.equal(requests[0].options.method,'POST');assert.equal(requests[0].options.mode,'cors');
 assert.equal(requests[0].options.body,'{}');assert.equal(requests[0].options.headers['Content-Type'],'application/json');
});

// Actual extension client + loopback HTTP + guarded service, with a FAKE model.
// No requests reach Meta; browser CORS/permission behavior requires separate Safari verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAIService} from '../server/ai-service.mjs';
import {createLoopbackServer} from '../server/loopback.mjs';
import {createConnection,readConnection,rePairConnection} from '../server/connection.mjs';

test('extension client and loopback service agree on consent, usage and validated suggestions (fake model)',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'workspaces-contract-'));
 const token='a'.repeat(64),origin='safari-web-extension://11111111-1111-4111-8111-111111111111';
 let calls=0;
 const provider={id:'fake-contract',countInputTokens:()=>100,generate:async({tabs})=>{
  calls++;assert.equal(tabs[0].url,'https://example.com/research');
  return {groups:[{name:'Research',reason:'Related task',tabIds:[tabs[0].id]}]};
 }};
 const service=createAIService({env:{AI_LIVE_ENABLED:'true',META_API_PROVIDER_ID:provider.id,META_API_MODEL:'fake-model',META_API_KEY:'FAKE-TEST-KEY'},provider,statePath:path.join(directory,'usage.json')});
 const transport=createLoopbackServer({service,token,allowedOrigin:origin,port:0});
 const address=await transport.listen();
 try{
  const context=vm.createContext({URL,AbortController,setTimeout,clearTimeout,location:{origin},fetch:async(url,options)=>{
   assert(url.startsWith('http://127.0.0.1:8788/'));
   // Node supplies the browser-origin header for this transport contract fixture.
   return fetch(url.replace('http://127.0.0.1:8788',`http://127.0.0.1:${address.port}`),{...options,headers:{...options.headers,Origin:origin}});
  }});
  vm.runInContext(await readFile(new URL('../extension/ai.js',import.meta.url),'utf8'),context);
  const client=context.WorkspaceAI;
  const status=await client.status({token});assert.equal(status.usage.configured,true);assert.equal(calls,0);
  const tabs=[{id:'1',title:'Research',url:'https://example.com/research?q=private#draft'}];
  await assert.rejects(()=>client.suggest({token,tabs,consent:false}),error=>error.code==='consent_required');
  assert.equal(calls,0);
  const result=await client.suggest({token,tabs,consent:true});
  assert.equal(result.result.groups[0].name,'Research');assert.deepEqual(result.result.groups[0].tabIds,['1']);
  assert.equal(result.usage.attemptsToday,1);assert.equal(calls,1);
  await assert.rejects(()=>client.status({token:'b'.repeat(64)}),error=>error.code==='unauthorized');
  assert.equal(calls,1);
 }finally{
  await new Promise(resolve=>transport.server.close(resolve));
  await rm(directory,{recursive:true,force:true});
 }
});


test('packaged extension confines AI network access to the local service',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
 const directives=manifest.content_security_policy.extension_pages.split(';').map(value=>value.trim());
 assert(directives.includes('connect-src http://127.0.0.1:8788'));
 assert.deepEqual(manifest.optional_host_permissions,['http://127.0.0.1/*']);
 assert.equal(manifest.host_permissions,undefined);
 assert.equal(manifest.permissions.some(permission=>permission.includes('meta.ai')||permission==='<all_urls>'),false);
});


test('real client refreshes a changed Safari origin on disk without restarting the local server or using model budget',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'workspaces-origin-contract-'));
 const file=path.join(directory,'connection.json'),usage=path.join(directory,'usage.json');
 const oldOrigin='safari-web-extension://11111111-1111-4111-8111-111111111111';
 const currentOrigin='safari-web-extension://22222222-2222-4222-8222-222222222222';
 const externalOrigin='safari-web-extension://33333333-3333-4333-8333-333333333333';
 const initial=await createConnection(file,oldOrigin);
 const usageBytes='{"test":"unchanged local budget","attempts":7}';await writeFile(usage,usageBytes,{mode:0o600});
 let updates=0,modelCalls=0;
 const service={status:async()=>({enabled:true,configured:true,attemptsToday:7}),suggest:async()=>{modelCalls++;throw Error('No model calls allowed in this test');}};
 const transport=createLoopbackServer({service,...initial,port:0,getConnection:()=>readConnection(file),updateOrigin:async(origin,options)=>{updates++;return rePairConnection(file,origin,options);}});
 const address=await transport.listen();
 try{
  const context=vm.createContext({URL,AbortController,setTimeout,clearTimeout,location:{origin:currentOrigin},fetch:(url,options)=>fetch(url.replace('http://127.0.0.1:8788',`http://127.0.0.1:${address.port}`),{...options,headers:{...options.headers,Origin:currentOrigin}})});
  vm.runInContext(await readFile(new URL('../extension/ai.js',import.meta.url),'utf8'),context);
  const response=await context.WorkspaceAI.status({token:initial.token});
  assert.equal(response.connection.updated,true);assert.equal((await readConnection(file)).allowedOrigin,currentOrigin);assert.equal(updates,1);
  assert.equal((await context.WorkspaceAI.status({token:initial.token})).connection.updated,false);assert.equal(updates,1);
  await rePairConnection(file,externalOrigin);
  assert.equal((await context.WorkspaceAI.status({token:initial.token})).connection.updated,true);assert.equal(updates,2);
  const stored=await readConnection(file);assert.equal(stored.token,initial.token);assert.equal(stored.allowedOrigin,currentOrigin);
  assert.equal(await readFile(usage,'utf8'),usageBytes);assert.equal(modelCalls,0);
 }finally{await new Promise(resolve=>transport.server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

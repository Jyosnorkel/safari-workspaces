// Connector lifecycle only: fake HTTP responses, no browser or real provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../extension/ai.js',import.meta.url),'utf8');
function clientFixture(respond){
 const requests=[];
 const context=vm.createContext({location:{origin:'safari-web-extension://11111111-1111-4111-8111-111111111111'},AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options});return respond(url,options);}});
 vm.runInContext(source,context);
 return {client:context.WorkspaceAI,requests};
}
const ok=data=>({ok:true,json:async()=>({ok:true,...data})});
const failed=(code,message)=>({ok:false,json:async()=>({ok:false,error:{code,message}})});
const token='a'.repeat(64);
test('connector performs no background calls and authenticates a connection on every status check',async()=>{
 const f=clientFixture(()=>ok({usage:{configured:true},connection:{updated:true}}));
 assert.equal(f.requests.length,0);
 const status=await f.client.status({token});
 assert.equal(status.connection.updated,true);
 await f.client.status({token});assert.equal(f.requests.length,2);
 for(const request of f.requests){assert.equal(request.url,'http://127.0.0.1:8788/v1/connect');assert.equal(request.options.method,'POST');assert.equal(request.options.body,'{}');assert.equal(request.options.headers.Authorization,`Bearer ${token}`);}
});
test('a user suggestion refreshes the connection once before inference and never retries a failed inference',async()=>{
 const f=clientFixture(url=>url.endsWith('/connect')?ok({usage:{configured:true}}):failed('provider_error','Safe provider failure'));
 await assert.rejects(()=>f.client.suggest({token,tabs:[{id:'1',title:'Fictional',url:'https://example.com/'}],consent:true}),error=>error.code==='provider_error');
 assert.deepEqual(f.requests.map(request=>new URL(request.url).pathname),['/v1/connect','/v1/suggestions']);
 assert.equal(JSON.parse(f.requests[1].options.body).consent,true);
});
test('failed authentication or unavailable connection cannot start a suggestion request',async()=>{
 const f=clientFixture(()=>failed('unauthorized','Enter the local token.'));
 await assert.rejects(()=>f.client.suggest({token,tabs:[],consent:true}),error=>error.code==='unauthorized');
 assert.equal(f.requests.length,1);assert(f.requests[0].url.endsWith('/v1/connect'));
});

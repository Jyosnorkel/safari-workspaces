import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoopbackServer} from '../server/loopback.mjs';

test('attack matrix cannot read status or rebind without the paired bearer and origin',async t=>{
 const token='a'.repeat(64),origin='safari-web-extension://11111111-1111-4111-8111-111111111111';
 let reads=0,updates=0,calls=0;
 const connection={token,allowedOrigin:origin};
 const app=createLoopbackServer({token,allowedOrigin:origin,port:0,
  service:{status:async()=>{reads++;return {configured:true};},suggest:async()=>{calls++;return {groups:[]};}},
  getConnection:async()=>connection,updateOrigin:async()=>{updates++;return connection;}});
 const address=await app.listen();t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const base=`http://127.0.0.1:${address.port}`;
 const origins=[undefined,'null','https://evil.example','http://127.0.0.1:9999','safari-web-extension://22222222-2222-4222-8222-222222222222',origin];
 for(const route of ['/v1/status','/v1/connect','/v1/suggestions'])for(const from of origins)for(const credential of ['',`Bearer ${'b'.repeat(64)}`]){
  const response=await fetch(base+route,{method:'POST',headers:{...(from?{Origin:from}:{}),Authorization:credential,'Content-Type':'application/json'},body:'{}'});
  assert.ok([401,403].includes(response.status));
  const body=await response.text();assert.ok(!body.includes(token));assert.ok(!body.includes('configured'));
 }
 assert.equal(reads,0);assert.equal(updates,0);assert.equal(calls,0);
 // Even with a known token, an ordinary hostile web origin cannot access status.
 const r=await fetch(base+'/v1/status',{headers:{Origin:'https://evil.example',Authorization:`Bearer ${token}`}});
 assert.equal(r.status,403);assert.equal(reads,0);
});

test('authenticated malformed JSON and injected fields never invoke inference',async t=>{
 const token='a'.repeat(64),origin='safari-web-extension://test';let calls=0;
 const app=createLoopbackServer({token,allowedOrigin:origin,port:0,service:{status:async()=>({}),suggest:async()=>{calls++;return {};}}});
 const address=await app.listen();t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 for(const body of ['{','null','[]','{"__proto__":{"admin":true}}','{"apiKey":"injected"}','{"endpoint":"https://evil.example"}']){
  const r=await fetch(`http://127.0.0.1:${address.port}/v1/suggestions`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body});assert.equal(r.status,400);
 }
 assert.equal(calls,0);assert.equal({}.admin,undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8');
test('dashboard creation activates the new tab without explicitly closing the popup window',async()=>{
  let click, created, closeCalls=0;
  const button={addEventListener:(_,fn)=>click=fn}, status={textContent:''};
  vm.runInNewContext(source,{
    document:{body:{addEventListener(){}},getElementById:id=>id==='open'?button:status},
    window:{close:()=>closeCalls++},
    browser:{windows:{getCurrent:async()=>({id:1,incognito:false})},runtime:{getURL:path=>`safari-web-extension://test/${path}`},tabs:{query:async()=>[],create:async options=>{created=options;}}}
  });
  await click();
  assert.equal(created.url,'safari-web-extension://test/dashboard.html');
  assert.equal(created.active,true);
  assert.equal(closeCalls,0);
  assert.equal(status.textContent,'Workspace manager opened.');
});

function dropHarness(options={}) {
  const handlers={}, classes=new Set(), button={addEventListener(){},disabled:false},status={textContent:''};
  const area={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
  const h={sent:[],button,status,classes,window:{id:7,type:'normal',incognito:false},...options};
  vm.runInNewContext(source,{URL,crypto:{randomUUID:()=> '5c6d9a98-c1ca-4d15-b673-ac94a190dd27'},
    document:{body:{addEventListener:(type,fn)=>handlers[type]=fn},getElementById:id=>id==='open'?button:id==='backup-drop'?area:status},
    browser:{windows:{getCurrent:async()=>h.window},runtime:{sendMessage:async message=>{h.sent.push(message);if(h.failure)return {ok:false,error:h.failure};return {ok:true,workspaces:[{tabs:[{}],restore:{results:{one:{state:'opened'}}}}]};}}}
  });
  h.event=(types=['Files'],files=[{size:2,text:async()=> '{}'}])=>({dataTransfer:{types,files},preventDefault(){this.prevented=true;}});
  h.drop=event=>handlers.drop(event);h.over=event=>handlers.dragover(event);return h;
}
test('toolbar popup highlights file drags and sends the existing background backup operation once',async()=>{
 const h=dropHarness();const over=h.event();h.over(over);assert(over.prevented);assert(h.classes.has('is-over'));
 const event=h.event();await Promise.all([h.drop(event),h.drop(h.event())]);
 assert(event.prevented);assert.equal(h.sent.length,1);assert.equal(h.sent[0].type,'drop-backup');assert.equal(h.sent[0].windowId,7);assert.equal(h.sent[0].json,'{}');assert.match(h.sent[0].requestId,/^[a-f0-9-]{36}$/);assert.match(h.status.textContent,/1\/1 saved URLs opened/);assert.equal(h.button.disabled,false);
});
test('popup rejects multiple, oversized, private-window and non-file drops without a restore request',async()=>{
 for(const kind of ['multiple','oversized','private','url']) {
  const h=dropHarness(kind==='private'?{window:{id:7,type:'normal',incognito:true}}:{});
  const event=kind==='multiple'?h.event(['Files'],[{},{}]):kind==='oversized'?h.event(['Files'],[{size:10485761}]):kind==='url'?h.event(['text/uri-list'],[]):h.event();
  await h.drop(event);assert(event.prevented);assert.equal(h.sent.length,0);assert.equal(h.button.disabled,false);
 }
});
test('popup shows background validation/recovery errors and remains usable',async()=>{
 const h=dropHarness({failure:'Invalid backup. No tabs were changed.'});await h.drop(h.event());
 assert.equal(h.sent.length,1);assert.match(h.status.textContent,/Invalid backup/);assert.equal(h.button.disabled,false);
});

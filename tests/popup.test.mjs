import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8');
test('dashboard creation activates the new tab without explicitly closing the popup window',async()=>{
  let click, created, closeCalls=0;
  const button={addEventListener:(_,fn)=>click=fn}, status={textContent:''};
  vm.runInNewContext(source,{
    document:{getElementById:id=>id==='open'?button:status},
    window:{close:()=>closeCalls++},
    browser:{windows:{getCurrent:async()=>({id:1,incognito:false})},runtime:{getURL:path=>`safari-web-extension://test/${path}`},tabs:{query:async()=>[],create:async options=>{created=options;}}}
  });
  await click();
  assert.equal(created.url,'safari-web-extension://test/dashboard.html');
  assert.equal(created.active,true);
  assert.equal(closeCalls,0);
  assert.equal(status.textContent,'Workspace manager opened.');
});

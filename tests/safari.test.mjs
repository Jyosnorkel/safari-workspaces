import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root=fileURLToPath(new URL('../',import.meta.url));
const popup=readFileSync(path.join(root,'extension/popup.js'),'utf8');
function harness({tabs=[],window={id:7,incognito:false,type:'normal'},queryError,createError,apiUnavailable=false}={}) {
  let click;
  const button={disabled:false,addEventListener:(_,listener)=>click=listener};
  const status={textContent:''};
  const h={created:[],updated:[],closed:0,queries:0};
  const browser={
    windows:{getCurrent:async()=>window},
    runtime:{getURL:path=>`safari-web-extension://test/${path}`},
    tabs:{
      query:async info=>{h.queries++;h.queryInfo=info;if(queryError)throw new Error(queryError);return tabs;},
      update:async(id,changes)=>h.updated.push({id,...changes}),
      create:async options=>{if(createError)throw new Error(createError);h.created.push(options);}
    }
  };
  vm.runInNewContext(popup,{URL,browser:apiUnavailable?undefined:browser,document:{body:{addEventListener(){}},getElementById:id=>id==='open'?button:status},window:{close:()=>h.closed++}});
  Object.assign(h,{click,button,status});return h;
}

test('toolbar opens one dashboard in the current normal window',async()=>{
  const h=harness();await h.click();
  assert.equal(h.created.length,1);assert.equal(h.created[0].windowId,7);
  assert.equal(h.created[0].url,'safari-web-extension://test/dashboard.html');assert.equal(h.closed,0);
});
test('existing dashboard with hash navigation is focused rather than duplicated',async()=>{
  for(const suffix of ['','#saved','?view=saved#saved']) {
    const h=harness({tabs:[{id:12,url:`safari-web-extension://test/dashboard.html${suffix}`}]});await h.click();
    assert.equal(h.created.length,0);assert.equal(h.updated[0].id,12);assert.equal(h.updated[0].active,true);
  }
});
test('unrelated origins, pages and unavailable tab URLs are not mistaken for dashboard',async()=>{
  const h=harness({tabs:[{id:1},{id:2,url:'https://test/dashboard.html'},{id:3,url:'safari-web-extension://other/dashboard.html'},{id:4,url:'safari-web-extension://test/popup.html'}]});
  await h.click();assert.equal(h.created.length,1);assert.equal(h.updated.length,0);
});
test('private, non-normal and invalid window IDs do not launch dashboard',async()=>{
  for(const window of [{id:7,incognito:true},{id:7,type:'popup'},{id:undefined,type:'normal'}]) {
    const h=harness({window});await h.click();assert.equal(h.created.length,0);assert.equal(h.queries,0);
    assert.equal(h.button.disabled,false);assert.match(h.status.textContent,/normal Safari window/);
  }
});
test('missing extension API gives actionable guidance',async()=>{
  const h=harness({apiUnavailable:true});await h.click();
  assert.match(h.status.textContent,/enabled Safari extension/);assert.equal(h.button.disabled,false);assert.equal(h.closed,0);
});
test('permission/query or create failure remains visible and allows retry',async()=>{
  for(const options of [{queryError:'Permission denied'},{createError:'Could not create tab'}]) {
    const h=harness(options);await h.click();assert.equal(h.button.disabled,false);assert.equal(h.closed,0);
    assert.match(h.status.textContent,/Permission denied|Could not create tab/);
  }
});
test('concurrent popup handlers create only one manager',async()=>{
  const h=harness();await Promise.all([h.click(),h.click()]);
  assert.equal(h.created.length,1);assert.equal(h.closed,0);assert.equal(h.queries,1);
});
test('manifest popup and background resources are included in the native extension resource phase',()=>{
  const manifest=JSON.parse(readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
  const project=readFileSync(path.join(root,'native/Safari Dev Lab/Safari Dev Lab.xcodeproj/project.pbxproj'),'utf8');
  const phase=project.match(/8FFCB11B3090F03E0088828C \/\* Resources \*\/ = \{[\s\S]*?\n\t\t\};/)[0];
  const dashboard=readFileSync(path.join(root,'extension/dashboard.html'),'utf8');
  const dashboardFiles=Array.from(dashboard.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),match=>match[1]);
  for(const file of ['manifest.json',manifest.action.default_popup,'popup.js','popup.css','dashboard.html',...dashboardFiles,...manifest.background.scripts]) {
    assert(existsSync(path.join(root,'extension',file)),`${file} exists`);
    assert(phase.includes(`${file} in Resources`),`${file} belongs to the extension copy phase`);
  }
});

test('native host renders extension-state failures and settings failures as actionable text',()=>{
  const source=readFileSync(path.join(root,'native/Safari Dev Lab/Safari Dev Lab/Resources/Script.js'),'utf8');
  const nodes=new Map();const classes=new Set();
  const node=name=>{if(!nodes.has(name))nodes.set(name,{innerText:'',addEventListener(){}});return nodes.get(name);};
  const context=vm.createContext({document:{
    getElementsByClassName:name=>[node(name)],querySelector:()=>node('open-preferences'),
    body:{classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),remove:(...names)=>names.forEach(name=>classes.delete(name))}}
  }});
  vm.runInContext(source,context);
  vm.runInContext('show(true, true)',context);assert(classes.has('state-on'));
  vm.runInContext('showStateError()',context);
  assert(!classes.has('state-on'));assert(!classes.has('state-off'));
  assert.match(node('state-unknown').innerText,/couldn’t confirm/);
  assert.match(node('state-unknown').innerText,/Safari Settings/);
  vm.runInContext('showSettingsError()',context);
  assert.match(node('state-unknown').innerText,/manually/);
  vm.runInContext('show(false, true)',context);assert(classes.has('state-off'));
});

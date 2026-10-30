// Explicit opt-in Safari check. Never deletes sessions, closes windows, or quits Safari.
// Leaves the driver and automation window alive so subsequent checks can reuse them.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,cp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='darwin') throw new Error('This test requires Safari on macOS.');
const dir=await mkdtemp(path.join(tmpdir(),'workspaces-backup-smoke-'));
const server=createServer();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port; await new Promise(resolve=>server.close(resolve));
const child=spawn('/usr/bin/safaridriver',['--port',String(port)],{detached:true,stdio:'ignore'});
let spawnError;child.on('error',error=>{spawnError=error;});child.unref();
const endpoint=`http://127.0.0.1:${port}`;
async function request(method,route,body) {
  // Defense in depth: this harness has no session/window deletion command.
  if(method==='DELETE') throw new Error('Deletion commands are forbidden in this harness.');
  const response=await fetch(endpoint+route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const {value}=await response.json();
  if(!response.ok || value?.error) throw new Error(`${method} ${route}: ${value?.message || response.status}`);
  return value;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(let attempt=0;;attempt++) {
  if(spawnError)throw spawnError;
  try{await request('GET','/status');break;}catch(error){if(attempt===30)throw error;await delay(100);}
}
const session=await request('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari'}}});
const route=`/session/${encodeURIComponent(session.sessionId)}`;
const command=(method,suffix,body)=>request(method,route+suffix,body);
await writeFile(path.join(dir,'session.json'),JSON.stringify({endpoint,sessionId:session.sessionId,pid:child.pid}),{mode:0o600});
console.log(`Session information retained privately in ${dir}/session.json. No automatic cleanup.`);
const handles=await command('GET','/window/handles');
if(handles.length!==1) throw new Error('Expected exactly one fresh automation tab; refusing to navigate.');
const initialURL=await command('GET','/url');
if(!['about:blank',''].includes(initialURL)) throw new Error('Fresh automation tab was not blank; refusing to navigate.');
// Temporary test-only content script exposes the extension URL on a disposable fixture.
// It cannot open, close, enumerate or navigate any other tab.
const extensionDir=path.join(dir,'extension');await cp(path.join(root,'extension'),extensionDir,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extensionDir,'manifest.json'),'utf8'));
manifest.content_scripts=[{matches:['http://127.0.0.1/*'],js:['smoke-locator.js']}];
await writeFile(path.join(extensionDir,'manifest.json'),JSON.stringify(manifest));
await writeFile(path.join(extensionDir,'smoke-locator.js'),"document.documentElement.dataset.workspaceDashboard = browser.runtime.getURL('dashboard.html');");
const installed=await command('POST','/webextension',{type:'path',path:extensionDir});
console.log('Temporary test extension loaded:',Boolean(installed));
// Fixture server runs separately and is left alive with the driver.
const fixture=spawn(process.execPath,['--input-type=module','-e',"import{createServer}from'node:http';const s=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end('<!doctype html><title>Disposable backup test</title><h1>Safari Workspaces backup test</h1>');});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"],{detached:true,stdio:['ignore','pipe','ignore']});
const fixturePort=await new Promise(resolve=>fixture.stdout.once('data',chunk=>resolve(Number(chunk.toString().trim()))));fixture.stdout.destroy();fixture.unref();
await command('POST','/url',{url:`http://127.0.0.1:${fixturePort}/backup-test`});
let dashboard;
for(let attempt=0;attempt<40;attempt++) {
  dashboard=await command('POST','/execute/sync',{script:'return document.documentElement.dataset.workspaceDashboard || null',args:[]});
  if(dashboard)break; await delay(100);
}
if(!dashboard?.startsWith('safari-web-extension://')) throw new Error('Safari did not expose the test extension URL. Test window left open for investigation.');
await command('POST','/url',{url:dashboard});
console.log('Dashboard:',await command('POST','/execute/sync',{script:"return {title:document.title,status:document.getElementById('status')?.textContent}",args:[]}));
await writeFile(path.join(dir,'fixture.json'),JSON.stringify({dashboard,fixturePort,fixturePid:fixture.pid,automationHandle:handles[0]}),{mode:0o600});
console.log('Ready for snapshot/export checks. Existing windows have not been targeted. Test session remains open.');

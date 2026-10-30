// Real Safari rendering with simulated extension APIs; not an extension integration test.
// Reuses a known disposable test session. Never closes or ends a session/window.
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv[2])throw Error('Pass the private session.json from safari-backup-smoke.mjs.');
const state=JSON.parse(await readFile(process.argv[2],'utf8'));
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(state.endpoint)||typeof state.sessionId!=='string')throw Error('Invalid local session file.');
async function command(method,route,body){
  if(method==='DELETE')throw Error('Deletion is forbidden.');
  const r=await fetch(state.endpoint+'/session/'+encodeURIComponent(state.sessionId)+route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const payload=await r.json();const {value}=payload;if(!r.ok||value?.error)throw Error(method+' '+route+': '+JSON.stringify(payload));return value;
}
const execute=(script,args=[])=>command('POST','/execute/sync',{script,args});
async function click(selector){
  if(selector!=='#confirm-accept')await wait("return !document.querySelector('main').inert");
  await execute("document.querySelector(arguments[0]).click()",[selector]);
}
async function wait(script){for(let n=0;n<40;n++){const result=await execute(script);if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('UI condition timed out.');}
const handles=await command('GET','/window/handles');
const currentURL=await command('GET','/url');
if(handles.length!==1||!/^http:\/\/127\.0\.0\.1:\d+\/backup-test(?:-ui)?$/.test(currentURL))throw Error('Session is not on the single disposable fixture tab. Refusing to navigate.');
const fixture=`
const store={};
const sampleTabs=[{id:1,index:0,windowId:1,title:'Research example',url:'https://example.com/research?q=test#section'}, {id:2,index:1,windowId:1,title:'Pinned reference',url:'https://example.org/',pinned:true},{id:3,index:2,windowId:1,title:'Duplicate research',url:'https://example.com/research?q=test#section'},{id:4,index:3,windowId:1,title:'Private example',url:'https://example.net/',incognito:true}];
let receiver;
window.browser={runtime:{id:'fixture',getURL:p=>'safari-web-extension://fixture/'+p,onMessage:{addListener:fn=>receiver=fn},sendMessage:msg=>receiver(msg,{id:'fixture',url:'safari-web-extension://fixture/dashboard.html'})},windows:{getCurrent:async()=>({id:1,type:'normal'}),get:async()=>({id:1,type:'normal'})},storage:{local:{get:async key=>({[key]:structuredClone(store[key])}),set:async values=>Object.assign(store,structuredClone(values))}},tabs:{query:async()=>structuredClone(sampleTabs),get:async id=>structuredClone(sampleTabs.find(t=>t.id===id)),remove:async()=>{throw Error('Closing tabs forbidden in fixture');},create:async()=>{throw Error('Opening tabs forbidden in fixture');}}};
const originalCreate=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.lastBackupBlob=blob;return originalCreate(blob);};
window.fixtureStore=store;
`;
const html=(await readFile(path.join(root,'extension/dashboard.html'),'utf8')).replace('<script src="core.js" defer></script>','<script src="fixture.js" defer></script><script src="core.js" defer></script><script src="background.js" defer></script>').replace('SAFARI WORKSPACES / MVP','SAFARI UI TEST / SIMULATED TABS');
const allowed=new Set(['core.js','background.js','dashboard.js','dashboard.css']);
const server=createServer(async(req,res)=>{
 try{const name=req.url.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');if(name==='backup-test-ui')res.end(html);else if(name==='fixture.js')res.end(fixture);else if(allowed.has(name))res.end(await readFile(path.join(root,'extension',name)));else{res.statusCode=404;res.end();}}catch{res.statusCode=500;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 await command('POST','/url',{url:`http://127.0.0.1:${server.address().port}/backup-test-ui`});
 await wait("return document.getElementById('status').textContent.includes('Connected')");
 await click('#scan'); await wait("return document.getElementById('scan-info').textContent.includes('3 tabs scanned')");
 await click('#snapshot-window');await wait("return document.getElementById('saved-count').textContent==='1'");
 const status=await execute("return document.getElementById('status').textContent");
 try { await click('#export-all'); } catch(error) { if(!await execute('return Boolean(window.lastBackupBlob)')) throw error; console.log('Safari returned a download-click response:',error.message); } await wait('return Boolean(window.lastBackupBlob)');
 const exported=await command('POST','/execute/async',{script:"window.lastBackupBlob.text().then(json=>arguments[arguments.length-1](JSON.parse(json)))",args:[]});
 if(exported.workspaces[0].tabs.length!==3||exported.workspaces[0].tabs[1].title!=='Pinned reference')throw Error('Wrong exported tabs.');
 const json=JSON.stringify(exported);
 await execute("const input=document.getElementById('backup-file');const data=new DataTransfer();data.items.add(new File([arguments[0]],'backup.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change'));",[json]);
 await wait("return document.getElementById('confirm').open");await click('#confirm-accept');
 await wait("return document.getElementById('saved-count').textContent==='2'");
 const after=await execute("return {status:document.getElementById('status').textContent,workspaces:Object.values(window.fixtureStore['workspaces.v1']).length}");
 const screenshot=await command('GET','/screenshot');
 const out=path.join(path.dirname(process.argv[2]),'backup-ui.png');await writeFile(out,Buffer.from(screenshot,'base64'));
 console.log(JSON.stringify({mode:'Safari DOM handlers; simulated extension APIs; programmatic clicks',snapshotStatus:status,exportedTabs:exported.workspaces[0].tabs.length,import:after,screenshot:out,windowsClosed:0},null,2));
}catch(error){console.log('Layout:',await execute("const e=document.getElementById('export-all');const r=e.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{w:innerWidth,h:innerHeight},html:e.outerHTML,inert:document.querySelector('main').inert,overlap:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,300)}"));const data=await command('GET','/screenshot');await writeFile(path.join(path.dirname(process.argv[2]),'backup-ui-error.png'),Buffer.from(data,'base64'));throw error;}finally{server.close();}

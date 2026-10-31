// Development-only UI preview. Uses fictional tabs, memory storage and a fake AI service.
// No Safari, credentials, real tab operations or outbound model requests are available.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.argv[2]||root);
const port=Number(process.env.WORKSPACES_PREVIEW_PORT||8790);
if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Invalid preview port.');
await readFile(path.join(source,'extension/dashboard.html'));
const browserFixture=`
const fixtureStore={};let receiver;
const sampleTabs=[
 ['Project roadmap','https://example.com/project/roadmap'],
 ['Interface patterns','https://example.org/design/patterns'],
 ['API reference','https://example.net/docs/api'],
 ['Weekend itinerary','https://example.com/travel/itinerary'],
 ['Train timetable','https://example.org/trains'],
 ['City map','https://example.net/map'],
 ['Weekly planning','https://example.com/planning'],
 ['Reading list','https://example.org/reading']
].map(([title,url],index)=>({id:index+1,index,windowId:1,title,url,incognito:false,pinned:false}));
sampleTabs.push({id:9,index:8,windowId:1,title:'Pinned reference',url:'https://example.net/reference',pinned:true});
sampleTabs.push({id:10,index:9,windowId:1,title:'Restricted settings page',url:'safari://settings',pinned:false});
window.browser={runtime:{id:'preview',getURL:p=>'safari-web-extension://preview/'+p,onMessage:{addListener:fn=>receiver=fn},sendMessage:msg=>receiver(msg,{id:'preview',url:'safari-web-extension://preview/dashboard.html'})},permissions:{request:async()=>true},windows:{getCurrent:async()=>({id:1,type:'normal',incognito:false}),get:async()=>({id:1,type:'normal',incognito:false})},storage:{local:{get:async key=>({[key]:structuredClone(fixtureStore[key])}),set:async values=>Object.assign(fixtureStore,structuredClone(values))}},tabs:{query:async()=>structuredClone(sampleTabs),get:async id=>structuredClone(sampleTabs.find(tab=>tab.id===id)),remove:async()=>{throw Error('UI preview cannot close browser tabs.');},create:async()=>{throw Error('UI preview cannot open browser tabs.');}}};
`;
const fakeAI=`
const usage=()=>({enabled:true,configured:true,busy:false,attemptsToday:0,remainingToday:20,remainingThisMinute:2,perMinute:2,perDay:20,timezone:'UTC',requestsPerSuggestion:2,maxOutputTokens:2048,dailyResetAt:Date.now()+86400000,retryAt:null});
window.WorkspaceAI={clientOrigin:'safari-web-extension://preview',status:async()=>({ok:true,usage:usage()}),suggest:async({tabs})=>{const ids=new Set(tabs.map(tab=>String(tab.id)));return {ok:true,usage:usage(),result:{groups:[{name:'Build the project',reason:'Fictional preview: roadmap, design and documentation.',tabIds:['1','2','3'].filter(id=>ids.has(id))},{name:'Weekend trip',reason:'Fictional preview: itinerary, transport and map.',tabIds:['4','5','6'].filter(id=>ids.has(id))}].filter(group=>group.tabIds.length)}};}};
`;
const allowed=new Set(['core.js','background.js','dashboard.js','dashboard.css']);
const server=createServer(async(request,response)=>{
 try{
  const name=new URL(request.url,'http://127.0.0.1').pathname.slice(1);
  response.setHeader('Cache-Control','no-store');
  if(name===''||name==='dashboard.html'){
   let html=await readFile(path.join(source,'extension/dashboard.html'),'utf8');
   html=html.replace('<script src="core.js" defer></script>','<script src="preview-browser.js" defer></script><script src="core.js" defer></script><script src="background.js" defer></script>').replace('<script src="ai.js" defer></script>','<script src="preview-ai.js" defer></script>').replace('SAFARI WORKSPACES / MVP','UI PREVIEW / FICTIONAL TABS').replace('● LOCAL FIRST','● NO SAFARI ACCESS');
   response.setHeader('Content-Type','text/html');return response.end(html);
  }
  if(name==='preview-browser.js'||name==='preview-ai.js'){response.setHeader('Content-Type','text/javascript');return response.end(name==='preview-browser.js'?browserFixture:fakeAI);}
  if(!allowed.has(name)){response.statusCode=404;return response.end('Not found');}
  response.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');
  response.end(await readFile(path.join(source,'extension',name)));
 }catch{response.statusCode=500;response.end('Preview could not load its source files.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Fictional-data UI preview: http://127.0.0.1:${port}/dashboard.html`));

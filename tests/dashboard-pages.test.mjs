import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../extension/dashboard-pages.js',import.meta.url),'utf8');
function harness(hash=''){
 const names=['home','organise','snapshots','settings'],events={},scrolls=[];
 const pages=names.map(page=>({dataset:{page},hidden:false,edit:'keep this draft'}));
 const links=names.map(page=>({dataset:{pageLink:page},attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(k,f){this[k]=f;}}));
 const context={document:{querySelectorAll:q=>q==='[data-page]'?pages:links},location:{hash},window:{scrollTo:value=>scrolls.push(value)},addEventListener:(k,f)=>events[k]=f};
 vm.runInNewContext(source,context);return {context,pages,links,events,scrolls};
}
test('webpage sidebar shows one view, resets scrolling and preserves edits without reload',()=>{
 const h=harness();assert.deepEqual(h.pages.map(p=>p.hidden),[false,true,true,true]);
 for(let i=1;i<4;i++){
  let prevented=false;h.links[i].click({preventDefault(){prevented=true;}});assert(prevented);
  assert.equal(h.pages.filter(p=>!p.hidden).length,1);assert.equal(h.pages[i].hidden,false);
  assert.equal(h.links[i].attributes['aria-current'],'page');assert.equal(h.links[0].attributes['aria-current'],undefined);
  assert.equal(h.pages[1].edit,'keep this draft');assert.equal(h.scrolls.at(-1).top,0);
 }
 h.context.DashboardPages.show('home');assert.equal(h.pages[0].hidden,false);
});
test('legacy bookmarks and browser back route to the appropriate isolated webpage views',()=>{
 const h=harness('#ai');assert.equal(h.pages[1].hidden,false);
 h.context.location.hash='#saved';h.events.hashchange();assert.equal(h.pages[2].hidden,false);
 h.context.location.hash='#dashboard-settings';h.events.hashchange();assert.equal(h.pages[3].hidden,false);
 h.context.location.hash='#unknown';h.events.hashchange();assert.equal(h.pages[0].hidden,false);
});

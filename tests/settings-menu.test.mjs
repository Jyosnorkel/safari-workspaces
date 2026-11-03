// Fake DOM event regressions; not Safari execution evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const popup=readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8');
const menuSource=popup.slice(popup.indexOf('function popupSettingsMenus(){'),popup.indexOf('// Popup navigation and local preferences;'));
function harness(){
  const documentEvents={},windowEvents={};let focused,focusOptions;
  const notify=(events,type,event)=>{for(const listener of events[type] || [])listener(event);};
  class Node{
    constructor(){this.children=[];this.events={};this.attributes={};this.style={};this.hidden=false;this.scrollTop=0;this.clientHeight=114;this.scrollHeight=114;this.offsetHeight=34;this.offsetTop=0;this.classList={toggle(){}};this.rect={left:24,top:228,bottom:270,width:417};}
    append(...nodes){for(const node of nodes){node.parent=this;node.offsetTop=this.children.length*34+4;this.children.push(node);}}
    after(node){this.sibling=node;}
    setAttribute(name,value){this.attributes[name]=value;}
    removeAttribute(name){delete this.attributes[name];}
    addEventListener(type,fn){(this.events[type] ||= []).push(fn);}
    dispatchEvent(event){notify(this.events,event.type,event);}
    contains(node){return this===node || this.children.some(child=>child.contains(node));}
    getBoundingClientRect(){return this.rect;}
    focus(options){focused=this;focusOptions=options;notify(documentEvents,'focusin',{target:this});}
  }
  const select=new Node();select.id='setting-theme';select.options=[{value:'system',textContent:'System'},{value:'light',textContent:'Light'},{value:'dark',textContent:'Dark'}];select.selectedIndex=0;
  Object.defineProperty(select,'value',{get(){return this.options[this.selectedIndex].value;},set(value){this.selectedIndex=this.options.findIndex(option=>option.value===value);}});
  select.textContent='SystemLightDark';select.labels=[{textContent:'AppearanceSystemLightDark'}];
  const body=new Node(),pane=new Node();pane.rect={top:72,bottom:600};
  const document={body,createElement:()=>new Node(),querySelectorAll:()=>[select],querySelector:()=>pane,addEventListener:(type,fn)=>(documentEvents[type] ||= []).push(fn)};
  const context={document,window:{addEventListener:(type,fn)=>(windowEvents[type] ||= []).push(fn)},innerHeight:600,Event};
  vm.runInNewContext(menuSource,context);const menus=context.popupSettingsMenus();const button=select.sibling,list=body.children[0];
  const fire=(node,type,event={})=>notify(node.events,type,{target:node,preventDefault(){},stopPropagation(){},...event});
  return {select,button,list,menus,pane,fire,documentEvent:(type,event)=>notify(documentEvents,type,event),resize:()=>notify(windowEvents,'resize',{}),get focused(){return focused;},get focusOptions(){return focusOptions;}};
}
test('mouse opening explicitly focuses trigger; Escape leaves the selected value unchanged',()=>{
  const h=harness();h.fire(h.button,'click');assert.equal(h.list.hidden,false);assert.equal(h.focused,h.button);assert.equal(h.focusOptions.preventScroll,true);
  h.fire(h.button,'keydown',{key:'ArrowDown'});assert.equal(h.select.value,'system');
  h.fire(h.button,'keydown',{key:'Escape'});assert.equal(h.list.hidden,true);assert.equal(h.select.value,'system');
});
test('resize and queued pane scroll reposition an open menu without dismissing it',()=>{
  const h=harness();h.fire(h.button,'click');h.resize();assert.equal(h.list.hidden,false);
  h.button.rect={...h.button.rect,top:210,bottom:252};h.documentEvent('scroll',{target:h.pane});assert.equal(h.list.hidden,false);assert.equal(h.list.style.top,'257px');
  h.documentEvent('scroll',{target:h.list});assert.equal(h.list.hidden,false);
  h.button.rect={...h.button.rect,top:10,bottom:52};h.documentEvent('scroll',{target:h.pane});assert.equal(h.list.hidden,true);
});
test('pointer choice commits once; focus inside menu is allowed; outside and page changes dismiss',()=>{
  const h=harness();let changes=0;h.select.addEventListener('change',()=>changes++);
  h.fire(h.button,'click');h.documentEvent('focusin',{target:h.list.children[1]});assert.equal(h.list.hidden,false);
  h.fire(h.list.children[1],'click');assert.equal(h.select.value,'light');assert.equal(changes,1);assert.equal(h.list.hidden,true);
  h.fire(h.button,'click');h.documentEvent('pointerdown',{target:{}});assert.equal(h.list.hidden,true);
  h.fire(h.button,'click');h.menus.close();assert.equal(h.list.hidden,true);
});

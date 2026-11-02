import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../extension/tab-selection.js',import.meta.url),'utf8');
function harness(){
 const context={};vm.runInNewContext(source,context);const reports=[];
 const selection=context.TabbySelection.create({announce:(count,clear)=>reports.push({count,clear})});selection.setItems([1,2,3,4]);
 const rows=[1,2,3,4].map(id=>{const row={attributes:{},handlers:{},classes:new Set(),setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,f){this.handlers[k]=f;},classList:{toggle(k,on){on?row.classes.add(k):row.classes.delete(k);}}};selection.bind(row,id,()=>opens.push(id));return row;});
 const opens=[];return{selection,rows,reports,opens};
}
test('single/Cmd/Shift selection is separate from opening and respects range anchor/order',()=>{
 const h=harness();h.rows[0].handlers.click({});h.rows[2].handlers.click({metaKey:true});assert.deepEqual(Array.from(h.selection.values()),[1,3]);assert.deepEqual(h.opens,[]);
 h.rows[3].handlers.click({shiftKey:true});assert.deepEqual(Array.from(h.selection.values()),[3,4]);assert.equal(h.rows[3].attributes['aria-pressed'],'true');
 h.rows[2].handlers.dblclick({});assert.deepEqual(h.opens,[3]);
 h.rows[3].handlers.keydown({key:'Enter',preventDefault(){}});assert.deepEqual(h.opens,[3,4]);
 h.rows[3].handlers.keydown({key:'Escape',preventDefault(){}});assert.equal(h.selection.values().length,0);assert.equal(h.reports.at(-1).count,0);
});
test('selected drag batch follows display order, prunes missing identities and ignores nested controls',()=>{
 const h=harness();h.rows[2].handlers.click({});h.rows[0].handlers.click({metaKey:true});assert.deepEqual(Array.from(h.selection.dragIds(3)),[1,3]);
 h.rows[1].handlers.click({target:{tagName:'INPUT'}});assert.deepEqual(Array.from(h.selection.values()),[1,3]);
 h.selection.setItems([2,3,4]);assert.deepEqual(Array.from(h.selection.values()),[3]);assert.deepEqual(Array.from(h.selection.dragIds(2)),[2]);
});

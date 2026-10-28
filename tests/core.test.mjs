import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source = readFileSync(new URL('../extension/core.js', import.meta.url), 'utf8');
const context = vm.createContext({crypto:webcrypto, URL});
vm.runInContext(source, context);
const C = context.WorkspaceCore;
const plain = value => JSON.parse(JSON.stringify(value));
const tab = (id, values={}) => ({id, index:id, windowId:1, title:`Page ${id}`, url:`https://example.com/${id}`, ...values});
const inventory = () => C.inventory([tab(1), tab(2)]);
const response = tabIds => ({groups:[{name:'Research', tabIds, reason:'Related sources'}]});
const snapshot = (tabs=[tab(1)], id=webcrypto.randomUUID(), time='2026-10-28T12:00:00.000Z') => C.snapshot(' Research ', tabs, id, time);

test('HTTP URL eligibility accepts strings only and excludes executable/local schemes', () => {
  for (const url of ['http://localhost:8765/test','https://example.com/a?q=1#anchor']) assert.equal(C.restorable(url),true);
  for (const url of ['javascript:alert(1)','data:text/plain,hello','file:///tmp/a','safari://settings','about:blank',null,{},new URL('https://example.com')]) assert.equal(C.restorable(url),false);
});

test('inventory tolerates malformed entries without making them actionable', () => {
  const result=C.inventory([null, false, [], tab(2,{title:{text:'bad'}}), tab(1,{url:{href:'https://example.com'}})]);
  assert.equal(result.length,2);
  assert.equal(result[0].eligible,false);
  assert.equal(result[0].url,'');
  assert.equal(result[1].title,'Untitled page');
  assert.throws(()=>C.inventory(null),/invalid tab inventory/);
});

test('inventory leaves ambiguous identity and missing order visible but ineligible', () => {
  const input=[tab(2),tab(2),tab(-1),tab(5,{index:undefined}),tab(6,{windowId:undefined})];
  const result=C.inventory(input);
  assert.equal(result.length,5);
  assert(result.every(t=>!t.eligible));
  assert(result.every(t=>/identity or order/.test(t.reason)));
  assert.equal(input[0].id,2);
});

test('inventory rejects unsafe integers and excludes private/pinned tabs from actions', () => {
  const result=C.inventory([tab(1,{incognito:true}),tab(2,{pinned:true}),tab(Number.MAX_SAFE_INTEGER+1),tab(0,{title:'   '})]);
  assert.equal(result.length,3);
  assert.equal(result.find(t=>t.id===0).title,'Untitled page');
  assert.equal(result.filter(t=>t.eligible).length,1);
});

test('snapshot uses stable order, independent persistent IDs and string titles', () => {
  const input=[tab(2,{url:'https://example.com/same',title:8}),tab(1,{url:'https://example.com/same'})];
  const id=webcrypto.randomUUID(); const result=snapshot(input,id);
  assert.equal(result.id,id); assert.equal(result.name,'Research');
  assert.deepEqual(Array.from(result.tabs,t=>t.index),[1,2]);
  assert.equal(result.tabs[1].title,'Untitled page');
  assert.notEqual(result.tabs[0].id,result.tabs[1].id);
  assert.equal(result.tabs[0].url,result.tabs[1].url);
  assert.equal(input[0].index,2);
});

test('snapshot rejects malformed or ambiguous selections before producing recovery data', () => {
  for (const tabs of [[null],[tab(1),tab(1)],[tab(1,{index:undefined})],[tab(1,{windowId:-1})],[tab(1),tab(2,{windowId:2})],[tab(1,{incognito:true})],[tab(1,{pinned:true})],[]]) {
    assert.throws(()=>snapshot(tabs));
  }
  assert.throws(()=>snapshot([tab(1)],'not-a-uuid'),/persistent ID/);
  assert.throws(()=>snapshot([tab(1)],webcrypto.randomUUID(),'not a date'),/timestamp/);
  assert.throws(()=>snapshot(Array.from({length:501},(_,i)=>tab(i))),/500/);
});

test('AI response accepts integer and canonical decimal IDs with explicit ungrouped remainder', () => {
  const input=inventory(); const before=plain(input);
  const result=C.suggestions(response(['1']),input);
  assert.deepEqual(plain(result.groups[0].tabIds),['1']);
  assert.deepEqual(plain(result.ungrouped),['2']);
  assert.deepEqual(plain(C.suggestions({groups:[]},input).ungrouped),['1','2']);
  assert.deepEqual(plain(C.suggestions(response([1,'2']),input).groups[0].tabIds),['1','2']);
  assert.deepEqual(plain(input),before);
});

test('AI response cannot coerce an object, array, boolean or noncanonical ID', () => {
  let coerced=false;
  const object={toString(){coerced=true;return '1';}};
  for(const id of [object,[1],true,null,'01','1.0',' 1','1e0',-1,1.1,Number.MAX_SAFE_INTEGER+1,'9007199254740992']) {
    assert.throws(()=>C.suggestions(response([id]),inventory()),/invalid tab ID/);
  }
  assert.equal(coerced,false);
});

test('unknown IDs, duplicate assignments and protected tabs reject the full suggestion', () => {
  assert.throws(()=>C.suggestions(response([3]),inventory()),/invented/);
  assert.throws(()=>C.suggestions(response([1,1]),inventory()),/once/);
  assert.throws(()=>C.suggestions({groups:[{name:'A',tabIds:[1]},{name:'B',tabIds:['1']}]},inventory()),/once/);
  const protectedTabs=C.inventory([tab(1),tab(2,{pinned:true})]);
  assert.throws(()=>C.suggestions(response([2]),protectedTabs),/invented/);
});

test('malformed groups and explanations fail without partial accepted assignments', () => {
  for(const raw of [null,[],{}, {groups:null}, {groups:[null]}, {groups:[[]]}, {groups:[{name:' ',tabIds:[1]}]}, {groups:[{name:'A',tabIds:[]}]}, {groups:[{name:'A',tabIds:[1],reason:{text:'bad'}}]}]) {
    assert.throws(()=>C.suggestions(raw,inventory()),/invalid/);
  }
  assert.throws(()=>C.suggestions({groups:Array.from({length:31},()=>({name:'A',tabIds:[1]}))},inventory()),/invalid group list/);
  assert.throws(()=>C.suggestions({groups:new Array(1)},inventory()),/invalid group/);
  const result=C.suggestions({groups:[{name:'  A  ',tabIds:[1],reason:'x'.repeat(500)}]},inventory());
  assert.equal(result.groups[0].name,'A'); assert.equal(result.groups[0].reason.length,240);
});

test('AI input strips URL credentials/query/fragment but retains necessary title/path context', () => {
  const input=C.inventory([tab(1,{url:'https://username:password@example.com/task/report?token=secret#section', title:'x'.repeat(300)}),tab(2,{pinned:true})]);
  const before=plain(input); const result=C.aiInventory(input);
  assert.equal(result.length,1); assert.equal(result[0].url,'https://example.com/task/report');
  assert.equal(result[0].title.length,250); assert.equal(result[0].id,'1');
  assert.deepEqual(plain(input),before);
});

test('AI helpers reject forged eligible entries and duplicated scanned IDs', () => {
  for(const input of [[{...tab(1),eligible:true}, {...tab(1),eligible:true}], [{...tab(1),incognito:true,eligible:true}], [{...tab(1),url:'javascript:alert(1)',eligible:true}]]) {
    assert.throws(()=>C.aiInventory(input),/invalid/);
    assert.throws(()=>C.suggestions({groups:[]},input),/invalid/);
  }
  const result=C.aiInventory([{...tab(1),eligible:true,title:undefined}]);
  assert.equal(result[0].title,'Untitled page');
});

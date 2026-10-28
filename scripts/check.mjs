import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
const inspectSource = source.split('const api = globalThis.browser;')[0];
let badge;
const document = {
  title: 'Test page', body: { innerText: 'A test page with five words' },
  getElementById: () => badge || null,
  querySelectorAll: selector => Array(selector === 'a[href]' ? 2 : 3),
  documentElement: { appendChild: node => { badge = node; } },
  createElement: () => ({ append() {}, appendChild() {}, addEventListener() {},
    attachShadow: () => ({ append() {} }), remove: () => { badge = null; } })
};
const context = vm.createContext({document, location: {host: 'localhost:8765'}});
vm.runInContext(inspectSource, context);
const inspect = value => vm.runInContext(`inspectPage(${value})`, context);
assert.equal(inspect(false).words, 6);
assert.equal(inspect(false).headings, 3);
assert.equal(inspect(false).links, 2);
assert.equal(inspect(false).badgeVisible, false);
assert.equal(inspect(true).badgeVisible, true);
assert.equal(inspect(false).badgeVisible, true);
assert.equal(inspect(true).badgeVisible, false);
document.body.innerText = '   ';
assert.equal(inspect(false).words, 0);
console.log('PASS: page statistics, empty page, badge insertion, persistence and removal');

// Ensure the preview cannot claim a live connection outside Safari.
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {textContent: '', addEventListener() {}, disabled: true});
  return elements.get(id);
};
vm.runInNewContext(source, { document: {getElementById: element}, console });
assert.match(element('page-title').textContent, /Safari/);
assert.equal(element('toggle').disabled, true);
console.log('PASS: normal-tab preview reports unavailable API and disables injection');

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyProject,verifyResources} from '../scripts/verify-extension-package.mjs';

test('Xcode project has unique object IDs; duplicate resource IDs are rejected',()=>{
  verifyProject();
  const object='AA0000000000000000000009 /* resource */ = {isa = PBXFileReference; };';
  assert.throws(()=>verifyProject(`${object}\n${object}`),/Duplicate Xcode object ID/);
});
test('package verification rejects missing and stale files, including nested resources',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'tabby-package-'));
  try{
    const source=path.join(directory,'source'),destination=path.join(directory,'package');
    mkdirSync(path.join(source,'icons'),{recursive:true});mkdirSync(path.join(destination,'icons'),{recursive:true});
    writeFileSync(path.join(source,'popup.css'),'body{color:blue}');
    writeFileSync(path.join(source,'icons','icon.png'),'icon');
    assert.throws(()=>verifyResources(source,destination),/Missing packaged extension file/);
    writeFileSync(path.join(destination,'icons','icon.png'),'icon');writeFileSync(path.join(destination,'popup.css'),'old');
    assert.throws(()=>verifyResources(source,destination),/Stale packaged extension file/);
    writeFileSync(path.join(destination,'popup.css'),'body{color:blue}');
    assert.equal(verifyResources(source,destination),2);
  }finally{rmSync(directory,{recursive:true,force:true});}
});


test('build guard refuses registered output but permits a separate staging path',async()=>{
  const {checkBuildTarget}=await import('../scripts/check-build-target.mjs');
  const app=path.join(tmpdir(),'tabby-registered','Tabby.app');
  const registration=` Path = ${app}/Contents/PlugIns/Tabby.appex\n`;
  assert.throws(()=>checkBuildTarget(app,registration),/Refusing to overwrite/);
  assert.doesNotThrow(()=>checkBuildTarget(app+'-staged',registration));
});

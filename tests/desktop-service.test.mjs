import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {desktopConfig, createDesktopService} from '../server/start-desktop.mjs';
import {createConnection} from '../server/connection.mjs';
import {UsageGuard} from '../server/usage-guard.mjs';

const fakeKey = 'FICTIONAL-TEST-KEY-NEVER-VALID';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'safari-desktop-test-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  return directory;
}
function provider() {
  return {id:'meta', remoteTokenCount:true,
    countInputTokens(){throw new Error('No provider calls allowed');},
    generate(){throw new Error('No provider calls allowed');}};
}
async function close(result) {await new Promise(resolve => result.server.close(resolve));}

test('desktop configuration rejects extra fields and fixes approved defaults', () => {
  const env = desktopConfig({apiKey:fakeKey,liveEnabled:false});
  assert.deepEqual(Object.keys(env).sort(), ['AI_LIVE_ENABLED','META_API_KEY','META_API_MODEL','META_API_PROVIDER_ID'].sort());
  assert.equal(env.AI_LIVE_ENABLED, 'false');
  for (const value of [null,[],{}, {apiKey:fakeKey,liveEnabled:'true'},
    {apiKey:fakeKey,liveEnabled:true,AI_REQUESTS_PER_DAY:999},
    {apiKey:'x\nsecret',liveEnabled:true},{apiKey:'x'.repeat(8193),liveEnabled:true}]) {
    assert.throws(() => desktopConfig(value));
  }
});

test('desktop bootstrap preserves token and existing shared usage without inference', async t => {
  const directory = await fixture(t), path = join(directory,'connection.json');
  const connection = await createConnection(path,'safari-web-extension://11111111-1111-1111-1111-111111111111');
  await new UsageGuard({statePath:join(directory,'usage.json')}).run(async()=>{});
  const beforeConnection = await readFile(path,'utf8');
  const beforeUsage = await readFile(join(directory,'usage.json'),'utf8');
  const result = await createDesktopService({apiKey:fakeKey,liveEnabled:true},{directory,port:0,provider:provider()});
  try {
    assert.equal(result.token,connection.token);
    const status = await result.service.status();
    assert.equal(status.attemptsToday,1); assert.equal(status.perMinute,10); assert.equal(status.perDay,200);
    assert.equal(status.maxOutputTokens,2048); assert.equal(status.configured,true);
    assert.equal(await readFile(path,'utf8'),beforeConnection);
    assert.equal(await readFile(join(directory,'usage.json'),'utf8'),beforeUsage);
  } finally {await close(result);}
});

test('fresh disabled desktop setup creates private pairing and cannot infer', async t => {
  const directory = await fixture(t);
  const result = await createDesktopService({apiKey:'',liveEnabled:false},{directory,port:0,provider:provider()});
  try {
    assert.match(result.token,/^[a-f0-9]{64}$/);
    assert.equal((await result.service.status()).configured,false);
    await assert.rejects(result.service.suggest([{id:1,title:'Fake',url:'https://example.com'}],{consent:true}),{code:'not_configured'});
  } finally {await close(result);}
});

test('corrupt pairing and usage are blocked without replacement', async t => {
  const directory = await fixture(t), path = join(directory,'connection.json');
  await writeFile(path,'broken',{mode:0o600});
  await assert.rejects(createDesktopService({apiKey:fakeKey,liveEnabled:false},{directory,port:0,provider:provider()}));
  assert.equal(await readFile(path,'utf8'),'broken');
  await rm(path);
  await createConnection(path,'safari-web-extension://11111111-1111-1111-1111-111111111111');
  await writeFile(join(directory,'usage.json'),'broken',{mode:0o600});
  await assert.rejects(createDesktopService({apiKey:fakeKey,liveEnabled:true},{directory,port:0,provider:provider()}));
  assert.equal(await readFile(join(directory,'usage.json'),'utf8'),'broken');
});

async function child(t, directory, payload) {
  const moduleURL = new URL('../server/start-desktop.mjs',import.meta.url).href;
  const script = `import {runDesktop} from ${JSON.stringify(moduleURL)}; await runDesktop({directory:${JSON.stringify(directory)},port:0});`;
  const proc = spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});
  t.after(()=>{if(proc.exitCode===null)proc.kill('SIGTERM');});
  const completion = once(proc,'exit');
  let stdout = '', stderr = '';
  const first = new Promise(resolve => proc.stdout.on('data',chunk=>{stdout+=chunk; if(stdout.includes('\n'))resolve(JSON.parse(stdout.split('\n')[0]));}));
  proc.stderr.on('data',chunk=>{stderr+=chunk;});
  proc.stdin.on('error',()=>{});
  proc.stdin.write(payload);
  return {proc,completion,first,output:()=>({stdout,stderr})};
}

test('private pipe starts without provider access and EOF releases owned listener', {timeout:10000}, async t => {
  const directory = await fixture(t);
  const c = await child(t,directory,JSON.stringify({apiKey:fakeKey,liveEnabled:false})+'\n');
  const ready = await c.first;
  assert.equal(ready.type,'ready');assert.match(ready.token,/^[a-f0-9]{64}$/);
  c.proc.stdin.end();
  assert.equal((await c.completion)[0],0);
  assert.equal(c.output().stderr,''); assert.ok(!c.output().stdout.includes(fakeKey));
});

test('malformed and oversized private pipe input fails with fixed safe diagnostics', {timeout:10000}, async t => {
  for (const payload of [`{"apiKey":"${fakeKey}",bad}\n`,fakeKey.repeat(800)+'\n']) {
    const directory = await fixture(t), c = await child(t,directory,payload);
    assert.equal((await c.first).type,'error');
    assert.equal((await c.completion)[0],1);
    assert.ok(!c.output().stdout.includes(fakeKey)); assert.equal(c.output().stderr,'');
    await assert.rejects(readFile(join(directory,'connection.json')),{code:'ENOENT'});
  }
});


test('occupied service port is left running and pairing is preserved', async t => {
  const directory = await fixture(t);
  const result = await createDesktopService({apiKey:'',liveEnabled:false},{directory,port:0,provider:provider()});
  const before = await readFile(join(directory,'connection.json'),'utf8');
  try {
    await assert.rejects(createDesktopService({apiKey:'',liveEnabled:false},{directory,port:result.address.port,provider:provider()}),{code:'EADDRINUSE'});
    const response = await fetch(`http://127.0.0.1:${result.address.port}/v1/connect`,{method:'POST',headers:{
      Origin:'safari-web-extension://22222222-2222-2222-2222-222222222222',
      Authorization:`Bearer ${result.token}`,'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200);
    assert.equal((await response.json()).usage.configured,false);
    const after = JSON.parse(await readFile(join(directory,'connection.json'),'utf8'));
    assert.equal(after.token,JSON.parse(before).token);
  } finally {await close(result);}
});

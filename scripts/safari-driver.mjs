import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {access} from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
export class WebDriverError extends Error {
  constructor(command, response, status) {
    super(`${command}: ${response?.error || status}: ${response?.message || 'WebDriver request failed'}`);
    this.name='WebDriverError'; this.code=response?.error; this.status=status;
  }
}
async function freePort() {
  const server=createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}

/** Owns one spawned driver and one fresh Safari automation session, never a normal window. */
export class SafariDriver {
  constructor(endpoint, {fetchImpl=fetch}={}) {
    this.endpoint=endpoint; this.fetch=fetchImpl;
    this.sessionId=null; this.extensionId=null; this.process=null; this.logs='';
  }
  static async start({binary='/usr/bin/safaridriver',timeout=20000}={}) {
    if(process.platform!=='darwin') throw new Error('Safari E2E requires macOS and Safari 26 or later.');
    await access(binary);
    const port=await freePort();
    const driver=new SafariDriver(`http://127.0.0.1:${port}`);
    driver.process=spawn(binary,['--port',String(port)],{stdio:['ignore','pipe','pipe']});
    driver.process.on('error',error=>{driver.spawnError=error;});
    for(const stream of [driver.process.stdout,driver.process.stderr]) stream.on('data',chunk=>{driver.logs=(driver.logs+chunk.toString()).slice(-8000);});
    try {
      await driver.waitFor(async()=>{
        if(driver.spawnError) throw driver.spawnError;
        if(driver.process.exitCode!==null) throw new Error(`SafariDriver exited before startup: ${driver.logs}`);
        try {await driver.request('GET','/status',undefined,1000);return true;}catch{return false;}
      },{timeout,label:'SafariDriver startup'});
      // No --enable or OS preference writes. Report setup errors for the user to resolve.
      const session=await driver.request('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari'}}},timeout);
      if(typeof session?.sessionId!=='string') throw new Error('SafariDriver did not return an owned session ID.');
      driver.sessionId=session.sessionId; driver.capabilities=session.capabilities;
      return driver;
    } catch(error) {await driver.close();throw error;}
  }
  async request(method, route, body,timeout=20000) {
    const response=await this.fetch(`${this.endpoint}${route}`,{method,headers:{'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeout)});
    const payload=await response.json();
    if(!response.ok || payload.value?.error) throw new WebDriverError(`${method} ${route}`,payload.value,response.status);
    return payload.value;
  }
  command(method,route,body,timeout) {
    if(!this.sessionId) throw new Error('No owned Safari automation session.');
    return this.request(method,`/session/${encodeURIComponent(this.sessionId)}${route}`,body,timeout);
  }
  async install(extensionPath) {
    const directory=path.resolve(extensionPath);await access(path.join(directory,'manifest.json'));
    // WECG WebDriver Classic: type=path uses the path property (not value).
    const installed=await this.command('POST','/webextension',{type:'path',path:directory});
    // Safari 26.6 wraps the runtime identifier in an `extension` property.
    const id=typeof installed==='string'?installed:installed?.extension;
    if(typeof id!=='string' || !id) throw new Error('Extension installation returned no identifier.');
    this.extensionId=id;return id;
  }
  navigate(url) {return this.command('POST','/url',{url});}
  execute(script,args=[]) {return this.command('POST','/execute/sync',{script,args});}
  executeAsync(script,args=[]) {return this.command('POST','/execute/async',{script,args});}
  async find(selector) {return this.command('POST','/element',{using:'css selector',value:selector});}
  async click(selector) {
    const element=await this.find(selector);
    const id=element['element-6066-11e4-a52e-4f735466cecf'];
    return this.command('POST',`/element/${encodeURIComponent(id)}/click`,{});
  }
  async screenshot() {return this.command('GET','/screenshot');}
  async waitFor(check,{timeout=10000,interval=100,label='condition'}={}) {
    const start=Date.now();let value;
    while(Date.now()-start<timeout){value=await check();if(value)return value;await pause(interval);}
    throw new Error(`Timed out waiting for ${label} after ${timeout}ms.`);
  }
  async close() {
    // Never quit the Safari app, delete a profile, or send commands to unowned sessions.
    if(this.sessionId) {
      if(this.extensionId) await this.command('DELETE',`/webextension/${encodeURIComponent(this.extensionId)}`).catch(()=>{});
      await this.command('DELETE','').catch(()=>{});
      this.sessionId=null;this.extensionId=null;
    }
    if(this.process && this.process.exitCode===null) {
      this.process.kill('SIGTERM');
      const child=this.process;
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(1500)]);
      if(child.exitCode===null) child.kill('SIGKILL');
    }
    this.process=null;
  }
}

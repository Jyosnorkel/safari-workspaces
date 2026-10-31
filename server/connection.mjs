import {mkdir,open,readFile,stat,rename,unlink} from 'node:fs/promises';
import {dirname, isAbsolute, resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {validClientOrigin} from './loopback.mjs';
import {UsageError} from './usage-guard.mjs';
export function resolveStateDirectory(override, home = homedir()) {
  if (override !== undefined && override !== '') {
    if (typeof override !== 'string' || !isAbsolute(override)) throw new UsageError('invalid_config','AI_STATE_DIR must be an absolute path shared by all service copies.');
    return resolve(override);
  }
  return resolve(home,'Library','Application Support','Safari Workspaces','AI');
}
export async function readConnection(path) {
  const metadata=await stat(path);
  if((metadata.mode & 0o077)!==0) throw new UsageError('invalid_config','Local connection file must be readable only by its owner (chmod 600).');
  const value=JSON.parse(await readFile(path,'utf8'));
  if(!value||!validClientOrigin(value.allowedOrigin)||typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token)) throw new UsageError('invalid_config','Local connection configuration is invalid.');
  return value;
}
export async function createConnection(path,allowedOrigin) {
  if(!validClientOrigin(allowedOrigin)) throw new UsageError('invalid_config','Use the exact Safari extension origin shown in the dashboard.');
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  try {
    const file=await open(path,'wx',0o600);
    try{await file.writeFile(JSON.stringify({allowedOrigin,token:randomBytes(32).toString('hex')},null,2));await file.sync();}finally{await file.close();}
  }catch(error){if(error.code!=='EEXIST')throw error;}
  const value=await readConnection(path);
  if(value.allowedOrigin!==allowedOrigin)throw new UsageError('invalid_config','The existing connection is paired to a different origin. Stop only the local AI service, then run node server/pair.mjs --re-pair with the new dashboard origin. Your token and usage ledger will be preserved.');
  return value;
}

// Explicit user action: replace one allowed origin, preserving the existing token/ledger.
export async function rePairConnection(path,allowedOrigin,{expectedToken} = {}) {
  if(!validClientOrigin(allowedOrigin)) throw new UsageError('invalid_config','Use the exact Safari extension origin shown in the dashboard.');
  const lockPath=`${path}.repair.lock`,temporary=`${path}.${randomUUID()}.tmp`;
  let lock,file;
  try {
    try {lock=await open(lockPath,'wx',0o600);}
    catch(error) {if(error.code==='EEXIST')throw new UsageError('invalid_config','Another pairing update is in progress.');throw error;}
    const current=await readConnection(path);
    const tokenMatches=value=>typeof expectedToken==='string'&&Buffer.byteLength(value)===Buffer.byteLength(expectedToken)&&timingSafeEqual(Buffer.from(value),Buffer.from(expectedToken));
    if(expectedToken!==undefined&&!tokenMatches(current.token)) throw new UsageError('connection_changed','The local connection changed. Re-enter the local token and connect again.');
    if(current.allowedOrigin===allowedOrigin)return current;
    const next={...current,allowedOrigin};
    file=await open(temporary,'wx',0o600);
    await file.writeFile(JSON.stringify(next,null,2));await file.sync();await file.close();file=null;
    // Every cooperating repair holds this lock. Re-read before commit as well,
    // so an intervening token replacement is not silently overwritten.
    if(expectedToken!==undefined&&!tokenMatches((await readConnection(path)).token)) throw new UsageError('connection_changed','The local connection changed. Re-enter the local token and connect again.');
    await rename(temporary,path);
    const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
    const stored=await readConnection(path);
    if(stored.allowedOrigin!==allowedOrigin||stored.token!==current.token)throw new UsageError('invalid_config','Pairing update could not be verified.');
    return stored;
  } finally {
    if(file)await file.close().catch(()=>{});
    await unlink(temporary).catch(()=>{});
    if(lock){await lock.close();await unlink(lockPath);}
  }
}

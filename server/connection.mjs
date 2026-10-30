import {mkdir,open,readFile,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {validClientOrigin} from './loopback.mjs';
import {UsageError} from './usage-guard.mjs';
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
  if(value.allowedOrigin!==allowedOrigin)throw new UsageError('invalid_config','The existing connection is paired to a different origin. Keep the usage ledger and explicitly replace only the connection file to re-pair.');
  return value;
}

import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {createConnection} from './connection.mjs';
const origin=process.argv[2];
const root=resolve(homedir(),'Library','Application Support','Safari Workspaces','AI');
const directory=resolve(process.env.AI_STATE_DIR||root);
try {
  await createConnection(resolve(directory,'connection.json'),origin);
  console.log(`Local pairing is ready. Copy the token from ${resolve(directory,'connection.json')} into the extension's local-service field. Keep this file private.`);
}catch {console.error('Pairing failed. Pass one exact allowed extension origin and check the private connection-file permissions. Existing pairing files are never overwritten.');process.exitCode=1;}

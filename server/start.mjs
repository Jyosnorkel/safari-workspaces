import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {createAIService} from './ai-service.mjs';
import {createMetaProvider} from './meta-provider.mjs';
import {createLoopbackServer} from './loopback.mjs';
import {readConnection} from './connection.mjs';
const root=resolve(homedir(),'Library','Application Support','Safari Workspaces','AI');
const directory=resolve(process.env.AI_STATE_DIR||root);
try {
  const connection=await readConnection(resolve(directory,'connection.json'));
  const service=createAIService({env:process.env,provider:createMetaProvider(),statePath:resolve(directory,'usage.json')});
  const {server,listen}=createLoopbackServer({service,...connection});
  const address=await listen();
  console.log(`Safari Workspaces local AI service listening at http://127.0.0.1:${address.port}. No inference runs until an authenticated, consented suggestion request is made.`);
  const close=()=>server.close(()=>process.exit(0));process.once('SIGINT',close);process.once('SIGTERM',close);
}catch {console.error('Local AI service could not start. Check pairing, private file permissions, configuration and port 8788. No secrets are printed.');process.exitCode=1;}

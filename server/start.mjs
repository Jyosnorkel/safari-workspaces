import {resolve} from 'node:path';
import {createAIService} from './ai-service.mjs';
import {createMetaProvider} from './meta-provider.mjs';
import {createLoopbackServer} from './loopback.mjs';
import {readConnection, resolveStateDirectory} from './connection.mjs';
try {
  const directory=resolveStateDirectory(process.env.AI_STATE_DIR);
  const connection=await readConnection(resolve(directory,'connection.json'));
  const service=createAIService({env:process.env,provider:createMetaProvider(),statePath:resolve(directory,'usage.json')});
  const {server,listen}=createLoopbackServer({service,...connection});
  const address=await listen();
  console.log(`Safari Workspaces local AI service listening at http://127.0.0.1:${address.port}. No inference runs until an authenticated, consented suggestion request is made.`);
  const close=()=>server.close(()=>process.exit(0));process.once('SIGINT',close);process.once('SIGTERM',close);
}catch {console.error('Local AI service could not start. Check pairing, private file permissions, configuration and port 8788. No secrets are printed.');process.exitCode=1;}

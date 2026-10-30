import {resolve} from 'node:path';
import {createConnection,rePairConnection,resolveStateDirectory} from './connection.mjs';
import {UsageError} from './usage-guard.mjs';
const args=process.argv.slice(2),replace=args[0]==='--re-pair';
try {
  if(args.length!==(replace?2:1)||(!replace&&args[0].startsWith('--')))throw new UsageError('invalid_config','Usage: node server/pair.mjs [--re-pair] <exact-dashboard-origin>');
  const origin=args[replace?1:0],directory=resolveStateDirectory(process.env.AI_STATE_DIR);
  const path=resolve(directory,'connection.json');
  await (replace?rePairConnection:createConnection)(path,origin);
  console.log(replace?'Pairing origin updated. Your existing token and API usage ledger are unchanged. Restart only the local AI service; Safari can stay open.':`Local pairing is ready. Copy the token from ${path} into the extension's local-service field. Keep this file private.`);
}catch(error) {
  console.error(error instanceof UsageError?error.message:'Pairing failed. Check the private connection file and its permissions. No secrets are printed.');
  process.exitCode=1;
}

import {spawnSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const directory of ['extension','server']) {
 for(const file of readdirSync(path.join(root,directory)).filter(f=>/\.m?js$/.test(f))){
  const result=spawnSync(process.execPath,['--check',path.join(root,directory,file)],{stdio:'inherit'});
  if(result.status) process.exit(result.status);
 }
}
const manifest=JSON.parse(readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
for(const file of [...manifest.background.scripts,manifest.action.default_popup]) readFileSync(path.join(root,'extension',file));
const tests=spawnSync(process.execPath,['--test',...readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.mjs')).map(f=>path.join(root,'tests',f))],{cwd:root,stdio:'inherit'});
process.exit(tests.status??1);

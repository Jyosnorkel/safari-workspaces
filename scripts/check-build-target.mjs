// Do not replace a registered Safari extension while the browser may still use it.
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const canonical=value=>{try{return realpathSync(value);}catch{return path.resolve(value);}};
export function checkBuildTarget(app,registration){
  const target=canonical(app);
  for(const line of registration.split('\n')){
    const match=line.match(/^\s*Path\s*=\s*(.+?)\s*$/);
    if(!match)continue;
    const extension=canonical(match[1]);
    if(extension===target || extension.startsWith(target+path.sep)){
      throw Error('Refusing to overwrite a registered Safari extension. Build to a separate staging directory, then arrange a deliberate extension update.');
    }
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(!process.argv[2])throw Error('Pass the intended app output path.');
    let registration;
    try{registration=execFileSync('/usr/bin/pluginkit',['-mAvvv','-p','com.apple.Safari.web-extension'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
    catch{throw Error('Cannot inspect Safari extension registration; refusing to build over an unknown installation.');}
    checkBuildTarget(process.argv[2],registration);
  }catch(error){console.error(error.message);process.exitCode=1;}
}

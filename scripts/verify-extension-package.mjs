// Fail builds on missing resources, stale copies, or ambiguous Xcode object IDs.
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const project=path.join(root,'native/Safari Dev Lab/Safari Dev Lab.xcodeproj/project.pbxproj');
export function verifyProject(text=readFileSync(project,'utf8')) {
  const seen=new Set();
  for(const match of text.matchAll(/^\s*([A-F0-9]{24})\s*\/\*[^\n]*?\*\/\s*=\s*\{/gm)){
    if(seen.has(match[1]))throw Error(`Duplicate Xcode object ID: ${match[1]}`);
    seen.add(match[1]);
  }
  if(!seen.size)throw Error('No Xcode objects found.');
}
export function verifyResources(source,destination) {
  let count=0;
  for(const entry of readdirSync(source,{withFileTypes:true})){
    const from=path.join(source,entry.name),to=path.join(destination,entry.name);
    if(entry.isDirectory())count+=verifyResources(from,to);
    else {
      let actual;
      try{actual=readFileSync(to);}catch{throw Error(`Missing packaged extension file: ${entry.name}`);}
      if(!readFileSync(from).equals(actual))throw Error(`Stale packaged extension file: ${entry.name}`);
      count++;
    }
  }
  return count;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  verifyProject();
  if(process.argv[2]){
    const resources=path.resolve(process.argv[2],'Contents/PlugIns/Safari Dev Lab Extension.appex/Contents/Resources');
    console.log(`Verified ${verifyResources(path.join(root,'extension'),resources)} packaged extension files against source.`);
  }else console.log('Xcode object IDs are unique.');
}

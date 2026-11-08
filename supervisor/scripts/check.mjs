import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const paths=['src','tests','public','scripts'];let count=0;
for(const directory of paths){for(const file of await readdir(directory)){if(!/\.(mjs|js)$/.test(file))continue;const child=spawnSync(process.execPath,['--check',directory+'/'+file],{encoding:'utf8'});if(child.status!==0){process.stderr.write(child.stderr);process.exit(1);}count++;}}
console.log(JSON.stringify({syntaxFiles:count,ok:true}));

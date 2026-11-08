import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const files = [];
for (const directory of ['src', 'tests', 'scripts', 'public']) for (const entry of await readdir(directory)) if (/\.(mjs|js)$/.test(entry)) files.push(`${directory}/${entry}`);
for (const file of files) { const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status || 1); }
console.log(`Syntax checked ${files.length} JavaScript files.`);

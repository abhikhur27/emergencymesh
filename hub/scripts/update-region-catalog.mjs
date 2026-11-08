import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dataPath } from '../src/config.mjs';
import { readOfficialBuildingCatalog, publicRegionWithCatalog, upgradeRegionCatalog } from '../src/region.mjs';
import { writeJsonAtomic } from '../src/atomic-json.mjs';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--data' && args[i + 1]) { i++; continue; }
  if (!['--apply', '--write-public'].includes(args[i])) throw new Error('Use --data <directory>, --apply, or --write-public');
}
if (args.includes('--write-public')) {
  if (args.includes('--apply') || args.includes('--data')) throw new Error('Public catalog generation and private migration are separate operations');
  const file = fileURLToPath(new URL('../../regions/utd-ecsw.json', import.meta.url));
  const catalog = await readOfficialBuildingCatalog(); const base = JSON.parse(await readFile(file, 'utf8'));
  await writeJsonAtomic(file, publicRegionWithCatalog(base, catalog));
  console.log(JSON.stringify({ publicCatalogUpdated: true, version: catalog.metadata.version, landmarks: catalog.landmarks.length, privateFilesTouched: false }));
} else {
  const at = args.indexOf('--data');
  const result = await upgradeRegionCatalog(dataPath(at >= 0 ? args[at + 1] : undefined), { apply: args.includes('--apply') });
  console.log(JSON.stringify({ operation: args.includes('--apply') ? 'explicit-catalog-migration' : 'catalog-migration-dry-run', ...result }, null, 2));
}

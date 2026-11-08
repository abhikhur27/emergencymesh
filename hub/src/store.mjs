import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export class IncidentStore {
  constructor(directory) { this.directory = directory; this.file = join(directory, 'incidents.json'); this.state = { version: 1, nextSequence: 1, incidents: [] }; }
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (value.version !== 1 || !Number.isInteger(value.nextSequence) || !Array.isArray(value.incidents) || value.incidents.length > 4096) throw new Error('Invalid incident store');
      this.state = value;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  list() { return structuredClone(this.state.incidents); }
  get(id) { return this.state.incidents.find(item => item.id === id); }
  reserveSequence() {
    if (this.state.nextSequence >= 0xffffffff) throw new Error('Hub sequence exhausted; reprovision required');
    return this.state.nextSequence++;
  }
  async persist() {
    const temporary = join(this.directory, `.incidents-${randomBytes(6).toString('hex')}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(this.state)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    // The core serializes all store transactions. Rename replaces atomically on supported local filesystems.
    await rename(temporary, this.file);
  }
}

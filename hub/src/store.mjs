import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MAX_CONTROL_RECORDS, MAX_QUESTIONS_PER_INCIDENT } from './followup.mjs';

function messagingState(value) {
  if (value === undefined) return { version: 1, capabilities: {}, controls: [], transmissions: [] };
  if (!value || value.version !== 1 || !value.capabilities || typeof value.capabilities !== 'object' || Array.isArray(value.capabilities) || !Array.isArray(value.controls) || value.controls.length > MAX_CONTROL_RECORDS || Object.keys(value.capabilities).length > MAX_CONTROL_RECORDS) throw new Error('Invalid messaging store');
  for (const [identity, capability] of Object.entries(value.capabilities)) if (!/^\d+:\d+:\d+$/.test(identity) || capability?.questionReply !== 1 || !Number.isFinite(capability.receivedAt)) throw new Error('Invalid messaging capability');
  for (const record of value.controls) if (!record || !['capability', 'reply'].includes(record.kind) || typeof record.id !== 'string' || !/^[0-9a-f]{64}$/.test(record.digest) || typeof record.receipt !== 'string') throw new Error('Invalid messaging replay record');
  value.transmissions ??= [];
  if (!Array.isArray(value.transmissions) || value.transmissions.length > 8 || value.transmissions.some(at => !Number.isFinite(at) || at < 0)) throw new Error('Invalid messaging transmit budget');
  return value;
}

export class IncidentStore {
  constructor(directory) { this.directory = directory; this.file = join(directory, 'incidents.json'); this.state = { version: 1, nextSequence: 1, incidents: [], messaging: messagingState() }; }
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (value.version !== 1 || !Number.isInteger(value.nextSequence) || !Array.isArray(value.incidents) || value.incidents.length > 4096) throw new Error('Invalid incident store');
      value.messaging = messagingState(value.messaging);
      for (const incident of value.incidents) if (incident.followups !== undefined && (!Array.isArray(incident.followups) || incident.followups.length > MAX_QUESTIONS_PER_INCIDENT)) throw new Error('Invalid follow-up history');
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

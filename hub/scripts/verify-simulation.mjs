import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { IncidentStore } from '../src/store.mjs';
import { HubCore } from '../src/core.mjs';
import { SerialLines } from '../src/serial.mjs';
import { encodeRequest, decodeFrame } from '../src/codec.mjs';
import { simulatedRequest, simulationTransport } from '../src/simulation.mjs';
const directory = await mkdtemp(join(tmpdir(), 'em-verify-'));
try {
  const config = { region: 1, keyId: 1, hubOrigin: 456, key: randomBytes(32) }; const store = await new IncidentStore(directory).load(); const transport = simulationTransport(config); const core = new HubCore({ config, store, transmit: transport.transmit });
  const frame = encodeRequest(simulatedRequest(), { region: 1, keyId: 1, origin: 123, sequence: 1 }, config.key);
  let received; const parser = new SerialLines((bytes, metadata) => { received = core.ingest(bytes, { ...metadata, simulated: true }); });
  parser.push(Buffer.from(`${JSON.stringify({ op: 'rx', frame: frame.toString('base64'), rssi: -83, snr: 7.5 })}\n`));
  const first = await received; assert.equal(core.list().length, 1); assert.equal(transport.transmissions[0].decoded.receipt.status, 1);
  await core.ingest(frame, { simulated: true }); assert.equal(core.list().length, 1); assert.equal(transport.transmissions.length, 2); assert.deepEqual(transport.transmissions[0].frame, transport.transmissions[1].frame);
  await core.review(first.id); assert.equal(transport.transmissions[2].decoded.receipt.status, 2); const exported = core.export(first.id); assert.equal(exported.simulation, true); assert.equal(exported.servicesContacted, false);
  const broken = Buffer.from(frame); broken[40] ^= 1; await assert.rejects(core.ingest(broken), /Authentication/);
  console.log(JSON.stringify({ verified: true, transport: 'software serial+encrypted protocol; no physical radio', frameBytes: frame.length, incidents: core.list().length, receptions: core.list()[0].receptions, authenticatedReceiptStatuses: transport.transmissions.map(item => item.decoded.receipt.status), tamperRejected: true, simulatedExport: true, realServicesContacted: false }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }

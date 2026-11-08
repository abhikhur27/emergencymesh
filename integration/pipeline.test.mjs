import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { encodeRequest, decodeFrame } from '../hub/src/codec.mjs';
import { IncidentStore } from '../hub/src/store.mjs';
import { HubCore } from '../hub/src/core.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
function forwardWithFirmware(frame) {
  const executable = join(directory, '.native', process.platform === 'win32' ? 'mesh-hop.exe' : 'mesh-hop');
  const result = spawnSync(executable, [frame.toString('hex')], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (result.error) throw new Error(`Compile integration/mesh-hop.cpp first: ${result.error.message}`);
  assert.equal(result.status, 0, result.stderr);
  const forwarded = Buffer.from(result.stdout.trim(), 'hex');
  assert.equal(forwarded.length, frame.length);
  assert.equal(forwarded[14], 0);
  return forwarded;
}

test('C++ BLE framing and three modeled forwarding steps preserve encryption; lost receipt recovers after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emergency-integration-'));
  try {
    const key = randomBytes(32);
    const config = { region: 1, keyId: 1, key, hubOrigin: 500 };
    const source = { category: 3, severity: 2, people: 2, flags: 4, createdAt: Math.floor(Date.now()/1000), latitude: 0, longitude: 0, accuracy: 65535, battery: 70, note: 'Synthetic test: two people at blocked trail exit.' };
    const phoneFrame = encodeRequest(source, { region: 1, keyId: 1, origin: 700, sequence: 1, hops: 3 }, key);
    const received = forwardWithFirmware(phoneFrame);
    assert.deepEqual(decodeFrame(received, config).request, source);
    const original = Buffer.from(phoneFrame); original[14] = 0;
    assert.deepEqual(received, original, 'Forwarding must change only mutable hop byte');

    let lostReceipt;
    const first = new HubCore({ config, store: await new IncidentStore(root).load(), transmit: async bytes => { lostReceipt = bytes; } });
    const result = await first.ingest(received, { simulated: true });
    assert.equal(result.duplicate, false);
    assert.equal(first.list().length, 1);
    // Simulate the phone never receiving the first valid receipt, then a hub restart.
    assert.equal(decodeFrame(lostReceipt, config).receipt.status, 1);
    const replies = [];
    const restarted = new HubCore({ config, store: await new IncidentStore(root).load(), transmit: async bytes => replies.push(forwardWithFirmware(bytes)) });
    const duplicate = await restarted.ingest(received, { simulated: true });
    assert.equal(duplicate.duplicate, true);
    assert.equal(restarted.list().length, 1);
    const receipt = decodeFrame(replies[0], config).receipt;
    assert.equal(receipt.requestOrigin, 700); assert.equal(receipt.requestSequence, 1); assert.equal(receipt.status, 1);
    const expectedReceipt = Buffer.from(lostReceipt); expectedReceipt[14] = 0;
    assert.deepEqual(replies[0], expectedReceipt, 'Retry returns identical durable receipt');

    await restarted.review(result.id);
    assert.equal(decodeFrame(replies[1], config).receipt.status, 2);
    const exported = restarted.export(result.id);
    assert.equal(exported.simulation, true); assert.equal(exported.servicesContacted, false);
    assert.deepEqual(exported.incident.request, source);
    const tampered = Buffer.from(received); tampered[30] ^= 1;
    await assert.rejects(restarted.ingest(tampered), /Authentication/);
    assert.equal(restarted.list().length, 1);
  } finally {
    const safeRoot = resolve(root), tempRoot = resolve(tmpdir()) + sep;
    if (!safeRoot.startsWith(tempRoot) || !safeRoot.includes('emergency-integration-')) throw new Error('Refusing unsafe test cleanup');
    await rm(safeRoot, { recursive: true, force: true });
  }
});

// This explicit check creates ONE visibly synthetic ECSW case on the configured supervisor.
// It never opens serial, starts/stops a service, changes live-hub state, or performs human review.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntime, dataPath, validateConfig } from '../src/config.mjs';
import { createDeviceProfile } from '../src/device-keyring.mjs';
import { encodeRequest, decodeFrame } from '../src/codec.mjs';
import { IncidentStore } from '../src/store.mjs';
import { HubCore } from '../src/core.mjs';
import { CoordinationPipeline } from '../src/coordination.mjs';
import { loadRegionProfile } from '../src/region.mjs';
import { runLocalAgent, boundedJson } from '../src/local-agent.mjs';
import { writeJsonAtomic } from '../src/atomic-json.mjs';

const args = process.argv.slice(2);
if (!args.includes('--confirm-live-simulation')) {
  console.error('Explicit --confirm-live-simulation is required: this creates one simulated ECSW case on the configured supervisor.');
  process.exitCode = 2;
} else {
  const dataAt = args.indexOf('--data');
  const receiptFile = fileURLToPath(new URL('../../docs/receipts/coordination-live-20261108.json', import.meta.url));
  const receipt = { schema: 'rescuemesh.coordination-verification.v1', checkedAt: new Date().toISOString(), outcome: 'failed', syntheticCasesCreated: 0, source: 'simulated', actualRadioUsed: false, physicalHubModified: false, humanReviewPerformed: false, realServicesContacted: false, timeoutSeconds: 120 };
  let directory; let pipeline; let stage = 'configuration'; let caseId; let ackAt = null; let modelAt = null; let modelFinishedAt = null; let durableBeforeAck = false; let encryptedAckVerified = false;
  const started = Date.now(); const deadline = started + 115000; const deadlineSignal = AbortSignal.timeout(115000);
  const supervisorEvents = new Map(); const dispatchIds = new Set(); const observedStatuses = new Set();
  const checkedFetch = async (url, options = {}) => {
    const response = await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal });
    if (String(url).includes('/api/hub/updates') && response.ok) {
      const data = await boundedJson(response.clone());
      for (const update of data.updates || []) if (update.caseId === caseId) {
        observedStatuses.add(update.status);
        if (update.allocation?.dispatchId) dispatchIds.add(update.allocation.dispatchId);
        for (const event of update.events || []) supervisorEvents.set(event.seq, { action: event.action, actor: event.actor });
      }
    }
    return response;
  };
  try {
    const runtime = await loadRuntime(dataPath(dataAt >= 0 ? args[dataAt + 1] : undefined));
    assert.ok(runtime.supervisorUrl && runtime.supervisorToken); assert.equal(runtime.hubId, 'ecsw');
    directory = await mkdtemp(join(tmpdir(), 'rescuemesh-live-coordination-'));
    const region = await loadRegionProfile(directory);
    const config = validateConfig({ version: 1, region: 1, keyId: 1, hubOrigin: randomBytes(4).readUInt32LE() || 1, keyHex: randomBytes(32).toString('hex') });
    const { profile } = createDeviceProfile(config, { label: 'Isolated synthetic verification phone' });
    const store = await new IncidentStore(directory).load(); const sequence = randomBytes(4).readUInt32LE() || 1;
    caseId = `ecsw:1:${profile.origin}:${sequence}`;
    receipt.caseFingerprint = createHash('sha256').update(caseId).digest('hex').slice(0, 16);
    const core = new HubCore({ config, store, standaloneSummary: false, transmit: async frame => {
      const saved = JSON.parse(await readFile(join(directory, 'incidents.json'), 'utf8'));
      durableBeforeAck = saved.incidents.length === 1 && Boolean(saved.incidents[0].receipt) && saved.incidents[0].coordination?.revision === 1;
      assert.equal(durableBeforeAck, true);
      const decoded = decodeFrame(frame, profile); assert.equal(decoded.receipt.requestOrigin, profile.origin); assert.equal(decoded.receipt.requestSequence, sequence); assert.equal(decoded.receipt.status, 1);
      encryptedAckVerified = true; ackAt = Date.now();
    } });
    pipeline = new CoordinationPipeline({ core, runtime, region, enabled: true, fetchImpl: checkedFetch, agent: async (request, options) => {
      modelAt = Date.now(); assert.ok(ackAt !== null && durableBeforeAck && ackAt <= modelAt);
      const result = await runLocalAgent(request, options); modelFinishedAt = Date.now(); return result;
    } });
    const request = { category: 5, severity: 3, people: 2, flags: 0, createdAt: Math.floor(Date.now() / 1000), latitude: 0, longitude: 0, accuracy: 65535, battery: 100, note: 'SYNTHETIC TEST: Two people request drinking water near HH. No real emergency.' };
    const frame = encodeRequest(request, { region: 1, keyId: profile.keyId, origin: profile.origin, sequence, hops: 3 }, Buffer.from(profile.keyHex, 'hex'));
    stage = 'encrypted-intake'; const intake = await core.ingest(frame, { simulated: true });
    assert.equal(intake.incident.simulated, true); assert.equal(encryptedAckVerified, true);
    stage = 'local-agent-and-outbox'; await pipeline.idle();
    const item = store.get(intake.id); assert.deepEqual(item.request, request); assert.equal(item.status, 'hub-received'); assert.equal(item.reviewedAt, null);
    receipt.localAgent = { model: runtime.model, source: item.summary.source, nativeToolsValidated: item.summary.source === 'local-model', durationMs: modelFinishedAt - modelAt };
    receipt.encryptedIntake = { independentDeviceKey: true, frameBytes: frame.length, durableBeforeAck, authenticatedAck: encryptedAckVerified, ackBeforeModel: ackAt <= modelAt };
    stage = 'supervisor-dispatch';
    while (Date.now() < deadline && item.coordination.stage !== 'simulated-dispatched') {
      pipeline.wake(); await pipeline.idle(); await pipeline.pollUpdates();
      if (item.coordination.stage === 'needs-review' || item.coordination.stage === 'paused') break;
      if (item.coordination.stage !== 'simulated-dispatched') await new Promise(resolve => setTimeout(resolve, 1000));
    }
    receipt.syntheticCasesCreated = item.coordination.sharedRevision === 1 ? 1 : 0;
    receipt.supervisor = { sharedRevision: item.coordination.sharedRevision, finalStatus: item.coordination.stage, observedStatuses: [...observedStatuses], resource: item.coordination.allocation?.resource || null, quantity: item.coordination.allocation?.quantity || null, locationKind: item.coordination.location.kind, landmark: item.coordination.location.landmarkId?.toUpperCase() || null, dispatchSimulation: item.coordination.allocation?.simulation === true };
    assert.equal(item.coordination.sharedRevision, 1); assert.equal(item.coordination.stage, 'simulated-dispatched'); assert.equal(item.coordination.allocation.simulation, true); assert.equal(item.coordination.allocation.resource, 'water'); assert.equal(item.coordination.allocation.quantity, 2);
    const originalDispatchId = item.coordination.allocation.dispatchId;
    stage = 'exact-event-idempotency'; const body = item.coordination.sharedCase;
    assert.equal(body.source.kind, 'simulated'); assert.match(body.request.note, /^SYNTHETIC TEST:/);
    const response = await checkedFetch(`${runtime.supervisorUrl}/api/hub/cases`, { method: 'POST', headers: { Authorization: `Bearer ${runtime.supervisorToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(7000) });
    const duplicate = await boundedJson(response); assert.equal(response.status, 202); assert.equal(duplicate.accepted, true); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.eventId, body.eventId); assert.equal(duplicate.status, 'simulated-dispatched');
    await new Promise(resolve => setTimeout(resolve, 1000)); await pipeline.pollUpdates();
    const allocationEvents = [...supervisorEvents.values()].filter(event => event.action === 'resource_allocated').length;
    assert.equal(item.coordination.allocation.dispatchId, originalDispatchId); assert.equal(dispatchIds.size, 1); assert.equal(allocationEvents, 1);
    receipt.idempotency = { exactEventRetried: true, duplicateAcknowledged: true, allocationEventCount: allocationEvents, uniqueDispatchIdentities: dispatchIds.size, dispatchIdentityUnchanged: true };
    receipt.pipeline = { localToolActions: [...new Set(item.coordination.events.map(event => event.action))], originalSourceUnchanged: JSON.stringify(item.request) === JSON.stringify(request), humanReviewed: item.reviewedAt !== null, automaticSharing: true, servicesContacted: false };
    assert.equal(item.summary.source, 'local-model'); assert.equal(item.reviewedAt, null);
    receipt.outcome = 'passed';
  } catch {
    receipt.outcome = 'failed'; receipt.failedStage = stage;
  } finally {
    if (pipeline) await pipeline.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    receipt.durationMs = Date.now() - started; receipt.completedAt = new Date().toISOString();
    await writeJsonAtomic(receiptFile, receipt); console.log(JSON.stringify(receipt, null, 2));
    if (receipt.outcome !== 'passed') process.exitCode = 1;
  }
}

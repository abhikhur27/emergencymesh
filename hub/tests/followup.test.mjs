import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HubCore } from '../src/core.mjs';
import { IncidentStore } from '../src/store.mjs';
import { encodeRequest, encodeReceipt, decodeFrame } from '../src/codec.mjs';
import { createDeviceProfile, revokeDevice } from '../src/device-keyring.mjs';
import { CAPABILITY_NOTE, CAPABILITY_ACK, encodeQuestionText, parseQuestionText, encodeReplyNote, parseControlRequest } from '../src/followup.mjs';

const initial = 1794000000000;
const questionId = '00000abc';
const baseRequest = { category: 1, severity: 1, people: 3, flags: 0, latitude: 0, longitude: 0, accuracy: 65535, battery: 255, note: 'At ECSW west entrance.' };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'em-followup-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { region: 1, keyId: 1, key: randomBytes(32), hubOrigin: 456 };
  const { profile: a } = createDeviceProfile(config), { profile: b } = createDeviceProfile(config);
  const store = await new IncidentStore(directory).load(), sent = [], clock = { now: initial }, calls = { initialize: 0, wake: 0, summarize: 0 };
  const core = new HubCore({ config, store, standaloneSummary: false, now: () => clock.now, transmit: async frame => sent.push(Buffer.from(frame)) });
  core.pipeline = { initialize() { calls.initialize++; }, wake() { calls.wake++; } };
  core.summaryQueue = { enqueue() { calls.summarize++; } };
  const frame = (sequence, request = {}, profile = a) => encodeRequest({ ...baseRequest, createdAt: Math.floor(clock.now / 1000), ...request }, { region: profile.region, origin: profile.origin, keyId: profile.keyId, sequence, hops: 3 }, Buffer.from(profile.keyHex, 'hex'));
  const report = await core.ingest(frame(1));
  const capabilityFrame = (sequence = 2, profile = a) => frame(sequence, { category: 8, severity: 3, people: 1, flags: 0, battery: 255, note: CAPABILITY_NOTE }, profile);
  const ready = async () => core.ingest(capabilityFrame());
  return { directory, config, a, b, store, core, sent, clock, calls, frame, capabilityFrame, ready, reportId: report.id };
}

test('follow-up text contract fits unchanged v1 limits and rejects ambiguous or broken text', () => {
  const text = 'x'.repeat(66), question = encodeQuestionText(questionId, text);
  assert.equal(Buffer.byteLength(question), 80); assert.deepEqual(parseQuestionText(question), { questionId, text });
  assert.equal(Buffer.byteLength(encodeReplyNote(0xffffffff, questionId, 'x'.repeat(97))), 120);
  assert.throws(() => encodeQuestionText(questionId, 'é'.repeat(34)), /66 UTF-8/);
  for (const value of ['', ' leading', 'trailing ', 'a\nb', '\0', '\ud800']) assert.throws(() => encodeQuestionText(questionId, value));
  for (const value of ['00000000', '00000ABC', 'xyz', '000000001']) assert.throws(() => encodeQuestionText(value, 'Where are you?'));
  for (const note of ['RMC1|bad', 'RMR1|00000000|00000abc|Hi', 'RMR1|00000001|00000000|Hi', 'RMR1|00000001|00000abc|', 'RMQ1|00000abc|Hello']) assert.throws(() => parseControlRequest({ ...baseRequest, note }));
  assert.equal(parseControlRequest({ ...baseRequest }), null);
});

test('public synthetic follow-up vectors are byte-exact across capability, question, answer and acknowledgment', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/followup-v1.json', import.meta.url), 'utf8'));
  const key = Buffer.from(fixture.keyHex, 'hex');
  assert.equal(fixture.capabilityAcknowledgment.receipt.text, CAPABILITY_ACK);
  for (const part of [fixture.capability, fixture.capabilityAcknowledgment, fixture.question, fixture.reply, fixture.replyAcknowledgment]) {
    const nonce = Buffer.from(part.nonceHex, 'hex');
    const frame = part.request ? encodeRequest(part.request, part.envelope, key, nonce) : encodeReceipt(part.receipt, part.envelope, key, nonce);
    assert.equal(frame.toString('hex'), part.frameHex); assert.ok(decodeFrame(frame, { ...fixture.profile, key }));
  }
  const question = encodeReceipt({ ...fixture.question.receipt, text: encodeQuestionText(questionId, 'x'.repeat(66)) }, fixture.question.envelope, key);
  const answer = encodeRequest({ ...fixture.reply.request, note: encodeReplyNote(7, questionId, 'x'.repeat(97)) }, fixture.reply.envelope, key);
  assert.equal(question.length, 134); assert.equal(answer.length, 184);
});

test('authenticated capability is durable, idempotent and never creates a report or runs agents', async t => {
  const f = await fixture(t); const before = { ...f.calls }, count = f.core.list().length;
  assert.equal(f.core.list()[0].canContactUser, false);
  await assert.rejects(f.core.askQuestion(f.reportId, 'Which entrance?'), /updated app/);
  const first = await f.ready(); assert.equal(first.control, 'capability'); assert.equal(f.core.list().length, count); assert.equal(f.core.list()[0].canContactUser, true); assert.deepEqual(f.calls, before);
  const ack = Buffer.from(f.sent.at(-1)); assert.equal(decodeFrame(ack, f.a).receipt.requestSequence, 2); assert.equal(decodeFrame(ack, f.a).receipt.text, 'RMC1|Q1|OK');
  const hopped = f.capabilityFrame();
  // Retries must reuse the exact authenticated ciphertext, not just identity.
  const original = f.capabilityFrame(3); await f.core.ingest(original); const cached = Buffer.from(f.sent.at(-1)); const forwarded = Buffer.from(original); forwarded[14] = 0;
  assert.equal((await f.core.ingest(forwarded)).duplicate, true); assert.deepEqual(f.sent.at(-1), cached);
  await assert.rejects(f.core.ingest(hopped), /Conflicting replay/);
  const reopened = await new IncidentStore(f.directory).load(); const restarted = new HubCore({ config: f.config, store: reopened, standaloneSummary: false, now: () => initial });
  assert.equal(restarted.list()[0].canContactUser, true); assert.equal(reopened.state.messaging.controls.length, 2);
});

test('question is committed before transmission, independently encrypted, and supports durable regional identity', async t => {
  const f = await fixture(t); await f.ready();
  f.core.transmit = async frame => {
    const disk = JSON.parse(await readFile(join(f.directory, 'incidents.json'), 'utf8'));
    assert.equal(disk.incidents[0].followups[0].frame, frame.toString('base64'));
    assert.equal(disk.incidents[0].followups[0].attemptCount, 1); f.sent.push(Buffer.from(frame));
  };
  const result = await f.core.askQuestion(f.reportId, '  Which entrance are you near?  ', { questionId, source: 'regional' });
  const q = result.followups[0]; assert.equal(q.source, 'regional'); assert.equal(q.text, 'Which entrance are you near?'); assert.equal(q.status, 'submitted-to-radio'); assert.equal(q.attemptCount, 1);
  assert.equal('frame' in q, false); assert.equal('digest' in result, false); assert.equal('receipt' in result, false);
  const questionFrame = Buffer.from(f.sent.at(-1)); const decoded = decodeFrame(questionFrame, f.a);
  assert.equal(decoded.receipt.requestOrigin, f.a.origin); assert.equal(decoded.receipt.requestSequence, 1); assert.equal(decoded.receipt.status, 1);
  assert.deepEqual(parseQuestionText(decoded.receipt.text), { questionId, text: q.text });
  assert.throws(() => decodeFrame(questionFrame, f.b), /Authentication/);
  const sent = f.sent.length; await f.core.askQuestion(f.reportId, q.text, { questionId, source: 'regional' }); assert.equal(f.sent.length, sent);
  await assert.rejects(f.core.askQuestion(f.reportId, 'Changed content', { questionId, source: 'regional' }), /identity conflicts/);
  await assert.rejects(f.core.askQuestion(f.reportId, q.text, { questionId, source: 'local' }), /identity conflicts/);
});

test('answer is durably attached to its original report before ACK without changing source or allocations', async t => {
  const f = await fixture(t); await f.ready(); await f.core.askQuestion(f.reportId, 'Where are you?', { questionId });
  const original = structuredClone(f.store.get(f.reportId).request), before = { ...f.calls };
  f.store.get(f.reportId).coordination = { allocation: { townId: 'plano', resource: 'medicine', quantity: 3 } };
  const reply = f.frame(3, { note: encodeReplyNote(1, questionId, 'At the library entrance.'), flags: 1, latitude: 32.9861, longitude: -96.75138, accuracy: 12 });
  f.core.transmit = async frame => {
    const disk = JSON.parse(await readFile(join(f.directory, 'incidents.json'), 'utf8'));
    assert.equal(disk.incidents.length, 1); assert.equal(disk.incidents[0].followups[0].answer.text, 'At the library entrance.'); f.sent.push(Buffer.from(frame));
  };
  const result = await f.core.ingest(reply); assert.equal(result.control, 'reply'); assert.equal(f.core.list().length, 1); assert.equal(f.store.get(f.reportId).receptions, 1);
  assert.deepEqual(f.store.get(f.reportId).request, original); assert.deepEqual(f.calls, before); assert.equal(f.store.get(f.reportId).coordination.allocation.quantity, 3);
  const q = result.incident.followups[0]; assert.equal(q.status, 'answered'); assert.equal(q.nextAttemptAt, null); assert.equal(q.answer.sequence, 3); assert.equal(q.answer.location.latitude, 32.9861);
  const ack = Buffer.from(f.sent.at(-1)); assert.equal(decodeFrame(ack, f.a).receipt.requestSequence, 3);
  const hopped = Buffer.from(reply); hopped[14] = 0; assert.equal((await f.core.ingest(hopped)).duplicate, true); assert.deepEqual(f.sent.at(-1), ack);
  await assert.rejects(f.core.ingest(f.frame(4, { note: encodeReplyNote(1, questionId, 'A second answer') })), /already has an answer/);
  const reopened = await new IncidentStore(f.directory).load(); const sent = []; const restarted = new HubCore({ config: f.config, store: reopened, standaloneSummary: false, now: () => initial, transmit: async frame => sent.push(frame) });
  assert.equal((await restarted.ingest(reply)).duplicate, true); assert.deepEqual(sent[0], ack); assert.equal(reopened.state.incidents.length, 1);
});

test('wrong phone, unknown question, stale control and conflicting control/report identities fail closed', async t => {
  const f = await fixture(t); await f.ready(); await f.core.askQuestion(f.reportId, 'Where are you?', { questionId });
  await assert.rejects(f.core.ingest(f.frame(1, { note: encodeReplyNote(1, questionId, 'At ECSW') }, f.b)), /does not match/);
  await assert.rejects(f.core.ingest(f.frame(3, { note: encodeReplyNote(1, '00000abd', 'At ECSW') })), /does not match/);
  await assert.rejects(f.core.ingest(f.frame(3, { note: CAPABILITY_NOTE, category: 8, severity: 3, people: 1, createdAt: Math.floor(initial / 1000) - 86401 })), /timestamp/);
  await assert.rejects(f.core.ingest(f.frame(3, { note: CAPABILITY_NOTE })), /capability fields/);
  await assert.rejects(f.core.ingest(f.frame(2)), /Conflicting replay/);
  assert.equal(f.core.list().length, 1); assert.equal(f.store.get(f.reportId).followups[0].answer, undefined);
});

test('question retries reuse exact bytes across restart and stop after bounded attempts or an answer', async t => {
  const f = await fixture(t); await f.ready(); await f.core.askQuestion(f.reportId, 'Where are you?', { questionId }); const first = Buffer.from(f.sent.at(-1));
  const reopened = await new IncidentStore(f.directory).load(); const sent = []; const core = new HubCore({ config: f.config, store: reopened, standaloneSummary: false, now: () => f.clock.now, transmit: async frame => sent.push(Buffer.from(frame)) });
  f.clock.now = initial + 9999; assert.equal(await core.tickFollowups(), 0);
  for (const at of [10000, 25000, 45000]) { f.clock.now = initial + at; assert.equal(await core.tickFollowups(), 1); assert.deepEqual(sent.at(-1), first); }
  f.clock.now = initial + 70000; assert.equal(await core.tickFollowups(), 0); assert.equal(reopened.get(f.reportId).followups[0].attemptCount, 4);
  assert.equal(reopened.get(f.reportId).followups[0].nextAttemptAt, null);
  assert.equal(reopened.get(f.reportId).followups[0].status, 'unconfirmed');
});

test('question budgets, one-open limit and close recovery are bounded without discarding history', async t => {
  const f = await fixture(t); await f.ready(); await f.core.askQuestion(f.reportId, 'Where are you?', { questionId });
  await assert.rejects(f.core.askQuestion(f.reportId, 'A second question'), /existing question/);
  for (let i = 0; i < 8; i++) {
    const { id } = await f.core.ingest(f.frame(10 + i));
    if (i < 7) await f.core.askQuestion(id, 'Which entrance?', { questionId });
    else await assert.rejects(f.core.askQuestion(id, 'Which entrance?', { questionId }), /Eight questions/);
  }
  assert.equal(f.store.state.messaging.transmissions.length, 1); // same-time burst is queued
  f.clock.now += 2000; assert.equal(await f.core.tickFollowups(), 1);
  const closed = await f.core.closeQuestion(f.reportId, questionId); assert.equal(closed.followups[0].status, 'closed'); assert.equal(closed.followups[0].nextAttemptAt, null);
  const ninth = `${f.a.region}:${f.a.origin}:17`; await f.core.askQuestion(ninth, 'Which entrance?', { questionId });
  for (let i = 0; i < 100; i++) { f.clock.now += 1000; await f.core.tickFollowups(); assert.ok(f.store.state.messaging.transmissions.length <= 8); }
  const reply = f.frame(30, { note: encodeReplyNote(1, questionId, 'Late answer at ECSW') }); await f.core.ingest(reply);
  assert.equal(f.store.get(f.reportId).followups[0].status, 'answered');
});

test('storage failures roll back capability, question identity and answers before any transmission', async t => {
  const f = await fixture(t); const persist = f.store.persist.bind(f.store); let count = f.sent.length, sequence = f.store.state.nextSequence;
  f.store.persist = async () => { throw new Error('disk full'); };
  await assert.rejects(f.ready(), /disk full/); assert.equal(f.sent.length, count); assert.equal(f.core.list()[0].canContactUser, false); assert.equal(f.store.state.nextSequence, sequence);
  f.store.persist = persist; await f.ready(); count = f.sent.length; sequence = f.store.state.nextSequence;
  f.store.persist = async () => { throw new Error('disk full'); };
  await assert.rejects(f.core.askQuestion(f.reportId, 'Where are you?', { questionId }), /disk full/); assert.equal(f.sent.length, count); assert.equal(f.core.list()[0].followups.length, 0); assert.equal(f.store.state.nextSequence, sequence);
  f.store.persist = persist; await f.core.askQuestion(f.reportId, 'Where are you?', { questionId }); count = f.sent.length; sequence = f.store.state.nextSequence;
  f.store.persist = async () => { throw new Error('disk full'); };
  const answer = f.frame(3, { note: encodeReplyNote(1, questionId, 'At ECSW') }); await assert.rejects(f.core.ingest(answer), /disk full/);
  assert.equal(f.sent.length, count); assert.equal(f.store.get(f.reportId).followups[0].answer, undefined); assert.equal(f.store.state.nextSequence, sequence);
  f.store.persist = persist; await f.core.ingest(answer); assert.equal(f.core.list()[0].followups[0].status, 'answered');
});

test('transport failure preserves encrypted question and revoked phone cannot receive a new question', async t => {
  const f = await fixture(t); await f.ready(); f.core.transmit = async () => { throw new Error('No radio'); };
  await f.core.askQuestion(f.reportId, 'Where are you?', { questionId }); const first = f.store.get(f.reportId).followups[0].frame;
  assert.equal(f.core.list()[0].followups[0].status, 'queued'); f.core.transmit = async frame => f.sent.push(frame); f.clock.now += 10000; await f.core.tickFollowups(); assert.equal(f.sent.at(-1).toString('base64'), first);
  revokeDevice(f.config, f.a.origin, f.a.keyId); assert.equal(f.core.list()[0].canContactUser, false);
  await f.core.closeQuestion(f.reportId, questionId); await assert.rejects(f.core.askQuestion(f.reportId, 'Another question'), /updated app/);
});

test('retained question history and replay state have explicit limits rather than silent eviction', async t => {
  const f = await fixture(t); await f.ready();
  for (let index = 1; index <= 12; index++) { const qid = index.toString(16).padStart(8, '0'); await f.core.askQuestion(f.reportId, 'Which entrance?', { questionId: qid }); await f.core.closeQuestion(f.reportId, qid); }
  await assert.rejects(f.core.askQuestion(f.reportId, 'A thirteenth question'), /history is full/); assert.equal(f.core.list()[0].followups.length, 12);
  const record = structuredClone(f.store.state.messaging.controls[0]); f.store.state.messaging.controls = Array.from({ length: 4096 }, (_, index) => ({ ...record, id: `1:${f.a.origin}:${1000 + index}` }));
  const sent = f.sent.length; await assert.rejects(f.core.ingest(f.capabilityFrame(50, f.b)), /replay store full/); assert.equal(f.sent.length, sent); assert.equal(f.core.list().length, 1);
});

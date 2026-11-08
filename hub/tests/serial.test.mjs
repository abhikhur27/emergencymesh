import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { SerialLines, connectSerial, validateReadiness, sanitizeBoardStats } from '../src/serial.mjs';

test('serial parser handles partial reads, ignores diagnostics and recovers after oversized lines', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/golden-v1.json', import.meta.url), 'utf8'));
  const frame = fixture.requestFrameBase64; const received = []; const diagnostics = [];
  assert.ok(frame);
  const parser = new SerialLines((frame, metadata) => received.push({ frame, metadata })); parser.on('diagnostic', value => diagnostics.push(value));
  const message = `${JSON.stringify({ op: 'rx', frame, rssi: -72, snr: 6.25 })}\n`;
  parser.push(Buffer.from('ESP boot text\n{"op":"queued"}\n')); parser.push(Buffer.from(message.slice(0, 10))); assert.equal(received.length, 0); parser.push(Buffer.from(message.slice(10)));
  assert.equal(received.length, 1); assert.equal(received[0].metadata.snr, 6.25);
  parser.push(Buffer.from(`${'a'.repeat(1200)}\n${message}`)); assert.equal(received.length, 2); assert.ok(diagnostics.includes('oversized-line'));
  parser.push(Buffer.from('{"op":"rx","frame":"invalid"}\n')); assert.equal(received.length, 2);
});

const ready = { op: 'ready', node: 123, role: 'hub', frequency: 915, region: 1, keyId: 1, radioReady: true, protocol: 1 };
class FakePort extends EventEmitter {
  constructor() { super(); this.isOpen = false; this.writes = []; FakePort.last = this; }
  open(callback) { this.isOpen = true; callback(); }
  write(value, callback) { this.writes.push(value); callback(); }
  drain(callback) { callback(); }
  close(callback) { this.isOpen = false; this.emit('close'); callback(); }
}
test('readiness validates radio state and every expected protocol/profile field', () => {
  assert.equal(validateReadiness(ready), 'ready');
  assert.equal(validateReadiness({ ...ready, radioReady: false }), 'radio-failed');
  for (const change of [{ region: 2 }, { keyId: 2 }, { frequency: 868 }, { protocol: 2 }, { role: 'companion' }]) assert.equal(validateReadiness({ ...ready, ...change }), 'profile-mismatch');
  for (const change of [{ radioReady: undefined }, { node: '123' }, { region: '1' }, { protocol: undefined }, { keyId: 1.5 }]) assert.equal(validateReadiness({ ...ready, ...change }), 'invalid-status');
});
test('opening USB only queries status; TX stays blocked until a matching positive ready, and fails closed on later radio error', async t => {
  const updates = []; const bridge = await connectSerial('FAKE', () => {}, state => updates.push(state), { SerialPortImpl: FakePort }); t.after(() => bridge.close());
  const port = FakePort.last;
  assert.equal(bridge.state.portOpen, true); assert.equal(bridge.state.connected, false); assert.equal(bridge.state.readiness, 'awaiting-status');
  assert.equal(port.writes[0], '{"op":"status"}\n');
  await assert.rejects(bridge.transmit(Buffer.alloc(64)), /unverified/);
  port.emit('data', Buffer.from(`${JSON.stringify({ ...ready, radioReady: false })}\n`)); assert.equal(bridge.state.readiness, 'radio-failed'); assert.equal(bridge.state.connected, false);
  await assert.rejects(bridge.transmit(Buffer.alloc(64)), /unverified/);
  port.emit('data', Buffer.from(`${JSON.stringify({ ...ready, region: 2 })}\n`)); assert.equal(bridge.state.readiness, 'profile-mismatch');
  port.emit('data', Buffer.from(`${JSON.stringify({ ...ready, radioReady: 'true' })}\n`)); assert.equal(bridge.state.readiness, 'invalid-status');
  port.emit('data', Buffer.from(`${JSON.stringify(ready)}\n`)); assert.equal(bridge.state.connected, true); assert.equal(bridge.state.readiness, 'ready'); assert.equal(bridge.state.board.keyId, 1); assert.equal(bridge.state.board.protocol, 1);
  await bridge.transmit(Buffer.alloc(64)); assert.equal(JSON.parse(port.writes.at(-1)).op, 'tx');
  port.emit('data', Buffer.from('{"op":"error","code":"radio_receive_failed"}\n')); assert.equal(bridge.state.connected, false); assert.equal(bridge.state.readiness, 'radio-failed'); await assert.rejects(bridge.transmit(Buffer.alloc(64)), /unverified/);
  assert.ok(updates.length >= 6);
});

test('board stats allowlist preserves bounded numeric diagnostics without keys or packet content', () => {
  const value = sanitizeBoardStats({ rxEvents: 4, rxAccepted: 2, rxReadErrors: 1, rxEnvelopeErrors: 0, rxDuplicates: 1, txStarted: 3, txCompleted: 2, txTimeouts: 1, queueDepth: 2, queueDrops: 0, bleRejects: 0, lastRxState: -7, lastRxLength: 184, lastRxIrq: 65535, lastEnvelopeReason: 'not_checked', lastRxRssi: -83.25, lastRxSnr: 7.5, keyHex: 'secret', frame: 'secret', note: 'private' });
  assert.equal(value.rxEvents, 4); assert.equal(value.lastRxState, -7); assert.equal(value.lastRxIrq, 65535); assert.equal(value.lastEnvelopeReason, 'not_checked'); assert.equal(value.lastRxRssi, -83.25);
  for (const key of ['keyHex', 'frame', 'note']) assert.equal(key in value, false);
  assert.equal(sanitizeBoardStats({ rxEvents: -1, rxAccepted: 1.5, queueDepth: 0x100000000, lastRxState: -32769, lastRxLength: 256, lastRxIrq: 65536, lastEnvelopeReason: 'private text', lastRxRssi: Infinity, lastRxSnr: NaN }), null);
  assert.equal(sanitizeBoardStats([]), null); assert.equal(sanitizeBoardStats(null), null);
});
test('live stats passthrough never changes unverified or failed radio readiness', async t => {
  const bridge = await connectSerial('FAKE', () => {}, () => {}, { SerialPortImpl: FakePort }); t.after(() => bridge.close()); const port = FakePort.last;
  port.emit('data', Buffer.from('{"op":"stats","stats":{"rxEvents":2,"lastEnvelopeReason":"none","keyHex":"secret"}}\n'));
  assert.equal(bridge.state.board.stats.rxEvents, 2); assert.equal('keyHex' in bridge.state.board.stats, false); assert.equal(bridge.state.connected, false); assert.equal(bridge.state.readiness, 'awaiting-status');
  port.emit('data', Buffer.from(`${JSON.stringify({ ...ready, stats: { rxEvents: 3, rxReadErrors: 1, lastRxState: -7 } })}\n`)); assert.equal(bridge.state.connected, true); assert.equal(bridge.state.board.stats.lastRxState, -7);
  port.emit('data', Buffer.from('{"op":"stats","stats":{"rxEvents":4,"rxReadErrors":2,"lastRxIrq":96}}\n')); assert.equal(bridge.state.board.stats.rxEvents, 4); assert.equal(bridge.state.board.role, 'hub'); assert.equal(bridge.state.readiness, 'ready');
  port.emit('data', Buffer.from(`${JSON.stringify({ ...ready, radioReady: false, stats: { rxEvents: 5 } })}\n`));
  port.emit('data', Buffer.from('{"op":"stats","stats":{"rxEvents":6,"radioReady":true}}\n')); assert.equal(bridge.state.connected, false); assert.equal(bridge.state.readiness, 'radio-failed'); assert.equal(bridge.state.board.stats.rxEvents, 6);
});
test('host receive counters distinguish no USB RX, valid, ignored and authenticated rejection without exposing errors', async t => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/golden-v1.json', import.meta.url), 'utf8')); let outcome = 'accepted';
  const bridge = await connectSerial('FAKE', () => { if (outcome === 'rejected') return Promise.reject(Object.assign(new Error('private value must not surface'), { code: 'AUTH_FAILED' })); return outcome === 'ignored' ? { ignored: true } : { duplicate: false }; }, () => {}, { SerialPortImpl: FakePort }); t.after(() => bridge.close()); const port = FakePort.last;
  const packet = () => port.emit('data', Buffer.from(`${JSON.stringify({ op: 'rx', frame: fixture.requestFrameBase64 })}\n`));
  assert.equal(bridge.state.hostStats.rxLines, 0); packet(); await new Promise(resolve => setImmediate(resolve)); assert.equal(bridge.state.hostStats.accepted, 1);
  outcome = 'ignored'; packet(); await new Promise(resolve => setImmediate(resolve)); assert.equal(bridge.state.hostStats.ignored, 1);
  outcome = 'rejected'; packet(); await new Promise(resolve => setImmediate(resolve)); assert.equal(bridge.state.hostStats.rejected, 1); assert.equal(bridge.state.hostStats.lastRejectCode, 'authentication-failed'); assert.equal(bridge.state.lastDiagnostic, 'rejected-frame'); assert.equal(JSON.stringify(bridge.state).includes('private value'), false);
  port.emit('data', Buffer.from('{"op":"rx","frame":"invalid"}\n')); assert.equal(bridge.state.hostStats.rxLines, 4); assert.equal(bridge.state.hostStats.rejected, 2); assert.equal(bridge.state.hostStats.lastRejectCode, 'invalid-base64'); assert.ok(bridge.state.hostStats.lastRxAt); assert.ok(bridge.state.hostStats.lastRejectedAt);
});

test('missing configured USB port stays disconnected and reconnects only that path, requiring a fresh matching status', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class ReconnectingPort extends FakePort {
    static attempts = [];
    constructor(options) { super(); this.options = options; ReconnectingPort.attempts.push(this); }
    open(callback) { if (ReconnectingPort.attempts.length === 1) return callback(new Error('Opening COM10: File not found')); super.open(callback); }
  }
  const bridge = await connectSerial('COM10', () => {}, () => {}, { SerialPortImpl: ReconnectingPort }); t.after(() => bridge.close());
  assert.equal(bridge.state.mode, 'serial'); assert.equal(bridge.state.path, 'COM10'); assert.equal(bridge.state.connected, false); assert.equal(bridge.state.portOpen, false);
  assert.equal(bridge.state.board, null); assert.ok(bridge.state.nextReconnectAt); await assert.rejects(bridge.transmit(Buffer.alloc(64)), /closed/);
  t.mock.timers.tick(4999); assert.equal(ReconnectingPort.attempts.length, 1);
  t.mock.timers.tick(1); const second = ReconnectingPort.attempts[1]; assert.ok(second); assert.equal(second.options.path, 'COM10');
  assert.equal(bridge.state.readiness, 'awaiting-status'); assert.equal(bridge.state.connected, false);
  second.emit('data', Buffer.from(`${JSON.stringify({ ...ready, role: 'companion' })}\n`)); await assert.rejects(bridge.transmit(Buffer.alloc(64)), /unverified/);
  second.emit('data', Buffer.from(`${JSON.stringify(ready)}\n`)); assert.equal(bridge.state.connected, true); await bridge.transmit(Buffer.alloc(64));
  second.isOpen = false; second.emit('close'); assert.equal(bridge.state.connected, false); assert.equal(bridge.state.board, null);
  second.emit('data', Buffer.from(`${JSON.stringify(ready)}\n`)); assert.equal(bridge.state.connected, false, 'stale port status cannot restore readiness');
  t.mock.timers.tick(5000); const third = ReconnectingPort.attempts[2]; assert.equal(third.options.path, 'COM10'); assert.equal(bridge.state.connected, false);
  third.emit('data', Buffer.from(`${JSON.stringify(ready)}\n`)); assert.equal(bridge.state.connected, true);
  await bridge.close(); t.mock.timers.tick(60000); assert.equal(ReconnectingPort.attempts.length, 3, 'shutdown cancels reconnection');
});

test('serial connection returns while an OS open is pending and closes a late-opened handle after shutdown', async t => {
  class DelayedPort extends FakePort {
    open(callback) { this.completeOpen = () => { this.isOpen = true; callback(); }; }
  }
  const bridge = await connectSerial('COM10', () => {}, () => {}, { SerialPortImpl: DelayedPort });
  const port = FakePort.last; assert.equal(bridge.state.connected, false); assert.equal(bridge.state.readiness, 'opening');
  await bridge.close(); port.completeOpen(); assert.equal(port.isOpen, false); assert.equal(bridge.state.connected, false);
});

import { EventEmitter } from 'node:events';
import { decodeBase64, inspectEnvelope } from './codec.mjs';

const counterFields = ['rxEvents', 'rxAccepted', 'rxReadErrors', 'rxEnvelopeErrors', 'rxDuplicates', 'txStarted', 'txCompleted', 'txTimeouts', 'queueDepth', 'queueDrops', 'bleRejects'];
const envelopeReasons = new Set(['not_checked', 'none', 'size', 'magic', 'version', 'type', 'type_size', 'region', 'key_id', 'hops']);
export function sanitizeBoardStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const field of counterFields) if (Number.isInteger(value[field]) && value[field] >= 0 && value[field] <= 0xffffffff) result[field] = value[field];
  for (const [field, min, max] of [['lastRxState', -32768, 32767], ['lastRxLength', 0, 255], ['lastRxIrq', 0, 65535]]) if (Number.isInteger(value[field]) && value[field] >= min && value[field] <= max) result[field] = value[field];
  for (const field of ['lastRxRssi', 'lastRxSnr']) if (typeof value[field] === 'number' && Number.isFinite(value[field])) result[field] = value[field];
  if (envelopeReasons.has(value.lastEnvelopeReason)) result.lastEnvelopeReason = value.lastEnvelopeReason;
  return Object.keys(result).length ? result : null;
}
function rejectionCode(error) {
  const codecCodes = { AUTH_FAILED: 'authentication-failed', UNKNOWN_PROFILE: 'unknown-profile', VALIDATION_ERROR: 'invalid-payload', INVALID_FRAME: 'invalid-frame' };
  if (codecCodes[error?.code]) return codecCodes[error.code];
  const coreCodes = { 'Request timestamp outside allowed window': 'timestamp-window', 'Conflicting replay identity': 'replay-conflict', 'Request rate limit reached': 'rate-limit', 'Incident store full; operator maintenance required': 'store-full' };
  return coreCodes[error?.message] || 'handler-or-storage-error';
}

export class SerialLines extends EventEmitter {
  constructor(onFrame) { super(); this.onFrame = onFrame; this.buffer = []; this.discarding = false; }
  push(chunk) {
    for (const byte of chunk) {
      if (byte === 10) {
        if (!this.discarding && this.buffer.length) this.line(Buffer.from(this.buffer).toString('utf8').replace(/\r$/, ''));
        this.buffer = []; this.discarding = false;
      } else if (!this.discarding) {
        this.buffer.push(byte);
        if (this.buffer.length > 1024) { this.buffer = []; this.discarding = true; this.emit('diagnostic', 'oversized-line'); }
      }
    }
  }
  line(line) {
    try {
      const value = JSON.parse(line);
      if (value.op === 'rx') {
        this.emit('rx-attempt');
        let frame;
        try { frame = decodeBase64(value.frame); } catch { this.emit('rx-rejected', 'invalid-base64'); this.emit('diagnostic', 'invalid-line'); return; }
        try { inspectEnvelope(frame); } catch { this.emit('rx-rejected', 'invalid-envelope'); this.emit('diagnostic', 'invalid-line'); return; }
        let handled;
        try { handled = this.onFrame(frame, { rssi: value.rssi, snr: value.snr }); }
        catch (error) { this.emit('rx-rejected', rejectionCode(error)); this.emit('diagnostic', 'rejected-frame'); return; }
        Promise.resolve(handled).then(result => this.emit(result?.ignored ? 'rx-ignored' : 'rx-accepted')).catch(error => { this.emit('rx-rejected', rejectionCode(error)); this.emit('diagnostic', 'rejected-frame'); });
      } else if (value.op === 'ready') this.emit('ready', { node: value.node, role: value.role, frequency: value.frequency, region: value.region, keyId: value.keyId, radioReady: value.radioReady, protocol: value.protocol, stats: sanitizeBoardStats(value.stats) });
      else if (value.op === 'stats') { const stats = sanitizeBoardStats(value.stats); if (stats) this.emit('board-stats', stats); }
      else if (value.op === 'error') {
        const code = typeof value.code === 'string' && /^[a-z_]{1,64}$/.test(value.code) ? value.code : 'unknown';
        this.emit('diagnostic', `board-error:${code}`);
      }
      else if (value.op === 'queued') this.emit('diagnostic', 'board-queued');
    } catch { this.emit('diagnostic', 'invalid-line'); }
  }
}

export function validateReadiness(board, { region = 1, keyId = 1, frequency = 915 } = {}) {
  if (!board || !Number.isInteger(board.node) || board.node < 0 || board.node > 0xffffffff ||
      typeof board.role !== 'string' || !Number.isFinite(board.frequency) || !Number.isInteger(board.region) ||
      !Number.isInteger(board.keyId) || typeof board.radioReady !== 'boolean' || !Number.isInteger(board.protocol)) return 'invalid-status';
  if (board.role !== 'hub' || board.region !== region || board.keyId !== keyId || board.frequency !== frequency || board.protocol !== 1) return 'profile-mismatch';
  return board.radioReady ? 'ready' : 'radio-failed';
}

export async function connectSerial(path, onFrame, onState = () => {}, { region = 1, keyId = 1, frequency = 915, SerialPortImpl } = {}) {
  const Port = SerialPortImpl || (await import('serialport')).SerialPort;
  const port = new Port({ path, baudRate: 115200, autoOpen: false });
  const lines = new SerialLines(onFrame);
  const state = { mode: 'serial', path, portOpen: false, connected: false, readiness: 'port-closed', board: null, lastDiagnostic: null, hostStats: { rxLines: 0, accepted: 0, rejected: 0, ignored: 0, lastRxAt: null, lastRejectedAt: null, lastRejectCode: null } };
  const readinessTimers = [];
  const clearReadinessTimers = () => { for (const timer of readinessTimers.splice(0)) clearTimeout(timer); };
  const update = () => onState(structuredClone(state));
  lines.on('rx-attempt', () => { state.hostStats.rxLines++; state.hostStats.lastRxAt = Date.now(); update(); });
  lines.on('rx-accepted', () => { state.hostStats.accepted++; update(); });
  lines.on('rx-ignored', () => { state.hostStats.ignored++; update(); });
  lines.on('rx-rejected', code => { state.hostStats.rejected++; state.hostStats.lastRejectedAt = Date.now(); state.hostStats.lastRejectCode = code; update(); });
  lines.on('board-stats', stats => { state.board = { ...state.board, stats }; update(); });
  lines.on('ready', board => {
    state.board = { ...board, stats: board.stats || state.board?.stats || null }; state.readiness = validateReadiness(board, { region, keyId, frequency });
    state.connected = state.portOpen && state.readiness === 'ready';
    if (state.readiness === 'ready' || state.readiness === 'profile-mismatch' || state.readiness === 'radio-failed') clearReadinessTimers();
    update();
  });
  lines.on('diagnostic', message => {
    state.lastDiagnostic = message;
    if (/^board-error:radio_(initialization_failed|receive_failed|unavailable)$/.test(message)) { state.connected = false; state.readiness = 'radio-failed'; }
    update();
  });
  port.on('data', chunk => lines.push(chunk));
  port.on('close', () => { clearReadinessTimers(); state.portOpen = false; state.connected = false; state.readiness = 'port-closed'; state.lastDiagnostic = 'port-closed'; update(); });
  port.on('error', () => { state.connected = false; state.readiness = 'port-error'; state.lastDiagnostic = 'port-error'; update(); });
  await new Promise((resolve, reject) => port.open(error => error ? reject(error) : resolve()));
  state.portOpen = true; state.readiness = 'awaiting-status'; update();
  const requestStatus = () => { if (port.isOpen) port.write('{"op":"status"}\n', error => { if (error) { state.lastDiagnostic = 'status-query-failed'; update(); } }); };
  // USB UART may reset the board on open. Bounded retries recover boot-time status without a continuing poller.
  readinessTimers.push(setTimeout(requestStatus, 1000), setTimeout(requestStatus, 3000), setTimeout(() => {
    if (state.readiness === 'awaiting-status' || state.readiness === 'invalid-status') { state.readiness = 'status-unavailable'; state.connected = false; update(); }
  }, 6000));
  requestStatus();
  return {
    transmit: frame => new Promise((resolve, reject) => {
      if (!port.isOpen) return reject(new Error('Radio serial port closed'));
      if (!state.connected || state.readiness !== 'ready') return reject(new Error('Board radio readiness or profile unverified'));
      let finished = false;
      const finish = error => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => finish(new Error('Radio serial write timed out')), 5000);
      port.write(`${JSON.stringify({ op: 'tx', frame: frame.toString('base64') })}\n`, error => {
        if (error) return finish(error);
        port.drain(finish);
      });
    }),
    close: () => new Promise(resolve => { clearReadinessTimers(); if (!port.isOpen) resolve(); else port.close(() => resolve()); }),
    state,
  };
}

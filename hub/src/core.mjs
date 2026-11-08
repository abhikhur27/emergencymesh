import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { decodeFrame, encodeReceipt, frameDigest, inspectEnvelope } from './codec.mjs';
import { hasDeviceKeyring, resolveDeviceKey } from './device-keyring.mjs';
import { deterministicSummary, SummaryQueue } from './summary.mjs';
import { CAPABILITY_ACK, deviceIdentity, encodeQuestionText, parseControlRequest, parseHex, messageText, followupError, MAX_QUESTION_BYTES, MAX_QUESTIONS_PER_INCIDENT, MAX_CONTROL_RECORDS, FOLLOWUP_RETRY_DELAYS } from './followup.mjs';

export class HubCore extends EventEmitter {
  constructor({ config, store, transmit = async () => { throw new Error('No radio connected'); }, now = () => Date.now(), ai = false, model, summarize, standaloneSummary = true } = {}) {
    super(); this.config = config; this.store = store; this.transmit = transmit; this.now = now; this.pending = Promise.resolve(); this.rates = new Map(); this.globalRates = [];
    this.summaryQueue = standaloneSummary ? new SummaryQueue({ enabled: ai, model, summarize, onResult: (id, result) => this.exclusive(async () => { const item = this.store.get(id); if (item) { item.summary = result; await this.store.persist(); this.emit('update'); } }) }) : null;
  }
  exclusive(action) { const next = this.pending.then(action); this.pending = next.catch(() => {}); return next; }
  incidentId(header) { return `${header.region}:${header.origin}:${header.sequence}`; }
  makeReceipt(item, status) {
    const keyId = item.keyId ?? this.config.keyId;
    const key = hasDeviceKeyring(this.config) ? resolveDeviceKey(this.config, item.origin, keyId) : this.config.key;
    return encodeReceipt({ requestOrigin: item.origin, requestSequence: item.sequence, status, text: status === 1 ? 'Received by RescueMesh hub. Coordination queued.' : 'Reviewed by operator. Dispatch is simulated.' }, { region: this.config.region, keyId, origin: this.config.hubOrigin, sequence: this.store.reserveSequence(), hops: 3 }, key).toString('base64');
  }
  keyFor(item) { return hasDeviceKeyring(this.config) ? resolveDeviceKey(this.config, item.origin, item.keyId) : this.config.key; }
  applicationReceipt(item, text) {
    return encodeReceipt({ requestOrigin: item.origin, requestSequence: item.sequence, status: 1, text }, { region: this.config.region, keyId: item.keyId, origin: this.config.hubOrigin, sequence: this.store.reserveSequence(), hops: 3 }, this.keyFor(item)).toString('base64');
  }
  messaging() { const state = this.store.state.messaging ??= { version: 1, capabilities: {}, controls: [], transmissions: [] }; state.transmissions ??= []; return state; }
  canContactUser(item) {
    try { this.keyFor(item); return this.messaging().capabilities[deviceIdentity(item)]?.questionReply === 1; }
    catch { return false; }
  }
  async ingestControl(header, request, control, digest, radio) {
    if (!header.origin || !header.sequence) throw followupError('Invalid messaging identity');
    const messaging = this.messaging();
    if (messaging.controls.length >= MAX_CONTROL_RECORDS) throw followupError('Messaging replay store full; operator maintenance required', 409);
    const identity = deviceIdentity(header);
    if (control.kind === 'capability' && !messaging.capabilities[identity] && Object.keys(messaging.capabilities).length >= MAX_CONTROL_RECORDS) throw followupError('Messaging capability store full', 409);
    let incident, question;
    if (control.kind === 'reply') {
      incident = this.store.get(`${header.region}:${header.origin}:${control.requestSequence}`);
      question = incident?.followups?.find(q => q.id === control.questionId);
      if (!incident || incident.keyId !== header.keyId || !question) throw followupError('Answer does not match an open question', 409);
      if (question.answer) throw followupError('This question already has an answer', 409);
    }
    const snapshot = structuredClone(this.store.state);
    const record = { id: this.incidentId(header), digest, region: header.region, origin: header.origin, keyId: header.keyId, sequence: header.sequence, kind: control.kind, receivedAt: this.now(), lastReceivedAt: this.now(), receptions: 1 };
    try {
      if (control.kind === 'capability') messaging.capabilities[identity] = { questionReply: 1, receivedAt: this.now(), lastSequence: header.sequence };
      else {
        record.incidentId = incident.id; record.questionId = question.id;
        question.answer = { text: control.text, receivedAt: this.now(), createdAt: request.createdAt * 1000, sequence: header.sequence, location: request.flags & 1 ? { latitude: request.latitude, longitude: request.longitude, accuracy: request.accuracy, capturedAt: request.createdAt * 1000 } : null };
        question.status = 'answered'; question.nextAttemptAt = null;
      }
      record.receipt = this.applicationReceipt(header, control.kind === 'capability' ? CAPABILITY_ACK : 'Your reply was saved by the hub.');
      messaging.controls.push(record);
      await this.store.persist();
    } catch (error) { this.store.state = snapshot; throw error; }
    await this.send(record); this.emit('update');
    return { id: record.id, control: control.kind, duplicate: false, ...(incident ? { incident: this.publicIncident(incident) } : {}) };
  }
  askQuestion(id, value, { questionId, source = 'local' } = {}) {
    return this.exclusive(async () => {
      const item = this.store.get(id); if (!item) throw followupError('Incident not found', 409);
      const text = messageText(typeof value === 'string' ? value.trim() : value, MAX_QUESTION_BYTES, 'Question');
      if (!['local', 'regional'].includes(source)) throw followupError('Invalid question source');
      if (questionId !== undefined) {
        parseHex(questionId, 'question ID');
        const prior = item.followups?.find(q => q.id === questionId);
        if (prior) { if (prior.text !== text || prior.source !== source) throw followupError('Question identity conflicts with saved content', 409); return this.publicIncident(item); }
      }
      if (!this.canContactUser(item)) throw followupError('This phone needs the updated app before receiving questions', 409);
      if ((item.followups?.length || 0) >= MAX_QUESTIONS_PER_INCIDENT) throw followupError('Question history is full for this request', 409);
      const pending = this.store.state.incidents.flatMap(i => i.followups || []).filter(q => !q.answer && q.status !== 'closed');
      if (pending.some(q => item.followups?.includes(q))) throw followupError('Wait for the existing question or close it first', 409);
      if (pending.length >= 8) throw followupError('Eight questions are pending; wait for replies or close an older question', 409);
      const snapshot = structuredClone(this.store.state);
      let qid = questionId;
      if (!qid) do { qid = randomBytes(4).toString('hex'); } while (qid === '00000000' || item.followups?.some(q => q.id === qid));
      let question;
      try {
        question = { id: qid, text, source, createdAt: this.now(), status: 'queued', attemptCount: 0, firstAttemptAt: null, lastAttemptAt: null, nextAttemptAt: this.now(), frame: this.applicationReceipt(item, encodeQuestionText(qid, text)) };
        (item.followups ??= []).push(question);
        await this.store.persist();
      } catch (error) { this.store.state = snapshot; throw error; }
      await this.attemptQuestion(question); this.emit('update'); return this.publicIncident(this.store.get(id));
    });
  }
  async attemptQuestion(question) {
    const recent = this.messaging().transmissions.filter(at => at > this.now() - 60000);
    // Leave room for ordinary hub receipts and cap bursts below the firmware's
    // eight-frame queue. A busy link postpones, rather than loses, a question.
    if (recent.length >= 8 || recent.length && this.now() - recent.at(-1) < 2000) return false;
    const snapshot = structuredClone(this.store.state);
    question.firstAttemptAt ??= this.now(); question.attemptCount++; question.lastAttemptAt = this.now();
    question.nextAttemptAt = question.attemptCount < FOLLOWUP_RETRY_DELAYS.length ? Math.max(question.firstAttemptAt + FOLLOWUP_RETRY_DELAYS[question.attemptCount], this.now() + 2000) : null;
    this.messaging().transmissions = [...recent, this.now()];
    try { await this.store.persist(); } catch (error) { this.store.state = snapshot; throw error; }
    await this.transmitQuestion(question); return true;
  }
  async transmitQuestion(question) {
    try { await this.transmit(Buffer.from(question.frame, 'base64')); question.status = 'submitted-to-radio'; question.lastTransmission = { state: 'submitted-to-radio', at: this.now() }; }
    catch { question.status = question.nextAttemptAt === null ? 'unconfirmed' : 'queued'; question.lastTransmission = { state: 'failed', at: this.now() }; }
    // The question and retry identity were committed before transmit. A later
    // metadata write failure cannot erase them or justify claiming delivery.
    try { await this.store.persist(); } catch { this.emit('warning', { code: 'FOLLOWUP_STATUS_NOT_PERSISTED' }); }
  }
  tickFollowups() {
    return this.exclusive(async () => {
      let count = 0, changed = false;
      for (const incident of this.store.state.incidents) for (const question of incident.followups || []) {
        if (question.answer || question.status === 'closed') continue;
        if (!this.canContactUser(incident)) {
          const snapshot = structuredClone(this.store.state); question.nextAttemptAt = null; question.status = 'closed'; question.closedAt = this.now();
          try { await this.store.persist(); } catch (error) { this.store.state = snapshot; throw error; }
          changed = true; continue;
        }
        if (question.nextAttemptAt === null && question.attemptCount >= FOLLOWUP_RETRY_DELAYS.length && question.status === 'submitted-to-radio' && this.now() - question.lastAttemptAt >= 10000) {
          const snapshot = structuredClone(this.store.state); question.status = 'unconfirmed';
          try { await this.store.persist(); } catch (error) { this.store.state = snapshot; throw error; }
          changed = true; continue;
        }
        if (!Number.isFinite(question.nextAttemptAt) || question.nextAttemptAt > this.now()) continue;
        if (await this.attemptQuestion(question)) count++;
      }
      if (count || changed) this.emit('update'); return count;
    });
  }
  closeQuestion(id, questionId) {
    return this.exclusive(async () => {
      const item = this.store.get(id); if (!item) throw followupError('Incident not found', 409);
      const question = item.followups?.find(q => q.id === questionId); if (!question) throw followupError('Question not found', 409);
      if (question.answer || question.status === 'closed') return this.publicIncident(item);
      const snapshot = structuredClone(this.store.state); question.status = 'closed'; question.closedAt = this.now(); question.nextAttemptAt = null;
      try { await this.store.persist(); } catch (error) { this.store.state = snapshot; throw error; }
      this.emit('update'); return this.publicIncident(item);
    });
  }
  checkRate(origin) {
    const cutoff = this.now() - 60000;
    this.globalRates = this.globalRates.filter(time => time > cutoff);
    for (const [key, times] of this.rates) { const recent = times.filter(time => time > cutoff); if (!recent.length) this.rates.delete(key); else this.rates.set(key, recent); }
    const times = this.rates.get(origin) || [];
    if (times.length >= 30 || this.globalRates.length >= 120) throw new Error('Request rate limit reached');
    times.push(this.now()); this.rates.set(origin, times); this.globalRates.push(this.now());
  }
  async send(item) {
    try { await this.transmit(Buffer.from(item.receipt, 'base64')); item.lastTransmission = { state: 'submitted-to-radio', at: this.now() }; }
    catch { item.lastTransmission = { state: 'failed', at: this.now() }; }
    // A successful host write does not prove over-air transmission or phone delivery.
  }
  ingest(frame, radio = {}) {
    return this.exclusive(async () => {
      // Receipt origins identify the hub, so they cannot select a phone-specific decryption key.
      if (inspectEnvelope(frame).type === 2) return { ignored: true, reason: 'receipt' };
      const decoded = decodeFrame(frame, this.config);
      if (decoded.header.type !== 1) return { ignored: true, reason: 'receipt' };
      const { header, request } = decoded;
      // Exact retries are valid, but repeated authenticated frames must not amplify into unlimited ACK traffic.
      this.checkRate(header.origin);
      const id = this.incidentId(header); const digest = frameDigest(frame);
      let item = this.store.get(id);
      if (item) {
        if (item.digest !== digest) throw new Error('Conflicting replay identity');
        item.receptions++; item.lastReceivedAt = this.now();
        await this.send(item); await this.store.persist(); this.emit('update');
        return { id, duplicate: true, incident: this.publicIncident(item) };
      }
      const priorControl = this.messaging().controls.find(record => record.id === id);
      if (priorControl) {
        if (priorControl.digest !== digest) throw new Error('Conflicting replay identity');
        priorControl.receptions++; priorControl.lastReceivedAt = this.now(); await this.send(priorControl); await this.store.persist(); this.emit('update');
        return { id, control: priorControl.kind, duplicate: true, ...(priorControl.incidentId ? { incident: this.publicIncident(this.store.get(priorControl.incidentId)) } : {}) };
      }
      const ageMs = this.now() - request.createdAt * 1000;
      if (ageMs > 24 * 60 * 60 * 1000 || ageMs < -5 * 60 * 1000) throw new Error('Request timestamp outside allowed window');
      const control = parseControlRequest(request);
      if (control) return this.ingestControl(header, request, control, digest, radio);
      if (this.store.state.incidents.length >= 4096) throw new Error('Incident store full; operator maintenance required');
      const snapshot = structuredClone(this.store.state);
      item = { id, digest, region: header.region, keyId: header.keyId, origin: header.origin, sequence: header.sequence, receivedAt: this.now(), lastReceivedAt: this.now(), receptions: 1, status: 'hub-received', reviewedAt: null, request, radio: { rssi: Number.isFinite(radio.rssi) ? radio.rssi : null, snr: Number.isFinite(radio.snr) ? radio.snr : null, hopsRemaining: header.hops }, summary: { text: deterministicSummary(request), source: 'extractive', model: null, needsReview: false }, simulated: Boolean(radio.simulated) };
      item.receipt = this.makeReceipt(item, 1);
      // Queue identity is in the same durable transaction as receipt creation. Network/model work runs later.
      this.pipeline?.initialize(item);
      this.store.state.incidents.push(item);
      try { await this.store.persist(); } catch (error) { this.store.state = snapshot; throw error; }
      await this.send(item);
      // Receipt is already durable and submitted before model invocation is scheduled.
      this.summaryQueue?.enqueue(id, request);
      this.pipeline?.wake();
      this.emit('update');
      return { id, duplicate: false, incident: this.publicIncident(item) };
    });
  }
  review(id) {
    return this.exclusive(async () => {
      const item = this.store.get(id); if (!item) throw new Error('Incident not found');
      if (item.status !== 'operator-reviewed') {
        const snapshot = structuredClone(this.store.state);
        item.status = 'operator-reviewed'; item.reviewedAt = this.now(); item.receipt = this.makeReceipt(item, 2);
        try { await this.store.persist(); } catch (error) { this.store.state = snapshot; throw error; }
      }
      await this.send(item); this.emit('update'); return this.publicIncident(item);
    });
  }
  publicIncident(item) {
    const { digest, receipt, followups, ...safe } = item;
    return structuredClone({ ...safe, canContactUser: this.canContactUser(item), followups: (followups || []).map(q => ({ id: q.id, text: q.text, source: q.source, createdAt: q.createdAt, status: q.status, attemptCount: q.attemptCount, firstAttemptAt: q.firstAttemptAt, lastAttemptAt: q.lastAttemptAt, nextAttemptAt: q.nextAttemptAt, ...(q.lastTransmission ? { lastTransmission: q.lastTransmission } : {}), ...(q.closedAt ? { closedAt: q.closedAt } : {}), ...(q.answer ? { answer: q.answer } : {}) })) });
  }
  list() { return this.store.state.incidents.map(item => this.publicIncident(item)).sort((a, b) => a.request.severity - b.request.severity || b.receivedAt - a.receivedAt); }
  export(id) {
    const item = this.store.get(id);
    if (!item) throw new Error('Incident not found');
    if (item.status !== 'operator-reviewed') throw new Error('Operator review required before export');
    return { format: 'EmergencyMesh simulated dispatch export v1', simulation: true, servicesContacted: false, exportedAt: new Date(this.now()).toISOString(), incident: this.publicIncident(item), notice: 'For hackathon demonstration only. No emergency services have been contacted or dispatched. Verify the original report and location with a human operator.' };
  }
}

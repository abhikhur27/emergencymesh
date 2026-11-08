import { EventEmitter } from 'node:events';
import { decodeFrame, encodeReceipt, frameDigest } from './codec.mjs';
import { deterministicSummary, SummaryQueue } from './summary.mjs';

export class HubCore extends EventEmitter {
  constructor({ config, store, transmit = async () => { throw new Error('No radio connected'); }, now = () => Date.now(), ai = false, model, summarize } = {}) {
    super(); this.config = config; this.store = store; this.transmit = transmit; this.now = now; this.pending = Promise.resolve(); this.rates = new Map(); this.globalRates = [];
    this.summaryQueue = new SummaryQueue({ enabled: ai, model, summarize, onResult: (id, result) => this.exclusive(async () => { const item = this.store.get(id); if (item) { item.summary = result; await this.store.persist(); this.emit('update'); } }) });
  }
  exclusive(action) { const next = this.pending.then(action); this.pending = next.catch(() => {}); return next; }
  incidentId(header) { return `${header.region}:${header.origin}:${header.sequence}`; }
  makeReceipt(item, status) {
    return encodeReceipt({ requestOrigin: item.origin, requestSequence: item.sequence, status, text: status === 1 ? 'Received by demo hub; awaiting operator review.' : 'Reviewed by demo operator. No services dispatched.' }, { region: this.config.region, keyId: this.config.keyId, origin: this.config.hubOrigin, sequence: this.store.reserveSequence(), hops: 3 }, this.config.key).toString('base64');
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
      const ageMs = this.now() - request.createdAt * 1000;
      if (ageMs > 24 * 60 * 60 * 1000 || ageMs < -5 * 60 * 1000) throw new Error('Request timestamp outside allowed window');
      if (this.store.state.incidents.length >= 4096) throw new Error('Incident store full; operator maintenance required');
      const snapshot = structuredClone(this.store.state);
      item = { id, digest, region: header.region, origin: header.origin, sequence: header.sequence, receivedAt: this.now(), lastReceivedAt: this.now(), receptions: 1, status: 'hub-received', reviewedAt: null, request, radio: { rssi: Number.isFinite(radio.rssi) ? radio.rssi : null, snr: Number.isFinite(radio.snr) ? radio.snr : null, hopsRemaining: header.hops }, summary: { text: deterministicSummary(request), source: 'extractive', model: null, needsReview: false }, simulated: Boolean(radio.simulated) };
      item.receipt = this.makeReceipt(item, 1);
      this.store.state.incidents.push(item);
      try { await this.store.persist(); } catch (error) { this.store.state = snapshot; throw error; }
      await this.send(item);
      // Receipt is already durable and submitted before model invocation is scheduled.
      this.summaryQueue.enqueue(id, request);
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
  publicIncident(item) { const { digest, receipt, ...safe } = item; return structuredClone(safe); }
  list() { return this.store.state.incidents.map(item => this.publicIncident(item)).sort((a, b) => a.request.severity - b.request.severity || b.receivedAt - a.receivedAt); }
  export(id) {
    const item = this.store.get(id);
    if (!item) throw new Error('Incident not found');
    if (item.status !== 'operator-reviewed') throw new Error('Operator review required before export');
    return { format: 'EmergencyMesh simulated dispatch export v1', simulation: true, servicesContacted: false, exportedAt: new Date(this.now()).toISOString(), incident: this.publicIncident(item), notice: 'For hackathon demonstration only. No emergency services have been contacted or dispatched. Verify the original report and location with a human operator.' };
  }
}

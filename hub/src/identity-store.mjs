import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from './atomic-json.mjs';

const SESSION_DAYS = 365;
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class IdentityStore {
  constructor(directory, { operatorToken, mongoUri = '', mongoDatabase = 'rescuemesh', namespace = 'hub-ecsw', now = () => Date.now(), mongoFactory } = {}) {
    this.file = join(directory, 'identity-store.json'); this.operatorToken = operatorToken; this.mongoUri = mongoUri; this.mongoDatabase = mongoDatabase; this.namespace = namespace; this.now = now; this.mongoFactory = mongoFactory;
    this.state = { version: 1, user: null, sessions: [], devices: [] }; this.pending = Promise.resolve(); this.client = null; this.db = null; this.mongoBusy = false; this.closed = false; this.lastMongoAttempt = 0;
    this.database = { configured: Boolean(mongoUri), connected: false, mode: 'local-spool', error: mongoUri ? 'MongoDB connection pending; local spool active.' : null, lastSyncAt: null };
  }
  async load() {
    this.state = await readJson(this.file, this.state);
    if (this.state.version !== 1 || !Array.isArray(this.state.sessions) || this.state.sessions.length > 64 || !Array.isArray(this.state.devices)) throw new Error('Invalid private identity store');
    const existing = this.state.user;
    if (!existing) {
      const salt = randomBytes(16).toString('hex');
      this.state.user = { id: `${this.namespace}:operator`, username: 'operator', role: 'operator', salt, passwordHash: scryptSync(this.operatorToken, salt, 32).toString('hex'), createdAt: this.now() };
    } else if (!/^[0-9a-f]{32}$/.test(existing.salt || '') || !/^[0-9a-f]{64}$/.test(existing.passwordHash || '')) throw new Error('Invalid private operator record');
    // Explicit credential rotation invalidates prior browser sessions; ordinary restarts do not.
    if (!this.checkPassword(this.operatorToken)) {
      const salt = randomBytes(16).toString('hex'); this.state.user = { ...this.state.user, salt, passwordHash: scryptSync(this.operatorToken, salt, 32).toString('hex'), rotatedAt: this.now() }; this.state.sessions = [];
    }
    this.prune(); await this.persist(); return this;
  }
  checkPassword(password) {
    if (typeof password !== 'string' || password.length > 256) return false;
    return equal(scryptSync(password, this.state.user.salt, 32).toString('hex'), this.state.user.passwordHash);
  }
  authenticate(body) { return (!body?.username || body.username === 'operator') && this.checkPassword(body?.password ?? body?.token); }
  prune() { this.state.sessions = this.state.sessions.filter(s => typeof s.idHash === 'string' && /^[a-f0-9]{64}$/.test(s.idHash) && s.expires > this.now()); }
  async createSession({ remember = true } = {}) {
    this.prune(); const id = randomBytes(32).toString('base64url'); const csrf = randomBytes(24).toString('base64url');
    const maxAge = (remember ? SESSION_DAYS * 24 : 8) * 60 * 60;
    if (this.state.sessions.length >= 32) this.state.sessions.shift();
    const session = { idHash: hash(id), csrf, userId: this.state.user.id, username: 'operator', createdAt: this.now(), expires: this.now() + maxAge * 1000, remember };
    this.state.sessions.push(session); await this.persist(); return { id, maxAge, ...session };
  }
  getSession(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null; this.prune(); return this.state.sessions.find(s => s.idHash === hash(id)) || null; }
  async revoke(id) { this.state.sessions = this.state.sessions.filter(s => s.idHash !== hash(id || '')); await this.persist(); }
  async setDevices(devices) { this.state.devices = structuredClone(devices); await this.persist(); }
  persist() {
    const snapshot = structuredClone(this.state); const next = this.pending.then(() => writeJsonAtomic(this.file, snapshot)); this.pending = next.catch(() => {});
    next.then(() => this.syncMongo()).catch(() => {}); return next;
  }
  status() { return structuredClone(this.database); }
  async syncMongo({ force = false } = {}) {
    if (!this.mongoUri || this.mongoBusy || this.closed || (!force && this.now() - this.lastMongoAttempt < 3000)) return;
    this.mongoBusy = true; this.lastMongoAttempt = this.now();
    try {
      if (!this.client) {
        const factory = this.mongoFactory || (async uri => { const { MongoClient } = await import('mongodb'); return new MongoClient(uri, { serverSelectionTimeoutMS: 2000, connectTimeoutMS: 2000, socketTimeoutMS: 3000, maxPoolSize: 2 }); });
        this.client = await factory(this.mongoUri); if (this.closed) { await this.client.close(); this.client = null; return; }
        await this.client.connect(); if (this.closed) { await this.client.close(); this.client = null; return; } this.db = this.client.db(this.mongoDatabase);
        await this.db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      }
      const state = structuredClone(this.state); const { id, ...user } = state.user;
      await this.db.collection('users').replaceOne({ _id: id }, { _id: id, namespace: this.namespace, ...user }, { upsert: true });
      await this.db.collection('sessions').deleteMany({ namespace: this.namespace, _id: { $nin: state.sessions.map(s => s.idHash) } });
      for (const session of state.sessions) await this.db.collection('sessions').replaceOne({ _id: session.idHash }, { _id: session.idHash, namespace: this.namespace, ...session, expiresAt: new Date(session.expires) }, { upsert: true });
      const deviceIds = state.devices.map(d => `${this.namespace}:${d.origin}:${d.keyId}`);
      await this.db.collection('devices').deleteMany({ namespace: this.namespace, _id: { $nin: deviceIds } });
      for (const device of state.devices) { const id = `${this.namespace}:${device.origin}:${device.keyId}`; await this.db.collection('devices').replaceOne({ _id: id }, { _id: id, namespace: this.namespace, ...device }, { upsert: true }); }
      this.database = { configured: true, connected: true, mode: 'mongodb', error: null, lastSyncAt: this.now() };
    } catch {
      this.database = { ...this.database, configured: true, connected: false, mode: 'local-spool', error: 'MongoDB unavailable; local durable storage remains active.' };
      await this.client?.close().catch(() => {}); this.client = null; this.db = null;
    } finally { this.mongoBusy = false; }
  }
  async close() { this.closed = true; await this.pending; await this.client?.close().catch(() => {}); }
}

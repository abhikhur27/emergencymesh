// Bounded owner for the physical receiver. Private state stays outside immutable releases.
import { fork, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, open } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const hub = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(hub, '.emergency');
const configFile = join(data, 'session-config.json');
const stateFile = join(data, 'session-state.json');
const goodFile = join(data, 'last-good-release.json');
const stopFile = join(data, 'session.stop');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
let child = null, active = null, lastGood = null, stopping = false;
let candidateHash = '', candidateSince = 0, rejectedHash = '', observedControl = '', nextHealth = 0, healthFailures = 0;
const state = { ownerPid: process.pid, startedAt: new Date().toISOString(), state: 'starting', simulation: false, restarts: 0, childPid: null, release: null, cleanupComplete: false };
async function save() { const tmp = `${stateFile}.${process.pid}.tmp`; await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`); await rename(tmp, stateFile); }
async function saveGood(release) { const tmp = `${goodFile}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify({ hash: release.hash, verifiedAt: new Date().toISOString() })); await rename(tmp, goodFile); }
async function loadGood() {
  try { const saved = await readJson(goodFile); if (!/^[a-f0-9]{64}$/.test(saved.hash)) return null; const root = join(data,'releases',saved.hash,'hub'); const validation = await readJson(join(root,'..','validated.json')); if (validation.hash !== saved.hash || !await exists(join(root,'src','cli.mjs'))) return null; return { hash: saved.hash, root }; }
  catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
}
async function exists(file) { try { const h = await open(file); await h.close(); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function filesIn(directory) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error('Release source cannot contain links');
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(file)); else if (entry.isFile()) result.push(file);
  }
  return result;
}
async function source() {
  const entries = [];
  for (const dir of ['src', 'public', 'tests', 'fixtures']) for (const file of await filesIn(join(hub, dir))) entries.push([file, join('hub', dir, file.slice(join(hub, dir).length + 1))]);
  for (const name of ['package.json', 'package-lock.json']) entries.push([join(hub, name), join('hub', name)]);
  for (const name of ['utd-ecsw.json', 'utd-campus-map.json']) entries.push([join(hub, '..', 'regions', name), join('regions', name)]);
  const hash = createHash('sha256'); const payload = [];
  for (const [file, relative] of entries) { const bytes = await readFile(file); hash.update(relative.replaceAll('\\','/')); hash.update('\0'); hash.update(bytes); payload.push({ relative, bytes }); }
  return { hash: hash.digest('hex'), payload };
}
async function command(args, cwd, timeout = 60000) {
  return new Promise((resolveResult, reject) => {
    const proc = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let output = ''; const collect = chunk => { output = (output + chunk.toString()).slice(-12000); };
    proc.stdout.on('data', collect); proc.stderr.on('data', collect);
    const timer = setTimeout(() => proc.kill(), timeout);
    proc.once('error', reject); proc.once('exit', code => { clearTimeout(timer); code === 0 ? resolveResult(output) : reject(new Error(`Candidate validation failed (${code}); current receiver preserved`)); });
  });
}
async function stage(bundle) {
  const release = join(data, 'releases', bundle.hash);
  await mkdir(release, { recursive: true });
  for (const { relative, bytes } of bundle.payload) { const target = join(release, relative); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
  const root = join(release, 'hub');
  for (const file of [...await filesIn(join(root, 'src')), ...await filesIn(join(root, 'public'))].filter(f => /\.(mjs|js)$/.test(f))) await command(['--check', file], root, 15000);
  const tests = (await filesIn(join(root, 'tests'))).filter(f => f.endsWith('.test.mjs'));
  await command(['--test', ...tests], root, 90000);
  await writeFile(join(release, 'validated.json'), JSON.stringify({ hash: bundle.hash, checkedAt: new Date().toISOString(), testFiles: tests.length }));
  return { hash: bundle.hash, root };
}
async function stopChild() {
  if (!child) return;
  const owned = child;
  if (owned.exitCode === null && owned.signalCode === null) {
    try { if (owned.connected) owned.send({ type: 'shutdown' }); } catch {}
    const exited = new Promise(r => owned.once('exit', r));
    await Promise.race([exited, sleep(15000)]);
    if (owned.exitCode === null && owned.signalCode === null) { owned.kill(); await Promise.race([exited, sleep(5000)]); }
  }
  child = null; state.childPid = null;
}
async function logoutProbe(probe) {
  if (!probe.cookie || !probe.csrf) return;
  const origin = 'http://127.0.0.1:4781';
  await fetch(`${origin}/api/logout`, { method: 'POST', headers: { Origin: origin, Cookie: probe.cookie, 'X-CSRF-Token': probe.csrf, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) }).catch(() => {});
}
async function verifyReceiver(probe = null) {
  const origin = 'http://127.0.0.1:4781';
  const token = (await readFile(join(data, 'operator-token.txt'), 'utf8')).trim();
  const ownsProbe = !probe; probe ||= {};
  try {
    if (!probe.cookie) {
      const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'operator', password: token, remember: false }), signal: AbortSignal.timeout(5000) });
      if (!login.ok) throw new Error('Receiver sign-in check failed');
      probe.cookie = login.headers.get('set-cookie')?.split(';')[0] || ''; probe.csrf = (await login.json()).csrf;
    }
    const response = await fetch(`${origin}/api/state`, { headers: { Cookie: probe.cookie }, signal: AbortSignal.timeout(5000) });
    const value = await response.json();
    if (!response.ok || value.simulation || value.link?.mode !== 'serial' || value.link?.readiness !== 'ready' || !value.link.connected || value.ai?.model !== 'nemotron-3-nano:4b') throw new Error('Physical receiver readiness check failed');
    state.lastVerifiedAt = new Date().toISOString(); state.radioReady = true; state.savedReports = value.incidents.length;
  } finally {
    if (ownsProbe) await logoutProbe(probe);
  }
}
async function launch(release, config) {
  await stopChild();
  const stdout = await open(join(data, 'session-hub.stdout.log'), 'a'); const stderr = await open(join(data, 'session-hub.stderr.log'), 'a');
  const minutes = Math.max(0.1, Math.min(1440, (Date.parse(config.untilUtc) - Date.now()) / 60000));
  child = fork(join(release.root, 'src', 'cli.mjs'), ['start','--data',data,'--serial',config.serialPort,'--ollama','--model','nemotron-3-nano:4b','--minutes',String(minutes)], { cwd: release.root, windowsHide: true, stdio: ['ignore',stdout.fd,stderr.fd,'ipc'] });
  await stdout.close(); await stderr.close();
  state.childPid = child.pid; state.release = release.hash; state.restarts++; state.state = 'starting'; state.radioReady = false; await save();
  const probe = {};
  try { for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(750);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Receiver exited during startup');
    try { await verifyReceiver(probe); active = release; lastGood = release; await saveGood(release); state.state = 'running'; await save(); return; } catch { /* USB reset and readiness are bounded. */ }
  } } finally { await logoutProbe(probe); }
  throw new Error('Receiver did not verify within startup budget');
}
async function readConfig() {
  const c = await readJson(configFile);
  if (!/^COM[1-9][0-9]*$/.test(c.serialPort) || !Number.isFinite(Date.parse(c.untilUtc)) || Date.parse(c.untilUtc) > Date.now() + 3*86400000) throw new Error('Invalid bounded receiver session');
  return c;
}
process.once('SIGINT', () => { stopping = true; }); process.once('SIGTERM', () => { stopping = true; });
try {
  let config = await readConfig(); state.untilUtc = config.untilUtc; state.serialPort = config.serialPort; state.workingDirectory = hub; await save();
  const savedGood = await loadGood(); let first;
  try { first = await stage(await source()); }
  catch (error) { if (!savedGood) throw error; first = savedGood; state.lastValidationError = error.message; }
  try { await launch(first, config); }
  catch (error) { if (!savedGood || savedGood.hash === first.hash) throw error; state.lastRestartError = error.message; rejectedHash = first.hash; await launch(savedGood, config); }
  observedControl = String(config.revision || 0);
  while (!stopping && Date.now() < Date.parse(config.untilUtc) && !await exists(stopFile)) {
    await sleep(3000);
    try { config = await readConfig(); state.controlError = null; }
    catch { state.controlError = 'Session control is temporarily invalid; retaining the last valid configuration'; await save(); }
    if (config.paused) { await stopChild(); state.state = 'paused'; state.radioReady = false; await save(); continue; }
    if (Date.now() >= nextHealth && child && child.exitCode === null && child.signalCode === null) {
      nextHealth = Date.now() + 30000;
      try { await verifyReceiver(); healthFailures = 0; await save(); }
      catch { state.radioReady = false; if (++healthFailures >= 3) { state.lastRestartReason = 'Three consecutive physical receiver checks failed'; await stopChild(); healthFailures = 0; } await save(); }
    }
    let bundle = null;
    try { bundle = await source(); state.sourceError = null; }
    catch { state.sourceError = 'Update source is temporarily incomplete; retaining the validated receiver'; await save(); }
    if (bundle && bundle.hash !== candidateHash) { candidateHash = bundle.hash; candidateSince = Date.now(); }
    let chosen = active;
    if (bundle && bundle.hash !== active.hash && bundle.hash !== rejectedHash && Date.now() - candidateSince >= 30000) {
      try { chosen = await stage(bundle); rejectedHash = ''; state.lastValidationError = null; }
      catch (error) { rejectedHash = bundle.hash; state.lastValidationError = error.message; state.rejectedAt = new Date().toISOString(); await save(); }
    }
    const control = String(config.revision || 0);
    if (!child || child.exitCode !== null || child.signalCode !== null || chosen.hash !== active.hash || control !== observedControl) {
      const fallback = lastGood;
      try { await launch(chosen, config); observedControl = control; }
      catch (error) { state.lastRestartError = error.message; await stopChild(); if (fallback && fallback.hash !== chosen.hash) { rejectedHash = chosen.hash; await launch(fallback, config); } else { state.state = 'retrying'; await save(); await sleep(10000); } }
    }
  }
  state.state = 'expired-or-stopped';
} catch (error) { state.state = 'failed'; state.error = error.message; process.exitCode = 1; }
finally { await stopChild(); state.cleanupComplete = true; state.endedAt = new Date().toISOString(); await save(); }

import { resolve } from 'node:path';
import { provision, loadConfig, createOperatorToken, dataPath, prepareDeviceRegistry, loadRuntime } from './config.mjs';
import { IncidentStore } from './store.mjs';
import { HubCore } from './core.mjs';
import { createHubServer } from './server.mjs';
import { connectSerial } from './serial.mjs';
import { simulationTransport } from './simulation.mjs';
import { IdentityStore } from './identity-store.mjs';
import { publicDevices } from './device-keyring.mjs';
import { loadRegionProfile } from './region.mjs';
import { CoordinationPipeline } from './coordination.mjs';

function parse(args) {
  const result = { command: args.shift() || 'start' };
  while (args.length) {
    const flag = args.shift();
    if (['--simulate', '--ollama'].includes(flag)) result[flag.slice(2)] = true;
    else if (['--data', '--serial', '--port', '--model', '--minutes', '--region'].includes(flag) && args.length) result[flag.slice(2)] = args.shift();
    else throw new Error(`Unknown or incomplete argument: ${flag}`);
  }
  return result;
}

async function main() {
  const args = parse(process.argv.slice(2)); const directory = dataPath(args.data);
  if (args.command === 'provision') {
    const receipt = await provision(directory, { region: args.region === undefined ? 1 : Number(args.region) });
    console.log(`Hub configuration: ${receipt.configFile}\nPrivate iPhone profile: ${receipt.phoneFile}\nTransfer the phone profile privately. Do not commit or share it in screenshots.`); return;
  }
  if (args.command === 'ports') { const { SerialPort } = await import('serialport'); console.log(JSON.stringify(await SerialPort.list(), null, 2)); return; }
  if (args.command !== 'start') throw new Error('Use start, provision, or ports');
  if (args.simulate && args.serial) throw new Error('Choose --simulate or --serial, not both');
  const port = args.port === undefined ? 4781 : Number(args.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be1024..65535');
  const minutes = args.minutes === undefined ? 120 : Number(args.minutes);
  if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > 1440) throw new Error('Minutes must be0.1..1440');
  let config;
  try { config = await loadConfig(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; throw new Error('Hub configuration missing. Run the explicit provision command; startup never silently changes the region or keys.'); }
  await prepareDeviceRegistry(directory, config);
  const runtime = await loadRuntime(directory); const regionProfile = await loadRegionProfile(directory);
  const model = args.model || runtime.model;
  const { token, tokenFile } = await createOperatorToken(directory);
  const store = await new IncidentStore(directory).load();
  const core = new HubCore({ config, store, standaloneSummary: false });
  const pipeline = new CoordinationPipeline({ core, runtime: { ...runtime, model }, region: regionProfile, enabled: Boolean(args.ollama) });
  const identities = new IdentityStore(directory, { operatorToken: token, mongoUri: runtime.mongoUri, mongoDatabase: runtime.mongoDatabase, namespace: `hub-${runtime.hubId}` });
  let link = { mode: 'disconnected', connected: false }; let radio = null;
  if (args.simulate) { const simulator = simulationTransport(config); core.transmit = simulator.transmit; link = { mode: 'simulation', connected: true, note: 'Software only; no radio or phone connected' }; }
  else if (args.serial) { radio = await connectSerial(args.serial, (frame, metadata) => core.ingest(frame, metadata), state => { link = state; }, { region: config.region, keyId: config.keyId, frequency: 915 }); core.transmit = radio.transmit; }
  const app = createHubServer({ core, config, operatorToken: token, identities, regionProfile, pipeline, simulation: Boolean(args.simulate), getLink: () => link, ai: Boolean(args.ollama), model });
  const { origin } = await app.listen(port);
  await identities.setDevices(publicDevices(config)); await pipeline.start();
  const databaseTimer = setInterval(() => { void identities.syncMongo(); }, 10000); databaseTimer.unref();
  console.log(`RescueMesh ${runtime.hubName} hub: ${origin}\nOperator credential file: ${tokenFile}\nMode: ${link.mode}. Emergency-service dispatch is simulated.\nBounded session ends after ${minutes} minutes. Ctrl+C stops it sooner.`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; clearTimeout(timer); clearInterval(databaseTimer); await pipeline.close(); await app.close(); if (radio) await radio.close(); if (process.connected) process.disconnect(); process.exitCode = 0; };
  const timer = setTimeout(stop, minutes * 60000);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  // A forked physical receiver must not outlive its controlling session owner.
  if (process.connected) process.once('disconnect', () => { void stop(); });
  process.on('message', message => { if (message?.type === 'shutdown') void stop(); });
}
main().catch(error => { console.error(error.code === 'ENOENT' ? 'Required file or device unavailable.' : error.message); process.exitCode = 1; });

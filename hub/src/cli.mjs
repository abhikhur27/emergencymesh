import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { provision, loadConfig, createOperatorToken, dataPath } from './config.mjs';
import { IncidentStore } from './store.mjs';
import { HubCore } from './core.mjs';
import { createHubServer } from './server.mjs';
import { connectSerial } from './serial.mjs';
import { simulationTransport } from './simulation.mjs';

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
  catch (error) { if (error.code !== 'ENOENT') throw error; await provision(directory); config = await loadConfig(directory); }
  const { token, tokenFile } = await createOperatorToken(directory);
  const store = await new IncidentStore(directory).load();
  const core = new HubCore({ config, store, ai: Boolean(args.ollama), model: args.model });
  let link = { mode: 'disconnected', connected: false }; let radio = null;
  if (args.simulate) { const simulator = simulationTransport(config); core.transmit = simulator.transmit; link = { mode: 'simulation', connected: true, note: 'Software only; no radio or phone connected' }; }
  else if (args.serial) { radio = await connectSerial(args.serial, (frame, metadata) => core.ingest(frame, metadata), state => { link = state; }, { region: config.region, keyId: config.keyId, frequency: 915 }); core.transmit = radio.transmit; }
  const app = createHubServer({ core, config, operatorToken: token, simulation: Boolean(args.simulate), getLink: () => link, ai: Boolean(args.ollama), model: args.model || process.env.OLLAMA_MODEL || 'llama3.2:latest' });
  const { origin } = await app.listen(port);
  console.log(`EmergencyMesh demo console: ${origin}\nOperator access code file: ${tokenFile}\nMode: ${link.mode}. No emergency services are connected.\nBounded session ends after ${minutes} minutes. Ctrl+C stops it sooner.`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; clearTimeout(timer); await app.close(); if (radio) await radio.close(); process.exitCode = 0; };
  const timer = setTimeout(stop, minutes * 60000);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(error => { console.error(error.code === 'ENOENT' ? 'Required file or device unavailable.' : error.message); process.exitCode = 1; });

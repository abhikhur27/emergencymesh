import { encodeRequest, decodeFrame } from './codec.mjs';
import { uint32 } from './config.mjs';
import { hasDeviceKeyring, resolveDeviceKey } from './device-keyring.mjs';

export function simulatedRequest(now = Date.now()) {
  return { category: 3, severity: 2, people: 2, flags: 1 | 4, createdAt: Math.floor(now / 1000), latitude: 32.9858, longitude: -96.7501, accuracy: 12, battery: 77, note: 'DEMO: Two people need assistance near the east entrance.' };
}
export async function injectSimulation(core, config, now = Date.now()) {
  const device = hasDeviceKeyring(config) ? config.devices.find(d => !d.revokedAt) : null;
  if (hasDeviceKeyring(config) && !device) throw new Error('Provision a simulation phone before injecting a test report');
  const origin = device?.origin || uint32() || 1; const keyId = device?.keyId || config.keyId;
  const key = device ? resolveDeviceKey(config, origin, keyId) : config.key;
  const frame = encodeRequest(simulatedRequest(now), { region: config.region, keyId, origin, sequence: uint32() || 1, hops: 1 }, key);
  const result = await core.ingest(frame, { rssi: -83, snr: 7.5, simulated: true });
  return { ...result, frameBytes: frame.length };
}

export function simulationTransport(config) {
  const transmissions = [];
  return {
    transmissions,
    transmit: async frame => {
      let decoded;
      if (hasDeviceKeyring(config)) {
        for (const device of config.devices.filter(d => !d.revokedAt)) { try { decoded = decodeFrame(frame, { region: config.region, keyId: device.keyId, key: resolveDeviceKey(config, device.origin, device.keyId) }); break; } catch { /* A simulated receiver has only its enrolled phone key. */ } }
        if (!decoded) throw new Error('Receipt did not authenticate for an enrolled simulated phone');
      } else decoded = decodeFrame(frame, config);
      if (decoded.header.type !== 2) throw new Error('Expected encrypted receipt');
      transmissions.push({ frame: Buffer.from(frame), decoded });
      if (transmissions.length > 200) transmissions.shift();
    },
  };
}

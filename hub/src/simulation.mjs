import { encodeRequest, decodeFrame } from './codec.mjs';
import { uint32 } from './config.mjs';

export function simulatedRequest(now = Date.now()) {
  return { category: 3, severity: 2, people: 2, flags: 1 | 4, createdAt: Math.floor(now / 1000), latitude: 32.9858, longitude: -96.7501, accuracy: 12, battery: 77, note: 'DEMO: Two people need assistance near the east entrance.' };
}
export async function injectSimulation(core, config, now = Date.now()) {
  const frame = encodeRequest(simulatedRequest(now), { region: config.region, keyId: config.keyId, origin: uint32() || 1, sequence: 1, hops: 1 }, config.key);
  const result = await core.ingest(frame, { rssi: -83, snr: 7.5, simulated: true });
  return { ...result, frameBytes: frame.length };
}

export function simulationTransport(config) {
  const transmissions = [];
  return {
    transmissions,
    transmit: async frame => {
      const decoded = decodeFrame(frame, config);
      if (decoded.header.type !== 2) throw new Error('Expected encrypted receipt');
      transmissions.push({ frame: Buffer.from(frame), decoded });
      if (transmissions.length > 200) transmissions.shift();
    },
  };
}

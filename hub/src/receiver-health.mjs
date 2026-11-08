import { validateReadiness } from './serial.mjs';

// Process health is authenticated dashboard availability. USB/RF readiness is
// independent: an unplugged board must not hide already-saved incidents.
export function receiverHealth(value, { serialPort, model = 'nemotron-3-nano:4b' } = {}) {
  if (!value || value.simulation !== false || value.link?.mode !== 'serial' || value.link.path !== serialPort ||
      typeof value.link.connected !== 'boolean' || typeof value.link.portOpen !== 'boolean' ||
      typeof value.link.readiness !== 'string' || value.ai?.model !== model || !Array.isArray(value.incidents)) {
    throw new Error('Authenticated receiver dashboard check failed');
  }
  const radioReady = value.link.portOpen && value.link.connected && value.link.readiness === 'ready' &&
    validateReadiness(value.link.board, { region: value.region, keyId: value.keyId, frequency: 915 }) === 'ready';
  return { radioReady, radioReadiness: value.link.readiness, savedReports: value.incidents.length };
}

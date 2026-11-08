// Application messages carried by the existing authenticated v1 envelopes.
// Firmware forwards these bytes opaquely; capability negotiation prevents
// receipt text from becoming an unreadable question in an older phone app.
export const CAPABILITY_NOTE = 'RMC1|Q1';
export const CAPABILITY_ACK = 'RMC1|Q1|OK';
export const MAX_QUESTION_BYTES = 66;
export const MAX_ANSWER_BYTES = 97;
export const MAX_QUESTIONS_PER_INCIDENT = 12;
export const MAX_CONTROL_RECORDS = 4096;
export const FOLLOWUP_RETRY_DELAYS = Object.freeze([0, 10000, 25000, 45000]);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const hex = /^[0-9a-f]{8}$/;

export function followupError(message, status = 400) { return Object.assign(new Error(message), { status, code: 'FOLLOWUP_INVALID' }); }
export function idHex(value, name = 'identifier') {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff) throw followupError(`Invalid ${name}`);
  return value.toString(16).padStart(8, '0');
}
export function parseHex(value, name = 'identifier') {
  if (typeof value !== 'string' || !hex.test(value) || value === '00000000') throw followupError(`Invalid ${name}`);
  return Number.parseInt(value, 16);
}
export function messageText(value, maximum, name) {
  if (typeof value !== 'string' || value !== value.trim() || !value || /[\u0000-\u001f\u007f]/u.test(value)) throw followupError(`Enter ${name} without control characters or surrounding spaces`);
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > maximum || utf8.decode(encoded) !== value) throw followupError(`${name} must fit within ${maximum} UTF-8 bytes`);
  return value;
}
export function encodeQuestionText(questionId, text) {
  parseHex(questionId, 'question ID');
  return `RMQ1|${questionId}|${messageText(text, MAX_QUESTION_BYTES, 'Question')}`;
}
export function parseQuestionText(value) {
  if (typeof value !== 'string' || !value.startsWith('RMQ1|')) return null;
  const match = /^RMQ1\|([0-9a-f]{8})\|([\s\S]+)$/.exec(value);
  if (!match) throw followupError('Invalid question message');
  parseHex(match[1], 'question ID');
  return { questionId: match[1], text: messageText(match[2], MAX_QUESTION_BYTES, 'Question') };
}
export function encodeReplyNote(requestSequence, questionId, text) {
  parseHex(questionId, 'question ID');
  return `RMR1|${idHex(requestSequence, 'request sequence')}|${questionId}|${messageText(text, MAX_ANSWER_BYTES, 'Answer')}`;
}
export function parseControlRequest(request) {
  const note = request.note;
  if (note === CAPABILITY_NOTE) {
    if (request.category !== 8 || request.severity !== 3 || request.people !== 1 || request.flags !== 0 || request.battery !== 255) throw followupError('Invalid messaging capability fields');
    return { kind: 'capability' };
  }
  if (typeof note !== 'string') return null;
  if (note.startsWith('RMR1|')) {
    const match = /^RMR1\|([0-9a-f]{8})\|([0-9a-f]{8})\|([\s\S]+)$/.exec(note);
    if (!match) throw followupError('Invalid answer message');
    return { kind: 'reply', requestSequence: parseHex(match[1], 'request sequence'), questionId: idHex(parseHex(match[2], 'question ID')), text: messageText(match[3], MAX_ANSWER_BYTES, 'Answer') };
  }
  if (/^RM[CQR]1\|/.test(note)) throw followupError('Invalid reserved messaging request');
  return null;
}
export const deviceIdentity = ({ region, origin, keyId }) => `${region}:${origin}:${keyId}`;

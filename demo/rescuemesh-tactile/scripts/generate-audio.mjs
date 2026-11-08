import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const rate = 48000, seconds = 12, frames = rate * seconds;
const left = new Float64Array(frames), right = new Float64Array(frames);
const events = [];
function tone({frame, frequency, duration, amplitude, attack = .002, decay = 7, pan = 0, harmonic = 0}) {
  events.push({frame, frequency, duration, amplitude, pan});
  const start = Math.round(frame / 30 * rate), count = Math.round(duration * rate);
  const l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < count && start + i < frames; i++) {
    const t = i / rate, x = i / count;
    const envelope = Math.min(1, t / attack) * Math.exp(-decay * x) * Math.min(1, (duration - t) / .008);
    const wave = Math.sin(2 * Math.PI * frequency * t) + harmonic * Math.sin(2 * Math.PI * frequency * 2 * t);
    const sample = amplitude * wave * envelope;
    left[start + i] += sample * l; right[start + i] += sample * r;
  }
}
// Original synthesized tones only. No stock samples, music, speech or telemetry.
tone({frame: 12, frequency: 1318.51, duration: .16, amplitude: .17, decay: 9});
tone({frame: 55, frequency: 80, duration: .085, amplitude: .26, decay: 5});
tone({frame: 55, frequency: 3200, duration: .03, amplitude: .12, decay: 7});
tone({frame: 63, frequency: 55, duration: .24, amplitude: .42, decay: 5});
tone({frame: 63, frequency: 3900, duration: .055, amplitude: .11, decay: 8});
for (let i = 0; i < 3; i++) {
  tone({frame: 118 + i * 18, frequency: 4000 * 2 ** (i / 12), duration: .038, amplitude: .15, decay: 9, pan: -.5 + i * .5});
  tone({frame: 118 + i * 18, frequency: 660 * 2 ** (i / 12), duration: .09, amplitude: .075, decay: 7, pan: -.5 + i * .5});
}
tone({frame: 178, frequency: 523.251, duration: .48, amplitude: .22, decay: 5, harmonic: .12});
tone({frame: 181, frequency: 783.991, duration: .46, amplitude: .17, decay: 5, harmonic: .08});
tone({frame: 178, frequency: 65.406, duration: .6, amplitude: .16, decay: 6});
tone({frame: 244, frequency: 1318.51, duration: .15, amplitude: .08, decay: 9});
let peak = 0, energy = 0;
for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const gain = peak > .7 ? .7 / peak : 1;
const wav = Buffer.alloc(44 + frames * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) {
  const l = left[i] * gain, r = right[i] * gain; energy += l * l + r * r;
  wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
}
const output = fileURLToPath(new URL('../public/audio/tactile-score.wav', import.meta.url));
mkdirSync(fileURLToPath(new URL('../public/audio/', import.meta.url)), {recursive: true}); writeFileSync(output, wav);
const receipt = {sampleRate: rate, channels: 2, durationSeconds: seconds, peak: peak * gain, rms: Math.sqrt(energy / (frames * 2)), clippedSamples: 0, events, provenance: 'Original deterministic PCM synthesis by this project; no external samples'};
writeFileSync(fileURLToPath(new URL('../public/audio/synthesis.json', import.meta.url)), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({output, ...receipt}));

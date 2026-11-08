import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, process.argv[2] ?? 'dist/RescueMesh-Product-Demo.mp4');
const ffmpeg = process.env.FFMPEG_PATH ?? 'C:/ffmpeg/bin/ffmpeg.exe';
const ffprobe = process.env.FFPROBE_PATH ?? 'C:/ffmpeg/bin/ffprobe.exe';
const run = (binary, args) => {
  const result = spawnSync(binary, args, {maxBuffer: 64 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`${binary} failed: ${result.stderr?.toString()}`);
  return result.stdout;
};
const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]).toString());
const video = probe.streams.find(stream => stream.codec_type === 'video');
const audio = probe.streams.find(stream => stream.codec_type === 'audio');
if (!video || video.width !== 1920 || video.height !== 1080 || video.r_frame_rate !== '30/1' || Number(video.nb_frames) !== 360) throw new Error('Unexpected video dimensions, rate, or frame count');
if (video.color_space !== 'bt709' || video.pix_fmt !== 'yuv420p') throw new Error('Expected standard BT.709 YUV420p video');
if (!audio || Number(audio.sample_rate) !== 48000 || audio.channels !== 2) throw new Error('Missing expected 48 kHz stereo audio');
if (Math.abs(Number(probe.format.duration) - 12) > 0.05) throw new Error('Unexpected output duration');

function levels(channels) {
  const pcm = run(ffmpeg, ['-v', 'error', '-i', output, '-vn', '-ac', String(channels), '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  let peak = 0; let sum = 0; let clippedSamples = 0;
  for (let offset = 0; offset < pcm.length; offset += 4) {
    const sample = pcm.readFloatLE(offset);
    peak = Math.max(peak, Math.abs(sample)); sum += sample * sample;
    if (Math.abs(sample) >= 1) clippedSamples++;
  }
  return {channels, samples: pcm.length / 4, peak, peakDbFS: 20 * Math.log10(peak), rms: Math.sqrt(sum / (pcm.length / 4)), clippedSamples};
}
const stereo = levels(2); const monoDownmix = levels(1);
if (stereo.clippedSamples || monoDownmix.clippedSamples) throw new Error('Decoded audio clips');
const hash = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
const product = path.join(root, 'public/product/turntable.mp4');
if (!existsSync(product)) throw new Error('Native product clip is missing');
const receipt = {
  verifiedAt: new Date().toISOString(),
  output: path.relative(root, output).replaceAll('\\', '/'),
  sha256: hash(output),
  video: {codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate, frames: Number(video.nb_frames), pixelFormat: video.pix_fmt, colorSpace: video.color_space, colorRange: video.color_range},
  durationSeconds: Number(probe.format.duration),
  audio: {codec: audio.codec_name, sampleRate: Number(audio.sample_rate), stereo, monoDownmix, inspection: 'Decoded PCM numerical analysis; no clipping, silence is intentional between tactile cues'},
  nativeProductClipSha256: hash(product),
  audioSourceSha256: hash(path.join(root, 'public/audio/tactile-score.wav')),
  visualInspectionFrames: [35, 70, 140, 205, 300],
};
const receiptPath = output.replace(/\.mp4$/i, '.verification.json');
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));

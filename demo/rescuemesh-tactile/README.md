# RescueMesh product film

Editable Remotion source for the twelve-second product film. See [BRIEF.md](BRIEF.md) for scene boundaries and sound timings. The Studio has the full film and each scene as an individual composition.

```powershell
npm ci
npm run dev
npm run lint
node scripts/generate-audio.mjs
node scripts/render-final.mjs
```

`render-final.mjs` requires the actual Blender clip at `public/product/turntable.mp4`. It exports `dist/RescueMesh-Product-Demo.mp4` and a verification receipt with frame count, duration, hashes and decoded stereo/mono audio peak checks. It expects FFmpeg and FFprobe in `C:/ffmpeg/bin`; use `FFMPEG_PATH` and `FFPROBE_PATH` to override those paths on a Mac.

The film is 1920×1080, 30 fps, BT.709 H.264 with AAC stereo audio. PNG frame capture preserves the brand colors through the video conversion. No paid generation services, external audio samples, credentials or private request data are included. Brand artwork comes from the supplied RescueMesh assets; the sound score is original PCM synthesis.

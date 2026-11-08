import {AbsoluteFill, Sequence, staticFile} from 'remotion';
import {Audio} from '@remotion/media';
import {AcknowledgmentScene, BroadcastScene, OfflineScene, ProductScene, RelayScene} from './Scenes';

export const Main = () => <AbsoluteFill>
  <Sequence name="Offline phone" durationInFrames={50}><OfflineScene /></Sequence>
  <Sequence name="Tactile send" from={50} durationInFrames={50}><BroadcastScene /></Sequence>
  <Sequence name="Encrypted mesh relay" from={100} durationInFrames={76}><RelayScene /></Sequence>
  <Sequence name="Authenticated hub receipt" from={176} durationInFrames={64}><AcknowledgmentScene /></Sequence>
  <Sequence name="Native product turntable" from={240} durationInFrames={120}><ProductScene /></Sequence>
  <Audio name="Original tactile sound design" src={staticFile('audio/tactile-score.wav')} volume={0.78} />
</AbsoluteFill>;

import {Composition} from 'remotion';
import {Main} from './Main';
import {AcknowledgmentScene, BroadcastScene, OfflineScene, ProductScene, RelayScene} from './Scenes';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="RescueMeshTactileDemo" component={Main} durationInFrames={360} fps={30} width={1920} height={1080} />
      <Composition id="OfflinePhone" component={OfflineScene} durationInFrames={50} fps={30} width={1920} height={1080} />
      <Composition id="TactileSend" component={BroadcastScene} durationInFrames={50} fps={30} width={1920} height={1080} />
      <Composition id="MeshRelay" component={RelayScene} durationInFrames={76} fps={30} width={1920} height={1080} />
      <Composition id="HubReceipt" component={AcknowledgmentScene} durationInFrames={64} fps={30} width={1920} height={1080} />
      <Composition id="ProductTurntable" component={ProductScene} durationInFrames={120} fps={30} width={1920} height={1080} />
    </>
  );
};

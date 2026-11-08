import {AbsoluteFill, getStaticFiles, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Video} from '@remotion/media';
import {PhoneReport} from './components/PhoneReport';
import {MeshDiagram} from './components/MeshDiagram';
import {Icon} from './components/Icons';
import {INK, MAGENTA, MESH_WAVE_SPRING, TACTILE_SPRING, TYPE} from './constants/springs';

const dark = '#0d0d12';
const cap = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};
const Brand = () => <div style={{position: 'absolute', left: 140, top: 73, display: 'flex', alignItems: 'center', gap: 13, fontSize: 33, fontWeight: 700, letterSpacing: -1, color: 'white'}}><Img src={staticFile('brand/rescuemesh-mark.png')} style={{width: 31, height: 40, objectFit: 'contain'}} /><span>Rescue<span style={{color: '#ff4b9f'}}>Mesh</span></span></div>;

export const OfflineScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entrance = spring({frame: frame - 4, fps, config: TACTILE_SPRING});
  return <AbsoluteFill style={{background: dark, fontFamily: TYPE}}>
    <Brand />
    {[0, 18, 36].map(delay => { const phase = ((frame + delay) % 76) / 76; return <div key={delay} style={{position: 'absolute', left: 520, top: 540, width: 620, height: 620, translate: '-50% -50%', scale: 0.7 + phase * 0.65, border: `1px solid ${MAGENTA}`, borderRadius: '50%', opacity: (1 - phase) * 0.15}} />; })}
    <PhoneReport globalFrame={frame} />
    <div style={{position: 'absolute', left: 955, top: 290, width: 820, opacity: Math.max(0, Math.min(1, entrance)), translate: `${interpolate(entrance, [0, 1], [20, 0])}px 0`}}>
      <h1 style={{margin: 0, color: 'white', fontSize: 100, fontWeight: 650, lineHeight: 1.04, letterSpacing: -4}}>No cellular.<br />Still connected.</h1>
      <div style={{display: 'flex', gap: 15, marginTop: 43, color: '#babac4', fontSize: 29}}><span>Cellular off</span><span style={{color: '#555561'}}>·</span><span>Wi-Fi off</span></div>
      <div style={{marginTop: 44, display: 'flex', alignItems: 'center', gap: 16, fontSize: 31, color: 'white'}}><div style={{width: 11, height: 11, background: '#ff399a', borderRadius: '50%'}} />Bluetooth + LoRa mesh</div>
    </div>
  </AbsoluteFill>;
};

export const BroadcastScene = () => {
  const frame = useCurrentFrame(); const globalFrame = frame + 50;
  const {fps} = useVideoConfig(); const release = spring({frame: frame - 13, fps, config: MESH_WAVE_SPRING});
  return <AbsoluteFill style={{background: dark, fontFamily: TYPE}}>
    <Brand /><PhoneReport globalFrame={globalFrame} />
    <div style={{position: 'absolute', left: 955, top: 290, width: 820}}>
      <h1 style={{margin: 0, color: 'white', fontSize: 92, fontWeight: 650, lineHeight: 1.04, letterSpacing: -4}}>One tap.<br />Request in motion.</h1>
      <div style={{marginTop: 44, width: 680, padding: '25px 30px', borderRadius: 25, border: '1px solid #ffffff22', background: '#ffffff09', backdropFilter: 'blur(30px)', display: 'flex', alignItems: 'center', gap: 20, opacity: interpolate(frame, [10, 18], [0, 1], cap), scale: interpolate(release, [0, 1], [0.94, 1])}}>
        <Icon name="lock" size={43} style={{color: '#ff4b9f'}} /><div><div style={{fontSize: 33, color: '#fff', fontWeight: 600}}>Encrypted on your phone</div><div style={{fontSize: 25, color: '#ababba', marginTop: 6}}>The relay carries an opaque packet.</div></div>
      </div>
    </div>
  </AbsoluteFill>;
};

export const RelayScene = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: dark, fontFamily: TYPE}}><Brand />
    <h1 style={{position: 'absolute', left: 140, top: 160, margin: 0, fontSize: 88, fontWeight: 650, lineHeight: 1.06, color: 'white', letterSpacing: -3}}>A nearby radio.<br />Then the next.</h1>
    <MeshDiagram frame={frame} />
  </AbsoluteFill>;
};

export const AcknowledgmentScene = () => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  const settle = spring({frame, fps, config: TACTILE_SPRING});
  return <AbsoluteFill style={{background: dark, fontFamily: TYPE}}><Brand />
    <div style={{opacity: interpolate(frame, [0, 9], [0.4, 0], cap), scale: interpolate(frame, [0, 12], [1, 0.65], cap)}}><MeshDiagram frame={76} muted /></div>
    <div style={{position: 'absolute', left: 320, top: 260, width: 1280, color: 'white', textAlign: 'center', scale: interpolate(settle, [0, 1], [0.88, 0.98]), opacity: Math.min(1, settle)}}>
      <div style={{width: 100, height: 100, borderRadius: '50%', margin: '0 auto 40px', background: '#14382b', color: '#81e0ac', display: 'flex', alignItems: 'center', justifyContent: 'center'}}><Icon name="check" size={57} /></div>
      <h1 style={{margin: 0, fontSize: 104, fontWeight: 650, lineHeight: 1.05, letterSpacing: -4}}>Received by ECSW.</h1>
      <div style={{position: 'relative', overflow: 'hidden', margin: '42px auto 0', width: 990, padding: '32px 35px', borderRadius: 34, border: '1px solid #ffffff26', background: '#ffffff0c', backdropFilter: 'blur(30px)', display: 'flex', justifyContent: 'center', gap: 19, alignItems: 'center', boxShadow: '0 26px 65px #0004'}}>
        <Icon name="lock" size={37} style={{color: '#ff55a4'}} /><span style={{fontSize: 45, fontWeight: 550}}>Hub receipt confirmed</span>
        <div style={{position: 'absolute', top: -100, bottom: -100, left: -450, width: 370, background: 'linear-gradient(105deg,transparent,rgba(255,255,255,.14),transparent)', translate: `${interpolate(frame, [9, 35], [0, 1900], cap)}px 0`, rotate: '-7deg'}} />
      </div>
    </div>
  </AbsoluteFill>;
};

export const ProductScene = () => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  const ready = getStaticFiles().some(file => file.name === 'product/turntable.mp4');
  const entrance = spring({frame: frame - 3, fps, config: MESH_WAVE_SPRING});
  return <AbsoluteFill style={{background: '#fff', fontFamily: TYPE, color: INK}}>
    {ready ? <Video src={staticFile('product/turntable.mp4')} objectFit="contain" style={{position: 'absolute', width: '100%', height: '100%'}} muted /> : <div style={{position: 'absolute', left: 200, top: 390, width: 840, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7a7a83', fontSize: 31}}>Product render in progress</div>}
    <div style={{position: 'absolute', left: 1120, top: 383, width: 650, opacity: Math.max(0, Math.min(1, entrance)), translate: `${interpolate(entrance, [0, 1], [24, 0])}px 0`}}>
      <Img src={staticFile('brand/rescuemesh-wordmark.png')} style={{width: 590, height: 'auto'}} />
      <h1 style={{fontSize: 57, lineHeight: 1.12, letterSpacing: -1.7, fontWeight: 560, margin: '43px 0 0'}}>A connection<br />when it matters.</h1>
      <div style={{height: 4, width: 78, borderRadius: 3, background: MAGENTA, marginTop: 37}} />
    </div>
  </AbsoluteFill>;
};

import {Img, interpolate, spring, staticFile, useVideoConfig} from 'remotion';
import {Icon} from './Icons';
import {MAGENTA, TACTILE_SPRING, TYPE} from '../constants/springs';

export const PhoneReport = ({globalFrame}: {globalFrame: number}) => {
  const {fps} = useVideoConfig();
  const released = globalFrame >= 63;
  const press = interpolate(globalFrame, [54, 55, 62, 63], [1, 0.94, 0.94, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const release = released ? spring({frame: globalFrame - 63, fps, config: TACTILE_SPRING}) : 0;
  const buttonScale = released ? 1 + 0.02 * (1 - release) : press;
  const entrance = spring({frame: globalFrame, fps, config: TACTILE_SPRING});
  return (
    <div style={{position: 'absolute', left: 270, top: 110, width: 500, height: 850, padding: 9, borderRadius: 52, background: '#24242b', boxShadow: '0 40px 80px #0006', scale: interpolate(entrance, [0, 1], [0.94, 1]), opacity: Math.min(1, entrance), fontFamily: TYPE}}>
      <div style={{height: '100%', background: '#f2f2f7', borderRadius: 43, overflow: 'hidden', color: '#17171b', position: 'relative'}}>
        <div style={{height: 72, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #e4e4ea'}}>
          <Img src={staticFile('brand/rescuemesh-wordmark.png')} style={{width: 244}} />
        </div>
        <div style={{padding: 22, display: 'flex', flexDirection: 'column', gap: 14}}>
          <div style={{background: 'white', borderRadius: 18, padding: 16, display: 'flex', gap: 16, alignItems: 'center'}}>
            <Icon name="radio" size={34} style={{color: MAGENTA}} />
            <div><div style={{fontSize: 24, fontWeight: 650}}>Transponder connected</div><div style={{fontSize: 18, color: '#686871', marginTop: 4}}>Bluetooth ready</div></div>
          </div>
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18}}>
            <div style={{background: 'white', borderRadius: 18, padding: 16}}><div style={{fontSize: 20, color: '#62626b'}}>People with you</div><div style={{fontSize: 66, fontWeight: 700, lineHeight: 1.1, marginTop: 11}}>3</div></div>
            <div style={{background: 'white', borderRadius: 18, padding: 16}}><div style={{fontSize: 20, color: '#62626b'}}>Priority</div><div style={{fontSize: 58, fontWeight: 700, color: MAGENTA, lineHeight: 1.1}}>!!!</div><div style={{fontSize: 20, fontWeight: 650}}>Urgent</div></div>
          </div>
          <div style={{background: 'white', borderRadius: 18, padding: 16}}>
            <div style={{fontSize: 20, color: '#62626b', marginBottom: 10}}>Supplies needed</div>
            <div style={{display: 'flex', gap: 24, fontSize: 22, fontWeight: 600}}><span style={{display: 'flex', gap: 9, alignItems: 'center'}}><Icon name="medicine" size={28} style={{color: MAGENTA}} /> Medicine</span><span style={{display: 'flex', gap: 9, alignItems: 'center'}}><Icon name="water" size={28} style={{color: MAGENTA}} /> Water</span></div>
          </div>
          <div style={{background: 'white', borderRadius: 18, padding: 16}}><div style={{fontSize: 20, color: '#62626b', marginBottom: 10}}>Additional note</div><div style={{fontSize: 25}}>ECSW west entrance.</div></div>
          <div style={{display: 'flex', gap: 9, alignItems: 'center', color: '#51515b', fontSize: 20}}><Icon name="pin" size={24} /> GPS ready</div>
          <div style={{position: 'relative', isolation: 'isolate'}}>
            {released && <div style={{position: 'absolute', left: '50%', top: '50%', width: 120, height: 120, translate: '-50% -50%', border: '2px solid #e20074', borderRadius: '50%', scale: interpolate(globalFrame, [63, 96], [1, 9], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), opacity: interpolate(globalFrame, [63, 96], [0.85, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), zIndex: -1}} />}
            <div style={{height: 70, background: MAGENTA, borderRadius: 19, color: 'white', fontSize: 27, fontWeight: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, scale: buttonScale, filter: globalFrame >= 55 && globalFrame <= 62 ? 'brightness(.85)' : 'none'}}><Icon name={released ? 'check' : 'arrow'} size={29} />{released ? 'Request sent to radio' : 'Send request'}</div>
          </div>
        </div>
        <div style={{position: 'absolute', bottom: 10, width: 132, height: 5, background: '#26262c', borderRadius: 4, left: '50%', translate: '-50% 0'}} />
      </div>
    </div>
  );
};

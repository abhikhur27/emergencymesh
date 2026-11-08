import {interpolate, spring, useVideoConfig} from 'remotion';
import {MAGENTA, TACTILE_SPRING, TYPE} from '../constants/springs';
import {Icon} from './Icons';

export const MeshDiagram = ({frame, muted = false}: {frame: number; muted?: boolean}) => {
  const {fps} = useVideoConfig();
  const nodes = [
    {label: 'Your companion', detail: 'Encrypted request', x: 170, y: 430, delay: 0, icon: 'radio' as const},
    {label: 'Relay A', detail: 'Opaque packet', x: 640, y: 235, delay: 18, icon: 'radio' as const},
    {label: 'Relay B', detail: 'Opaque packet', x: 1090, y: 470, delay: 36, icon: 'radio' as const},
    {label: 'ECSW hub', detail: 'Save and acknowledge', x: 1570, y: 270, delay: 54, icon: 'hub' as const},
  ];
  return (
    <div style={{position: 'absolute', inset: 0, fontFamily: TYPE, opacity: muted ? 0.55 : 1}}>
      <svg width={1760} height={650} style={{position: 'absolute', left: 80, top: 250, overflow: 'visible'}}>
        {nodes.slice(1).map((node, i) => {
          const previous = nodes[i]; const progress = interpolate(frame, [previous.delay + 1, node.delay], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return <g key={node.label}><line x1={previous.x} y1={previous.y} x2={node.x} y2={node.y} stroke="#ffffff20" strokeWidth={3} /><line x1={previous.x} y1={previous.y} x2={node.x} y2={node.y} stroke={MAGENTA} strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} />{progress > 0 && progress < 1 && <circle cx={previous.x + (node.x - previous.x) * progress} cy={previous.y + (node.y - previous.y) * progress} r={10} fill="white" />}</g>;
        })}
      </svg>
      {nodes.map(node => {
        const active = frame >= node.delay;
        const enter = spring({frame: Math.max(0, frame - node.delay), fps, config: TACTILE_SPRING});
        const ring = (frame - node.delay) / 28;
        return <div key={node.label} style={{position: 'absolute', left: node.x + 80, top: node.y + 250, translate: '-50% -50%', width: 100, height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          {active && ring >= 0 && ring <= 1 && <div style={{position: 'absolute', inset: -20, border: `2px solid ${MAGENTA}`, borderRadius: '50%', scale: 1 + ring * 1.1, opacity: 1 - ring}} />}
          <div style={{width: 90, height: 90, background: active ? MAGENTA : '#24242c', color: active ? 'white' : '#71717e', border: `1px solid ${active ? '#ff5ba9' : '#454550'}`, borderRadius: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', scale: active ? interpolate(enter, [0, 1], [0.85, 1]) : 1, boxShadow: active ? '0 12px 36px #e2007426' : 'none'}}><Icon name={node.icon} size={43} /></div>
          <div style={{position: 'absolute', top: 119, left: -100, width: 300, textAlign: 'center', color: active ? '#fff' : '#868692'}}><div style={{fontSize: 33, fontWeight: 600}}>{node.label}</div><div style={{fontSize: 23, marginTop: 10, color: '#a7a7b2'}}>{node.detail}</div></div>
        </div>;
      })}
    </div>
  );
};

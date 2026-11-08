import type {CSSProperties} from 'react';

const paths = {
  radio: 'M12 12v9M8.5 7a7 7 0 0 0 0 10M15.5 7a7 7 0 0 1 0 10M5.5 3a12 12 0 0 0 0 18M18.5 3a12 12 0 0 1 0 18M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Zm7 4v3',
  check: 'm5 12 4 4L19 6',
  pin: 'M20 9c0 6-8 13-8 13S4 15 4 9a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  water: 'M12 2C8 8 5 11 5 15a7 7 0 0 0 14 0c0-4-3-7-7-13ZM8 15a4 4 0 0 0 4 4',
  medicine: 'm9 4-5 5a6 6 0 0 0 8 8l5-5a6 6 0 0 0-8-8Zm-2 3 10 10',
  arrow: 'M3 12h18m-7-7 7 7-7 7',
  phone: 'M7 2h10v20H7Zm4 17h2',
  hub: 'M4 9h16v12H4ZM7 5h10v4M12 1v4M8 14h2m4 0h2m-8 4h8',
};
export const Icon = ({name, size = 32, style}: {name: keyof typeof paths; size?: number; style?: CSSProperties}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" style={{display: 'block', flexShrink: 0, overflow: 'visible', ...style}}>
    <path d={paths[name]} />
  </svg>
);

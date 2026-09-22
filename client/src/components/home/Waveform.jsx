import { useId } from 'react';

export default function Waveform({ size = 34 }) {
  const gradient = useId();
  return (
    <svg className="home-logo-icon" width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="36" x2="36" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#386bff" /><stop offset="1" stopColor="#b85aff" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradient})`}>
        {[8, 20, 30, 22, 12, 4].map((height, index) => (
          <rect key={index} x={index * 5.5 + 1} y={(36 - height) / 2} width="4" height={height} rx="2" />
        ))}
      </g>
    </svg>
  );
}

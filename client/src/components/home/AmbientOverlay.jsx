import { useMemo } from 'react';

const SECTION_COLORS = [
  { pos: '20% 10%', color: 'rgba(0,180,216,0.10)', size: 60 },
  { pos: '80% 30%', color: 'rgba(80,64,160,0.07)', size: 50 },
  { pos: '30% 55%', color: 'rgba(0,180,216,0.05)', size: 55 },
  { pos: '70% 75%', color: 'rgba(100,60,180,0.06)', size: 45 },
  { pos: '50% 95%', color: 'rgba(0,140,180,0.04)', size: 60 },
];

export default function AmbientOverlay({ scrollProgress = 0 }) {
  const gradients = useMemo(() => {
    return SECTION_COLORS.map((s) => {
      const [x, y] = s.pos.split(' ').map((v) => parseFloat(v));
      const shiftedX = Math.min(Math.max(x + scrollProgress * 8, 0), 100);
      return `radial-gradient(ellipse ${s.size}% ${s.size * 0.6}% at ${shiftedX}% ${y}, ${s.color}, transparent)`;
    }).join(', ');
  }, [scrollProgress]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1,
        background: gradients,
        pointerEvents: 'none',
        transition: 'background 0.5s ease',
      }}
    />
  );
}

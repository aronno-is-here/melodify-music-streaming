import { Suspense, useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import ParticleField from './ParticleField.jsx';
import { FloatingRing, OrbitalMesh, WaveRibbon } from './FloatingGeometry.jsx';

function Scene({ scrollProgress }) {
  return (
    <>
      <ambientLight intensity={0.1} />
      <ParticleField count={800} scrollProgress={scrollProgress} />
      <FloatingRing position={[-4, 2, -5]} scale={1.5} speed={0.6} />
      <FloatingRing position={[5, -1, -6]} scale={1} speed={0.8} />
      <FloatingRing position={[0, 3, -8]} scale={2} speed={0.4} />
      <OrbitalMesh position={[3, 1, -7]} />
      <OrbitalMesh position={[-3, -2, -9]} />
      <WaveRibbon scrollProgress={scrollProgress} />
    </>
  );
}

function WebGLFallback() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'radial-gradient(ellipse at 25% 15%, rgba(0,180,216,0.08) 0%, transparent 50%), ' +
          'radial-gradient(ellipse at 75% 55%, rgba(80,64,160,0.06) 0%, transparent 50%), ' +
          'radial-gradient(ellipse at 50% 85%, rgba(0,180,216,0.04) 0%, transparent 40%), ' +
          'radial-gradient(circle at 60% 20%, rgba(0,212,255,0.03) 0%, transparent 35%), ' +
          '#050507',
      }}
    />
  );
}

function detectWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

export default function MusicBackground3D({ scrollProgress = 0 }) {
  const [supported, setSupported] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setSupported(detectWebGL());
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (!supported || reducedMotion) return <WebGLFallback />;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}>
      <Suspense fallback={<WebGLFallback />}>
        <Canvas
          camera={{ position: [0, 0, 6], fov: 60 }}
          dpr={[1, 1.2]}
          gl={{
            antialias: false,
            alpha: true,
            powerPreference: 'high-performance',
            stencil: false,
            depth: false,
          }}
          frameloop="always"
          style={{ background: 'transparent' }}
        >
          <Scene scrollProgress={scrollProgress} />
        </Canvas>
      </Suspense>
    </div>
  );
}

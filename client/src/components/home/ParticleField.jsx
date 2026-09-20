import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export default function ParticleField({ count = 800, scrollProgress = 0 }) {
  const mesh = useRef();
  const { viewport } = useThree();

  const [positions, sizes, colors] = useMemo(() => {
    const isMobile = viewport.width < 10;
    const actualCount = isMobile ? Math.floor(count * 0.4) : count;
    const spread = isMobile ? 12 : 20;
    const pos = new Float32Array(actualCount * 3);
    const siz = new Float32Array(actualCount);
    const col = new Float32Array(actualCount * 3);

    const palette = [
      [0, 0.706, 0.847],
      [0.565, 0.878, 0.937],
      [0.35, 0.2, 0.65],
      [0.2, 0.15, 0.5],
    ];

    for (let i = 0; i < actualCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * spread;
      pos[i * 3 + 1] = (Math.random() - 0.5) * spread;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2;
      siz[i] = Math.random() * 2.5 + 0.5;
      const c = palette[Math.floor(Math.random() * palette.length)];
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
    return [pos, siz, col];
  }, [count, viewport.width]);

  useFrame((state) => {
    if (!mesh.current) return;
    const time = state.clock.getElapsedTime();
    const posArr = mesh.current.geometry.attributes.position.array;
    const sizArr = mesh.current.geometry.attributes.size.array;
    const len = posArr.length / 3;

    for (let i = 0; i < len; i++) {
      const i3 = i * 3;
      posArr[i3 + 1] += Math.sin(time * 0.15 + i * 0.02) * 0.002;
      posArr[i3] += Math.cos(time * 0.1 + i * 0.015) * 0.001;
      posArr[i3 + 2] += Math.sin(time * 0.08 + i * 0.01) * 0.001;
      sizArr[i] = Math.sin(time * 0.5 + i * 0.3) * 0.5 + 1.5;
    }
    mesh.current.geometry.attributes.position.needsUpdate = true;
    mesh.current.geometry.attributes.size.needsUpdate = true;
    mesh.current.rotation.y = time * 0.015 + scrollProgress * 0.5;
    mesh.current.rotation.x = scrollProgress * 0.2;
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-size" count={sizes.length} array={sizes} itemSize={1} />
        <bufferAttribute attach="attributes-color" count={colors.length / 3} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        vertexColors
        transparent
        opacity={0.7}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function FloatingRing({ position, scale = 1, speed = 1 }) {
  const ring = useRef();
  const initialRotation = useMemo(
    () => [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI],
    []
  );

  useFrame((state) => {
    if (!ring.current) return;
    const time = state.clock.getElapsedTime();
    ring.current.rotation.x = initialRotation[0] + time * 0.08 * speed;
    ring.current.rotation.y = initialRotation[1] + time * 0.06 * speed;
    ring.current.rotation.z = initialRotation[2] + time * 0.04 * speed;
    ring.current.position.y = position[1] + Math.sin(time * 0.3 * speed) * 0.3;
    ring.current.position.x = position[0] + Math.cos(time * 0.2 * speed) * 0.2;
  });

  return (
    <mesh ref={ring} position={position} scale={scale}>
      <torusGeometry args={[1, 0.02, 16, 64]} />
      <meshBasicMaterial
        color="#00b4d8"
        transparent
        opacity={0.15}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

export function OrbitalMesh({ position }) {
  const mesh = useRef();
  const initialPos = useMemo(() => [...position], [position]);

  useFrame((state) => {
    if (!mesh.current) return;
    const time = state.clock.getElapsedTime();
    mesh.current.rotation.x = time * 0.05;
    mesh.current.rotation.y = time * 0.08;
    mesh.current.position.x = initialPos[0] + Math.sin(time * 0.15) * 0.5;
    mesh.current.position.y = initialPos[1] + Math.cos(time * 0.12) * 0.3;
  });

  return (
    <mesh ref={mesh} position={position}>
      <icosahedronGeometry args={[0.6, 1]} />
      <meshBasicMaterial
        color="#5040a0"
        wireframe
        transparent
        opacity={0.08}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

export function WaveRibbon({ scrollProgress = 0 }) {
  const line = useRef();
  const pointCount = 120;

  const positions = useMemo(() => new Float32Array(pointCount * 3), []);

  useFrame((state) => {
    if (!line.current) return;
    const time = state.clock.getElapsedTime();
    const arr = line.current.geometry.attributes.position.array;
    for (let i = 0; i < pointCount; i++) {
      const t = i / pointCount;
      arr[i * 3] = (t - 0.5) * 16;
      arr[i * 3 + 1] =
        Math.sin(t * Math.PI * 3 + time * 0.4) * 0.8 +
        Math.cos(t * Math.PI * 2 + time * 0.25) * 0.4;
      arr[i * 3 + 2] = -4 + scrollProgress * 2;
    }
    line.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <line ref={line}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={pointCount}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color="#00b4d8"
        transparent
        opacity={0.12}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </line>
  );
}

"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { getMoonPhaseAngle } from "@/lib/astro";

export function MoonGlobe() {
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.DirectionalLight>(null);

  // NASA LROC texture — we'll use a generated fallback if the texture isn't available
  let texture: THREE.Texture | null = null;
  try {
    texture = useTexture("/textures/moon-diffuse.jpg");
  } catch {
    // Texture not found, will use fallback color
  }

  // Position the light based on current moon phase
  const angle = getMoonPhaseAngle(new Date());
  const lightAngle = (angle * Math.PI) / 180;
  const lightX = Math.sin(lightAngle) * 5;
  const lightZ = Math.cos(lightAngle) * 5;

  // Slow auto-rotation
  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.05;
    }
  });

  return (
    <>
      <ambientLight intensity={0.08} />
      <directionalLight
        ref={lightRef}
        position={[lightX, 1, lightZ]}
        intensity={2.5}
        color="#ffeedd"
      />
      <mesh ref={meshRef}>
        <sphereGeometry args={[1.8, 64, 64]} />
        {texture ? (
          <meshStandardMaterial
            map={texture}
            roughness={0.9}
            metalness={0}
          />
        ) : (
          <meshStandardMaterial
            color="#8a8480"
            roughness={0.9}
            metalness={0}
          />
        )}
      </mesh>
    </>
  );
}

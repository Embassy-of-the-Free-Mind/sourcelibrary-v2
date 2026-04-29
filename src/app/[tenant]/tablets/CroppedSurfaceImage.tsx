'use client';

import { useState, useRef, useCallback } from 'react';

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CroppedSurfaceImageProps {
  photoUrl: string;
  bbox: BBox;
  imageAspect: number;
  containerWidth: number;
  alt: string;
}

export default function CroppedSurfaceImage({
  photoUrl,
  bbox,
  imageAspect,
  containerWidth,
  alt,
}: CroppedSurfaceImageProps) {
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const imgW = containerWidth / bbox.w;
  const imgH = imgW / imageAspect;
  const containerH = bbox.h * imgH;

  const magnifierSize = 220;
  const zoom = 3;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (mx < 0 || my < 0 || mx > containerWidth || my > containerH) {
        setShowMagnifier(false);
        return;
      }

      setCursorPos({ x: mx, y: my });
      setShowMagnifier(true);
    },
    [containerWidth, containerH]
  );

  // Magnifier background: full image zoomed, positioned so cursor point is centered
  const bgW = imgW * zoom;
  const bgH = imgH * zoom;
  const bgX = -(bbox.x * imgW + cursorPos.x) * zoom + magnifierSize / 2;
  const bgY = -(bbox.y * imgH + cursorPos.y) * zoom + magnifierSize / 2;

  return (
    <div
      ref={containerRef}
      className="shrink-0 relative overflow-hidden rounded shadow-sm cursor-crosshair"
      style={{
        width: `${containerWidth}px`,
        height: `${containerH}px`,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowMagnifier(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl}
        alt={alt}
        loading="lazy"
        style={{
          position: 'absolute',
          width: `${imgW}px`,
          maxWidth: 'none',
          left: `${-bbox.x * imgW}px`,
          top: `${-bbox.y * imgH}px`,
        }}
      />

      {showMagnifier && (
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            width: magnifierSize,
            height: magnifierSize,
            left: cursorPos.x - magnifierSize / 2,
            top: cursorPos.y - magnifierSize / 2,
            border: '3px solid rgba(255,255,255,0.9)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(0,0,0,0.1)',
            backgroundImage: `url(${photoUrl})`,
            backgroundSize: `${bgW}px ${bgH}px`,
            backgroundPosition: `${bgX}px ${bgY}px`,
            backgroundRepeat: 'no-repeat',
            backgroundColor: '#1a1612',
            zIndex: 100,
          }}
        />
      )}
    </div>
  );
}

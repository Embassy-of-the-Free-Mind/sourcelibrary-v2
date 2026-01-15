'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface FullscreenImageViewerProps {
  src: string;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function FullscreenImageViewer({ src, alt, isOpen, onClose }: FullscreenImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lastTouchDistance = useRef<number>(0);
  const lastTouchCenter = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const positionStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setIsLoaded(false);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Get distance between two touch points
  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Get center point between two touches
  const getTouchCenter = (touches: React.TouchList) => {
    if (touches.length < 2) {
      return { x: touches[0].clientX, y: touches[0].clientY };
    }
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      lastTouchDistance.current = getTouchDistance(e.touches);
      lastTouchCenter.current = getTouchCenter(e.touches);
    } else if (e.touches.length === 1 && scale > 1) {
      // Pan start (only when zoomed)
      setIsDragging(true);
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      positionStart.current = { ...position };
    }
  }, [scale, position]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch zoom
      e.preventDefault();
      const newDistance = getTouchDistance(e.touches);
      const newCenter = getTouchCenter(e.touches);

      if (lastTouchDistance.current > 0) {
        const scaleDelta = newDistance / lastTouchDistance.current;
        const newScale = Math.min(Math.max(scale * scaleDelta, 1), 5);

        // Adjust position to zoom toward pinch center
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const centerX = newCenter.x - rect.left - rect.width / 2;
          const centerY = newCenter.y - rect.top - rect.height / 2;

          const scaleChange = newScale / scale;
          const newX = position.x - (centerX - position.x) * (scaleChange - 1);
          const newY = position.y - (centerY - position.y) * (scaleChange - 1);

          setPosition({ x: newX, y: newY });
        }

        setScale(newScale);
      }

      lastTouchDistance.current = newDistance;
      lastTouchCenter.current = newCenter;
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
      // Pan
      e.preventDefault();
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      setPosition({
        x: positionStart.current.x + dx,
        y: positionStart.current.y + dy,
      });
    }
  }, [scale, position, isDragging]);

  const handleTouchEnd = useCallback(() => {
    lastTouchDistance.current = 0;
    setIsDragging(false);

    // Snap back to bounds if needed
    if (scale <= 1) {
      setPosition({ x: 0, y: 0 });
    }
  }, [scale]);

  // Double tap to zoom
  const lastTap = useRef<number>(0);
  const handleTap = useCallback((e: React.TouchEvent) => {
    const now = Date.now();
    const timeDiff = now - lastTap.current;

    if (timeDiff < 300 && timeDiff > 0) {
      // Double tap
      e.preventDefault();
      if (scale > 1) {
        // Zoom out
        setScale(1);
        setPosition({ x: 0, y: 0 });
      } else {
        // Zoom in to 2x at tap location
        const touch = e.changedTouches[0];
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const tapX = touch.clientX - rect.left - rect.width / 2;
          const tapY = touch.clientY - rect.top - rect.height / 2;
          setScale(2);
          setPosition({ x: -tapX, y: -tapY });
        }
      }
    }
    lastTap.current = now;
  }, [scale]);

  // Button controls
  const zoomIn = () => {
    const newScale = Math.min(scale * 1.5, 5);
    setScale(newScale);
  };

  const zoomOut = () => {
    const newScale = Math.max(scale / 1.5, 1);
    setScale(newScale);
    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
    }
  };

  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Click backdrop to close (only if not zoomed)
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current && scale <= 1) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col"
      style={{ touchAction: 'none' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50">
        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            disabled={scale <= 1}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-all"
          >
            <ZoomOut className="w-5 h-5 text-white" />
          </button>
          <span className="text-white text-sm font-medium min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scale >= 5}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-all"
          >
            <ZoomIn className="w-5 h-5 text-white" />
          </button>
          {scale > 1 && (
            <button
              onClick={resetZoom}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all ml-2"
            >
              <RotateCcw className="w-5 h-5 text-white" />
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all"
        >
          <X className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden"
        onClick={handleBackdropClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
            cursor: scale > 1 ? 'grab' : 'default',
          }}
          onLoad={() => setIsLoaded(true)}
          onTouchEnd={handleTap}
          draggable={false}
        />
      </div>

      {/* Hint */}
      <div className="px-4 py-2 text-center text-xs text-white/50 bg-black/50">
        {scale <= 1 ? 'Double-tap to zoom • Pinch to zoom' : 'Drag to pan • Double-tap to reset'}
      </div>
    </div>
  );
}

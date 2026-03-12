'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

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
  const [hasError, setHasError] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const hasDragged = useRef(false);

  // Refs mirror state so native event listeners always read current values
  // without needing to be re-registered on every render.
  const scaleRef = useRef(1);
  const positionRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastTouchDistance = useRef(0);
  const lastTap = useRef(0);
  const mouseDragStart = useRef({ x: 0, y: 0 });
  const mousePosStart = useRef({ x: 0, y: 0 });
  const touchDragStart = useRef({ x: 0, y: 0 });
  const touchPosStart = useRef({ x: 0, y: 0 });

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { positionRef.current = position; }, [position]);

  // Detect touch device
  useEffect(() => {
    setIsTouchDevice(
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches
    );
  }, []);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setIsLoaded(false);
      setHasError(false);
      scaleRef.current = 1;
      positionRef.current = { x: 0, y: 0 };
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) {
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [isOpen, onClose]);

  // ── Native touch listeners (passive: false so preventDefault works) ────────
  // React 17+ registers synthetic touch listeners as passive at the root,
  // so we must attach directly to the DOM element to call preventDefault.

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isOpen) return;

    const getTouchDist = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastTouchDistance.current = getTouchDist(e.touches);
      } else if (e.touches.length === 1 && scaleRef.current > 1) {
        isDraggingRef.current = true;
        setIsDragging(true);
        touchDragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchPosStart.current = { ...positionRef.current };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const newDist = getTouchDist(e.touches);
        if (lastTouchDistance.current > 0) {
          const newScale = Math.min(Math.max(scaleRef.current * (newDist / lastTouchDistance.current), 1), 5);
          const rect = container.getBoundingClientRect();
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - rect.width / 2;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top - rect.height / 2;
          const ratio = newScale / scaleRef.current;
          const newPos = {
            x: positionRef.current.x - (cx - positionRef.current.x) * (ratio - 1),
            y: positionRef.current.y - (cy - positionRef.current.y) * (ratio - 1),
          };
          positionRef.current = newPos;
          scaleRef.current = newScale;
          setPosition(newPos);
          setScale(newScale);
        }
        lastTouchDistance.current = newDist;
      } else if (e.touches.length === 1 && isDraggingRef.current && scaleRef.current > 1) {
        e.preventDefault();
        const newPos = {
          x: touchPosStart.current.x + (e.touches[0].clientX - touchDragStart.current.x),
          y: touchPosStart.current.y + (e.touches[0].clientY - touchDragStart.current.y),
        };
        positionRef.current = newPos;
        setPosition(newPos);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastTouchDistance.current = 0;
      isDraggingRef.current = false;
      setIsDragging(false);
      if (scaleRef.current <= 1) {
        positionRef.current = { x: 0, y: 0 };
        setPosition({ x: 0, y: 0 });
      }

      // Double-tap to zoom
      const now = Date.now();
      const diff = now - lastTap.current;
      if (diff < 300 && diff > 0 && e.changedTouches.length === 1) {
        e.preventDefault();
        if (scaleRef.current > 1) {
          scaleRef.current = 1;
          positionRef.current = { x: 0, y: 0 };
          setScale(1);
          setPosition({ x: 0, y: 0 });
        } else {
          const touch = e.changedTouches[0];
          const rect = container.getBoundingClientRect();
          const newPos = {
            x: -(touch.clientX - rect.left - rect.width / 2),
            y: -(touch.clientY - rect.top - rect.height / 2),
          };
          scaleRef.current = 2;
          positionRef.current = newPos;
          setScale(2);
          setPosition(newPos);
        }
      }
      lastTap.current = now;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [isOpen]); // refs keep handlers current without re-registration

  // ── Mouse drag to pan ─────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current || scaleRef.current <= 1) return;
    e.preventDefault();
    hasDragged.current = false;
    isDraggingRef.current = true;
    setIsDragging(true);
    mouseDragStart.current = { x: e.clientX, y: e.clientY };
    mousePosStart.current = { ...positionRef.current };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - mouseDragStart.current.x;
    const dy = e.clientY - mouseDragStart.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasDragged.current = true;
    const newPos = { x: mousePosStart.current.x + dx, y: mousePosStart.current.y + dy };
    positionRef.current = newPos;
    setPosition(newPos);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
    if (scaleRef.current <= 1) {
      positionRef.current = { x: 0, y: 0 };
      setPosition({ x: 0, y: 0 });
    }
  }, []);

  // ── Mouse double-click to zoom ────────────────────────────────────────────

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) return;
    if (scaleRef.current > 1) {
      scaleRef.current = 1;
      positionRef.current = { x: 0, y: 0 };
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const newPos = {
        x: -(e.clientX - rect.left - rect.width / 2),
        y: -(e.clientY - rect.top - rect.height / 2),
      };
      scaleRef.current = 2;
      positionRef.current = newPos;
      setScale(2);
      setPosition(newPos);
    }
  }, []);

  // ── Button controls ───────────────────────────────────────────────────────

  const zoomIn = () => {
    const s = Math.min(scaleRef.current * 1.5, 5);
    scaleRef.current = s;
    setScale(s);
  };

  const zoomOut = () => {
    const s = Math.max(scaleRef.current / 1.5, 1);
    scaleRef.current = s;
    setScale(s);
    if (s <= 1) {
      positionRef.current = { x: 0, y: 0 };
      setPosition({ x: 0, y: 0 });
    }
  };

  const resetZoom = () => {
    scaleRef.current = 1;
    positionRef.current = { x: 0, y: 0 };
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Backdrop click closes (only when not zoomed and no drag occurred)
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current && scaleRef.current <= 1 && !hasDragged.current) {
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
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {!isLoaded && !hasError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <BookLoader size="sm" variant="dark" />
          </div>
        )}
        {hasError ? (
          <div className="flex flex-col items-center justify-center gap-4 text-white/70">
            <X className="w-12 h-12 opacity-40" />
            <p className="text-sm">Failed to load image</p>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            ref={imageRef}
            src={src}
            alt={alt}
            className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transition: isDragging ? 'none' : 'transform 0.2s ease-out',
              cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default',
            }}
            onLoad={() => setIsLoaded(true)}
            onError={() => setHasError(true)}
            draggable={false}
          />
        )}
      </div>

      {/* Hint */}
      <div className="px-4 py-2 text-center text-xs text-white/50 bg-black/50">
        {isTouchDevice
          ? scale <= 1 ? 'Double-Tap to Zoom • Pinch to Zoom' : 'Drag to Pan • Double-Tap to Reset'
          : scale <= 1 ? 'Double-Click to Zoom' : 'Drag to Pan • Double-Click to Reset'
        }
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import FullscreenImageViewer from '@/components/reader/FullscreenImageViewer';

interface ImageWithMagnifierProps {
  src: string;
  thumbnail?: string;
  alt: string;
  className?: string;
  magnifierSize?: number;
  zoomLevel?: number;
  scrollable?: boolean;
  highResSrc?: string; // For magnifier/zoom, use higher resolution version
  fallbackSrc?: string; // Fallback if src fails to load (e.g. on-the-fly crop URL)
  darkMode?: boolean; // Dark skeleton/background for lightbox contexts
}

// Magnifier component for zooming into the source image
// Desktop: hover to show magnifier lens, click HD button for fullscreen
// Mobile/Touch: tap to open fullscreen viewer
export default function ImageWithMagnifier({
  src,
  thumbnail,
  alt,
  className = '',
  magnifierSize = 200,
  zoomLevel = 3,
  scrollable = false,
  highResSrc,
  fallbackSrc,
  darkMode = false
}: ImageWithMagnifierProps) {
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 });
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [fullImageDimensions, setFullImageDimensions] = useState({ width: 0, height: 0 });
  const [isLoaded, setIsLoaded] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [fullImageLoaded, setFullImageLoaded] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  // Inline pinch-to-zoom state (mobile)
  const [touchScale, setTouchScale] = useState(1);
  const [touchPosition, setTouchPosition] = useState({ x: 0, y: 0 });
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const touchScaleRef = useRef(1);
  const touchPositionRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastTouchDistance = useRef(0);
  const lastTap = useRef(0);
  const touchDragStart = useRef({ x: 0, y: 0 });
  const touchPosStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Use thumbnail for display, full image for magnifier
  // If no thumbnail, use resize API to generate one on-the-fly
  // If src is already an API endpoint (crop, image, etc), use it directly
  const getResizedUrl = (url: string, width: number = 400) => {
    // Don't wrap API endpoint URLs
    if (url.startsWith('/api/')) return url;
    // Blob CDN URLs: resize via proxy for display sizes
    if (url.includes('blob.vercel-storage.com')) {
      return `/api/image?url=${encodeURIComponent(url)}&w=${width}&q=70`;
    }
    // External URLs get resized via proxy
    return `/api/image?url=${encodeURIComponent(url)}&w=${width}&q=70`;
  };
  const activeSrc = useFallback && fallbackSrc ? fallbackSrc : src;
  const isApiUrl = activeSrc.startsWith('/api/');
  const displaySrc = thumbnail || (isApiUrl ? activeSrc : getResizedUrl(activeSrc, 400));
  // Use high-res version for magnifier if available, otherwise use standard src
  const magnifierSrc = highResSrc || activeSrc;

  // Detect touch device on mount
  useEffect(() => {
    const checkTouch = () => {
      setIsTouchDevice(
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia('(pointer: coarse)').matches
      );
    };
    checkTouch();
    // Re-check on resize (for responsive testing)
    window.addEventListener('resize', checkTouch);
    return () => window.removeEventListener('resize', checkTouch);
  }, []);

  useEffect(() => {
    // Reset loaded state when src changes
    setIsLoaded(false);
    setFullImageLoaded(false);
    setFullImageDimensions({ width: 0, height: 0 });
    setUseFallback(false);

    // Check if image is already cached/loaded (fixes race condition on initial render)
    // Use a small timeout to let the img element mount first
    const checkLoaded = setTimeout(() => {
      if (imgRef.current?.complete && imgRef.current?.naturalHeight > 0) {
        setIsLoaded(true);
        const rect = imgRef.current.getBoundingClientRect();
        setImageDimensions({ width: rect.width, height: rect.height });
      }
    }, 50);

    return () => clearTimeout(checkLoaded);
  }, [src, displaySrc]);

  // Calculate rendered image content size (accounting for object-contain)
  const getRenderedImageSize = useCallback(() => {
    if (!imgRef.current) return { width: 0, height: 0 };
    const img = imgRef.current;
    const rect = img.getBoundingClientRect();
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    if (!naturalWidth || !naturalHeight) return { width: rect.width, height: rect.height };

    if (scrollable) {
      // Scrollable: image fills width, no object-contain — element box = content area
      return { width: rect.width, height: rect.height };
    }

    // Non-scrollable with object-contain: content may be smaller than element box
    const containerAspect = rect.width / rect.height;
    const imageAspect = naturalWidth / naturalHeight;

    if (imageAspect > containerAspect) {
      return { width: rect.width, height: rect.width / imageAspect };
    } else {
      return { width: rect.height * imageAspect, height: rect.height };
    }
  }, [scrollable]);

  useEffect(() => {
    const updateDimensions = () => {
      const dims = getRenderedImageSize();
      if (dims.width > 0 && dims.height > 0) {
        setImageDimensions(dims);
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    // ResizeObserver catches layout changes that window resize misses
    // (panel toggles, font loading, flex reflow)
    const observer = new ResizeObserver(updateDimensions);
    if (imgRef.current) observer.observe(imgRef.current);

    return () => {
      window.removeEventListener('resize', updateDimensions);
      observer.disconnect();
    };
  }, [isLoaded, getRenderedImageSize]);

  // Keep refs in sync with state
  useEffect(() => { touchScaleRef.current = touchScale; }, [touchScale]);
  useEffect(() => { touchPositionRef.current = touchPosition; }, [touchPosition]);

  // Reset zoom when src changes
  useEffect(() => {
    touchScaleRef.current = 1;
    touchPositionRef.current = { x: 0, y: 0 };
    setTouchScale(1);
    setTouchPosition({ x: 0, y: 0 });
  }, [src]);

  // ── Inline pinch-to-zoom for mobile ────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice) return;

    const getTouchDist = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch start
        e.preventDefault();
        lastTouchDistance.current = getTouchDist(e.touches);
      } else if (e.touches.length === 1 && touchScaleRef.current > 1) {
        // Pan start (only when zoomed)
        isDraggingRef.current = true;
        setIsTouchDragging(true);
        touchDragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchPosStart.current = { ...touchPositionRef.current };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const newDist = getTouchDist(e.touches);
        if (lastTouchDistance.current > 0) {
          const newScale = Math.min(Math.max(touchScaleRef.current * (newDist / lastTouchDistance.current), 1), 4);
          const rect = container.getBoundingClientRect();
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - rect.width / 2;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top - rect.height / 2;
          const ratio = newScale / touchScaleRef.current;
          const newPos = {
            x: touchPositionRef.current.x - (cx - touchPositionRef.current.x) * (ratio - 1),
            y: touchPositionRef.current.y - (cy - touchPositionRef.current.y) * (ratio - 1),
          };
          touchPositionRef.current = newPos;
          touchScaleRef.current = newScale;
          setTouchPosition(newPos);
          setTouchScale(newScale);
        }
        lastTouchDistance.current = newDist;
      } else if (e.touches.length === 1 && isDraggingRef.current && touchScaleRef.current > 1) {
        e.preventDefault();
        const newPos = {
          x: touchPosStart.current.x + (e.touches[0].clientX - touchDragStart.current.x),
          y: touchPosStart.current.y + (e.touches[0].clientY - touchDragStart.current.y),
        };
        touchPositionRef.current = newPos;
        setTouchPosition(newPos);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastTouchDistance.current = 0;
      isDraggingRef.current = false;
      setIsTouchDragging(false);

      // Snap back if zoomed out (pinch back to ~1x)
      if (touchScaleRef.current <= 1.05) {
        touchScaleRef.current = 1;
        touchPositionRef.current = { x: 0, y: 0 };
        setTouchScale(1);
        setTouchPosition({ x: 0, y: 0 });
        return;
      }

      // Auto-exit zoom if user pans past the bottom edge of the zoomed image
      // (natural "I'm done looking" gesture — swipe down past content)
      if (touchScaleRef.current > 1) {
        const rect = container.getBoundingClientRect();
        const scaledHeight = rect.height * touchScaleRef.current;
        const maxPanY = (scaledHeight - rect.height) / 2;
        // If panned well past the bottom edge, exit zoom
        if (touchPositionRef.current.y < -(maxPanY + 60)) {
          touchScaleRef.current = 1;
          touchPositionRef.current = { x: 0, y: 0 };
          setTouchScale(1);
          setTouchPosition({ x: 0, y: 0 });
          return;
        }
      }

      // Double-tap to zoom / reset
      const now = Date.now();
      const diff = now - lastTap.current;
      if (diff < 300 && diff > 0 && e.changedTouches.length === 1) {
        e.preventDefault();
        if (touchScaleRef.current > 1) {
          touchScaleRef.current = 1;
          touchPositionRef.current = { x: 0, y: 0 };
          setTouchScale(1);
          setTouchPosition({ x: 0, y: 0 });
        } else {
          const touch = e.changedTouches[0];
          const rect = container.getBoundingClientRect();
          const newPos = {
            x: -(touch.clientX - rect.left - rect.width / 2),
            y: -(touch.clientY - rect.top - rect.height / 2),
          };
          touchScaleRef.current = 2.5;
          touchPositionRef.current = newPos;
          setTouchScale(2.5);
          setTouchPosition(newPos);
        }
        lastTap.current = 0; // Prevent triple-tap firing again
        return;
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
  }, [isTouchDevice]);

  // Load full image only on first hover (lazy load for magnifier)
  const [hasHovered, setHasHovered] = useState(false);

  useEffect(() => {
    if (!hasHovered) return;
    const img = new window.Image();
    img.onload = () => {
      setFullImageLoaded(true);
      setFullImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = magnifierSrc;
  }, [magnifierSrc, hasHovered]);

  // Desktop: mouse move for magnifier
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Skip magnifier on touch devices
    if (isTouchDevice) return;

    // Start loading full image on first hover
    if (!hasHovered) setHasHovered(true);
    if (!containerRef.current || !imgRef.current || !fullImageLoaded) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const imgRect = imgRef.current.getBoundingClientRect();

    // Get fresh image content dimensions (avoids stale imageDimensions state)
    const dims = getRenderedImageSize();
    if (!dims.width || !dims.height) return;

    // Update imageDimensions state if they've drifted (e.g. after layout reflow)
    if (Math.abs(imageDimensions.width - dims.width) > 1 || Math.abs(imageDimensions.height - dims.height) > 1) {
      setImageDimensions(dims);
    }

    // Use actual DOM positions for offset — always accurate regardless of layout changes
    const imgOffsetX = imgRect.left - containerRect.left + (imgRect.width - dims.width) / 2;
    const imgOffsetY = imgRect.top - containerRect.top + (imgRect.height - dims.height) / 2;

    // Get cursor position relative to container
    const containerX = e.clientX - containerRect.left;
    const containerY = e.clientY - containerRect.top;

    // Get cursor position relative to the actual rendered image content
    const imgX = containerX - imgOffsetX;
    const imgY = containerY - imgOffsetY;

    // Check if cursor is over the actual rendered image
    const isOverImage = imgX >= 0 && imgX <= dims.width && imgY >= 0 && imgY <= dims.height;

    if (isOverImage) {
      setCursorPosition({ x: containerX, y: containerY });

      // Calculate background position as percentage of image dimensions
      const xPercent = (imgX / dims.width) * 100;
      const yPercent = (imgY / dims.height) * 100;
      setMagnifierPosition({ x: xPercent, y: yPercent });
      setShowMagnifier(true);
    } else {
      setShowMagnifier(false);
    }
  };

  const resetZoom = useCallback(() => {
    touchScaleRef.current = 1;
    touchPositionRef.current = { x: 0, y: 0 };
    setTouchScale(1);
    setTouchPosition({ x: 0, y: 0 });
  }, []);

  // Tap/click to open fullscreen (skip when zoomed inline on mobile)
  const handleClick = () => {
    if (isLoaded && touchScale <= 1) {
      setShowFullscreen(true);
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`relative ${className} ${isTouchDevice && touchScale > 1 ? 'overflow-hidden' : ''}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setShowMagnifier(false)}
        onClick={handleClick}
        data-no-swipe={touchScale > 1 ? true : undefined}
        style={isTouchDevice ? { touchAction: touchScale > 1 ? 'none' : 'pan-y' } : undefined}
      >
        {/* Loading skeleton */}
        {!isLoaded && (
          <div className={`flex items-center justify-center ${darkMode ? 'bg-black' : 'bg-stone-100 animate-pulse'} ${scrollable ? 'w-full h-48' : 'absolute inset-0'}`}>
            <div className={`text-sm ${darkMode ? 'text-stone-600' : 'text-stone-400'}`}>Loading...</div>
          </div>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={displaySrc}
          alt={alt}
          loading="eager"
          className={`w-full ${isTouchDragging ? '' : 'transition-opacity duration-300'} ${isLoaded ? 'opacity-100' : 'opacity-0'} ${isTouchDevice ? 'cursor-pointer' : 'cursor-crosshair'} ${scrollable ? '' : 'h-full object-contain'}`}
          style={isTouchDevice && touchScale > 1 ? {
            transform: `translate(${touchPosition.x}px, ${touchPosition.y}px) scale(${touchScale})`,
            transition: isTouchDragging ? 'none' : 'transform 0.2s ease-out',
            transformOrigin: 'center center',
          } : undefined}
          onLoad={() => {
            // Detect broken/tiny images (e.g. corrupt Blob uploads)
            // Real gallery crops are 300px+ wide; corrupt ones come through ≤150px
            if (!useFallback && fallbackSrc && imgRef.current) {
              const { naturalWidth, naturalHeight } = imgRef.current;
              if (naturalWidth < 150 || naturalHeight < 150) {
                setUseFallback(true);
                return;
              }
            }
            setIsLoaded(true);
            if (imgRef.current) {
              const rect = imgRef.current.getBoundingClientRect();
              setImageDimensions({ width: rect.width, height: rect.height });
            }
          }}
          onError={() => {
            if (!useFallback && fallbackSrc) {
              setUseFallback(true);
            }
          }}
        />

        {/* Mobile: zoom exit button */}
        {isTouchDevice && touchScale > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); resetZoom(); }}
            className="absolute top-2 right-2 z-10 bg-black/70 hover:bg-black/90 text-white rounded-full p-2 shadow-lg active:scale-95 transition-all"
            aria-label="Exit zoom"
          >
            <X className="w-6 h-6" />
          </button>
        )}

        {/* Desktop: Magnifier lens - uses full resolution image */}
        {!isTouchDevice && showMagnifier && fullImageLoaded && (
          <div
            className="absolute pointer-events-none rounded-full overflow-hidden"
            style={{
              width: magnifierSize,
              height: magnifierSize,
              left: cursorPosition.x - magnifierSize / 2,
              top: cursorPosition.y - magnifierSize / 2,
              border: '4px solid white',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              backgroundImage: `url(${magnifierSrc})`,
              backgroundSize: `${imageDimensions.width * zoomLevel}px ${imageDimensions.height * zoomLevel}px`,
              backgroundPosition: `${-(magnifierPosition.x / 100) * imageDimensions.width * zoomLevel + magnifierSize / 2}px ${-(magnifierPosition.y / 100) * imageDimensions.height * zoomLevel + magnifierSize / 2}px`,
              backgroundRepeat: 'no-repeat',
              backgroundColor: 'white',
              zIndex: 100,
            }}
          />
        )}

      </div>

      {/* Fullscreen viewer - works for both mobile and desktop */}
      <FullscreenImageViewer
        src={src}
        alt={alt}
        isOpen={showFullscreen}
        onClose={() => setShowFullscreen(false)}
      />
    </>
  );
}

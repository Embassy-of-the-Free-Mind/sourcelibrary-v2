'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
  onLoad?: () => void; // Called when the display image finishes loading
  imgClassName?: string; // Override default img sizing classes (replaces h-full object-contain)
}

// Magnifier component for zooming into the source image.
// Desktop: hover to show magnifier lens, click to open in-app fullscreen viewer.
// Mobile/Touch: tap opens the raw high-res image in a new tab so the browser's
// native pinch-zoom can take over (the in-app viewer caps at 5x, which isn't
// enough for high-DPI scans — see PR #1873 for the prior escape-hatch button).
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
  darkMode = false,
  onLoad,
  imgClassName,
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
  // Track last known image height to prevent layout shift during page transitions
  const [lastImageHeight, setLastImageHeight] = useState<number>(0);
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
  const initialDisplaySrc = thumbnail || (isApiUrl ? activeSrc : getResizedUrl(activeSrc, 400));
  // Progressive display: background-load activeSrc, decode it, then swap seamlessly
  const [hiResDisplayReady, setHiResDisplayReady] = useState(false);
  const canUpgradeDisplay = !!thumbnail && thumbnail !== activeSrc;
  useEffect(() => {
    if (!canUpgradeDisplay) return;
    setHiResDisplayReady(false);
    const img = new window.Image();
    img.src = activeSrc;
    // decode() ensures the image is fully decoded before we swap src — no flash
    img.decode?.()
      .then(() => setHiResDisplayReady(true))
      .catch(() => { /* decode failed, stay on low-res */ });
  }, [canUpgradeDisplay, activeSrc]);
  const displaySrc = (hiResDisplayReady && canUpgradeDisplay) ? activeSrc : initialDisplaySrc;
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
    // Reset loaded state only on page navigation (src change), not on progressive upgrade
    setIsLoaded(false);
    setFullImageLoaded(false);
    setFullImageDimensions({ width: 0, height: 0 });
    setUseFallback(false);
    setHiResDisplayReady(false);

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
  }, [src]); // Only reset on src change, not displaySrc — progressive upgrade shouldn't flash

  // Calculate rendered image content size (accounting for object-contain)
  const getRenderedImageSize = useCallback(() => {
    if (!imgRef.current) return { width: 0, height: 0 };
    const img = imgRef.current;
    const rect = img.getBoundingClientRect();
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    if (!naturalWidth || !naturalHeight) return { width: rect.width, height: rect.height };

    if (scrollable || imgClassName) {
      // No object-contain — element box = content area
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

  // Tap/click to open fullscreen.
  // On touch devices, skip the in-app viewer (capped at 5x) and open the
  // highest-resolution image in a new tab so the browser's native pinch-zoom
  // can take over. Desktop keeps the in-app viewer where the magnifier lives.
  const handleClick = () => {
    if (!isLoaded) return;
    if (isTouchDevice) {
      window.open(highResSrc || src, '_blank', 'noopener,noreferrer');
      return;
    }
    setShowFullscreen(true);
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`relative ${className}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setShowMagnifier(false)}
        onClick={handleClick}
      >
        {/* Loading skeleton — use last known height in scrollable mode to prevent layout shift.
            Default to 140vw for portrait book pages (~1.4:1 aspect ratio) to avoid a big
            jump when the real image loads. Capped at 900px for large screens. */}
        {!isLoaded && (
          <div
            className={`flex items-center justify-center ${darkMode ? 'bg-black' : 'bg-stone-100 animate-pulse'} ${scrollable ? 'w-full' : 'absolute inset-0'}`}
            style={scrollable && lastImageHeight > 0 ? { height: lastImageHeight } : scrollable ? { height: 'min(140vw, 900px)' } : undefined}
          >
            <div className={`text-sm ${darkMode ? 'text-stone-600' : 'text-stone-400'}`}>Loading...</div>
          </div>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={displaySrc}
          alt={alt}
          loading="eager"
          className={`max-w-full transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'} ${isTouchDevice ? 'cursor-pointer' : 'cursor-crosshair'} ${imgClassName ? imgClassName : scrollable ? 'w-full' : 'w-full h-full object-contain'}`}
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
            onLoad?.();
            if (imgRef.current) {
              const rect = imgRef.current.getBoundingClientRect();
              setImageDimensions({ width: rect.width, height: rect.height });
              if (scrollable && rect.height > 0) {
                setLastImageHeight(rect.height);
              }
            }
          }}
          onError={() => {
            if (!useFallback && fallbackSrc) {
              setUseFallback(true);
            }
          }}
        />

        {/* Desktop: Magnifier lens - uses full resolution image */}
        {!isTouchDevice && showMagnifier && fullImageLoaded && (() => {
          // Calculate effective zoom: use full image native resolution for sharpness.
          // If the full image is only marginally larger than display, scale up to use all native pixels.
          const nativeW = fullImageDimensions.width || imageDimensions.width;
          const nativeH = fullImageDimensions.height || imageDimensions.height;
          const nativeZoom = Math.max(nativeW / (imageDimensions.width || 1), 1);
          // Use whichever is larger: requested zoomLevel or native pixel ratio
          const effectiveZoom = Math.max(zoomLevel, nativeZoom);
          const bgW = imageDimensions.width * effectiveZoom;
          const bgH = imageDimensions.height * effectiveZoom;
          return (
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
                backgroundSize: `${bgW}px ${bgH}px`,
                backgroundPosition: `${-(magnifierPosition.x / 100) * bgW + magnifierSize / 2}px ${-(magnifierPosition.y / 100) * bgH + magnifierSize / 2}px`,
                backgroundRepeat: 'no-repeat',
                backgroundColor: 'white',
                zIndex: 100,
              }}
            />
          );
        })()}

      </div>

      {/* Fullscreen viewer - works for both mobile and desktop */}
      <FullscreenImageViewer
        src={highResSrc || src}
        alt={alt}
        isOpen={showFullscreen}
        onClose={() => setShowFullscreen(false)}
      />
    </>
  );
}

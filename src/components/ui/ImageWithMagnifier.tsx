'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ZoomIn } from 'lucide-react';
import FullscreenImageViewer from '@/components/reader/FullscreenImageViewer';

// Readers can switch the hover lens off (it captures scroll-to-zoom, which makes
// scrolling past a tall facsimile awkward). Remembered across pages and sessions.
const LENS_PREF_KEY = 'sl-magnifier-lens';

// Lens toggle geometry — the button is h-8/w-8, inset 8px from the image edge.
const TOGGLE_SIZE = 32;
const TOGGLE_MARGIN = 8;

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
// Desktop: hover to show a wide reading lens — scroll up/down over the image
// adjusts magnification; click opens the in-app fullscreen viewer. A corner
// toggle switches the lens off (persisted), restoring normal page scrolling.
// Mobile/Touch: tap opens the raw high-res image in a new tab so the browser's
// native pinch-zoom can take over (the in-app viewer caps at 5x, which isn't
// enough for high-DPI scans — see PR #1873 for the prior escape-hatch button).
export default function ImageWithMagnifier({
  src,
  thumbnail,
  alt,
  className = '',
  magnifierSize = 200,
  zoomLevel = 2.5,
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
  // User-adjusted magnification (scroll over the image while the lens is up).
  // Stored unclamped; render clamps to [MIN_ZOOM, native pixel ratio].
  const [userZoom, setUserZoom] = useState(zoomLevel);
  // Lens on/off toggle. Defaults on; hydrated from localStorage after mount
  // (SSR-safe) so the choice sticks across pages and sessions.
  const [lensEnabled, setLensEnabled] = useState(true);
  // Distance of the lens toggle from the top of the image. Follows the scroll
  // position so the button stays on screen over a tall facsimile (see effect below).
  const [toggleTop, setToggleTop] = useState(TOGGLE_MARGIN);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const showMagnifierRef = useRef(false);
  showMagnifierRef.current = showMagnifier;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(LENS_PREF_KEY) === '0') setLensEnabled(false);
    } catch { /* private mode / storage disabled — keep default */ }
  }, []);

  const toggleLens = () => {
    setLensEnabled((on) => {
      const next = !on;
      if (!next) setShowMagnifier(false);
      try {
        window.localStorage.setItem(LENS_PREF_KEY, next ? '1' : '0');
      } catch { /* non-persistent is fine */ }
      return next;
    });
  };

  // The lens is a wide reading rectangle (fits a line of text) rather than a
  // square/circle. Derived from magnifierSize so existing callers keep their scale.
  const lensW = Math.round(magnifierSize * 1.9);
  const lensH = Math.round(magnifierSize * 0.85);

  const MIN_ZOOM = 1.5;
  // Absolute sanity bound only — the real ceiling is the scan's native pixel
  // ratio (below), so a high-res master zooms deeper than a low-res one.
  const MAX_ZOOM = 32;

  // Native pixel ratio of the full image vs its displayed size — the deepest
  // zoom that still shows real detail. Kept in a ref so the wheel handler
  // (bound once) can clamp to it; render clamps effectiveZoom with the same
  // numbers. 0 until the full image has loaded.
  const nativeZoomRef = useRef(0);
  useEffect(() => {
    nativeZoomRef.current =
      fullImageDimensions.width && imageDimensions.width
        ? Math.max(fullImageDimensions.width / imageDimensions.width, MIN_ZOOM)
        : 0;
  }, [fullImageDimensions, imageDimensions, MIN_ZOOM]);

  // The lens toggle floats: as the reader scrolls down a tall facsimile it tracks
  // the top of the still-visible slice of the image rather than scrolling away.
  // CSS `position: sticky` can't do this — callers wrap the image in a
  // `rounded-lg overflow-hidden` box, which becomes sticky's scroll container
  // and never scrolls, so the button would simply sit still. Instead we measure
  // the nearest genuinely scrollable ancestor (the reader panel, else the page)
  // and offset the button from the container's own top edge.
  useEffect(() => {
    if (isTouchDevice || !isLoaded) return;
    const el = containerRef.current;
    if (!el) return;

    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const overflowY = window.getComputedStyle(scroller).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scroller = scroller.parentElement;
    }

    // Page-scrolled callers (artwork hero) have no scrollable ancestor — the
    // top of their "viewport" is whatever the sticky site header leaves free.
    const viewportTop = () => {
      if (scroller) return scroller.getBoundingClientRect().top;
      const header = document.querySelector<HTMLElement>('[data-site-header]');
      if (!header) return 0;
      const position = window.getComputedStyle(header).position;
      if (position !== 'sticky' && position !== 'fixed') return 0;
      return Math.max(0, header.getBoundingClientRect().bottom);
    };

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const viewTop = viewportTop();
      // Never push the button below the image's bottom edge.
      const maxTop = Math.max(TOGGLE_MARGIN, rect.height - TOGGLE_SIZE - TOGGLE_MARGIN);
      const wanted = viewTop - rect.top + TOGGLE_MARGIN;
      setToggleTop(Math.min(maxTop, Math.max(TOGGLE_MARGIN, wanted)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    // Scroll events don't bubble, so listen in the capture phase to catch them
    // from whichever ancestor is actually scrolling.
    const capture = { capture: true, passive: true } as const;
    window.addEventListener('scroll', schedule, capture);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, capture);
      window.removeEventListener('resize', schedule);
    };
  }, [isTouchDevice, isLoaded]);

  // Scroll-to-zoom needs a native non-passive wheel listener (React attaches
  // wheel handlers passively, so preventDefault would be ignored). Only
  // intercepts while the lens is visible — otherwise the page scrolls normally.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!showMagnifierRef.current) return;
      e.preventDefault();
      // Clamp the stored zoom to the native ceiling too — otherwise scrolling
      // "past" the ceiling banks invisible zoom the user must scroll back out of.
      const cap = nativeZoomRef.current > 0 ? Math.min(nativeZoomRef.current, MAX_ZOOM) : MAX_ZOOM;
      setUserZoom((z) => Math.min(cap, Math.max(MIN_ZOOM, z * Math.exp(-e.deltaY * 0.002))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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

    // Without object-contain the element box IS the content area; with it,
    // the content may be letterboxed inside the box (custom imgClassName
    // included — callers like ArtworkHero pass object-contain explicitly).
    const usesObjectContain = imgClassName ? imgClassName.includes('object-contain') : !scrollable;
    if (!usesObjectContain) {
      return { width: rect.width, height: rect.height };
    }

    const containerAspect = rect.width / rect.height;
    const imageAspect = naturalWidth / naturalHeight;

    if (imageAspect > containerAspect) {
      return { width: rect.width, height: rect.width / imageAspect };
    } else {
      return { width: rect.height * imageAspect, height: rect.height };
    }
  }, [scrollable, imgClassName]);

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
    // Skip magnifier on touch devices or when the reader switched the lens off
    // (also skips the full-res prefetch — it only serves the lens)
    if (isTouchDevice || !lensEnabled) return;

    // Get out of the toggle's way — the lens is centred on the cursor, so it would
    // otherwise cover the very button the reader is reaching for.
    const toggleRect = toggleRef.current?.getBoundingClientRect();
    if (
      toggleRect &&
      e.clientX >= toggleRect.left - TOGGLE_MARGIN &&
      e.clientX <= toggleRect.right + TOGGLE_MARGIN &&
      e.clientY >= toggleRect.top - TOGGLE_MARGIN &&
      e.clientY <= toggleRect.bottom + TOGGLE_MARGIN
    ) {
      setShowMagnifier(false);
      return;
    }

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
          className={`max-w-full transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'} ${isTouchDevice || !lensEnabled ? 'cursor-pointer' : 'cursor-crosshair'} ${imgClassName ? imgClassName : scrollable ? 'w-full' : 'w-full h-full object-contain'}`}
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

        {/* Desktop: lens on/off toggle — top-left (deep-zoom button owns top-right).
            While the lens is up it captures scroll for zoom, so readers who want
            to wheel past a tall facsimile can switch it off. Floats with the
            scroll position, and sits above the lens so it's never painted over. */}
        {!isTouchDevice && isLoaded && (
          <button
            ref={toggleRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleLens();
            }}
            title={lensEnabled ? 'Magnifier on — click to turn off (restores normal scrolling)' : 'Turn on magnifier'}
            aria-label={lensEnabled ? 'Turn off magnifier' : 'Turn on magnifier'}
            aria-pressed={lensEnabled}
            style={{ top: toggleTop, zIndex: 110 }}
            className={`absolute left-2 flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors ${
              lensEnabled
                ? 'bg-black/55 text-white hover:bg-black/80'
                : 'bg-black/30 text-white/60 hover:bg-black/55 hover:text-white'
            }`}
          >
            <ZoomIn className="h-4 w-4" />
            {!lensEnabled && (
              <span className="pointer-events-none absolute h-[2px] w-5 rotate-45 rounded-full bg-current" />
            )}
          </button>
        )}

        {/* Desktop: wide reading lens - uses full resolution image, scroll adjusts zoom */}
        {!isTouchDevice && lensEnabled && showMagnifier && fullImageLoaded && (() => {
          // Never magnify past the full image's native pixels (it only blurs) —
          // the native ratio is the ceiling, the user's scroll-zoom picks within it.
          const nativeW = fullImageDimensions.width || imageDimensions.width;
          const nativeZoom = Math.max(nativeW / (imageDimensions.width || 1), MIN_ZOOM);
          const effectiveZoom = Math.min(Math.max(userZoom, MIN_ZOOM), nativeZoom);
          const bgW = imageDimensions.width * effectiveZoom;
          const bgH = imageDimensions.height * effectiveZoom;
          return (
            <div
              className="absolute pointer-events-none overflow-hidden rounded-xl"
              style={{
                width: lensW,
                height: lensH,
                left: cursorPosition.x - lensW / 2,
                top: cursorPosition.y - lensH / 2,
                border: '3px solid white',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                backgroundImage: `url(${magnifierSrc})`,
                backgroundSize: `${bgW}px ${bgH}px`,
                backgroundPosition: `${-(magnifierPosition.x / 100) * bgW + lensW / 2}px ${-(magnifierPosition.y / 100) * bgH + lensH / 2}px`,
                backgroundRepeat: 'no-repeat',
                backgroundColor: 'white',
                zIndex: 100,
              }}
            >
              <span
                className="absolute bottom-1 right-1.5 rounded bg-black/50 px-1 py-px text-[10px] font-medium leading-tight text-white"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {effectiveZoom.toFixed(1)}×
              </span>
            </div>
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

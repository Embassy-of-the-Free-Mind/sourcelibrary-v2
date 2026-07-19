'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ZoomIn, Move, Plus, Minus, RotateCcw, X } from 'lucide-react';
import FullscreenImageViewer from '@/components/reader/FullscreenImageViewer';
import {
  useFloatingOverlayTop,
  FLOATING_OVERLAY_MARGIN,
  LENS_AVOID_ATTR,
  LENS_Z,
  OVERLAY_CONTROL_Z,
} from '@/hooks/useFloatingOverlayTop';

// Readers can switch the hover lens off entirely (some prefer no lens at all).
// Remembered across pages and sessions. The key is versioned: the lens is on
// by default, and bumping the suffix forgets stale "off" preferences so the
// default takes effect again — done when the lens stopped capturing scroll
// (#3137), which removed the main reason anyone had turned it off.
const LENS_PREF_KEY = 'sl-magnifier-lens-v2';

interface ImageWithMagnifierProps {
  src: string;
  thumbnail?: string;
  alt: string;
  className?: string;
  magnifierSize?: number;
  zoomLevel?: number;
  scrollable?: boolean;
  inlineZoomable?: boolean; // Desktop: offer an in-place pan/zoom mode (no modal) — see below
  highResSrc?: string; // For magnifier/zoom, use higher resolution version
  fallbackSrc?: string; // Fallback if src fails to load (e.g. on-the-fly crop URL)
  darkMode?: boolean; // Dark skeleton/background for lightbox contexts
  onLoad?: () => void; // Called when the display image finishes loading
  imgClassName?: string; // Override default img sizing classes (replaces h-full object-contain)
}

// Magnifier component for zooming into the source image.
// Desktop: hover to show a wide reading lens at a fixed magnification; click
// opens the in-app fullscreen viewer. The lens NEVER captures scroll — a
// two-finger/wheel scroll over the image always scrolls the page, so readers
// can browse a passage down a tall facsimile without the lens hijacking it
// (user feedback, 2026-07-13). A corner toggle hides the lens (persisted) for
// those who prefer none. For deeper zoom, click through to the fullscreen
// viewer or the deep-zoom button.
// Mobile/Touch: a two-finger pinch on the scan zooms it in place (same pan/zoom
// surface as the desktop inline toggle, when `inlineZoomable` is set) — one
// finger pans while zoomed, pinching back to 1× returns to reading. Tap still
// opens the raw high-res image in a new tab as the deep-zoom escape hatch (the
// in-place surface clamps at the scan's native pixels — see PR #1873 for the
// prior escape-hatch button).
//
// Inline zoom mode (desktop, opt-in via `inlineZoomable`): a corner toggle turns
// the pane into an in-place pan/zoom surface — no modal (user request,
// 2026-07-13). At 1× the scan fits the pane width; drag pans (so you can browse
// a passage down the page) and the wheel zooms toward the cursor (zoom out to
// orient, move, zoom in on the spot). Esc or the ✕ exits back to reading mode.
export default function ImageWithMagnifier({
  src,
  thumbnail,
  alt,
  className = '',
  magnifierSize = 200,
  zoomLevel = 2.5,
  scrollable = false,
  inlineZoomable = false,
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
  // Lens on/off toggle. Defaults on; hydrated from localStorage after mount
  // (SSR-safe) so the choice sticks across pages and sessions.
  const [lensEnabled, setLensEnabled] = useState(true);
  // Inline pan/zoom mode (desktop, opt-in). scale=1 fits the pane width; x/y are
  // the CSS translate in px (transformOrigin is the pane's top-left).
  const [zoomMode, setZoomMode] = useState(false);
  const [panZoom, setPanZoom] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  // Load the full-res image only once it's needed (first lens hover or zoom).
  const [hasHovered, setHasHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Refs feed the once-bound native wheel / window drag listeners fresh values
  // without re-binding. panZoomRef is authoritative (written synchronously via
  // commitPanZoom); zoomModeRef is set in enter/exit; the dim refs sync in
  // effects. None are written during render (react-hooks/refs).
  const zoomModeRef = useRef(false);
  const panZoomRef = useRef(panZoom);
  const fullDimRef = useRef(fullImageDimensions);
  const imgDimRef = useRef(imageDimensions);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  // Touch gesture state: an in-flight pinch (dist 0 = none) and a one-finger pan.
  const pinchRef = useRef({ dist: 0, midX: 0, midY: 0 });
  const touchPanRef = useRef({ active: false, lastX: 0, lastY: 0 });
  // Last viewport cursor point (for repositioning the lens on scroll) and a
  // mirror of showMagnifier the scroll listener can read without re-binding.
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const showMagnifierRef = useRef(false);
  useEffect(() => { fullDimRef.current = fullImageDimensions; }, [fullImageDimensions]);
  useEffect(() => { imgDimRef.current = imageDimensions; }, [imageDimensions]);
  useEffect(() => { showMagnifierRef.current = showMagnifier; }, [showMagnifier]);
  // Write ref + state together so the listeners never read a stale transform.
  const commitPanZoom = useCallback((v: { scale: number; x: number; y: number }) => {
    panZoomRef.current = v;
    setPanZoom(v);
  }, []);

  // The toggle floats: over a tall facsimile it tracks the top of the visible
  // slice rather than scrolling out of reach, so it stays reachable as the
  // reader scrolls the page past the image.
  const toggleTop = useFloatingOverlayTop(toggleRef, !isTouchDevice && isLoaded);

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

  // ── Inline pan/zoom mode (desktop) ─────────────────────────────────────────
  // The scan's aspect ratio, from the loaded full image (falls back to the
  // rendered reading image). Read from refs so the once-bound listeners below
  // never see a stale value.
  const zoomAspect = useCallback(() => {
    const f = fullDimRef.current, r = imgDimRef.current;
    if (f.width && f.height) return f.width / f.height;
    if (r.width && r.height) return r.width / r.height;
    return 0.7; // portrait book page fallback
  }, []);

  // Deepest useful zoom: the scan's native pixels vs the pane's DEVICE pixels
  // (CSS width × devicePixelRatio) — at that scale one scan pixel maps to one
  // screen pixel, past it there's only blur. Matters most on phones, where the
  // pane is ~400 CSS px at 3× DPR and a 4000px master genuinely supports ~20×.
  // Ceiling 16 keeps the transformed layer inside what mobile Safari will
  // rasterize sharply; floor 2 so even a low-res scan zooms a little.
  const getMaxScale = useCallback(() => {
    const vpW = containerRef.current?.clientWidth || imgDimRef.current.width || 1;
    const native = fullDimRef.current.width || 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    return Math.min(Math.max(native ? (native / vpW) * dpr : 4, 2), 16);
  }, []);

  // Keep the image covering the pane: no dragging it off into empty space.
  // Centres an axis when the content is smaller than the pane on that axis.
  const clampPan = useCallback((x: number, y: number, s: number) => {
    const el = containerRef.current;
    if (!el) return { x, y };
    const vpW = el.clientWidth, vpH = el.clientHeight;
    const baseH = vpW / zoomAspect();
    const contentW = vpW * s, contentH = baseH * s;
    const cx = contentW <= vpW ? (vpW - contentW) / 2 : Math.min(0, Math.max(vpW - contentW, x));
    const cy = contentH <= vpH ? (vpH - contentH) / 2 : Math.min(0, Math.max(vpH - contentH, y));
    return { x: cx, y: cy };
  }, [zoomAspect]);

  // Zoom to a new scale while keeping the point at (cx, cy) — pane coords — fixed.
  const zoomAround = useCallback((cx: number, cy: number, nextScale: number) => {
    const { scale, x, y } = panZoomRef.current;
    const s = Math.min(Math.max(nextScale, 1), getMaxScale());
    const nx = cx - (cx - x) * (s / scale);
    const ny = cy - (cy - y) * (s / scale);
    const c = clampPan(nx, ny, s);
    commitPanZoom({ scale: s, x: c.x, y: c.y });
  }, [getMaxScale, clampPan, commitPanZoom]);

  const enterZoom = useCallback(() => {
    setHasHovered(true); // pull the full-res image (idempotent)
    setShowMagnifier(false);
    commitPanZoom({ scale: 1, x: 0, y: 0 });
    zoomModeRef.current = true;
    setZoomMode(true);
  }, [commitPanZoom]);

  const exitZoom = useCallback(() => {
    zoomModeRef.current = false;
    setZoomMode(false);
    commitPanZoom({ scale: 1, x: 0, y: 0 });
  }, [commitPanZoom]);

  // Wheel zooms toward the cursor (non-passive so we can preventDefault). Only
  // acts in zoom mode — reading mode leaves the wheel to scroll the page.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!zoomModeRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { scale } = panZoomRef.current;
      zoomAround(e.clientX - rect.left, e.clientY - rect.top, scale * Math.exp(-e.deltaY * 0.002));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  // Drag to pan, plus Esc to exit — bound only while zoom mode is active.
  useEffect(() => {
    if (!zoomMode) return;
    const el = containerRef.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Let the toolbar buttons work without starting a drag.
      if ((e.target as HTMLElement)?.closest('[data-zoom-control]')) return;
      e.preventDefault();
      dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, baseX: panZoomRef.current.x, baseY: panZoomRef.current.y };
      setDragging(true);
    };
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const c = clampPan(
        dragRef.current.baseX + (e.clientX - dragRef.current.startX),
        dragRef.current.baseY + (e.clientY - dragRef.current.startY),
        panZoomRef.current.scale,
      );
      commitPanZoom({ scale: panZoomRef.current.scale, x: c.x, y: c.y });
    };
    const onUp = () => { dragRef.current.active = false; setDragging(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitZoom(); };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [zoomMode, clampPan, exitZoom, commitPanZoom]);

  // ── Touch: pinch zooms the scan in place ───────────────────────────────────
  // A pinch that starts on the image enters the same inline pan/zoom surface the
  // desktop toggle uses; the pinch zooms about the fingers' midpoint and follows
  // it (two-finger pan), one finger pans while zoomed, and pinching back down to
  // fit-width exits to the reading view. Bound natively with passive: false so
  // preventDefault works — the reader panel's touch-action: pan-y suppresses the
  // BROWSER's pinch but still delivers the touch events to us.
  // A pan that runs out of image chains into the page: the vertical leftover at
  // the top/bottom edge scrolls the nearest scrollable ancestor, so the reader
  // can keep moving down to the translation without leaving zoom.
  useEffect(() => {
    if (!inlineZoomable) return;
    const el = containerRef.current;
    if (!el) return;
    const touchDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const touchMid = (t: TouchList) => {
      const rect = el.getBoundingClientRect();
      return {
        x: (t[0].clientX + t[1].clientX) / 2 - rect.left,
        y: (t[0].clientY + t[1].clientY) / 2 - rect.top,
      };
    };
    const getScrollParent = (): HTMLElement | null => {
      let cur: HTMLElement | null = el.parentElement;
      while (cur) {
        const style = window.getComputedStyle(cur);
        if (/(auto|scroll)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight) return cur;
        cur = cur.parentElement;
      }
      return (document.scrollingElement as HTMLElement | null);
    };
    const onTouchStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement)?.closest('[data-zoom-control]')) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        if (!zoomModeRef.current) enterZoom();
        touchPanRef.current.active = false;
        const m = touchMid(e.touches);
        pinchRef.current = { dist: touchDist(e.touches), midX: m.x, midY: m.y };
      } else if (e.touches.length === 1 && zoomModeRef.current) {
        touchPanRef.current = { active: true, lastX: e.touches[0].clientX, lastY: e.touches[0].clientY };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current.dist > 0) {
        e.preventDefault();
        const dist = touchDist(e.touches);
        const m = touchMid(e.touches);
        const prev = pinchRef.current;
        zoomAround(m.x, m.y, panZoomRef.current.scale * (dist / prev.dist));
        const p = panZoomRef.current;
        const c = clampPan(p.x + (m.x - prev.midX), p.y + (m.y - prev.midY), p.scale);
        commitPanZoom({ scale: p.scale, x: c.x, y: c.y });
        pinchRef.current = { dist, midX: m.x, midY: m.y };
      } else if (e.touches.length === 1 && touchPanRef.current.active && zoomModeRef.current) {
        e.preventDefault();
        const t = e.touches[0];
        const d = touchPanRef.current;
        const dx = t.clientX - d.lastX;
        const dy = t.clientY - d.lastY;
        d.lastX = t.clientX;
        d.lastY = t.clientY;
        const p = panZoomRef.current;
        const desiredY = p.y + dy;
        const c = clampPan(p.x + dx, desiredY, p.scale);
        commitPanZoom({ scale: p.scale, x: c.x, y: c.y });
        // Scroll chaining: the vertical delta the clamp swallowed at the image's
        // top/bottom edge goes to the page instead. desiredY > clamped means the
        // finger pulled past the top (page scrolls up); below the bottom, down.
        const overshoot = desiredY - c.y;
        if (overshoot !== 0) {
          const scroller = getScrollParent();
          if (scroller) scroller.scrollTop -= overshoot;
        }
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinchRef.current.dist > 0) {
        pinchRef.current.dist = 0;
        // Pinched back out to fit-width: return to the reading view.
        if (zoomModeRef.current && panZoomRef.current.scale <= 1.01) exitZoom();
      }
      if (e.touches.length === 0) {
        touchPanRef.current.active = false;
      } else if (e.touches.length === 1 && zoomModeRef.current) {
        // The finger that stays down continues seamlessly as a pan.
        touchPanRef.current = { active: true, lastX: e.touches[0].clientX, lastY: e.touches[0].clientY };
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [inlineZoomable, enterZoom, exitZoom, zoomAround, clampPan, commitPanZoom]);

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

    // Page navigation drops out of inline zoom back to the reading view of the
    // NEW page. Without this the next page opens stuck at the previous page's
    // zoom/pan (the reading <img> is unmounted in zoom mode, so it never shows
    // the new scan) — "next page doesn't reset / move to the next image".
    zoomModeRef.current = false;
    panZoomRef.current = { scale: 1, x: 0, y: 0 };
    setZoomMode(false);
    setPanZoom({ scale: 1, x: 0, y: 0 });

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

  // Load full image only on first hover / zoom (lazy load for magnifier)
  useEffect(() => {
    if (!hasHovered) return;
    const img = new window.Image();
    img.onload = () => {
      setFullImageLoaded(true);
      setFullImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = magnifierSrc;
  }, [magnifierSrc, hasHovered]);

  // Is the cursor on (or just beside) a control the lens must not cover? Searches
  // from the positioning wrapper, so it finds sibling controls drawn over the
  // same image as well as our own toggle.
  const isOverLensAvoidControl = (clientX: number, clientY: number) => {
    const scope = containerRef.current?.parentElement ?? containerRef.current;
    if (!scope) return false;
    return [...scope.querySelectorAll<HTMLElement>(`[${LENS_AVOID_ATTR}]`)].some((control) => {
      const box = control.getBoundingClientRect();
      return (
        clientX >= box.left - FLOATING_OVERLAY_MARGIN &&
        clientX <= box.right + FLOATING_OVERLAY_MARGIN &&
        clientY >= box.top - FLOATING_OVERLAY_MARGIN &&
        clientY <= box.bottom + FLOATING_OVERLAY_MARGIN
      );
    });
  };

  // Position the lens for a given viewport cursor point. Reads all geometry
  // fresh from the DOM, so it's correct whether it fires from a mousemove or
  // from a scroll (the reader panel scrolls the tall facsimile under a
  // stationary cursor — see the scroll listener below).
  const positionLensAt = useCallback((clientX: number, clientY: number) => {
    // Skip on touch devices, in inline zoom mode, or when the lens is off
    // (also skips the full-res prefetch — it only serves the lens)
    if (isTouchDevice || zoomMode || !lensEnabled) return;

    // Get out of the controls' way — the lens is centred on the cursor, so it
    // would otherwise cover the very button the reader is reaching for. Covers
    // our own toggle plus any sibling control that opts in (the deep-zoom
    // button, which lives outside this component but over the same image).
    if (isOverLensAvoidControl(clientX, clientY)) {
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

    // Cursor position relative to the lens's positioning parent (the container).
    // Because the lens is absolutely positioned inside the container, this must
    // be re-derived from the LIVE container rect every time — the container
    // scrolls with the page, so a cached value would drift the lens off-cursor.
    const containerX = clientX - containerRect.left;
    const containerY = clientY - containerRect.top;

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
  }, [isTouchDevice, zoomMode, lensEnabled, hasHovered, fullImageLoaded, getRenderedImageSize, imageDimensions]);

  // Desktop: mouse move drives the lens, and remember the last cursor point so
  // the scroll listener can keep the lens glued to it while the page scrolls.
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    positionLensAt(e.clientX, e.clientY);
  };

  // Keep the lens glued to the cursor while the reader scrolls the facsimile.
  // A trackpad/wheel scroll fires no mousemove, so without this the image (and
  // the lens absolutely positioned inside it) slides out from under a
  // stationary cursor — the "magnifier not aligned" report (2026-07-13). Only
  // reposition while the lens is already up; capture:true catches the panel's
  // own scroll (scroll events don't bubble).
  useEffect(() => {
    const onScroll = () => {
      if (!showMagnifierRef.current) return;
      const m = lastMouseRef.current;
      if (m) positionLensAt(m.x, m.y);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [positionLensAt]);

  // Tap/click to open fullscreen.
  // On touch devices, skip the in-app viewer (capped at 5x) and open the
  // highest-resolution image in a new tab so the browser's native pinch-zoom
  // can take over. Desktop keeps the in-app viewer where the magnifier lives.
  const handleClick = () => {
    if (!isLoaded || zoomMode) return; // in zoom mode, clicks drive drag/pan
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
        // data-no-swipe while zoomed: a one-finger pan must not read as the
        // reader's swipe-between-pages gesture (reading mode keeps the swipe).
        {...(zoomMode ? { 'data-no-swipe': '' } : {})}
        className={`relative ${className} ${zoomMode ? `overflow-hidden select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}` : ''}`}
        // touchAction none while zoomed: the pan/pinch is ours, the page must
        // not scroll underneath (overrides the reader panel's pan-y).
        style={zoomMode ? { height: 'min(78vh, 900px)', background: darkMode ? '#000' : 'var(--bg-white, #fff)', touchAction: 'none' } : undefined}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setShowMagnifier(false)}
        onClick={handleClick}
      >
        {/* Loading skeleton — use last known height in scrollable mode to prevent layout shift.
            Default to 140vw for portrait book pages (~1.4:1 aspect ratio) to avoid a big
            jump when the real image loads. Capped at 900px for large screens. */}
        {!zoomMode && !isLoaded && (
          <div
            className={`flex items-center justify-center ${darkMode ? 'bg-black' : 'bg-stone-100 animate-pulse'} ${scrollable ? 'w-full' : 'absolute inset-0'}`}
            style={scrollable && lastImageHeight > 0 ? { height: lastImageHeight } : scrollable ? { height: 'min(140vw, 900px)' } : undefined}
          >
            <div className={`text-sm ${darkMode ? 'text-stone-600' : 'text-stone-400'}`}>Loading...</div>
          </div>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        {!zoomMode && (
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
        )}

        {/* Inline zoom mode: the pane becomes a pan/zoom surface. High-res image,
            transformed about the top-left; drag pans, wheel zooms to the cursor. */}
        {zoomMode && (() => {
          const zoomTransform = `translate(${panZoom.x}px, ${panZoom.y}px) scale(${panZoom.scale})`;
          return (
          <>
            {/* Low-res backdrop under the full-res image — same transform, so
                there's detail on screen instantly while the master decodes. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displaySrc}
              alt=""
              aria-hidden
              draggable={false}
              className="absolute top-0 left-0 pointer-events-none select-none max-w-none"
              style={{ width: '100%', height: 'auto', transform: zoomTransform, transformOrigin: '0 0' }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={magnifierSrc}
              alt={alt}
              draggable={false}
              className="absolute top-0 left-0 pointer-events-none select-none max-w-none"
              style={{
                width: '100%',
                height: 'auto',
                transform: zoomTransform,
                transformOrigin: '0 0',
                willChange: 'transform',
              }}
            />
            {/* Toolbar: zoom out / % / zoom in / reset / exit */}
            <div
              data-zoom-control
              className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-lg bg-black/65 px-1.5 py-1 text-white backdrop-blur-sm"
              style={{ zIndex: OVERLAY_CONTROL_Z }}
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" onClick={() => { const el = containerRef.current; if (el) zoomAround(el.clientWidth / 2, el.clientHeight / 2, panZoom.scale / 1.4); }} title="Zoom out" aria-label="Zoom out" className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/20">
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[3rem] text-center text-xs font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(panZoom.scale * 100)}%</span>
              <button type="button" onClick={() => { const el = containerRef.current; if (el) zoomAround(el.clientWidth / 2, el.clientHeight / 2, panZoom.scale * 1.4); }} title="Zoom in" aria-label="Zoom in" className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/20">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => commitPanZoom({ scale: 1, x: 0, y: 0 })} title="Reset" aria-label="Reset zoom" className="ml-0.5 flex h-7 w-7 items-center justify-center rounded hover:bg-white/20">
                <RotateCcw className="h-4 w-4" />
              </button>
              <span className="mx-0.5 h-4 w-px bg-white/25" />
              <button type="button" onClick={exitZoom} title="Exit zoom (Esc)" aria-label="Exit zoom" className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/20">
                <X className="h-4 w-4" />
              </button>
            </div>
          </>
          );
        })()}

        {/* Desktop: inline pan/zoom toggle — sits beside the lens toggle. Opens
            the in-place zoom surface (no modal); hidden while zoom mode is on
            (the toolbar's ✕ exits). */}
        {inlineZoomable && !isTouchDevice && isLoaded && !zoomMode && (
          <button
            type="button"
            {...{ [LENS_AVOID_ATTR]: '' }}
            onClick={(e) => { e.stopPropagation(); enterZoom(); }}
            title="Zoom & pan this page (in place)"
            aria-label="Zoom and pan this page"
            style={{ top: toggleTop, zIndex: OVERLAY_CONTROL_Z }}
            className="absolute left-11 flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
          >
            <Move className="h-4 w-4" />
          </button>
        )}

        {/* Desktop: lens on/off toggle — top-left (deep-zoom button owns top-right).
            The lens is a reading aid at fixed magnification; readers who prefer
            no lens can switch it off. Floats with the scroll position, and sits
            above the lens so it's never painted over. */}
        {!isTouchDevice && isLoaded && !zoomMode && (
          <button
            ref={toggleRef}
            type="button"
            {...{ [LENS_AVOID_ATTR]: '' }}
            onClick={(e) => {
              e.stopPropagation();
              toggleLens();
            }}
            title={lensEnabled ? 'Magnifier on — click to turn off' : 'Turn on magnifier'}
            aria-label={lensEnabled ? 'Turn off magnifier' : 'Turn on magnifier'}
            aria-pressed={lensEnabled}
            style={{ top: toggleTop, zIndex: OVERLAY_CONTROL_Z }}
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

        {/* Desktop: wide reading lens at fixed magnification — full-res image */}
        {!isTouchDevice && lensEnabled && showMagnifier && fullImageLoaded && (() => {
          // Fixed magnification (no scroll-to-zoom — scroll always scrolls the
          // page). Never magnify past the full image's native pixels (it only
          // blurs), so a low-res scan clamps below the requested zoomLevel.
          const nativeW = fullImageDimensions.width || imageDimensions.width;
          const nativeZoom = Math.max(nativeW / (imageDimensions.width || 1), MIN_ZOOM);
          const effectiveZoom = Math.min(Math.max(zoomLevel, MIN_ZOOM), nativeZoom);
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
                zIndex: LENS_Z,
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

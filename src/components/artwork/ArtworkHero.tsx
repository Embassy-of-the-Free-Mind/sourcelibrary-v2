'use client';

import { useState, useEffect, lazy, Suspense } from 'react';
import Link from 'next/link';
import ImageWithMagnifier from '@/components/ui/ImageWithMagnifier';
import { ZoomIn, Maximize, Minimize, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { DeepZoomManifest } from '@/lib/types/book';

// Lazy so OpenSeadragon (and its bundle weight) only loads on user intent.
const DeepZoomOverlay = lazy(() => import('./DeepZoomOverlay'));

interface ArtworkNavItem {
  slug: string;
  title: string;
}

interface ArtworkHeroProps {
  imageUrl: string;
  thumbUrl?: string;
  hiResUrl?: string;
  title: string;
  fullResUrl: string;
  license: string;
  isLandscape: boolean;
  prevWork?: ArtworkNavItem | null;
  nextWork?: ArtworkNavItem | null;
  /** Per-collection prev/next pairs — when the visitor arrived via ?from=<collection>, arrows walk that collection. */
  navByCollection?: Record<string, { prev: ArtworkNavItem | null; next: ArtworkNavItem | null }>;
  institution?: string;
  deepZoom?: DeepZoomManifest | null;
}

export default function ArtworkHero({ imageUrl, thumbUrl, hiResUrl, title, fullResUrl, license, isLandscape, prevWork, nextWork, navByCollection, institution, deepZoom }: ArtworkHeroProps) {
  const [fitWidth, setFitWidth] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const [zoomOpen, setZoomOpen] = useState(false);
  const hasThumb = !!thumbUrl && thumbUrl !== imageUrl;
  const hasHiRes = !!hiResUrl && hiResUrl !== imageUrl;
  const [medReady, setMedReady] = useState(!hasThumb);
  const [hiResReady, setHiResReady] = useState(false);

  // Auto-hide chrome after 3s
  useEffect(() => {
    const timer = setTimeout(() => setShowChrome(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Background-load medium blob
  useEffect(() => {
    if (!hasThumb) return;
    const img = new window.Image();
    img.onload = () => setMedReady(true);
    img.src = imageUrl;
  }, [hasThumb, imageUrl]);

  // Background-load hi-res after medium is ready
  useEffect(() => {
    if (!medReady || !hasHiRes) return;
    const img = new window.Image();
    img.onload = () => setHiResReady(true);
    img.src = hiResUrl!;
  }, [medReady, hasHiRes, hiResUrl]);

  const displaySrc = hiResReady && hiResUrl ? hiResUrl
    : medReady ? imageUrl
    : thumbUrl || imageUrl;

  const magnifierSrc = hiResReady && hiResUrl ? hiResUrl : imageUrl;

  // Collection context: when the visitor arrived from a collection page
  // (?from=<slug>), walk that collection's prev/next instead of the default
  // scope, and keep the param on the nav links so the context persists.
  // Read from window.location after mount — the page is statically rendered,
  // and useSearchParams() would force a CSR bailout.
  const [fromCollection, setFromCollection] = useState<string | null>(null);
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get('from');
    if (from && navByCollection?.[from]) setFromCollection(from);
  }, [navByCollection]);

  const activeNav = fromCollection ? navByCollection![fromCollection] : { prev: prevWork ?? null, next: nextWork ?? null };
  const navHref = (item: ArtworkNavItem) =>
    `/artwork/${item.slug}${fromCollection ? `?from=${encodeURIComponent(fromCollection)}` : ''}`;

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && activeNav.prev) {
        window.location.href = navHref(activeNav.prev);
      } else if (e.key === 'ArrowRight' && activeNav.next) {
        window.location.href = navHref(activeNav.next);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav.prev, activeNav.next, fromCollection]);

  const captionText = [institution, license].filter(Boolean).join(' · ');

  return (
    <div
      className="bg-black relative group/hero"
      onMouseEnter={() => setShowChrome(true)}
      onMouseLeave={() => setShowChrome(false)}
    >
      {/* Image container — viewport-height by default, natural proportions */}
      <div className="flex items-center justify-center" style={{ minHeight: fitWidth ? undefined : 'calc(100vh - 64px)' }}>
          <ImageWithMagnifier
            src={displaySrc}
            thumbnail={displaySrc}
            highResSrc={magnifierSrc}
            alt={title}
            className={`${fitWidth ? 'w-full' : ''} mx-auto`}
            imgClassName={fitWidth ? 'w-full' : 'max-h-[calc(100vh-64px)]'}
            magnifierSize={240}
            zoomLevel={3}
            darkMode
          />
      </div>

      {/* Top-right controls — appear on hover */}
      <div className={`absolute top-4 right-4 flex items-center gap-2 z-10 transition-all ${showChrome ? 'opacity-100' : 'opacity-0'}`}>
        {deepZoom && (
          <button
            onClick={() => setZoomOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm transition-all"
            title="Open deep zoom — stream the full-resolution image tile by tile"
          >
            <Search className="w-3.5 h-3.5" />
            Deep zoom
          </button>
        )}
        <button
          onClick={() => setFitWidth(!fitWidth)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm transition-all"
          title={fitWidth ? 'Fit to screen' : 'Fit to width'}
        >
          {fitWidth ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          {fitWidth ? 'Fit screen' : 'Full width'}
        </button>
      </div>

      {/* Deep-zoom overlay — mounted only on user intent */}
      {zoomOpen && deepZoom && (
        <Suspense fallback={null}>
          <DeepZoomOverlay
            manifest={deepZoom}
            title={title}
            caption={captionText}
            onClose={() => setZoomOpen(false)}
          />
        </Suspense>
      )}

      {/* Prev/Next navigation — appears on hover */}
      {activeNav.prev && (
        <Link
          href={navHref(activeNav.prev)}
          className={`absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-3 bg-black/40 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm transition-all z-10 group ${showChrome ? 'opacity-100' : 'opacity-0'}`}
          title={activeNav.prev.title}
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="hidden sm:block text-xs max-w-[120px] truncate opacity-0 group-hover:opacity-100 transition-opacity">{activeNav.prev.title}</span>
        </Link>
      )}
      {activeNav.next && (
        <Link
          href={navHref(activeNav.next)}
          className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-3 bg-black/40 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm transition-all z-10 group ${showChrome ? 'opacity-100' : 'opacity-0'}`}
          title={activeNav.next.title}
        >
          <span className="hidden sm:block text-xs max-w-[120px] truncate opacity-0 group-hover:opacity-100 transition-opacity">{activeNav.next.title}</span>
          <ChevronRight className="w-5 h-5" />
        </Link>
      )}

      {/* Caption bar — appears on hover */}
      <div className={`absolute bottom-0 left-0 right-0 transition-all ${showChrome ? 'opacity-100' : 'opacity-0'}`}>
        <div className="bg-gradient-to-t from-black/80 to-transparent px-6 md:px-12 py-4 flex items-center justify-between">
          <p className="text-xs text-stone-400">
            {captionText || 'Hover to magnify'}
          </p>
          <a
            href={fullResUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-white transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            Original file
          </a>
        </div>
      </div>
    </div>
  );
}

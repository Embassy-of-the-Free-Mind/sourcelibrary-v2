'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import ImageWithMagnifier from '@/components/ui/ImageWithMagnifier';
import { ZoomIn, Maximize, Minimize, ChevronLeft, ChevronRight } from 'lucide-react';

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
}

export default function ArtworkHero({ imageUrl, thumbUrl, hiResUrl, title, fullResUrl, license, isLandscape, prevWork, nextWork }: ArtworkHeroProps) {
  const [fitHeight, setFitHeight] = useState(false);
  const hasThumb = !!thumbUrl && thumbUrl !== imageUrl;
  const hasHiRes = !!hiResUrl && hiResUrl !== imageUrl;
  const [medReady, setMedReady] = useState(!hasThumb); // if no thumb, medium is already the starting point
  const [hiResReady, setHiResReady] = useState(false);

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

  // Best loaded source — upgrades instantly, no transitions
  const displaySrc = hiResReady && hiResUrl ? hiResUrl
    : medReady ? imageUrl
    : thumbUrl || imageUrl;

  // Best available for magnifier zoom
  const magnifierSrc = hiResReady && hiResUrl ? hiResUrl : imageUrl;

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && prevWork) {
        window.location.href = `/artwork/${prevWork.slug}`;
      } else if (e.key === 'ArrowRight' && nextWork) {
        window.location.href = `/artwork/${nextWork.slug}`;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [prevWork, nextWork]);

  return (
    <div className="bg-stone-900 relative">
      {/* Image container */}
      <div className={`max-w-[var(--container-wide)] mx-auto ${fitHeight ? 'py-2' : isLandscape ? 'py-4 sm:py-8' : 'py-4 sm:py-8 max-w-3xl'}`}>
        <div
          className={`relative mx-auto ${fitHeight ? '' : isLandscape ? 'aspect-[16/10]' : 'aspect-[3/4]'}`}
          style={fitHeight ? { height: 'calc(100vh - 120px)' } : undefined}
        >
          <ImageWithMagnifier
            src={displaySrc}
            thumbnail={displaySrc}
            highResSrc={magnifierSrc}
            alt={title}
            className="w-full h-full"
            magnifierSize={240}
            zoomLevel={3}
            darkMode
          />
        </div>
      </div>

      {/* Fit-to-height toggle */}
      <button
        onClick={() => setFitHeight(!fitHeight)}
        className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm transition-colors z-10"
        title={fitHeight ? 'Fit to width' : 'Fit to screen height'}
      >
        {fitHeight ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
        {fitHeight ? 'Fit width' : 'Fit height'}
      </button>

      {/* Prev/Next navigation */}
      {prevWork && (
        <Link
          href={`/artwork/${prevWork.slug}`}
          className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-3 bg-black/40 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm transition-colors z-10 group"
          title={prevWork.title}
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="hidden sm:block text-xs max-w-[120px] truncate opacity-0 group-hover:opacity-100 transition-opacity">{prevWork.title}</span>
        </Link>
      )}
      {nextWork && (
        <Link
          href={`/artwork/${nextWork.slug}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-3 bg-black/40 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm transition-colors z-10 group"
          title={nextWork.title}
        >
          <span className="hidden sm:block text-xs max-w-[120px] truncate opacity-0 group-hover:opacity-100 transition-opacity">{nextWork.title}</span>
          <ChevronRight className="w-5 h-5" />
        </Link>
      )}

      {/* Caption bar */}
      <div className="border-t border-stone-800">
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-3 flex items-center justify-between">
          <p className="text-xs text-stone-500">
            Wikimedia Commons · {license} · Hover to magnify, click for fullscreen
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

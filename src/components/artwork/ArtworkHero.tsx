'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [fitWidth, setFitWidth] = useState(false);
  const [showChrome, setShowChrome] = useState(false);
  const hasThumb = !!thumbUrl && thumbUrl !== imageUrl;
  const hasHiRes = !!hiResUrl && hiResUrl !== imageUrl;
  const [medReady, setMedReady] = useState(!hasThumb);
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

  const displaySrc = hiResReady && hiResUrl ? hiResUrl
    : medReady ? imageUrl
    : thumbUrl || imageUrl;

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

  // Auto-hide chrome
  const handleMouseMove = useCallback(() => {
    setShowChrome(true);
  }, []);

  useEffect(() => {
    if (!showChrome) return;
    const timer = setTimeout(() => setShowChrome(false), 2500);
    return () => clearTimeout(timer);
  }, [showChrome]);

  return (
    <div
      className="bg-black relative group/hero"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowChrome(false)}
    >
      {/* Image container — fills viewport height by default, no padding */}
      <div
        className={fitWidth ? 'w-full' : 'flex items-center justify-center'}
        style={fitWidth ? undefined : { height: 'calc(100vh - 64px)' }}
      >
        <div
          className={`relative ${fitWidth ? 'w-full' : 'h-full'}`}
          style={fitWidth ? undefined : { maxHeight: 'calc(100vh - 64px)' }}
        >
          <ImageWithMagnifier
            src={displaySrc}
            thumbnail={displaySrc}
            highResSrc={magnifierSrc}
            alt={title}
            className={fitWidth ? 'w-full h-auto' : 'h-full w-auto mx-auto'}
            magnifierSize={240}
            zoomLevel={3}
            darkMode
          />
        </div>
      </div>

      {/* Chrome — appears on hover, fades out */}
      <div className={`transition-opacity duration-300 ${showChrome ? 'opacity-100' : 'opacity-0'} pointer-events-none`}>
        {/* Fit toggle */}
        <button
          onClick={() => setFitWidth(!fitWidth)}
          className="pointer-events-auto absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm transition-colors z-10"
          title={fitWidth ? 'Fit to viewport' : 'Fit to width'}
        >
          {fitWidth ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          {fitWidth ? 'Fit screen' : 'Fit width'}
        </button>

        {/* Prev/Next */}
        {prevWork && (
          <Link
            href={`/artwork/${prevWork.slug}`}
            className="pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors z-10"
            title={prevWork.title}
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
        )}
        {nextWork && (
          <Link
            href={`/artwork/${nextWork.slug}`}
            className="pointer-events-auto absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors z-10"
            title={nextWork.title}
          >
            <ChevronRight className="w-5 h-5" />
          </Link>
        )}

        {/* Minimal caption — bottom edge */}
        <div className="pointer-events-auto absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-6 py-4 flex items-end justify-between">
          <p className="text-xs text-white/50">
            {license} · Hover to magnify
          </p>
          <a
            href={fullResUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            Original
          </a>
        </div>
      </div>
    </div>
  );
}

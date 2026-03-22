'use client';

import ImageWithMagnifier from '@/components/ui/ImageWithMagnifier';
import { ZoomIn } from 'lucide-react';

interface ArtworkHeroProps {
  imageUrl: string;
  title: string;
  fullResUrl: string;
  license: string;
  isLandscape: boolean;
}

export default function ArtworkHero({ imageUrl, title, fullResUrl, license, isLandscape }: ArtworkHeroProps) {
  return (
    <div className="bg-stone-900">
      <div className={`max-w-[var(--container-wide)] mx-auto ${isLandscape ? 'py-4 sm:py-8' : 'py-4 sm:py-8 max-w-3xl'}`}>
        <div className={`relative ${isLandscape ? 'aspect-[16/10]' : 'aspect-[3/4]'} mx-auto`}>
          <ImageWithMagnifier
            src={imageUrl}
            alt={title}
            className="w-full h-full"
            magnifierSize={240}
            zoomLevel={3}
            darkMode
          />
        </div>
      </div>
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

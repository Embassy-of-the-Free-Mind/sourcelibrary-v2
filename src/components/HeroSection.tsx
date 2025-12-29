'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { recordLoadingMetric } from '@/lib/analytics';

export default function HeroSection() {
  const [videoLoaded, setVideoLoaded] = useState(false);
  const hasRecorded = useRef(false);

  const handleVideoLoad = () => {
    if (!hasRecorded.current && typeof window !== 'undefined') {
      // Use Navigation Timing API for accurate page-relative timing
      const navStart = performance.timing?.navigationStart || performance.timeOrigin;
      const loadTime = Date.now() - navStart;
      recordLoadingMetric('hero_video_load', loadTime);
      hasRecorded.current = true;
    }
    setVideoLoaded(true);
  };

  return (
    <section className="relative h-screen w-full overflow-hidden bg-black">
      {/* Poster image - loads immediately as background (local, 2s into video) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/hero-poster.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover z-0"
        fetchPriority="high"
      />

      {/* Video - plays over poster when ready */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onCanPlay={handleVideoLoad}
        className="absolute inset-0 w-full h-full object-cover z-0"
      >
        <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.webm" type="video/webm" />
        <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.mp4" type="video/mp4" />
      </video>

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40 z-0" />

      {/* Header Navigation - visible immediately */}
      <header className="relative z-50 flex items-center justify-between px-6 md:px-12 py-4">
        <Link href="/" className="text-white flex items-center gap-3">
          <Image src="/logo.svg" alt="Source Library" width={48} height={48} className="w-10 h-10 md:w-12 md:h-12" priority />
          <span className="text-xl md:text-2xl uppercase tracking-wider text-white">
            <span className="font-semibold text-white">Source</span>
            <span className="font-light text-white">Library</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/upload"
            className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm text-white rounded-full text-sm font-medium hover:bg-white/20 transition-colors border border-white/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Book
          </Link>
        </div>
      </header>

      {/* Hero Content - text visible immediately, no delay */}
      <div className="relative z-10 h-full flex items-center">
        <div className="px-6 md:px-12 max-w-3xl">
          <h1
            className="text-4xl md:text-5xl lg:text-6xl text-white mb-6 leading-tight tracking-wide"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            Unlock a New Renaissance of Ancient Knowledge
          </h1>
          <p className="text-lg md:text-xl font-light text-white/90 leading-relaxed max-w-2xl">
            Source Library is scanning and translating rare Hermetic and esoteric texts to make them accessible to scholars, seekers, and AI systems.
          </p>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
        <svg className="w-6 h-6 text-white animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    </section>
  );
}

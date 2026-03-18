'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { recordLoadingMetric } from '@/lib/analytics';
import { BookLoader } from '@/components/ui/BookLoader';

export default function SocietyHeroSection() {
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const hasRecorded = useRef(false);

  // Show content after a brief delay even if video isn't loaded
  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 300);
    return () => clearTimeout(timer);
  }, []);

  const handleVideoLoad = () => {
    if (!hasRecorded.current && typeof window !== 'undefined') {
      const navStart = performance.timing?.navigationStart || performance.timeOrigin;
      const loadTime = Date.now() - navStart;
      recordLoadingMetric('society_hero_video_load', loadTime);
      hasRecorded.current = true;
    }
    setVideoLoaded(true);
    setShowContent(true);
  };

  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-stone-950">
      {/* Loading state */}
      {!showContent && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-stone-950">
          <BookLoader size="sm" variant="dark" />
        </div>
      )}

      {/* Poster image - loads immediately */}
      <img
        src="/hero-poster.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover z-0"
        fetchPriority="high"
        onLoad={() => setShowContent(true)}
      />

      {/* Video background - same as Source Library */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onCanPlay={handleVideoLoad}
        className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-500 ${videoLoaded ? 'opacity-100' : 'opacity-0'}`}
      >
        <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.webm#t=3" type="video/webm" />
        <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.mp4#t=3" type="video/mp4" />
      </video>

      {/* Darker overlay for Society - more mysterious */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/70 z-0" />

      {/* Header */}
      <header className="relative z-50 flex items-center justify-between px-6 md:px-12 py-4">
        <Link href="/" className="text-white flex items-center gap-3">
          {/* Ficino Society Logo - concentric circles with flame */}
          <svg className="w-10 h-10 md:w-12 md:h-12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="22" stroke="white" strokeWidth="1" opacity="0.6" />
            <circle cx="24" cy="24" r="16" stroke="white" strokeWidth="1" opacity="0.8" />
            <circle cx="24" cy="24" r="10" stroke="white" strokeWidth="1.5" />
            {/* Flame in center */}
            <path d="M24 32c-3 0-5-2.5-5-5.5 0-4 3-7 5-9 2 2 5 5 5 9 0 3-2 5.5-5 5.5z" fill="white" opacity="0.9" />
            <path d="M24 30c-1.5 0-2.5-1.2-2.5-2.8 0-2 1.5-3.5 2.5-4.5 1 1 2.5 2.5 2.5 4.5 0 1.6-1 2.8-2.5 2.8z" fill="#c9a86c" />
          </svg>
          <div className="flex flex-col">
            <span className="text-lg md:text-xl tracking-wide text-white font-light">
              The Ficino Society
            </span>
            <span className="text-[10px] md:text-xs tracking-widest text-white/60 uppercase">
              Est. MMXXV
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/auth/signin"
            className="px-4 py-2 text-white/90 text-sm font-medium hover:text-white transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/apply"
            className="flex items-center gap-2 px-5 py-2.5 bg-accent-rust/90 backdrop-blur-sm text-white rounded-full text-sm font-medium hover:bg-accent-rust transition-colors"
          >
            Apply for Membership
          </Link>
        </div>
      </header>

      {/* Hero Content */}
      <div className="relative z-10 min-h-[calc(100vh-80px)] flex items-center">
        <div className="px-6 md:px-12 max-w-5xl">
          {/* Small eyebrow */}
          <p
            className="text-accent-gold/90 text-sm md:text-base tracking-widest uppercase mb-6 font-sans"
          >
            A Cooperative of Scholars & Seekers
          </p>

          {/* Main headline */}
          <h1
            className="text-4xl md:text-5xl lg:text-6xl text-white mb-8 leading-tight"
            style={{ fontWeight: 400 }}
          >
            Join the community translating<br />
            <span className="text-accent-gold">the Western esoteric tradition</span>
          </h1>

          {/* Subheadline */}
          <p
            className="text-lg md:text-xl text-white/80 leading-relaxed max-w-2xl mb-10 font-body"
          >
            Rare alchemical manuscripts, Hermetic treatises, and Kabbalistic texts—freshly
            translated from Latin, German, and Greek. Your membership funds the work.
            You decide what we translate next.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap gap-4">
            <Link
              href="/apply"
              className="px-8 py-4 bg-accent-rust hover:bg-accent-gold/80 text-white rounded-lg text-base font-medium transition-colors font-sans"
            >
              Apply for Membership
            </Link>
            <a
              href="#what-inside"
              className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white rounded-lg text-base font-medium transition-colors border border-white/20 font-sans"
            >
              See What&apos;s Inside
            </a>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap gap-8 md:gap-12 mt-16 pt-8 border-t border-white/20">
            <div>
              <p className="text-3xl md:text-4xl text-white font-light font-serif">
                847
              </p>
              <p className="text-xs text-white/60 uppercase tracking-wider mt-1 font-sans">
                Texts Translated
              </p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl text-white font-light font-serif">
                12,400+
              </p>
              <p className="text-xs text-white/60 uppercase tracking-wider mt-1 font-sans">
                Pages Available
              </p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl text-accent-gold font-light font-serif">
                $2,400
              </p>
              <p className="text-xs text-white/60 uppercase tracking-wider mt-1 font-sans">
                Funded This Month
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
        <a href="#what-inside" className="flex flex-col items-center gap-2 text-white/60 hover:text-white/80 transition-colors">
          <span className="text-xs tracking-widest uppercase font-sans">Explore</span>
          <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </a>
      </div>
    </section>
  );
}

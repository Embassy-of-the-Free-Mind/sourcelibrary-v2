'use client';

import Link from 'next/link';

export default function SocietyHeroSection() {
  return (
    <section className="relative min-h-screen w-full bg-stone-900">
      {/* Header */}
      <header className="relative z-50 flex items-center justify-between px-6 md:px-12 py-4">
        <Link href="/" className="text-white flex items-center gap-3">
          {/* Ficino Society Logo - concentric circles with flame */}
          <svg className="w-10 h-10 md:w-12 md:h-12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="22" stroke="white" strokeWidth="1" opacity="0.6" />
            <circle cx="24" cy="24" r="16" stroke="white" strokeWidth="1" opacity="0.8" />
            <circle cx="24" cy="24" r="10" stroke="white" strokeWidth="1.5" />
            <path d="M24 32c-3 0-5-2.5-5-5.5 0-4 3-7 5-9 2 2 5 5 5 9 0 3-2 5.5-5 5.5z" fill="white" opacity="0.9" />
            <path d="M24 30c-1.5 0-2.5-1.2-2.5-2.8 0-2 1.5-3.5 2.5-4.5 1 1 2.5 2.5 2.5 4.5 0 1.6-1 2.8-2.5 2.8z" fill="#c9a86c" />
          </svg>
          <div className="flex flex-col">
            <span className="text-lg md:text-xl tracking-wide text-white font-light">
              The Ficino Society
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
            className="px-5 py-2.5 bg-amber-600 text-white rounded-full text-sm font-medium hover:bg-amber-500 transition-colors"
          >
            Join
          </Link>
        </div>
      </header>

      {/* Hero Content */}
      <div className="relative z-10 min-h-[calc(100vh-80px)] flex items-center">
        <div className="px-6 md:px-12 max-w-3xl">
          {/* Main headline */}
          <h1
            className="text-4xl md:text-5xl lg:text-6xl text-white mb-8 leading-tight"
            style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
          >
            A community translating the Western esoteric tradition
          </h1>

          {/* Subheadline */}
          <p
            className="text-lg md:text-xl text-white/70 leading-relaxed max-w-2xl mb-10"
            style={{ fontFamily: 'Georgia, serif' }}
          >
            Rare alchemical manuscripts, Hermetic treatises, and Kabbalistic texts—freshly translated. Your membership funds the work.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap gap-4">
            <Link
              href="/apply"
              className="px-8 py-4 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-base font-medium transition-colors"
            >
              Become a Member
            </Link>
            <a
              href="#library"
              className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white rounded-lg text-base font-medium transition-colors border border-white/20"
            >
              Browse the Library
            </a>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
        <a href="#library" className="flex flex-col items-center gap-2 text-white/40 hover:text-white/60 transition-colors">
          <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </a>
      </div>
    </section>
  );
}

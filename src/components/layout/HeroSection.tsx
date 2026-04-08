'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { signIn, useSession } from 'next-auth/react';
import { recordLoadingMetric } from '@/lib/analytics';
import UnifiedSearch from '@/components/search/UnifiedSearch';
import SiteHeader from '@/components/layout/SiteHeader';

function HeroSignUp() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      await signIn('email', { email, callbackUrl: '/', redirect: false });
      setSent(true);
    } catch {
      // fall through
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="max-w-xl">
        <p className="text-white text-lg">
          Check your email &mdash; we sent a sign-in link to <strong>{email}</strong>
        </p>
        <button
          onClick={() => setSent(false)}
          className="mt-3 text-sm text-white/60 hover:text-white/90 transition-colors underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email address"
          required
          className="flex-1 px-5 py-3.5 rounded-lg bg-white text-stone-900 placeholder-stone-400 text-base outline-none border border-white focus:ring-2 focus:ring-white/50 transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !email}
          className="px-7 py-3.5 rounded-lg text-base font-medium transition-all hover:brightness-110 disabled:opacity-50 shrink-0"
          style={{ background: 'var(--accent-rust)', color: '#fff' }}
        >
          {loading ? 'Sending...' : 'Join us'}
        </button>
      </form>
      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={() => signIn('google', { callbackUrl: '/' })}
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white/90 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Or continue with Google
        </button>
        <span className="text-white/30">|</span>
        <Link
          href="/auth/signin"
          className="text-sm text-white/60 hover:text-white/90 transition-colors"
        >
          Already have an account?
        </Link>
      </div>
    </div>
  );
}

export default function HeroSection() {
  const { status } = useSession();
  const hasRecorded = useRef(false);
  const [videoReady, setVideoReady] = useState(false);

  const handleVideoLoad = () => {
    setVideoReady(true);
    if (!hasRecorded.current && typeof window !== 'undefined') {
      const navStart = performance.timeOrigin;
      const loadTime = Date.now() - navStart;
      recordLoadingMetric('hero_video_load', loadTime);
      hasRecorded.current = true;
    }
  };

  return (
    <section className="relative h-screen w-full overflow-hidden bg-black">
      {/* Video — poster shows instantly while video loads, no JS dependency */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster="https://images.sourcelibrary.org/video/hero-poster.jpg"
        onCanPlay={handleVideoLoad}
        className="absolute inset-0 w-full h-full object-cover z-0"
      >
        <source src="https://images.sourcelibrary.org/video/hero-bg.webm#t=3" type="video/webm" />
        <source src="https://images.sourcelibrary.org/video/hero-bg.mp4#t=3" type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-black/40 z-0" />

      {/* Header */}
      <SiteHeader variant="transparent" />

      {/* Hero Content */}
      <div className="relative z-10 h-full flex items-center">
        <div className="px-6 md:px-12 w-full max-w-4xl">
          <h1
            className="text-4xl md:text-5xl lg:text-6xl text-white mb-6 leading-tight tracking-wide font-display text-balance"
          >
            A New Renaissance of Ancient Wisdom
          </h1>
          <p className="text-xl md:text-2xl lg:text-3xl font-light text-white/90 leading-relaxed max-w-2xl mb-8">
            Welcome to the world&rsquo;s largest library<br /> of AI-translated ancient sources.
          </p>

          {/* Reserve min-height to prevent layout shift while session loads */}
          <div className="min-h-[120px]">
            {status === 'loading' ? (
              <div className="max-w-xl opacity-0">
                {/* Invisible placeholder matching sign-up form height */}
                <div className="h-[52px] rounded-lg" />
                <div className="h-[24px] mt-4" />
              </div>
            ) : status === 'authenticated' ? (
              <div className="max-w-xl animate-fade-in">
                <UnifiedSearch />
              </div>
            ) : (
              <div className="animate-fade-in">
                <HeroSignUp />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <a
        href="#library"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('library')?.scrollIntoView({ behavior: 'smooth' });
        }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 group"
        aria-label="Scroll to library"
      >
        <span className="text-xs uppercase tracking-[0.2em] text-white/70 group-hover:text-white transition-colors">
          Explore the collection
        </span>
        <svg className="w-5 h-5 text-white/70 group-hover:text-white animate-bounce transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </a>
    </section>
  );
}

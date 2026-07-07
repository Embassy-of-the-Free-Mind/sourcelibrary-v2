'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';
import { recordLoadingMetric } from '@/lib/analytics';
import SiteHeader from '@/components/layout/SiteHeader';
import { HOME_STRINGS, type HomeLang, type HomeStrings } from '@/lib/home-i18n';

/**
 * The hero's primary front door: a prompt that hands the visitor's question
 * straight to the librarian (which auto-runs a ?q= seed — see
 * LibrarianClient's initial-query effect). Surfaces the most distinctive part
 * of the product the instant you land, instead of leaving it buried in the
 * nav. Label is intentionally a single i18n string so it's trivial to swap
 * (e.g. Derek's "Talk to the source" — parked for now).
 */
function HeroLibrarianPrompt({ t }: { t: HomeStrings }) {
  const router = useRouter();
  const [q, setQ] = useState('');

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/librarian?q=${encodeURIComponent(query)}` : '/librarian');
  };

  return (
    <div className="max-w-2xl">
      <form onSubmit={go} className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.librarianPlaceholder}
          aria-label={t.librarianPlaceholder}
          className="flex-1 px-5 py-3.5 rounded-lg bg-white/95 text-stone-900 placeholder-stone-400 text-base outline-none border border-white focus:ring-2 focus:ring-white/50 transition-colors shadow-lg"
        />
        <button
          type="submit"
          aria-label={t.librarianAsk}
          className="px-7 py-3.5 rounded-lg text-base font-medium transition-all hover:brightness-110 shrink-0 inline-flex items-center gap-1.5"
          style={{ background: 'var(--accent-rust)', color: '#fff' }}
        >
          {t.librarianAsk}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </form>
      <p className="mt-2 text-sm text-white/60">{t.librarianHint}</p>
    </div>
  );
}

/**
 * Suggestion banner shown only on the English `/` page to visitors whose device
 * language is Spanish, pointing them at the fully-localized `/es` page. Renders
 * after mount (so it never affects the edge-cached English HTML) and respects a
 * dismissal flag. This is the auto-detect path for Instagram/mobile traffic,
 * done without any cache-busting SSR branch on Accept-Language.
 */
function LangSuggestBanner({ t }: { t: HomeStrings }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('sl_lang_dismissed') === '1') return;
      const nav = (navigator.language || '').toLowerCase();
      if (nav.startsWith('es')) setShow(true);
    } catch {
      // navigator/localStorage unavailable — show nothing
    }
  }, []);

  if (!show) return null;

  return (
    <div className="mt-4 inline-flex items-center gap-3 rounded-lg bg-white/10 px-4 py-2 text-sm backdrop-blur-sm">
      <Link href="/es" className="text-white font-medium hover:underline">
        {t.suggestSpanish} &rarr;
      </Link>
      <button
        onClick={() => {
          setShow(false);
          try { localStorage.setItem('sl_lang_dismissed', '1'); } catch { /* ignore */ }
        }}
        aria-label={t.dismiss}
        className="text-white/50 hover:text-white/90 transition-colors"
      >
        &times;
      </button>
    </div>
  );
}

export default function HeroSection({ lang = 'en' }: { lang?: HomeLang }) {
  const { status } = useStableSession();
  const hasRecorded = useRef(false);
  const [videoReady, setVideoReady] = useState(false);
  const t = HOME_STRINGS[lang];

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

      {/* Header — pass the known locale so the EN/ES toggle is server-rendered
          on the statically-prerendered homepage (usePathname is null at build). */}
      <SiteHeader variant="transparent" homeLocale={lang} />

      {/* Hero Content */}
      <div className="relative z-10 h-full flex items-center animate-fade-in-up">
        <div className="w-full max-w-[1500px] mx-auto px-6 md:px-12">
        <div className="w-full max-w-4xl">
          <h1
            className="text-4xl md:text-5xl lg:text-6xl text-white mb-6 leading-tight tracking-wide font-display text-balance"
          >
            {t.heroTitle}
          </h1>
          <p className="text-xl md:text-2xl lg:text-3xl font-light text-white/90 leading-relaxed max-w-2xl mb-8">
            {t.heroSubtitleLine1}<br /> {t.heroSubtitleLine2}
          </p>

          {/* Primary front door: ask the librarian. The secondary line adapts
              to auth state — sign-up for guests, search for members — and both
              are the same height so the min-h reservation prevents layout shift
              while the session resolves. */}
          <div className="min-h-[120px] animate-fade-in">
            <HeroLibrarianPrompt t={t} />
            {status === 'authenticated' ? (
              <Link
                href="/search"
                className="inline-block mt-3 text-sm text-white/60 hover:text-white/90 transition-colors"
              >
                {t.heroSearchInstead}
              </Link>
            ) : (
              <p className="mt-3 text-sm text-white/60">
                {t.heroSignupLead}{' '}
                <Link
                  href="/auth/signin"
                  className="text-white/85 underline underline-offset-2 hover:text-white transition-colors"
                >
                  {t.heroSignupCta}
                </Link>
              </p>
            )}
          </div>

          {/* Language switch lives in the site header now (top-right EN · ES),
              so it's discoverable above the fold on every homepage visit. */}
          {lang === 'en' && <LangSuggestBanner t={t} />}
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
          {t.explore}
        </span>
        <svg className="w-5 h-5 text-white/70 group-hover:text-white animate-bounce transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </a>
    </section>
  );
}

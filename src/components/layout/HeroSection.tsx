'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocalePath } from '@/lib/i18n';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { isInAppBrowser } from '@/lib/in-app-browser';
import { useStableSession } from '@/hooks/useStableSession';
import { recordLoadingMetric } from '@/lib/analytics';
import { trackEvent } from '@/lib/track-event';
import { suggestEmailFix } from '@/lib/email-typo';
import { TurnstileWidget, turnstileConfigured } from '@/components/auth/TurnstileWidget';
import UnifiedSearch from '@/components/search/UnifiedSearch';
import SiteHeader from '@/components/layout/SiteHeader';
import { HOME_STRINGS, type HomeLang, type HomeStrings } from '@/lib/home-i18n';

/**
 * Inline email/Google sign-up — the hero's primary action. The hero is the
 * visitor-capture front door (email ≈44% of signups, Google ≈56%), so we
 * capture inline rather than punting to a linked page. The "Ask the source"
 * librarian invitation lives in its own section below (AskTheSourceBand).
 */
function HeroSignUp({ t }: { t: HomeStrings }) {
  // The sign-in page has a Spanish twin; keep the visitor on their locale.
  const localePath = useLocalePath();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // The hero mints magic links exactly like the sign-in page does, so it needs
  // the same Turnstile token. Without this the widget is absent here and every
  // hero signup would 403 the moment Turnstile is switched on in production —
  // a latent tripwire, since turnstileEnabled() is false today.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Google OAuth is blocked inside Instagram/Facebook/LinkedIn webviews
  // (disallowed_useragent), so the button silently fails there. Detect it and
  // steer the visitor to the email magic link, which always works.
  const [inApp, setInApp] = useState(false);
  useEffect(() => { setInApp(isInAppBrowser(navigator.userAgent)); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError(false);
    trackEvent('signup_start', { source: 'hero', method: 'email' });
    try {
      // Provider id is 'nodemailer' (next-auth v5 renamed Email→Nodemailer);
      // the old 'email' id silently no-ops and faked a "check your email".
      const result = await signIn('nodemailer', {
        email,
        callbackUrl: '/',
        redirect: false,
        'cf-turnstile-response': turnstileToken ?? '',
      });
      if (result?.error) setError(true);
      else setSent(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="max-w-xl">
        <p className="text-white text-lg">
          {t.checkEmail} <strong>{email}</strong>
        </p>
        <button
          onClick={() => setSent(false)}
          className="mt-3 text-sm text-white/60 hover:text-white/90 transition-colors underline"
        >
          {t.differentEmail}
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
          onBlur={(e) => setSuggestion(suggestEmailFix(e.target.value))}
          placeholder={t.emailPlaceholder}
          required
          className="flex-1 px-5 py-3.5 rounded-lg bg-white text-stone-900 placeholder-stone-400 text-base outline-none border border-white focus:ring-2 focus:ring-white/50 transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !email || (turnstileConfigured && !turnstileToken)}
          className="px-7 py-3.5 rounded-lg text-base font-medium transition-all hover:brightness-110 disabled:opacity-50 shrink-0"
          style={{ background: 'var(--accent-rust)', color: '#fff' }}
        >
          {loading ? t.sending : t.join}
        </button>
      </form>
      {/* Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. */}
      <TurnstileWidget onVerify={setTurnstileToken} />
      {suggestion && (
        <button
          type="button"
          onClick={() => { setEmail(suggestion); setSuggestion(null); }}
          className="mt-2 text-sm text-white/90 underline text-left"
        >
          {t.didYouMean(suggestion)}
        </button>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-200">{t.emailError}</p>
      )}
      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={() => {
            trackEvent('signup_start', { source: 'hero', method: 'google' });
            signIn('google', { callbackUrl: '/' });
          }}
          style={{ opacity: inApp ? 0.5 : 1 }}
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white/90 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {t.google}
        </button>
        <span className="text-white/30">|</span>
        <Link
          href={localePath('/auth/signin')}
          className="text-sm text-white/60 hover:text-white/90 transition-colors"
        >
          {t.haveAccount}
        </Link>
      </div>
      {inApp && (
        <p className="mt-2 max-w-md text-xs text-white/50">{t.googleBlockedNote}</p>
      )}
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

          {/* The hero's job is sign-up — the visitor-capture front door (email
              ≈44% of signups, Google ≈56%). The "Ask the source" librarian
              invitation lives in its own section just below (AskTheSourceBand),
              so the two never compete for the same box. Reserve min-height so
              the content below doesn't shift while the session resolves. */}
          <div className="min-h-[120px]">
            {status === 'authenticated' ? (
              <div className="max-w-xl animate-fade-in">
                <UnifiedSearch />
              </div>
            ) : (
              <div className="animate-fade-in">
                <HeroSignUp t={t} />
              </div>
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

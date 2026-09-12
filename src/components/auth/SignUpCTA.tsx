'use client';

import { useStableSession } from '@/hooks/useStableSession';
import Link from 'next/link';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import ParallaxImage from '@/components/ParallaxImage';
import { localePath, type Locale } from '@/lib/locale-path';

// Chrome strings. This band was hard-coded English, and it renders on the
// Spanish book page and inside the Spanish homepage's own (already localized)
// "Ayuda a recuperar…" section — so the one thing on those pages ASKING a
// reader to join was in a language they may not read, and its button pointed at
// the English sign-in while `/es/auth/signin` exists. It is client-only and
// hidden for signed-in visitors, which is why a crawl never sees it.
const STRINGS: Record<Locale, {
  inlineNudge: string; inlineLink: string;
  eyebrow: string; heading: string; body: string; cta: string; footnote: string;
}> = {
  en: {
    inlineNudge: 'Create a free account to save books and track your reading.',
    inlineLink: 'Sign in with email',
    eyebrow: 'Join the project',
    heading: 'Help recover the lost intellectual heritage of humanity',
    body: "Create a free account to save books, track your reading, and follow new translations as they're published.",
    cta: 'Create free account',
    footnote: 'Sign in with email \u00b7 No spam, ever',
  },
  es: {
    inlineNudge: 'Crea una cuenta gratuita para guardar libros y seguir tus lecturas.',
    inlineLink: 'Entra con tu correo',
    eyebrow: 'Súmate al proyecto',
    heading: 'Ayuda a recuperar el patrimonio intelectual perdido de la humanidad',
    body: 'Crea una cuenta gratuita para guardar libros, seguir tus lecturas y enterarte de cada nueva traducción.',
    cta: 'Crea tu cuenta gratuita',
    footnote: 'Entra con tu correo \u00b7 Nunca enviamos spam',
  },
};

interface SignUpCTAProps {
  variant?: 'section' | 'inline';
  /** Optional background image (e.g. a collection plate) behind the dark section. */
  bgImageUrl?: string;
  /** Optional credit for the background image, shown bottom-centre with a link. */
  bgAttribution?: { text: string; href: string };
  /** Surface language — picks the copy and the sign-in href. */
  lang?: Locale;
}

// Default background for the shared "Join the project" section: the Flamsteed
// celestial allegory. Any page that passes its own bgImageUrl (e.g. a collection
// with a themed plate, like mycology) overrides it.
const DEFAULT_BG_IMAGE_URL = '/api/gallery-crop/6955d43628a09ca65928002a-0';
const DEFAULT_BG_ATTRIBUTION = {
  text: 'Image: Flamsteed, Historia Coelestis Britannica, Vol. 3, 1725.',
  href: '/gallery/image/6955d43628a09ca65928002a-0',
};

export default function SignUpCTA({
  variant = 'section',
  bgImageUrl = DEFAULT_BG_IMAGE_URL,
  bgAttribution = DEFAULT_BG_ATTRIBUTION,
  lang = 'en',
}: SignUpCTAProps) {
  const { status } = useStableSession();
  const isEmbedded = useIsEmbedded();
  const t = STRINGS[lang];
  const signInHref = localePath('/auth/signin', lang);

  // Don't show when embedded, authenticated, or while loading
  if (isEmbedded || status !== 'unauthenticated') return null;

  // Inline variant — just a small nudge within a larger section
  if (variant === 'inline') {
    return (
      <div className="text-center mt-10 pt-8" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-sm mb-3" style={{ color: '#6b6560' }}>
          {t.inlineNudge}
        </p>
        <Link
          href={signInHref}
          className="text-sm font-medium hover:underline"
          style={{ color: 'var(--accent-gold)' }}
        >
          {t.inlineLink}
        </Link>
      </div>
    );
  }

  // Full section variant (original)
  return (
    <section className={`relative overflow-hidden py-20 md:py-28${bgImageUrl ? ' min-h-[60vh] md:min-h-[80vh] flex flex-col justify-center' : ''}`} style={{ background: 'var(--bg-dark)' }}>
      {bgImageUrl && (
        <>
          <ParallaxImage src={bgImageUrl} className="opacity-55" strength={0.08} oversize={0.1} />
          <div className="absolute inset-0" style={{ background: 'var(--bg-dark)', opacity: 0.5 }} />
        </>
      )}
      <div className="relative px-6 md:px-12 max-w-2xl mx-auto text-center" style={bgImageUrl ? { textShadow: '0 1px 10px rgba(0,0,0,0.55)' } : undefined}>
        <p
          className="text-sm uppercase tracking-[0.2em] mb-6"
          style={{ color: 'var(--accent-gold)' }}
        >
          {t.eyebrow}
        </p>
        <h2
          className="text-2xl md:text-3xl lg:text-4xl font-display mb-5 leading-snug"
          style={{ color: '#f5f0e8' }}
        >
          {t.heading}
        </h2>
        <p
          className="text-base md:text-lg mb-10 max-w-lg mx-auto leading-relaxed"
          style={{ color: bgImageUrl ? '#e7e1d7' : '#a09a90' }}
        >
          {t.body}
        </p>
        <Link
          href={signInHref}
          className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-full text-sm font-medium transition-all hover:brightness-110"
          style={{ background: 'var(--accent-rust)', color: '#fff' }}
        >
          {t.cta}
        </Link>
        <p className="text-xs mt-5" style={{ color: bgImageUrl ? '#cfc8bc' : '#6b6560' }}>
          {t.footnote}
        </p>
      </div>
      {bgImageUrl && bgAttribution && (
        <Link
          href={bgAttribution.href}
          className="absolute bottom-3 inset-x-0 z-10 text-center text-[11px] leading-snug px-6 max-w-3xl mx-auto hover:opacity-80 transition-opacity"
          style={{ color: '#cfc8bc', textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}
        >
          {bgAttribution.text}
        </Link>
      )}
    </section>
  );
}

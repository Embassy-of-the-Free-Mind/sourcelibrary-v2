'use client';

/**
 * Restyled options for the homepage "Ask the source" band (Laura, 2026-11-05).
 * A is the current band, untouched. B to D drop the eyebrow and centring and
 * keep the same strings (HOME_STRINGS), so every language still works. The
 * picker shows in dev.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HOME_STRINGS, type HomeLang } from '@/lib/home-i18n';
import { VariantProvider, Variant } from './Variants';

type Look = 'light' | 'big' | 'dark';

function useAsk() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/librarian?q=${encodeURIComponent(query)}` : '/librarian');
  };
  return { q, setQ, go };
}

function Browse({ lang, dark }: { lang: HomeLang; dark?: boolean }) {
  const t = HOME_STRINGS[lang];
  const l = `underline underline-offset-4 decoration-1 transition-colors ${dark ? 'hover:text-white' : 'hover:text-primary'}`;
  return (
    <p className={`text-base ${dark ? 'text-stone-300' : 'text-secondary'}`}>
      <Link href="/search" className={l}>{t.searchHeading}</Link>{' '}{t.browseBy}{' '}
      <Link href="/browse/titles/A" className={l}>{t.byTitle}</Link>{' · '}
      <Link href="/browse/authors/A" className={l}>{t.byAuthor}</Link>{' · '}
      <Link href="/browse/years/1500s" className={l}>{t.byYear}</Link>{' · '}
      <Link href="/gallery" className={l}>{t.byImages}</Link>
    </p>
  );
}

const Arrow = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7l5 5m0 0l-5 5m5-5H6" />
  </svg>
);

function Restyled({ lang, look }: { lang: HomeLang; look: Look }) {
  const t = HOME_STRINGS[lang];
  const { q, setQ, go } = useAsk();
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767px)');
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const wide = 'mx-auto w-full max-w-[1500px] px-6 md:px-12';

  // B: light, two columns. The question on the left, the box on the right.
  if (look === 'light') {
    return (
      <section className="py-20 md:py-28 bg-cream border-y border-border-light">
        <div className={`${wide} grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-10 md:gap-20 items-center`}>
          <div>
            <h2 className="font-serif text-4xl md:text-6xl text-primary leading-[1.05] tracking-tight">{t.askSourceHeading}</h2>
            <p className="mt-6 text-lg md:text-xl text-secondary leading-relaxed max-w-xl">{t.askSourceSubtitle}</p>
          </div>
          <div>
            <form onSubmit={go} className="flex">
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t.librarianPlaceholder}
                aria-label={t.librarianPlaceholder}
                className="flex-1 min-w-0 px-5 py-4 bg-white border border-border-medium border-r-0 text-primary placeholder-stone-400 text-lg outline-none focus:border-[#1a1612]"
              />
              <button type="submit" className="px-7 py-4 bg-[#1a1612] text-white hover:bg-black transition-colors text-lg font-medium inline-flex items-center gap-2 shrink-0">
                {t.librarianAsk} <Arrow />
              </button>
            </form>
            <p className="mt-3 text-base text-muted">{t.librarianHint}</p>
            <div className="mt-8"><Browse lang={lang} /></div>
          </div>
        </div>
      </section>
    );
  }

  // C: one big question. The box is the headline. Phones get the short
  // placeholder; the Newton example doesn't fit at this size.
  if (look === 'big') {
    return (
      <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
        <div className={wide}>
          <h2 className="font-serif text-3xl md:text-4xl text-primary leading-tight">{t.askSourceHeading}</h2>
          <p className="mt-3 text-lg text-secondary max-w-2xl">{t.askSourceSubtitle}</p>
          <form onSubmit={go} className="mt-10 md:mt-12 flex items-end gap-4 border-b-2 border-[#1a1612]">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={narrow ? t.librarianPlaceholder : t.librarianHint}
              aria-label={t.librarianPlaceholder}
              className="flex-1 min-w-0 pb-4 bg-transparent font-serif text-xl md:text-4xl lg:text-6xl text-primary placeholder-stone-400 outline-none"
            />
            <button type="submit" aria-label={t.librarianAsk} className="mb-4 px-6 py-3 bg-[#1a1612] text-white hover:bg-black transition-colors font-medium inline-flex items-center gap-2 shrink-0">
              {t.librarianAsk} <Arrow />
            </button>
          </form>
          <div className="mt-8"><Browse lang={lang} /></div>
        </div>
      </section>
    );
  }

  // D: dark, in the /about hero's tint, left aligned.
  return (
    <section
      className="py-24 md:py-32 bg-[#1a1612]"
      style={{ backgroundImage: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,.22) 0%, transparent 55%)' }}
    >
      <div className={wide}>
        <div className="max-w-3xl">
          <h2 className="font-serif text-4xl md:text-6xl text-white leading-[1.05] tracking-tight">{t.askSourceHeading}</h2>
          <p className="mt-6 text-lg md:text-xl text-stone-200 leading-relaxed">{t.askSourceSubtitle}</p>
          <form onSubmit={go} className="mt-10 flex">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.librarianPlaceholder}
              aria-label={t.librarianPlaceholder}
              className="flex-1 min-w-0 px-5 py-4 bg-white text-[#1a1612] placeholder-stone-400 text-lg outline-none"
            />
            <button type="submit" className="px-7 py-4 bg-white/10 border border-white/40 border-l-0 text-white hover:bg-white/20 transition-colors text-lg font-medium inline-flex items-center gap-2 shrink-0">
              {t.librarianAsk} <Arrow />
            </button>
          </form>
          <p className="mt-3 text-base text-stone-400">{t.librarianHint}</p>
          <div className="mt-8"><Browse lang={lang} dark /></div>
        </div>
      </div>
    </section>
  );
}

export default function AskBandOptions({ lang = 'en' }: { lang?: HomeLang }) {
  return (
    <VariantProvider>
      <Variant
        id="ask"
        options={{
          // Laura, 2026-11-05: C for now, D kept to compare. A (old band) and B (light) dropped.
          c: <Restyled lang={lang} look="big" />,
          d: <Restyled lang={lang} look="dark" />,
        }}
      />
    </VariantProvider>
  );
}

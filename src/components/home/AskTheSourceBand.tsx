'use client';

/**
 * "Ask the source": the librarian's front door on the homepage. The prompt hands
 * the visitor's question straight to the librarian via /librarian?q=…, which
 * already auto-fills AND auto-runs the seed (LibrarianClient initial-query
 * effect), a seamless handoff.
 *
 * Framed as "Ask the source" (ad fontes): you question the primary sources
 * directly and the answer comes back citing them, not a help-desk persona.
 * The box is the headline. The homepage's old search section is folded in as
 * the line of links below it.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HOME_STRINGS, type HomeLang } from '@/lib/home-i18n';
import { localePath } from '@/lib/locale-path';

const link = 'underline underline-offset-4 decoration-1 transition-colors hover:text-primary';

export default function AskTheSourceBand({ lang = 'en' }: { lang?: HomeLang }) {
  const t = HOME_STRINGS[lang];
  const router = useRouter();
  const [q, setQ] = useState('');
  // Phones get the short placeholder; the worked example doesn't fit at this size.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767px)');
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    const base = localePath('/librarian', lang);
    router.push(query ? `${base}?q=${encodeURIComponent(query)}` : base);
  };

  return (
    <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
      <div className="mx-auto w-full max-w-[1500px] px-6 md:px-12">
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
            {t.librarianAsk}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </form>
        <p className="mt-8 text-base text-secondary">
          <Link href={localePath('/search', lang)} className={link}>{t.searchHeading}</Link>{' '}{t.browseBy}{' '}
          <Link href="/browse/titles/A" className={link}>{t.byTitle}</Link>{' · '}
          <Link href="/browse/authors/A" className={link}>{t.byAuthor}</Link>{' · '}
          <Link href="/browse/years/1500s" className={link}>{t.byYear}</Link>{' · '}
          <Link href="/gallery" className={link}>{t.byImages}</Link>
        </p>
      </div>
    </section>
  );
}

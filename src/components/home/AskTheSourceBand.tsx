'use client';

/**
 * "Ask the source" — the librarian's front door on the homepage, given its own
 * section just below the hero so it doesn't compete with the hero's sign-up box
 * (#3059 follow-on). The prompt hands the visitor's question straight to the
 * librarian via /librarian?q=…, which already auto-fills AND auto-runs the seed
 * (LibrarianClient initial-query effect) — a seamless handoff.
 *
 * Framed as "Ask the source" (ad fontes): you question the primary sources
 * directly and the answer comes back citing them, not a help-desk persona.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HOME_STRINGS, type HomeLang } from '@/lib/home-i18n';

export default function AskTheSourceBand({ lang = 'en' }: { lang?: HomeLang }) {
  const t = HOME_STRINGS[lang];
  const router = useRouter();
  const [q, setQ] = useState('');

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/librarian?q=${encodeURIComponent(query)}` : '/librarian');
  };

  return (
    <section className="py-16 md:py-24" style={{ background: 'var(--bg-dark)' }}>
      <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
        <p className="text-sm uppercase tracking-[0.2em] mb-4" style={{ color: 'var(--accent-gold)' }}>
          {t.askSourceEyebrow}
        </p>
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-display mb-4 leading-tight" style={{ color: '#f5f0e8' }}>
          {t.askSourceHeading}
        </h2>
        <p className="text-base md:text-lg leading-relaxed mb-8 max-w-2xl mx-auto" style={{ color: '#b8b2a8' }}>
          {t.askSourceSubtitle}
        </p>

        <form onSubmit={go} className="flex gap-2 max-w-2xl mx-auto">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.librarianPlaceholder}
            aria-label={t.librarianPlaceholder}
            className="flex-1 px-5 py-3.5 rounded-lg bg-white text-stone-900 placeholder-stone-400 text-base outline-none border border-white focus:ring-2 focus:ring-white/40 transition-colors shadow-lg"
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
        <p className="mt-3 text-sm" style={{ color: '#8a8480' }}>{t.librarianHint}</p>
      </div>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';

interface Introduction {
  id: string;
  name: string | null;
  email: string | null;
  about: string;
  help: string;
  language: string;
  language_key: string;
  created_at: string | null;
  updated_at: string | null;
}

interface Totals {
  wrote: number;
  welcomed: number;
  skipped: number;
  pending: number;
  offered_help: number;
  gave_language: number;
  language_respondents: number;
}

interface Payload {
  introductions: Introduction[];
  totals: Totals;
  language_tally: { language: string; count: number }[];
  language_unmatched: string[];
}

type Filter = 'all' | 'help' | 'substantial';

function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function csvCell(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function IntroductionsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    fetch('/api/admin/introductions')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setError(String(e.message || e)));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.introductions.filter(i => {
      if (filter === 'help' && !i.help.trim()) return false;
      // "Substantial" = wrote more than a couple of words. Most introductions are
      // one line ("leer"); the handful of long ones are where the offers and the
      // corpus gaps actually are, and they get buried by volume otherwise.
      if (filter === 'substantial' && i.about.trim().length < 120) return false;
      if (!q) return true;
      return [i.name, i.email, i.about, i.help, i.language]
        .some(f => (f || '').toLowerCase().includes(q));
    });
  }, [data, query, filter]);

  function exportCsv() {
    if (!data) return;
    const header = ['name', 'email', 'language', 'about', 'help', 'written'];
    const lines = [header.join(',')];
    for (const i of rows) {
      lines.push([i.name, i.email, i.language, i.about, i.help, i.updated_at].map(csvCell).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `introductions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return <div className="p-8 text-status-error">Could not load introductions: {error}</div>;
  }
  if (!data) {
    return <div className="p-8 text-stone-500">Loading…</div>;
  }

  const t = data.totals;
  const topLanguage = data.language_tally[0];

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-stone-900 mb-1">Introductions</h1>
        <p className="text-stone-500 text-sm">
          What readers wrote about themselves on <code className="text-stone-600">/welcome</code>. Every field is optional.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Wrote something', value: t.wrote },
          { label: 'Skipped', value: t.skipped },
          { label: 'Offered to help', value: t.offered_help },
          { label: 'Gave a language', value: t.gave_language },
          { label: 'Not yet seen', value: t.pending },
        ].map(s => (
          <div key={s.label} className="border border-stone-200 rounded-lg p-3">
            <div className="text-2xl font-serif text-stone-900">{s.value.toLocaleString()}</div>
            <div className="text-xs text-stone-500">{s.label}</div>
          </div>
        ))}
      </div>

      {data.language_tally.length > 0 && (
        <section className="mb-6 border border-stone-200 rounded-lg p-4">
          <h2 className="font-serif text-lg text-stone-900 mb-1">Languages readers want</h2>
          <p className="text-xs text-stone-500 mb-3">
            Free text, so one reader who names two languages counts for both.
            {topLanguage && t.language_respondents > 0 && (
              <>
                {' '}
                {topLanguage.language} leads at{' '}
                {Math.round((100 * topLanguage.count) / t.language_respondents)}% of the{' '}
                {t.language_respondents} who answered.
              </>
            )}
          </p>
          <div className="space-y-1.5">
            {data.language_tally.map(l => (
              <div key={l.language} className="flex items-center gap-3 text-sm">
                <div className="w-24 text-stone-700">{l.language}</div>
                <div className="flex-1 bg-stone-100 rounded h-4 overflow-hidden">
                  <div
                    className="bg-accent-rust/70 h-full"
                    style={{ width: `${Math.round((100 * l.count) / Math.max(1, t.language_respondents))}%` }}
                  />
                </div>
                <div className="w-10 text-right text-stone-500 tabular-nums">{l.count}</div>
              </div>
            ))}
          </div>
          {data.language_unmatched.length > 0 && (
            <p className="text-xs text-stone-500 mt-3">
              Not recognised: {data.language_unmatched.join(' · ')}
            </p>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search name, email, or what they wrote…"
          className="flex-1 min-w-[240px] px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
        />
        {([
          ['all', 'All'],
          ['help', 'Offered help'],
          ['substantial', 'Wrote at length'],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
              filter === key
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={exportCsv}
          className="px-3 py-2 rounded-lg text-sm border border-stone-300 text-stone-600 hover:border-stone-400"
        >
          CSV
        </button>
      </div>

      <p className="text-xs text-stone-500 mb-3">
        {rows.length === data.introductions.length
          ? `${rows.length} introduction${rows.length === 1 ? '' : 's'}`
          : `${rows.length} of ${data.introductions.length}`}
      </p>

      <div className="space-y-3">
        {rows.map(i => (
          <article key={i.id} className="border border-stone-200 rounded-lg p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <div>
                <span className="font-medium text-stone-900">{i.name || '(no name given)'}</span>
                {i.email && (
                  <a
                    href={`mailto:${i.email}`}
                    className="ml-2 text-sm text-stone-500 hover:text-accent-rust break-all"
                  >
                    {i.email}
                  </a>
                )}
              </div>
              <span className="text-xs text-stone-400">{fmtDate(i.updated_at)}</span>
            </div>

            {i.language && (
              <p className="text-sm text-stone-600 mb-2">
                <span className="text-stone-400">Reads in </span>
                {i.language}
              </p>
            )}
            {i.about && (
              <p className="text-stone-800 whitespace-pre-wrap text-[15px] leading-relaxed">{i.about}</p>
            )}
            {i.help && (
              <p className="mt-2 pt-2 border-t border-stone-100 text-stone-700 whitespace-pre-wrap text-[15px] leading-relaxed">
                <span className="text-stone-400">Would help by </span>
                {i.help}
              </p>
            )}
          </article>
        ))}
        {rows.length === 0 && (
          <p className="text-stone-500 text-sm py-8 text-center">Nothing matches that filter.</p>
        )}
      </div>
    </div>
  );
}

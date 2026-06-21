'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, User, Search } from 'lucide-react';

type Credit = { tr: string | null; t: string | null; pub: string | null; y: number | null; s: string };
type Work = {
  a: string; w: string; wl?: string; y: number | null; era: string; tgt?: boolean;
  c: Credit[]; ed: number; h: 'work' | 'author' | 'none'; slug?: string; asl?: string;
  tmin?: number; tmax?: number;
};

const SOURCE_LABEL: Record<string, string> = {
  itrl_curated: 'I Tatti Renaissance Library',
  brill_curated: 'Brill',
  doml_curated: 'Dumbarton Oaks Medieval Library',
  loeb: 'Loeb Classical Library',
  unesco_master: 'UNESCO Index Translationum',
  extended_unesco_index_translationum: 'UNESCO Index Translationum',
  loc_marc: 'Library of Congress',
  openlibrary: 'OpenLibrary',
  hathitrust: 'HathiTrust',
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] || s.replace(/_/g, ' ');
const ERA_LABEL: Record<string, string> = {
  renaissance_early_modern: 'Renaissance', medieval: 'Medieval', antiquity: 'Antiquity', patristic: 'Patristic', modern: 'Modern',
};
const yearLabel = (y: number | null | undefined) => (y == null ? '—' : y < 0 ? `${-y} BC` : `${y}`);

// Translation era from a publication year.
type TEra = 'period' | 'historical' | 'modern';
const transEra = (y: number | null): TEra | null => (y == null ? null : y <= 1700 ? 'period' : y < 1900 ? 'historical' : 'modern');
const TERA_STYLE: Record<TEra, string> = {
  modern: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  historical: 'bg-stone-100 text-stone-500 border-stone-200',
  period: 'bg-amber-50 text-amber-700 border-amber-200',
};
const TERA_LABEL: Record<TEra, string> = { modern: 'modern', historical: 'historical', period: 'period' };

type HeldFilter = 'all' | 'work' | 'author' | 'none';
type EraFilter = 'all' | 'modern' | 'historical' | 'period';

function Credits({ credits }: { credits: Credit[] }) {
  const named = credits.filter((c) => c.tr);
  const list = (named.length ? named : credits).slice(0, 2);
  return (
    <div className="space-y-1">
      {list.map((c, i) => {
        const te = transEra(c.y);
        return (
          <div key={i} className="leading-snug flex items-baseline gap-1.5 flex-wrap">
            <span>
              {c.tr ? <span className="text-stone-900">{c.tr}</span> : <span className="text-stone-600">{c.t || 'English translation'}</span>}
              {c.y && <span className="text-stone-500">, {c.y}</span>}
              <span className="text-stone-400"> · {sourceLabel(c.s)}</span>
            </span>
            {te && <span className={`text-[10px] uppercase tracking-wide px-1 py-0.5 rounded border ${TERA_STYLE[te]}`}>{TERA_LABEL[te]}</span>}
          </div>
        );
      })}
      {credits.length > list.length && <div className="text-xs text-stone-400">+{credits.length - list.length} more</div>}
    </div>
  );
}

export default function RegistryBrowser() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [held, setHeld] = useState<HeldFilter>('all');
  const [era, setEra] = useState<EraFilter>('all');
  const [onlyRen, setOnlyRen] = useState(false);
  const [page, setPage] = useState(0);

  const [works, setWorks] = useState<Work[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => { setDq(q); setPage(0); }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const reqId = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const params = new URLSearchParams({ q: dq, held, era, ren: onlyRen ? '1' : '0', page: String(page) });
    try {
      const d = await (await fetch(`/api/research/translation-registry?${params}`)).json();
      if (id !== reqId.current) return; // stale response — a newer request is in flight
      setWorks(d.works);
      setTotal(d.total);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [dq, held, era, onlyRen, page]);

  useEffect(() => { load(); }, [load]);

  const pageCount = Math.ceil(total / 50);
  const eraButtons: [EraFilter, string, string][] = useMemo(() => [
    ['all', 'All', 'Translations of any era'],
    ['modern', 'Modern', 'We have a 20th–21st-century translation on record'],
    ['historical', 'Pre-1900', 'The newest translation we have catalogued predates 1900 — a modern one may exist but be uncatalogued'],
    ['period', 'Period', 'A contemporaneous translation (made by 1700)'],
  ], []);

  return (
    <div>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search an author, work, or translator — Ficino, Vesalius, Utopia…"
            className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded bg-white focus:border-stone-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-1 border border-stone-300 rounded overflow-hidden text-sm">
          {(['all', 'work', 'author', 'none'] as HeldFilter[]).map((f) => (
            <button key={f} onClick={() => { setHeld(f); setPage(0); }}
              title={f === 'work' ? 'We hold this exact work' : f === 'author' ? 'We hold writings by this author, not this work' : f === 'none' ? 'Neither the work nor the author is in the library' : 'All works'}
              className={`px-3 py-2 ${held === f ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
              {f === 'all' ? 'All' : f === 'work' ? 'In library' : f === 'author' ? 'Author held' : 'Not held'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-stone-600">
          <input type="checkbox" checked={onlyRen} onChange={(e) => { setOnlyRen(e.target.checked); setPage(0); }} className="accent-amber-700" />
          Renaissance Latin only
        </label>
      </div>

      {/* translation-era filter + legend */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
        <span className="text-stone-400 text-xs uppercase tracking-wide">Translation:</span>
        <div className="flex gap-1 border border-stone-300 rounded overflow-hidden">
          {eraButtons.map(([f, label, tip]) => (
            <button key={f} onClick={() => { setEra(f); setPage(0); }} title={tip}
              className={`px-2.5 py-1.5 ${era === f ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-stone-400 text-xs">
          <span className="text-emerald-700">modern</span> = 1900+ · <span className="text-stone-500">historical</span> = 1700–1900 · <span className="text-amber-700">period</span> = contemporaneous (≤1700). Dates are the catalogue&rsquo;s — a missing modern tag may mean uncatalogued, not untranslated.
        </span>
        <span className="text-stone-400 tabular-nums ml-auto">{loading ? '…' : `${total.toLocaleString()} works`}</span>
      </div>

      {/* table */}
      <div className="overflow-x-auto min-h-[400px]">
        <table className="w-full text-sm border-t border-b border-stone-200">
          <thead className="bg-stone-50">
            <tr>
              <th className="text-left py-2 px-3 font-medium text-stone-700">Author</th>
              <th className="text-left py-2 px-3 font-medium text-stone-700">Work</th>
              <th className="text-left py-2 px-3 font-medium text-stone-700 whitespace-nowrap">Written</th>
              <th className="text-left py-2 px-3 font-medium text-stone-700 border-l border-stone-200">English translation</th>
              <th className="text-center py-2 px-3 font-medium text-stone-700 border-l border-stone-200">In our library</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-10 text-center text-stone-400">Loading…</td></tr>
            ) : works.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-stone-500">No matching works. (Absent works may simply never have been translated — the gap.)</td></tr>
            ) : works.map((w, i) => (
              <tr key={i} className="border-t border-stone-100 hover:bg-stone-50 align-top">
                <td className="py-2.5 px-3 text-stone-600 whitespace-nowrap">{w.a}</td>
                <td className="py-2.5 px-3">
                  <div className="font-serif text-stone-900 leading-snug">{w.w}</div>
                  {w.wl && <div className="font-serif italic text-stone-500 text-xs mt-0.5">{w.wl}</div>}
                  <div className="text-xs text-stone-400 mt-0.5">{ERA_LABEL[w.era] || w.era}{w.tgt ? ' · Latin' : ''}</div>
                </td>
                <td className="py-2.5 px-3 text-stone-500 tabular-nums whitespace-nowrap">{yearLabel(w.y)}</td>
                <td className="py-2.5 px-3 text-stone-700 border-l border-stone-100"><Credits credits={w.c} /></td>
                <td className="py-2.5 px-3 text-center border-l border-stone-100">
                  {w.h === 'work' && w.slug ? (
                    <Link href={`/book/${w.slug}`} className="inline-flex items-center gap-1 text-xs bg-stone-800 text-white px-2 py-1 rounded hover:bg-stone-900 whitespace-nowrap">
                      <BookOpen className="w-3 h-3" /> Read original
                    </Link>
                  ) : w.h === 'author' && w.asl ? (
                    <Link href={`/book/${w.asl}`} className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 whitespace-nowrap" title="We hold other writings by this author">
                      <User className="w-3 h-3" /> Author held
                    </Link>
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-4 mt-5 text-sm">
          <button onClick={() => setPage(page - 1)} disabled={page === 0 || loading} className="px-3 py-1.5 border border-stone-300 rounded disabled:opacity-40 hover:bg-stone-50">← Prev</button>
          <span className="text-stone-500 tabular-nums">Page {page + 1} of {pageCount}</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= pageCount - 1 || loading} className="px-3 py-1.5 border border-stone-300 rounded disabled:opacity-40 hover:bg-stone-50">Next →</button>
        </div>
      )}
    </div>
  );
}

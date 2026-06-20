'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, User, Search } from 'lucide-react';

type Credit = { tr: string | null; t: string | null; pub: string | null; y: number | null; s: string };
type Work = {
  a: string; w: string; wl?: string; y: number | null; era: string; tgt?: boolean;
  c: Credit[]; ed: number; h: 'work' | 'author' | 'none'; slug?: string; asl?: string;
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
  renaissance_early_modern: 'Renaissance',
  medieval: 'Medieval', antiquity: 'Antiquity', patristic: 'Patristic', modern: 'Modern',
};
const yearLabel = (y: number | null | undefined) => (y == null ? '—' : y < 0 ? `${-y} BC` : `${y}`);

type HeldFilter = 'all' | 'work' | 'author' | 'none';
const PAGE_SIZE = 50;

function Credits({ credits }: { credits: Credit[] }) {
  const named = credits.filter((c) => c.tr);
  const list = (named.length ? named : credits).slice(0, 2);
  return (
    <div className="space-y-0.5">
      {list.map((c, i) => (
        <div key={i} className="leading-snug">
          {c.tr ? (
            <>
              <span className="text-stone-900">{c.tr}</span>
              {c.y && <span className="text-stone-500">, {c.y}</span>}
            </>
          ) : (
            <span className="text-stone-600">{c.t || 'English translation'}{c.y ? `, ${c.y}` : ''}</span>
          )}
          <span className="text-stone-400"> · {sourceLabel(c.s)}</span>
        </div>
      ))}
      {credits.length > list.length && (
        <div className="text-xs text-stone-400">+{credits.length - list.length} more</div>
      )}
    </div>
  );
}

export default function RegistryBrowser({ works }: { works: Work[] }) {
  const [q, setQ] = useState('');
  const [held, setHeld] = useState<HeldFilter>('all');
  const [onlyRen, setOnlyRen] = useState(false);
  const [page, setPage] = useState(0);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = works;
    if (onlyRen) r = r.filter((w) => w.tgt);
    if (held !== 'all') r = r.filter((w) => w.h === held);
    if (needle) {
      r = r.filter(
        (w) =>
          w.a.toLowerCase().includes(needle) ||
          w.w.toLowerCase().includes(needle) ||
          (w.wl || '').toLowerCase().includes(needle) ||
          w.c.some((c) => (c.tr || '').toLowerCase().includes(needle)),
      );
    }
    return r;
  }, [q, held, onlyRen, works]);

  const pageCount = Math.ceil(results.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const shown = results.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const reset = () => setPage(0);

  return (
    <div>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); reset(); }}
            placeholder="Search an author, work, or translator — Ficino, Vesalius, Utopia…"
            className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded bg-white focus:border-stone-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-1 border border-stone-300 rounded overflow-hidden text-sm">
          {(['all', 'work', 'author', 'none'] as HeldFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => { setHeld(f); reset(); }}
              title={
                f === 'work' ? 'We hold this exact work' :
                f === 'author' ? 'We hold writings by this author, not this work' :
                f === 'none' ? 'Neither the work nor the author is in the library' : 'All works'
              }
              className={`px-3 py-2 ${held === f ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
            >
              {f === 'all' ? 'All' : f === 'work' ? 'In library' : f === 'author' ? 'Author held' : 'Not held'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-stone-600">
          <input type="checkbox" checked={onlyRen} onChange={(e) => { setOnlyRen(e.target.checked); reset(); }} className="accent-amber-700" />
          Renaissance Latin only
        </label>
        <span className="text-sm text-stone-400 tabular-nums ml-auto">{results.length.toLocaleString()} works</span>
      </div>

      {/* table */}
      <div className="overflow-x-auto">
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
            {shown.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-stone-500">No matching works. (Absent works may simply never have been translated — the gap.)</td></tr>
            ) : shown.map((w, i) => (
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

      {/* pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-4 mt-5 text-sm">
          <button onClick={() => setPage(safePage - 1)} disabled={safePage === 0} className="px-3 py-1.5 border border-stone-300 rounded disabled:opacity-40 hover:bg-stone-50">← Prev</button>
          <span className="text-stone-500 tabular-nums">Page {safePage + 1} of {pageCount}</span>
          <button onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1} className="px-3 py-1.5 border border-stone-300 rounded disabled:opacity-40 hover:bg-stone-50">Next →</button>
        </div>
      )}
    </div>
  );
}

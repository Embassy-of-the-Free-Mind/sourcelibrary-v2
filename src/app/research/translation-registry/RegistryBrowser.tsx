'use client';

import { useMemo, useState } from 'react';

type Credit = { tr: string | null; t: string | null; pub: string | null; y: number | null; s: string };
type Work = { a: string; w: string; wl?: string; y: number | null; era: string; tgt?: boolean; c: Credit[]; ed: number; sl?: boolean };

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
  medieval: 'Medieval',
  antiquity: 'Antiquity',
  patristic: 'Patristic',
  modern: 'Modern',
};

function WorkCard({ work }: { work: Work }) {
  const named = work.c.filter((c) => c.tr);
  const credits = named.length ? named : work.c;
  const slQuery = encodeURIComponent(`${work.a.split(',')[0]} ${work.w}`.slice(0, 80));
  return (
    <li className="py-4 border-b border-stone-200">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="font-serif text-lg text-stone-900 leading-snug">
          <span className="text-stone-500">{work.a}</span> — {work.w}
        </div>
        <div className="font-body text-xs text-stone-400 whitespace-nowrap">
          {ERA_LABEL[work.era] || work.era}
          {work.y != null && <> · {work.y < 0 ? `${-work.y} BC` : work.y}</>}
        </div>
      </div>
      {work.wl && <div className="font-serif italic text-sm text-stone-500 mt-0.5">{work.wl}</div>}
      <ul className="mt-2 space-y-1">
        {credits.map((c, i) => (
          <li key={i} className="font-body text-sm text-stone-700 flex gap-2">
            <span className="text-amber-700 select-none">→</span>
            <span>
              {c.tr ? (
                <>
                  tr. <span className="text-stone-900">{c.tr}</span>
                  {c.y && <>, {c.y}</>}
                  {c.pub && <span className="text-stone-500"> · {c.pub}</span>}
                </>
              ) : (
                <span className="text-stone-600">{c.t || 'English translation'}{c.y ? `, ${c.y}` : ''}{c.pub ? ` · ${c.pub}` : ''}</span>
              )}
              <span className="text-stone-400"> ({sourceLabel(c.s)})</span>
            </span>
          </li>
        ))}
      </ul>
      {work.sl && (
        <a
          href={`/search?q=${slQuery}`}
          className="inline-block mt-2 font-body text-sm text-amber-800 hover:text-amber-900 hover:underline"
        >
          Read on Source Library →
        </a>
      )}
    </li>
  );
}

export default function RegistryBrowser({ works }: { works: Work[] }) {
  const [q, setQ] = useState('');
  const [onlyRen, setOnlyRen] = useState(false);
  const [onlySL, setOnlySL] = useState(false);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = works;
    if (onlyRen) r = r.filter((w) => w.tgt);
    if (onlySL) r = r.filter((w) => w.sl);
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
  }, [q, onlyRen, onlySL, works]);

  const shown = results.slice(0, 150);

  return (
    <div>
      <div className="sticky top-0 bg-stone-50/95 backdrop-blur py-3 z-10 border-b border-stone-200">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search an author, work, or translator — Ficino, Vesalius, Utopia…"
          className="w-full px-4 py-3 font-body text-base border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-600/40 focus:border-amber-600"
        />
        <div className="flex items-center gap-4 mt-2 font-body text-sm text-stone-600">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlyRen} onChange={(e) => setOnlyRen(e.target.checked)} className="accent-amber-700" />
            Renaissance Latin only
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlySL} onChange={(e) => setOnlySL(e.target.checked)} className="accent-amber-700" />
            Readable on Source Library
          </label>
          <span className="ml-auto text-stone-400 tabular-nums">
            {results.length.toLocaleString()} work{results.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="py-12 text-center font-body text-stone-500">
          <p className="text-lg">No translation on record for “{q}”.</p>
          <p className="mt-2 text-sm">
            That may mean it has never been translated — the 97% gap — or that our registry hasn&rsquo;t reached it yet.
            We keep collecting as the pipeline runs.
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-1">
            {shown.map((w, i) => (
              <WorkCard key={i} work={w} />
            ))}
          </ul>
          {results.length > shown.length && (
            <p className="py-6 text-center font-body text-sm text-stone-500">
              Showing the first {shown.length} of {results.length.toLocaleString()} — refine your search to see more.
            </p>
          )}
        </>
      )}
    </div>
  );
}

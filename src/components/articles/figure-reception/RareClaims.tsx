'use client';

// Rarely told (#7073): the claims about a figure that no other work in the library makes in similar words, in date
// order (rare.json, built by scripts/eval/figure-reception/rare.py). This is the other end of the map and the story
// tree: they show what was said often, this shows what was said once. Spurious, legendary and garbled claims are
// kept on purpose; a note explains a passage that means something other than it seems.

import { useMemo, useState } from 'react';
import { fmtYear, useFigureJson, type RareData } from './data';
import { DielsTag, useDiels } from './Diels';

const FIRST = 20;

export default function RareClaims({ dataUrl, dielsUrl }: { dataUrl: string; dielsUrl?: string }) {
  const { data, failed } = useFigureJson<RareData>(dataUrl);
  const diels = useDiels(dielsUrl);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return needle ? data.items.filter((it) => (it[3] + ' ' + it[4]).toLowerCase().includes(needle)) : data.items;
  }, [data, q]);

  if (failed) return <p className="text-muted italic">The list could not be loaded. Reload the page to try again.</p>;
  if (!data) return <p className="text-muted italic">Loading the list…</p>;

  const list = all || q ? shown : shown.slice(0, FIRST);
  return (
    <div className="not-prose flex flex-col gap-4">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter these passages…"
        aria-label="Filter the rarely told passages"
        className="w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-primary" />
      <ol className="flex flex-col gap-3">
        {list.map((it) => (
          <li key={`${it[1]}:${it[2]}`} className="grid grid-cols-1 sm:grid-cols-[4.5rem_1fr] gap-x-4 gap-y-1">
            <div className="font-mono text-sm text-accent-gold tabular-nums">{fmtYear(it[0])}</div>
            <div className={`min-w-0 border-l-2 pl-3 text-sm leading-relaxed text-secondary ${it[5] ? 'border-accent-gold' : 'border-stone-300'}`}>
              {it[3]}{' '}
              <a href={`/book/${it[1]}?page=${it[2]}`} className="break-words font-mono text-xs text-muted hover:text-primary">
                {it[4].slice(0, 60)}, p.&nbsp;{it[2]}&nbsp;&rarr;
              </a>
              <DielsTag data={diels} id={it[1]} page={it[2]} text={it[3]} />
              {it[7] >= 0 && <p className="mt-1 text-xs italic text-muted">{data.notes[it[7]]}</p>}
            </div>
          </li>
        ))}
      </ol>
      {!q && !all && shown.length > FIRST && (
        <button type="button" onClick={() => setAll(true)} className="self-start rounded-full border border-stone-300 px-3 py-1 text-sm text-secondary hover:border-primary">
          Show all {shown.length}
        </button>
      )}
      {q && shown.length === 0 && <p className="text-muted italic">No passage matches that filter.</p>}
    </div>
  );
}

'use client';

// What Diels collected and what he did not (#7073), from diels.json (scripts/eval/figure-reception/diels.py).
// DielsTag marks a passage that retells an entry of the figure's chapter in Diels, Die Fragmente der Vorsokratiker
// (3rd ed. 1912, held in the library), and links to that page of the Diels volume. DielsThemes shows, for each theme
// of the map, how many of its passages retell a Diels entry. OutsideDiels lists the claims several authors repeat
// that Diels's chapter does not contain. Tags come from a similarity measure checked by reading samples; a passage
// without a tag may still be in Diels.
// PRIOR ART: RareClaims.tsx is the same list shape for claims made once; this file reuses its layout.

import { useMemo, useState } from 'react';
import { FAMILY_COLOR, fmtYear, passageKey, useFigureJson, type DielsData, type MapData } from './data';

const KIND: Record<string, string> = { testimony: 'testimony', fragment: 'fragment', doubtful: 'doubtful fragment', spurious: 'spurious fragment' };

/** diels.json for a component whose Diels tags are optional: no url, no fetch, no tags. */
export function useDiels(url?: string) {
  return useFigureJson<DielsData>(url ?? '').data;
}

/** A small link to the Diels entry a passage retells, or nothing. */
export function DielsTag({ data, id, page, text }: { data: DielsData | null; id: string; page: number; text: string }) {
  if (!data) return null;
  const t = data.tags[passageKey(id, page, text)];
  if (!t) return null;
  const e = data.entries[t[0]];
  return (
    <a href={`/book/${data.book}?page=${e[2]}`} title={`In Diels 1912 as ${e[0]}, a ${KIND[e[1]] ?? e[1]}${e[3] ? ` (${e[3]})` : ''}: ${e[4]}`}
      className="ml-1 inline-block whitespace-nowrap rounded border border-stone-300 bg-white px-1.5 py-0.5 align-[1px] font-mono text-[10px] text-secondary no-underline hover:border-primary">
      Diels {e[0]}
    </a>
  );
}

/** Per theme of the map: how many of its passages retell a Diels entry. Themes mostly outside Diels come first. */
export function DielsThemes({ mapUrl, dielsUrl }: { mapUrl: string; dielsUrl: string }) {
  const map = useFigureJson<MapData>(mapUrl);
  const diels = useFigureJson<DielsData>(dielsUrl);
  const rows = useMemo(() => {
    if (!map.data || !diels.data) return [];
    const fam = Object.fromEntries(map.data.themes.map((t) => [t.c, t]));
    return Object.entries(diels.data.themes)
      .map(([c, [inD, n]]) => ({ c: Number(c), inD, n, t: fam[Number(c)] }))
      .filter((r) => r.t && r.c >= 0 && r.c < 1000 && r.n >= 10) // set-aside groups (c >= 1000) are about someone else
      .sort((a, b) => a.inD / a.n - b.inD / b.n);
  }, [map.data, diels.data]);
  if (map.failed || diels.failed) return <p className="text-muted italic">The chart could not be loaded. Reload the page to try again.</p>;
  if (!rows.length) return <p className="text-muted italic">Loading…</p>;
  return (
    <div className="not-prose flex flex-col gap-2">
      {rows.map((r) => {
        const pct = Math.round((100 * r.inD) / r.n);
        return (
          <div key={r.c} className="grid grid-cols-[1fr_6.5rem] sm:grid-cols-[minmax(0,18rem)_1fr_6.5rem] items-center gap-x-3 gap-y-1 text-sm">
            <div className="min-w-0 text-secondary">{r.t.name}</div>
            <div className="order-last col-span-2 sm:order-none sm:col-span-1 h-2.5 rounded-full bg-stone-200 overflow-hidden" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1)}%`, background: FAMILY_COLOR[r.t.family] ?? FAMILY_COLOR.other }} />
            </div>
            <div className="text-right font-mono text-xs text-muted tabular-nums">{pct}% of {r.n}</div>
          </div>
        );
      })}
    </div>
  );
}

const FIRST = 12;

/** Claims about him that two or more authors make and that his chapter in Diels does not contain. */
export function OutsideDiels({ dielsUrl, mapUrl }: { dielsUrl: string; mapUrl: string }) {
  const { data, failed } = useFigureJson<DielsData>(dielsUrl);
  const map = useFigureJson<MapData>(mapUrl);
  const [all, setAll] = useState(false);
  if (failed) return <p className="text-muted italic">The list could not be loaded. Reload the page to try again.</p>;
  if (!data) return <p className="text-muted italic">Loading the list…</p>;
  const themeName = Object.fromEntries((map.data?.themes ?? []).map((t) => [t.c, t.name]));
  const list = all ? data.outside : data.outside.slice(0, FIRST);
  return (
    <div className="not-prose flex flex-col gap-5">
      <ol className="flex flex-col gap-5">
        {list.map((o) => (
          <li key={`${o[4]}:${o[5]}`} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-body font-semibold text-primary">{o[2]}</span>
              <span className="font-mono text-[11px] text-muted">
                {o[0]} authors{themeName[o[1]] ? ` · ${themeName[o[1]]}` : ''}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[4.5rem_1fr] gap-x-4 gap-y-1">
              <div className="font-mono text-sm text-accent-gold tabular-nums">
                {o[9] != null ? 'by ' : ''}{fmtYear(o[3])}
                {o[9] != null && <span className="block text-[11px] text-muted">ed. {o[9]}</span>}
              </div>
              <div className="min-w-0 border-l-2 border-stone-300 pl-3 text-sm leading-relaxed text-secondary">
                {o[6]}{' '}
                <a href={`/book/${o[4]}?page=${o[5]}`} className="break-words font-mono text-xs text-muted hover:text-primary">
                  {o[7].slice(0, 60)}, p.&nbsp;{o[5]}&nbsp;&rarr;
                </a>
                {o[8].length > 0 && (
                  <p className="mt-1.5 text-xs text-muted">
                    Also:{' '}
                    {o[8].map((x, i) => (
                      <span key={`${x[1]}:${x[2]}`}>
                        {i > 0 && '; '}
                        <a href={`/book/${x[1]}?page=${x[2]}`} className="hover:text-primary">{x[3].slice(0, 40)}</a> ({fmtYear(x[0])})
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {!all && data.outside.length > FIRST && (
        <button type="button" onClick={() => setAll(true)} className="self-start rounded-full border border-stone-300 px-3 py-1 text-sm text-secondary hover:border-primary">
          Show all {data.outside.length}
        </button>
      )}
    </div>
  );
}

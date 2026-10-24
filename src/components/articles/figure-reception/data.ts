'use client';

// Shared data types and loading for the figure-reception charts (#7073). The map, the theme river and the story
// tree all read the same map.json, so it is fetched once per page and shared through a module-level cache.
// PRIOR ART: none — looked in src/lib and src/components/articles; the article charts each fetched their own file.

import { useEffect, useState } from 'react';

// [x, y, theme (-1 = unassigned), year, book id, page, passage, title]
export type Row = [number, number, number, number | null, string, number, string, string];
export type Theme = { c: number; name: string; family: string; n: number; earliest: number | null; median: number | null };
export type MapData = { families: { key: string; name: string }[]; themes: Theme[]; rows: Row[] };
// node = [row, parent row (-1 = starts a new line), similarity %]; rows index map.json, or the story's own rows.
export type Story = { key: string; name: string; theme: number | null; rows?: Row[]; nodes: [number, number, number][] };
export type TreeData = { threshold: number; stories: Story[] };
// rare.json (rare.py): [year, book id, page, passage, title, reports a saying 0|1, other works loosely similar, note index or -1]
export type RareItem = [number | null, string, number, string, string, 0 | 1, number, number];
export type RareData = { threshold: number; total: number; items: RareItem[]; notes: string[] };

// One colour per family; no reds (article rule), each readable on the cream ground.
export const FAMILY_COLOR: Record<string, string> = {
  soul: '#7b4f8c', cosmos: '#2f6f8f', number: '#b07d1a', music: '#2a8a73',
  life: '#6b7a2a', legend: '#8a5a33', pseudo: '#4a4fa0', other: '#57534e',
  // the Map of Harmony's kinds (#7129), the same values the timeline's kind colours take from the site tokens
  ratio: '#8d6f35', opposites: '#9e4a3a', order: '#7c5db5', balance: '#8b9a7d', concord: '#3e7a6e', resonance: '#496da3', feeling: '#8a5a33', spheres: '#57534e',
};

export const fmtYear = (y: number | null) => (y == null ? 'n.d.' : y < 0 ? `${-y} BCE` : String(y));

const cache = new Map<string, Promise<unknown>>();

export function useFigureJson<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    if (!url) return; // optional data the page did not ask for
    if (!cache.has(url)) {
      const p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
      p.catch(() => cache.delete(url)); // a failed load is retried on the next mount
      cache.set(url, p);
    }
    (cache.get(url) as Promise<T>).then((d) => live && setData(d)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [url]);
  return { data, failed };
}

// diels.json (diels.py): which passages retell an entry of the figure's chapter in Diels, Vorsokratiker 1912.
// entry = [label ("32 B 13"), kind, page in the Diels volume, source, gist, passages tagged, works, earliest year]
export type DielsEntry = [string, string, number, string, string, number, number, number | null];
// outside = [authors, map theme (-1 = none), gist, year, book id, page, passage, title, [year, book id, page, title][],
//   edition year when the year is the author's death year (shown as "by"), else null]
export type OutsideItem = [number, number, string, number | null, string, number, string, string, [number | null, string, number, string][], number | null];
export type DielsData = {
  edition: string; book: string; chapters: [number, number][];
  entries: DielsEntry[]; tags: Record<string, [number, number]>; themes: Record<string, [number, number]>; outside: OutsideItem[];
};

// The key diels.py tags a passage by: book, page and the first 30 letters and digits of its text (passages.py).
export const passageKey = (id: string, page: number, text: string) =>
  `${id}:${page}:${text.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30)}`;

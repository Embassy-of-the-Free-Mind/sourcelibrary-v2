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

// One colour per family; no reds (article rule), each readable on the cream ground.
export const FAMILY_COLOR: Record<string, string> = {
  soul: '#7b4f8c', cosmos: '#2f6f8f', number: '#b07d1a', music: '#2a8a73',
  life: '#6b7a2a', legend: '#8a5a33', pseudo: '#4a4fa0', other: '#57534e',
};

export const fmtYear = (y: number | null) => (y == null ? 'n.d.' : y < 0 ? `${-y} BCE` : String(y));

const cache = new Map<string, Promise<unknown>>();

export function useFigureJson<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
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

import type { Book } from './types';

/**
 * What a maker sets on their collection: the works in their order, with section headings (and an
 * optional line of text) placed between them, a note per work, and the order readers see first.
 * The prototype keeps it in the browser (localStorage); the real thing saves it with the collection.
 */
export type DocEntry = { kind: 'work'; id: string } | { kind: 'section'; id: string; heading: string; text: string };
export interface CollectionDoc { order: DocEntry[]; notes: Record<string, string>; added: Record<string, Book>; sort: string }

export const docKey = (slug: string) => `collection-doc-${slug}`;
export const SORTS: [string, string][] = [['maker', 'Maker’s order'], ['year_asc', 'Oldest first'], ['year_desc', 'Newest first'], ['title', 'Title A to Z'], ['author', 'Author A to Z']];

/**
 * The old collection pages' sections, carried over as the maker's sections: the first essential
 * work as Start here, the rest of tier 1, tier 2 and tier 3 under the headings and lines those pages
 * used, then every other work by date. Collections without tiers get the ranked works first, no sections.
 */
const OLD_SECTIONS: [number | 'start', string, string][] = [
  ['start', 'Start here', ''],
  [1, 'Essential reading', 'The foundational texts of this tradition'],
  [2, 'Important works', 'Significant texts that deepen understanding'],
  [3, 'Also notable', ''],
];

export function initialDoc(books: Book[], notes: { id: string; rank: number; note: string; tier?: number }[]): CollectionDoc {
  const have = new Set(books.map((b) => b.id!));
  const ranked = notes.filter((x) => have.has(x.id));
  const rank = new Map(ranked.map((x) => [x.id, x.rank]));
  const byDate = (a: Book, b: Book) => (rank.get(a.id!) ?? 1e6) - (rank.get(b.id!) ?? 1e6) || (a.year ?? 9999) - (b.year ?? 9999);
  const base = { notes: Object.fromEntries(notes.map((x) => [x.id, x.note])), added: {}, sort: 'maker' };
  if (!ranked.some((x) => x.tier)) return { ...base, order: [...books].sort(byDate).map((b) => ({ kind: 'work', id: b.id! })) };
  const order: DocEntry[] = [];
  const placed = new Set<string>();
  const t1 = ranked.filter((x) => x.tier === 1);
  for (const [tier, heading, text] of OLD_SECTIONS) {
    const ids = (tier === 'start' ? t1.slice(0, 1) : tier === 1 ? t1.slice(1) : ranked.filter((x) => x.tier === tier)).map((x) => x.id);
    if (!ids.length) continue;
    order.push({ kind: 'section', id: `old-${tier}`, heading, text });
    for (const id of ids) { order.push({ kind: 'work', id }); placed.add(id); }
  }
  const rest = books.filter((b) => !placed.has(b.id!)).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  if (rest.length) {
    order.push({ kind: 'section', id: 'old-rest', heading: 'More in this collection', text: '' });
    for (const b of rest) order.push({ kind: 'work', id: b.id! });
  }
  return { ...base, order };
}

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

/** The starting point: the collection's own ranked works first, then the rest by date. */
export function initialDoc(books: Book[], notes: { id: string; rank: number; note: string }[]): CollectionDoc {
  const rank = new Map(notes.map((x) => [x.id, x.rank]));
  const order = [...books].sort((a, b) => (rank.get(a.id!) ?? 1e6) - (rank.get(b.id!) ?? 1e6) || (a.year ?? 9999) - (b.year ?? 9999));
  return { order: order.map((b) => ({ kind: 'work', id: b.id! })), notes: Object.fromEntries(notes.map((x) => [x.id, x.note])), added: {}, sort: 'maker' };
}

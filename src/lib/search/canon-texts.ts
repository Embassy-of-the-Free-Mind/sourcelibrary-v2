// PRIOR ART: the book lane (src/lib/books-catalog.ts searchBookIds) matches title/author of the
// BOOK, so a canon volume titled "Derge Tengyur, vol. 96" can never answer "Nagarjuna"; the index
// lanes (unified searchIndex, /api/search/index) read AI-built entity indexes, which the Tengyur
// does not have and which name people, not the texts that open on a page. Nothing searched
// `books.chapters`. src/lib/search/name-variants.ts expands names for the PAGE lane only.
//
// canon-texts — the catalogue lane for multi-text canon volumes (#6145).
//
// A Derge Tengyur volume holds ~16 texts by as many authors. Each text is a level-1 chapter written
// by scripts/maintenance/tengyur-catalogue-6145.mjs from the Esukhia Tohoku markers and BDRC's
// outline (CC0), and carries `catalogue.search_keys`: diacritic-free lower-case keys for its
// Sanskrit and Tibetan titles, its authors and translators, and its Tohoku number. A query matches a
// text when EVERY query word is a substring of one of its keys; the hit is returned as a PAGE result
// that opens the volume at the text's first page.
//
// Scoped by `collections` (indexed) to the canon volumes, so the unwind runs over ~200 documents.

import type { Db } from 'mongodb';
import type { SearchResult } from '@/lib/api-client/types/search';

/** Collections whose volumes carry catalogue chapters. */
export const CANON_TEXT_COLLECTIONS = ['derge-tengyur'];
const METHOD = 'catalogue:esukhia-tohoku-markers+bdrc-O23703';
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'by', 'of', 'on', 'in', 'tengyur', 'derge', 'text', 'texts', 'works', 'tohoku']);

/** Same folding as scripts/lib/tengyur-catalogue.mjs fold() — keep the two in step. */
export function foldKey(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ṃṁ]/g, 'm').replace(/ḥ/g, 'h')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Query → folded words that must each match a key. `toh 3824` keeps both words. */
export function canonQueryWords(query: string): string[] {
  const q = String(query || '').replace(/^"|"$/g, '');
  return [...new Set(q.split(/[\s,;:]+/).map(foldKey).filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP.has(w)))];
}

interface CanonPerson { name?: string | null; name_ewts?: string | null; author_id?: string | null }
interface CanonChapter {
  title: string; titleEn?: string; pageNumber: number; endPage?: number;
  catalogue: { tohoku: string; title_sa?: string | null; title_ewts?: string | null; authors?: CanonPerson[]; translators?: CanonPerson[]; search_keys?: string[]; continued_from_previous_volume?: boolean };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A folded word as a key pattern. IAST folds ś/ṣ to "s" and c stays "c", while readers type
 * "Shantideva" and "Chandrakirti" — and EWTS keys really do contain "sh"/"ch" ("shes rab", "chos").
 * So "sh"/"s" and "ch"/"c" are interchangeable in both directions.
 */
export function wordPattern(w: string): string {
  return escapeRe(w.replace(/sh/g, 's').replace(/ch/g, 'c')).replace(/s/g, 'sh?').replace(/c/g, 'ch?');
}
const personName = (p: CanonPerson) => p.name || p.name_ewts || '';

/**
 * Is the query the NAME of one of this text's authors in the `authors` thesaurus? BDRC splits
 * Dharmakīrti into I/II/III, and all three match "dharmakirti" as a word; the thesaurus resolves
 * the bare name to one person — the doc whose id IS the name (`dharmakirti` = Dharmakīrti I; his
 * namesakes are `dharmakirti-iii`, `dharmakirti-of-suvarnadvipa-…`). So the author_id, folded,
 * equal to the whole folded query picks the person a reader means by the bare name (#6145).
 */
export function queryNamesAuthor(words: string[], authors: CanonPerson[] | undefined): boolean {
  if (!words.length) return false;
  const whole = new RegExp(`^${words.map(wordPattern).join('')}$`);
  return (authors || []).some((p) => Boolean(p.author_id) && whole.test(foldKey(p.author_id as string)));
}

/**
 * Texts in canon volumes matching every word of the query.
 * `bookFilter` is the caller's book-level filter (visible, pages_count, language, year, tenant…) —
 * applied here so this lane obeys the same filters as every other (search-filters-and-lanes.md).
 */
export async function searchCanonTexts(db: Db, query: string, bookFilter: Record<string, unknown>, limit = 10): Promise<SearchResult[]> {
  const words = canonQueryWords(query);
  if (!words.length) return [];
  const rows = await db.collection('books').aggregate([
    { $match: { ...bookFilter, collections: { $in: CANON_TEXT_COLLECTIONS }, chapters_method: METHOD } },
    { $project: { id: 1, slug: 1, title: 1, display_title: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, chapters: 1 } },
    { $unwind: '$chapters' },
    { $match: { 'chapters.catalogue.continued_from_previous_volume': { $ne: true }, $and: words.map((w) => ({ 'chapters.catalogue.search_keys': { $regex: wordPattern(w) } })) } },
    { $limit: 200 },
  ], { maxTimeMS: 4000 }).toArray();

  // Rank, strongest first: every word is in an AUTHOR's name (not a translator's, not a title word);
  // the query is the thesaurus name of an author (Dharmakīrti I before II/III);
  // more words that are whole keys (a name, the Tohoku number); we hold the Sanskrit original;
  // longer texts (the treatises before the short ritual pieces); then canonical order.
  const whole = words.map((w) => new RegExp(`^${wordPattern(w)}$`));
  const authorKeys = (ch: CanonChapter) => (ch.catalogue.authors || []).flatMap((p) => [p.name, p.name_ewts])
    .filter(Boolean).flatMap((n) => [foldKey(n as string), ...String(n).split(/[\s\-/_]+/).map(foldKey)]);
  const byAuthor = (ch: CanonChapter) => { const ks = authorKeys(ch); return words.every((w) => ks.some((k) => new RegExp(wordPattern(w)).test(k))) ? 1 : 0; };
  const exact = (ch: CanonChapter) => whole.filter((re) => (ch.catalogue.search_keys || []).some((k) => re.test(k))).length;
  const named = (ch: CanonChapter) => (queryNamesAuthor(words, ch.catalogue.authors) ? 1 : 0);
  const held = (ch: CanonChapter) => ((ch.catalogue as { sanskrit_held?: string }).sanskrit_held ? 1 : 0);
  const length = (ch: CanonChapter) => (ch.endPage ?? ch.pageNumber) - ch.pageNumber;
  const ranked = rows
    .map((r) => ({ r, ch: r.chapters as CanonChapter }))
    .sort((a, b) => byAuthor(b.ch) - byAuthor(a.ch) || named(b.ch) - named(a.ch) || exact(b.ch) - exact(a.ch) || held(b.ch) - held(a.ch)
      || length(b.ch) - length(a.ch)
      || String(a.r.slug).localeCompare(String(b.r.slug), undefined, { numeric: true }) || a.ch.pageNumber - b.ch.pageNumber)
    .slice(0, limit);

  return ranked.map(({ r, ch }) => {
    const c = ch.catalogue;
    const n = c.tohoku.replace(/^D/, '');
    const head = (c.title_sa || c.title_ewts || ch.title || '').replace(/-nāma$/i, '');
    const authors = (c.authors || []).map(personName).filter(Boolean);
    const translators = (c.translators || []).map(personName).filter(Boolean);
    const span = ch.endPage && ch.endPage > ch.pageNumber ? `pp. ${ch.pageNumber}–${ch.endPage}` : `p. ${ch.pageNumber}`;
    const snippet = [
      `Toh ${n}. ${ch.title}`,
      `${r.display_title || r.title}, ${span}.`,
      translators.length ? `Translated by ${translators.join(', ')}.` : '',
    ].filter(Boolean).join(' · ');
    return {
      id: `${r.id}-p${ch.pageNumber}`,
      type: 'page',
      book_id: r.id,
      slug: r.slug,
      title: `${head} (Toh ${n})`,
      display_title: `${head} (Toh ${n})`,
      author: authors.join(', ') || 'Unknown',
      language: r.language || 'Tibetan',
      published: r.published || '',
      page_count: r.pages_count,
      translated_count: r.pages_translated,
      has_doi: false,
      page_number: ch.pageNumber,
      snippet,
      thumbnail: r.thumbnail,
      thumbnail_blob: r.thumbnail_blob,
      image_display: r.image_display,
      image_thumb: r.image_thumb,
    } as SearchResult;
  });
}

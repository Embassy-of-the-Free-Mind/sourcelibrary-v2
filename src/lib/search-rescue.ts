/**
 * When a gallery or catalogue search finds nothing, work out what the reader
 * probably meant and check that it finds something.
 *
 * "ship fools woodcut", "shp of fols" and "ship of foools" all mean the three
 * Ship of Fools artworks, and each found nothing: the gallery needs every word
 * in an image's own text, spelled right. The site's older suggester
 * (/api/search/suggest) matches a whole query against a fixed vocabulary with
 * one edit, so it handles "dragn" but not a missing word, two typos, an extra
 * word, or artworks (its vocabulary is readable books only).
 *
 * Candidates, from the library's own text (Atlas Search fuzzy matching, which
 * reports the word it actually matched), never invented:
 *  - spelling: each word replaced by the nearest word the index really holds;
 *  - title: the stretch of a real title the words line up with, filling in the
 *    small words between them ("ship fools" → "ship of fools");
 *  - kind (gallery): a kind of image becomes the kind filter ("woodcut");
 *  - fewer words: the query with one word left out.
 * Each candidate is run through the page's own count; only ones that find
 * something are offered, best first.
 */

import { BOOK_SEARCH_INDEX } from '@/lib/atlas-search';
import { queryTerms } from '@/lib/search-grounding';

export interface Rescue {
  /** The words to search instead. */
  q: string;
  /** Gallery only: a kind of image to filter by. */
  type?: string;
  /** How it was found, for the sentence the page shows. */
  why: 'spelling' | 'title' | 'kind' | 'fewer-words';
  /** Results the page's own search returns for it. */
  count: number;
}

/** Kinds of image a reader types as a word; the gallery filters them by type. */
const KINDS: Record<string, string> = {
  woodcut: 'woodcut', woodcuts: 'woodcut', engraving: 'engraving', engravings: 'engraving',
  emblem: 'emblem', emblems: 'emblem', diagram: 'diagram', diagrams: 'diagram', map: 'map', maps: 'map',
  portrait: 'portrait', portraits: 'portrait', frontispiece: 'frontispiece', frontispieces: 'frontispiece',
  painting: 'painting', paintings: 'painting', print: 'print', prints: 'print', drawing: 'drawing', drawings: 'drawing',
};

const SMALL = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'or', 'de', 'et', 'la', 'le', 'der', 'die', 'das', 'und', 'von']);
const WORD = /[\p{L}\p{M}\p{N}']+/gu;
const words = (s: string) => (s.toLowerCase().match(WORD) ?? []);

/**
 * Edit distance where swapping two neighbouring letters is one edit
 * ("mermiad" → "mermaid"), as Atlas Search's own fuzzy matching counts it.
 */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Edits a word may be off by: none for one or two letters, one up to five, two from six ("alkemy" → "alchemy"). */
const allowed = (w: string) => (w.length <= 2 ? 0 : w.length <= 5 ? 1 : 2);
/** Close enough: within the allowed edits, or one is the other plus a plural ending. */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.replace(/(es|s)$/, '') === b.replace(/(es|s)$/, '')) return true;
  const n = allowed(a);
  return n > 0 && b.length > 2 && Math.abs(a.length - b.length) <= n && editDistance(a, b) <= n;
}
const fuzzy = (t: string) => ({ maxEdits: Math.max(1, allowed(t)) as 1 | 2, prefixLength: 1 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any };

/**
 * The words the index really holds near each query word, from Atlas Search
 * highlights: a fuzzy match reports the stored word it matched.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hitWords(docs: any[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const d of docs) {
    for (const h of d.highlights ?? []) {
      for (const t of h.texts ?? []) {
        if (t.type !== 'hit') continue;
        for (const w of words(t.value)) seen.set(w, (seen.get(w) || 0) + 1);
      }
    }
  }
  return seen;
}

/**
 * Up to three real words near each term: nearest first, then the longer word
 * (a typo usually drops a letter: "shp" is "ship" before "sha"), then the more
 * frequent. A term the index holds stays as it is.
 */
function nearWords(t: string, seen: Map<string, number>): string[] {
  if (seen.has(t)) return [t];
  const close = [...seen].filter(([w]) => near(t, w))
    .map(([w, n]) => ({ w, n, d: editDistance(t, w) }))
    .sort((a, b) => a.d - b.d || b.w.length - a.w.length || b.n - a.n)
    .slice(0, 3)
    .map((x) => x.w);
  return close.length ? close : [t];
}

/** Every combination of the per-word choices (capped), the nearest first. */
function combinations(choices: string[][], cap = 9): string[][] {
  let out: string[][] = [[]];
  for (const c of choices) out = out.flatMap((pre) => c.map((w) => [...pre, w])).slice(0, cap);
  return out;
}

/**
 * The stretch of a title the query's words line up with, in order, allowing
 * small words between them: ["ship","fools"] in "The Ship of Fools and Other
 * Grotesques" → "ship of fools". Null when the words don't all appear close together.
 */
export function titleSpan(terms: string[], title: string): string | null {
  const tw = words(title);
  if (!terms.length) return null;
  let start = -1;
  let at = 0;
  for (const t of terms) {
    let found = -1;
    for (let i = at; i < tw.length; i++) {
      if (near(t, tw[i])) { found = i; break; }
      // Only small words may sit between two matched words.
      if (start >= 0 && !SMALL.has(tw[i])) break;
    }
    if (found < 0) return null;
    if (start < 0) start = found;
    at = found + 1;
  }
  const span = tw.slice(start, at);
  return span.length <= terms.length + 3 ? span.join(' ') : null;
}

export interface RescueScope {
  kind: 'gallery' | 'library';
  /** Results the page's own search returns for a candidate (0 when none). */
  count: (c: { q: string; type?: string }) => Promise<number>;
}

const MAX_CANDIDATES = 14;

export async function rescueSearch(db: Db, query: string, scope: RescueScope): Promise<Rescue[]> {
  const raw = words(query);
  if (!raw.length || query.length > 120) return [];
  const terms = queryTerms(query).terms.filter((t) => t.length > 1);
  if (!terms.length) return [];

  const candidates: Omit<Rescue, 'count'>[] = [];
  const push = (c: Omit<Rescue, 'count'>) => {
    const q = c.q.trim();
    if (!q && !c.type) return;
    if (q === query.trim().toLowerCase() && !c.type) return;
    if (!candidates.some((x) => x.q === q && x.type === c.type)) candidates.push({ ...c, q });
  };

  // A kind of image typed as a word becomes the kind filter.
  const kindWord = scope.kind === 'gallery' ? terms.find((t) => KINDS[t]) : undefined;
  const contentTerms = kindWord ? terms.filter((t) => t !== kindWord) : terms;

  const titlePaths = ['title', 'display_title', 'english_title'];
  const textPaths = scope.kind === 'gallery'
    ? ['description', 'metadata.subjects', 'metadata.figures']
    : [...titlePaths, 'reading_summary.overview'];
  const textIndex = scope.kind === 'gallery' ? 'gallery_search' : BOOK_SEARCH_INDEX;
  const textCollection = scope.kind === 'gallery' ? 'gallery_images' : 'books';
  const shouldFuzzy = (paths: string[]) => contentTerms.map((t) => ({ text: { query: t, path: paths, fuzzy: fuzzy(t) } }));

  const [textDocs, titleDocs] = await Promise.all([
    contentTerms.length ? db.collection(textCollection).aggregate([
      { $search: { index: textIndex, compound: { should: shouldFuzzy(textPaths), minimumShouldMatch: 1 }, highlight: { path: textPaths } } },
      { $limit: 40 },
      { $project: { _id: 0, highlights: { $meta: 'searchHighlights' } } },
    ], { maxTimeMS: 4000 }).toArray().catch(() => []) : Promise.resolve([]),
    contentTerms.length ? db.collection('books').aggregate([
      { $search: { index: BOOK_SEARCH_INDEX, compound: { should: shouldFuzzy(titlePaths), minimumShouldMatch: Math.min(2, contentTerms.length) } } },
      { $limit: 40 },
      {
        $match: {
          visible: true, hidden: { $ne: true },
          ...(scope.kind === 'library' ? { pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } } : {}),
        },
      },
      { $limit: 12 },
      { $project: { _id: 0, title: 1, display_title: 1, english_title: 1 } },
    ], { maxTimeMS: 4000 }).toArray().catch(() => []) : Promise.resolve([]),
  ]);

  // Titles first: a whole phrase someone half-remembered is the likeliest intent.
  for (const d of titleDocs) {
    for (const t of [d.display_title, d.title, d.english_title]) {
      const span = typeof t === 'string' ? titleSpan(contentTerms, t) : null;
      if (span) { push({ q: span, why: 'title' }); break; }
    }
  }

  // Spelling: every word replaced by a near real word; the combinations are
  // counted below, so "unicorm horn" lands on unicorn, not uniform.
  const seen = hitWords(textDocs);
  const choices = contentTerms.map((t) => nearWords(t, seen));
  const fixed = choices.map((c) => c[0]);
  for (const combo of combinations(choices)) {
    if (combo.join(' ') !== contentTerms.join(' ')) push({ q: combo.join(' '), why: 'spelling' });
  }

  if (kindWord) {
    push({ q: fixed.join(' '), type: KINDS[kindWord], why: 'kind' });
    for (const c of [...candidates]) if (c.why === 'title') push({ q: c.q, type: KINDS[kindWord], why: 'kind' });
  }

  // Fewer words: leave one out (spelling fixed), longest remainders first.
  if (fixed.length >= 2) {
    for (let i = 0; i < fixed.length; i++) push({ q: fixed.filter((_, j) => j !== i).join(' '), why: 'fewer-words' });
  }

  const counted = await Promise.all(candidates.slice(0, MAX_CANDIDATES).map(async (c) => ({
    ...c, count: await scope.count({ q: c.q, type: c.type }).catch(() => 0),
  })));
  // Keep the order above (title, spelling, kind, fewer words); within spelling,
  // the combination that finds the most comes first. A shortened query is
  // offered only when it finds a few, not one stray match.
  const rank = { title: 0, spelling: 1, kind: 2, 'fewer-words': 3 };
  // "ship fools" says nothing "ship of fools" did not.
  const bare = (q: string) => words(q).filter((w) => !SMALL.has(w)).join(' ');
  const titles = new Set(counted.filter((c) => c.why === 'title').map((c) => bare(c.q)));
  return counted
    .filter((c) => c.why === 'title' || !titles.has(bare(c.q)) || c.type)
    .filter((c) => c.count > (c.why === 'fewer-words' ? 2 : 0))
    .sort((a, b) => rank[a.why] - rank[b.why] || (a.why === 'spelling' ? b.count - a.count : 0))
    .filter((c, i, all) => all.findIndex((x) => x.q === c.q && x.type === c.type) === i)
    .slice(0, 3);
}

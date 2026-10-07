/**
 * Page search by meaning, as the concept lanes serve it: the English vector
 * lane, the original-text lane beside it, fused, then spread across traditions
 * and works (#3514, #3895, #5729).
 *
 * PRIOR ART: `semanticPageSearchGlobal` (src/lib/semantic-search.ts) — one RPC,
 * the nearest N as they come. Its three concept callers (/api/search/semantic,
 * the /api/search semantic page lane, the Librarian's global page source) each
 * took its top rows directly, so each returned one tradition's vocabulary
 * island and none could reach an untranslated page. `rrfScores`
 * (src/lib/search/rrf.ts) is the fusion; `diversify` (diversity.ts) the
 * re-rank. This file only puts them in one order so the three callers cannot
 * drift apart.
 *
 * Order of work:
 *  1. English lane, CANDIDATES rows. `match_semantic` returns at most
 *     `hnsw.ef_search` (40) rows whatever is asked, so that is the pool.
 *  2. Original-text lane when it is switched on and deployed; otherwise
 *     nothing, and `lanes.untranslated` says which.
 *  3. Reciprocal-rank fusion. The lanes share no row (a page has a
 *     translation or it does not), so this interleaves them by rank.
 *  4. Books the reader does not serve are dropped BEFORE the caps are
 *     counted, so a hidden book cannot use up a tradition's places.
 *  5. `diversify`: per-tradition and per-work caps on each screen of ten, and
 *     at most ORIGINAL_PER_SCREEN untranslated rows.
 *  6. Rows with no English get their snippet from the page's own OCR; one
 *     with no text is dropped. That includes English-lane rows whose stored
 *     translation is empty (a page embedded from its OCR): they used to go
 *     out with a blank snippet, and the MCP tool then dropped them, which is
 *     how the four #5729 gold pages the shared index does find went unseen.
 *
 * Tenant scope is the caller's `SearchScope`, passed to both lanes; a closed
 * scope returns nothing.
 */
import { getDb } from '@/lib/mongodb';
import {
  semanticPageSearchGlobal,
  semanticPageSearchUntranslated,
  type SemanticPageResult,
  type SemanticPageSearchOptions,
  type UntranslatedLaneState,
} from '@/lib/semantic-search';
import { rrfScores } from '@/lib/search/rrf';
import { diversify, traditionFamily, traditionSpread, type DiversityMode } from '@/lib/search/diversity';
import { loadBookFacets, type LoadedBookFacets } from '@/lib/search/diversity-facets';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { stripMarkupTags } from '@/lib/strip-markup-tags';

/** What `match_semantic` can return in one call (hnsw.ef_search). */
const CANDIDATES = 40;
const UNTRANSLATED_CANDIDATES = 20;
/** Untranslated rows per screen of ten: found, but not most of what a reader of English sees. */
export const ORIGINAL_PER_SCREEN = 3;
/**
 * A capped row is passed over only for a row within this cosine of it.
 * Measured 2026-10-07 (scripts/eval/experiments/2026-10-07-tradition-diversity-rerank.md):
 * at 0.02 neither known-item gold set lost a query and relevant traditions in
 * the top 10 rose 1.68 → 1.88; at 0.03 and with no margin the Librarian golden
 * set lost two. The value was chosen on the sets it is reported on.
 */
export const DIVERSITY_MARGIN = 0.02;

export interface ConceptPageRow extends SemanticPageResult {
  /** `books.tradition` of the row's book, when it has one. */
  tradition?: string[];
  /** `original` = from the untranslated lane: the snippet is the page's own language. */
  text_lane: 'translated' | 'original';
  slug?: string | null;
}

export interface ConceptSearchOptions extends SemanticPageSearchOptions {
  /** `off` returns the lanes' own order. */
  diversity: DiversityMode;
}

export interface ConceptSearchResult {
  rows: ConceptPageRow[];
  /** The mode that was applied: `off` when the facts to re-rank on could not be read. */
  diversity: DiversityMode;
  lanes: { untranslated: UntranslatedLaneState };
  /** Rows per tradition family in `rows`. */
  traditions: Record<string, number>;
}

const key = (r: { book_id: string; page_number: number }) => `${r.book_id}-p${r.page_number}`;

/** The page's own text as a snippet: wrappers out content-and-all, then tags, then whitespace. */
export function ocrSnippet(ocr: string | null | undefined, chars = 300): string {
  return stripMarkupTags(stripEditorialWrappers(ocr || '')).replace(/\s+/g, ' ').trim().slice(0, chars);
}

async function loadOcrSnippets(rows: ConceptPageRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = rows.map((r) => r.page_id).filter(Boolean);
  if (ids.length === 0) return out;
  try {
    const db = await getDb();
    const pages = await db.collection('pages')
      .find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, 'ocr.data': 1 }, maxTimeMS: 3000 })
      .toArray();
    for (const p of pages) {
      const snippet = ocrSnippet((p.ocr as { data?: string } | undefined)?.data);
      if (snippet) out.set(p.id as string, snippet);
    }
  } catch {
    // No text, no row: the caller drops what it cannot show.
  }
  return out;
}

export async function conceptPageSearch(
  query: string,
  limit: number,
  opts: ConceptSearchOptions,
): Promise<ConceptSearchResult> {
  const { diversity: requested, maxPerBook, ...laneOpts } = opts;
  if (opts.scope.kind === 'closed') {
    return { rows: [], diversity: requested, lanes: { untranslated: 'closed' }, traditions: {} };
  }
  const want = Math.max(limit, CANDIDATES);
  const [english, original] = await Promise.all([
    semanticPageSearchGlobal(query, want, laneOpts),
    semanticPageSearchUntranslated(query, UNTRANSLATED_CANDIDATES, laneOpts),
  ]);

  // An English-lane row with no stored translation is a page embedded from
  // its own text: same handling as the original-text lane's rows.
  const fromEnglish = (r: SemanticPageResult): ConceptPageRow => (r.snippet
    ? { ...r, text_lane: 'translated' }
    : { ...r, text_lane: 'original', snippet_type: 'ocr' });
  // Only rows the original-text lane ADDED count against its share of a screen.
  const laneOnly = new Set<string>();
  let fused: ConceptPageRow[];
  if (original.rows.length === 0) {
    fused = english.map(fromEnglish);
  } else {
    const byKey = new Map<string, ConceptPageRow>();
    for (const r of english) byKey.set(key(r), fromEnglish(r));
    for (const r of original.rows) {
      if (byKey.has(key(r))) continue;
      byKey.set(key(r), { ...r, text_lane: 'original' });
      laneOnly.add(key(r));
    }
    const scores = rrfScores([english.map(key), original.rows.map(key)]);
    // Equal fused score (the same rank in each lane): the nearer vector first.
    fused = [...byKey.entries()]
      .sort((a, b) => (scores.get(b[0]) ?? 0) - (scores.get(a[0]) ?? 0) || b[1].score - a[1].score)
      .map(([, r]) => r);
  }

  const lookup = await loadBookFacets(fused.map((r) => r.book_id));
  const facets: Map<string, LoadedBookFacets> = lookup.facets;
  if (lookup.ok) fused = fused.filter((r) => facets.get(r.book_id)?.live === true);
  if ((maxPerBook ?? 0) > 0) {
    const perBook = new Map<string, number>();
    fused = fused.filter((r) => {
      const n = (perBook.get(r.book_id) ?? 0) + 1;
      perBook.set(r.book_id, n);
      return n <= maxPerBook!;
    });
  }

  // Without the facts there is nothing to count by; the lanes' order stands.
  const applied: DiversityMode = lookup.ok ? requested : 'off';
  const ordered = diversify(fused, {
    mode: applied,
    bookId: (r) => r.book_id,
    facets,
    score: (r) => r.score,
    margin: DIVERSITY_MARGIN,
    extra: [{ key: (r) => (laneOnly.has(key(r)) ? 'original' : null), cap: ORIGINAL_PER_SCREEN }],
  });

  // Over-read by the rows that may turn out to have no text to show.
  const head = ordered.slice(0, limit + ORIGINAL_PER_SCREEN + 2);
  const snippets = await loadOcrSnippets(head.filter((r) => r.text_lane === 'original'));
  const rows = head
    .map((r) => {
      const f = facets.get(r.book_id);
      const row: ConceptPageRow = { ...r, slug: f?.slug ?? null };
      if (f?.tradition?.length) row.tradition = f.tradition;
      if (r.text_lane === 'original') row.snippet = snippets.get(r.page_id) ?? '';
      return row;
    })
    .filter((r) => r.text_lane === 'translated' || r.snippet !== '')
    .slice(0, limit);

  return {
    rows,
    diversity: applied,
    lanes: { untranslated: original.state },
    traditions: traditionSpread(rows, (r) => r.book_id, facets),
  };
}

export { traditionFamily };

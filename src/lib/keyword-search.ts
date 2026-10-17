/**
 * Client for the keyword page service (#6852): the `/api/search` page lane's
 * Atlas `pages_search` questions — the 25 best pages, the name-variant pages,
 * the page roll-up's counts and its best page per added book — answered from a
 * tantivy (BM25) index on Hetzner in one round trip instead of up to four Atlas
 * `$search` calls (1.3 s p50, 2.9 s p90 for the lane in production). Service
 * code and contract: scripts/workers/keyword-search/ (README.md).
 *
 * Three modes, from KEYWORD_SEARCH_MODE, and only when KEYWORD_SEARCH_URL and
 * KEYWORD_SEARCH_TOKEN are both set:
 *   off     (default) the service is never called.
 *   shadow  the lane runs Atlas exactly as before and returns ITS pages; the
 *           service is called beside it and the comparison (`KeywordShadow`)
 *           is logged on the search_queries row as `keyword_shadow`.
 *   serve   the service's pages, their text hydrated from Mongo by page id,
 *           with Atlas as the fallback on any error or timeout.
 *
 * Global scope only: not for a `book_id` search (that lane admits a book that
 * is not visible), not on a tenant, not for `?lang=` (that lane is Postgres).
 * The service only ever returns pages of live books (visible, pages_count > 0,
 * not hidden), intersected with the allow-list the caller passes.
 *
 * PRIOR ART: src/lib/vector-search.ts — the same off/shadow/serve shape, env
 * names and Bearer transport for the page-vector service (#6821). Its rows are
 * hydrated from Supabase; these come from Mongo `pages`, the store the Atlas
 * lane reads, and carry the roll-up's counts as well.
 */
import type { Db, Document } from 'mongodb';
import { NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';

export type KeywordSearchMode = 'off' | 'shadow' | 'serve';

/**
 * The service call's budget, network included. Server time is tens of ms for
 * most queries (scripts/eval/experiments/ for the measured distribution); a
 * common word scores a long posting list. Atlas, which it stands in for, has
 * an 8 s ceiling.
 */
export const KEYWORD_SEARCH_TIMEOUT_MS = 1500;

export function keywordSearchMode(): KeywordSearchMode {
  if (!process.env.KEYWORD_SEARCH_URL || !process.env.KEYWORD_SEARCH_TOKEN) return 'off';
  const m = process.env.KEYWORD_SEARCH_MODE;
  return m === 'shadow' || m === 'serve' ? m : 'off';
}

/** What the route's page lane asks, in the service's names. */
export interface KeywordLaneParams {
  query: string;
  /** Pages wanted from the main query (the lane's `pageLimit`). */
  k: number;
  /** Allow-list of book ids when book-level filters apply; absent = every live book. */
  bookIds?: string[];
  /** Other spellings of a person the query names (expandNameQuery). */
  variants?: string[];
  /** With variants: the page must also print one of these. */
  topicWords?: string[];
  variantK?: number;
  /** rollupTerms(query); null = no roll-up. */
  rollup?: { terms: string[]; buckets?: number; maxBooks?: number } | null;
}

export interface KeywordServiceRow {
  page_id: string;
  book_id: string;
  page_number: number;
  score: number | null;
  src: 'main' | 'variant' | 'rollup';
}

export interface KeywordLaneResult {
  main: KeywordServiceRow[];
  variants: KeywordServiceRow[];
  /** Pages printing every roll-up term, per live book, most first; null when no roll-up ran. */
  counts: { book_id: string; pages: number }[] | null;
  extra: KeywordServiceRow[];
  ms: Record<string, number>;
  server_ms?: number;
}

export class KeywordServiceError extends Error {
  constructor(message: string) {
    super(`[keyword-search] ${message}`);
    this.name = 'KeywordServiceError';
  }
}

/** POST /lane. Throws KeywordServiceError on a timeout, a non-200 or a malformed body. */
export async function callKeywordLane(p: KeywordLaneParams, timeoutMs = KEYWORD_SEARCH_TIMEOUT_MS): Promise<KeywordLaneResult> {
  const url = process.env.KEYWORD_SEARCH_URL;
  const token = process.env.KEYWORD_SEARCH_TOKEN;
  if (!url || !token) throw new KeywordServiceError('KEYWORD_SEARCH_URL / KEYWORD_SEARCH_TOKEN not set');
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, '')}/lane`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: p.query,
        k: p.k,
        book_ids: p.bookIds ?? null,
        variants: p.variants ?? [],
        topic_words: p.topicWords ?? [],
        variant_k: p.variantK ?? 10,
        rollup: p.rollup ? { terms: p.rollup.terms, buckets: p.rollup.buckets ?? 200, max_books: p.rollup.maxBooks ?? 30 } : null,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new KeywordServiceError(name === 'TimeoutError' || name === 'AbortError' ? `timeout after ${timeoutMs} ms` : `fetch failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new KeywordServiceError(`HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as KeywordLaneResult | null;
  if (!body || !Array.isArray(body.main) || !Array.isArray(body.variants) || !Array.isArray(body.extra)) throw new KeywordServiceError('malformed response');
  return body;
}

// ---------------------------------------------------------------------------
// Shadow comparison
// ---------------------------------------------------------------------------

/**
 * One shadow comparison (`search_queries.keyword_shadow`). Overlaps are on
 * book:page keys, after both sides are confined to live books (the Atlas lane
 * returns hidden books' pages and the route drops them at the join), and are
 * |svc ∩ atlas| / |atlas|: the share of what readers get today that the
 * service also returns. null when the Atlas side is empty.
 */
export interface KeywordShadow {
  atlas_ms: number;
  svc_ms: number | null;
  svc_server_ms?: number;
  k: number;
  /** Atlas main pages (live books only) and the service's. */
  atlas_n: number;
  svc_n: number | null;
  /** Recall of the Atlas main top-k (live). */
  recall_main: number | null;
  /** Recall of the Atlas top 20 (live) within the service's top 20. */
  recall_at_20: number | null;
  /** Recall of the lane's whole page list (main + variant + roll-up pages). */
  recall_lane: number | null;
  /** Recall of the Atlas roll-up's 30 most-evidenced live books within the service's 30. */
  recall_counts_30: number | null;
  filtered: boolean;
  variants: boolean;
  svc_error?: string;
  /** Atlas itself failed or timed out; nothing to compare against. */
  atlas_failed?: boolean;
}

type PageKeyed = { book_id?: unknown; page_number?: unknown };
const keyOf = (p: PageKeyed) => `${p.book_id}:${p.page_number}`;

/** |b ∩ a| / |a| over the first k of each; null when a is empty. */
export function recallOf(atlas: readonly string[], svc: readonly string[], k = Infinity): number | null {
  const a = atlas.slice(0, k);
  if (a.length === 0) return null;
  const s = new Set(svc.slice(0, k));
  return Math.round((a.filter((x) => s.has(x)).length / a.length) * 1000) / 1000;
}

export interface AtlasLaneSnapshot {
  main: PageKeyed[];
  /** The lane's whole page list as returned (main, variants, roll-up). */
  lane: PageKeyed[];
  counts: { book_id: string; pages: number }[] | null;
  ms: number;
  failed?: boolean;
}

/**
 * Build the comparison. `liveBooks` is the set of the Atlas side's book ids
 * that are live (the caller reads it with one indexed find, after the
 * response). Exported for tests.
 */
export function buildKeywordShadow(
  s: { ok: true; r: KeywordLaneResult; ms: number } | { ok: false; error: string; ms: number },
  atlas: AtlasLaneSnapshot,
  liveBooks: ReadonlySet<string>,
  k: number,
  flags: { filtered: boolean; variants: boolean },
): KeywordShadow {
  const live = (xs: PageKeyed[]) => xs.filter((p) => liveBooks.has(String(p.book_id)));
  const aMain = live(atlas.main).map(keyOf);
  const aLane = live(atlas.lane).map(keyOf);
  const aCounts = (atlas.counts || []).filter((c) => liveBooks.has(c.book_id)).map((c) => c.book_id);
  const base = {
    atlas_ms: Math.round(atlas.ms),
    svc_ms: Math.round(s.ms),
    k,
    atlas_n: aMain.length,
    filtered: flags.filtered,
    variants: flags.variants,
    ...(atlas.failed ? { atlas_failed: true } : {}),
  };
  if (!s.ok) {
    return { ...base, svc_n: null, recall_main: null, recall_at_20: null, recall_lane: null, recall_counts_30: null, svc_error: s.error.slice(0, 200) };
  }
  const r = s.r;
  const sMain = r.main.map(keyOf);
  const sLane = [...r.main, ...r.variants, ...r.extra].map(keyOf);
  const sCounts = (r.counts || []).map((c) => c.book_id);
  return {
    ...base,
    ...(typeof r.server_ms === 'number' ? { svc_server_ms: Math.round(r.server_ms) } : {}),
    svc_n: sMain.length,
    recall_main: atlas.failed ? null : recallOf(aMain, sMain),
    recall_at_20: atlas.failed ? null : recallOf(aMain, sMain, 20),
    recall_lane: atlas.failed ? null : recallOf(aLane, sLane),
    recall_counts_30: atlas.failed || !atlas.counts ? null : recallOf(aCounts, sCounts, 30),
  };
}

/** The live subset of `bookIds` — the route's join filter plus its hidden drop, unfiltered. */
export async function liveBookSet(db: Db, bookIds: string[]): Promise<Set<string>> {
  if (bookIds.length === 0) return new Set();
  const rows = await db.collection('books')
    .find({ id: { $in: bookIds }, visible: true, pages_count: { $gt: 0 }, hidden: { $ne: true } }, { projection: { _id: 0, id: 1 } })
    .maxTimeMS(5000)
    .toArray();
  return new Set(rows.map((b) => b.id as string));
}

// ---------------------------------------------------------------------------
// Serve: hydrate the service's rows into the page documents the lane returns
// ---------------------------------------------------------------------------

/** Lowercased words of a query or name list, for locating a hit in the hydrated text. */
function hitWords(words: string[]): string[] {
  return [...new Set(words.flatMap((w) => w.toLowerCase().split(/[^\p{L}\p{M}\p{N}'’]+/u)).filter((w) => w.length >= 2))];
}

/**
 * Atlas returns `searchHighlights`, which the route uses to choose the
 * translation or the OCR for the snippet and to centre it on the hit. The
 * service stores no text, so the same choice is made here from the hydrated
 * text: the first word found in the translation, else in the OCR. No word
 * found → no highlight, and the route's own fallback (translation, else OCR)
 * applies, as it does for an Atlas page without highlights.
 */
export function synthesizeHighlights(page: { translation?: { data?: string }; ocr?: { data?: string } }, words: string[]):
  Array<{ path: string; texts: Array<{ value: string; type: string }> }> | undefined {
  const ws = hitWords(words);
  for (const [path, text] of [['translation.data', page.translation?.data], ['ocr.data', page.ocr?.data]] as const) {
    if (!text) continue;
    const low = text.toLowerCase();
    const w = ws.find((x) => low.includes(x));
    if (w) {
      const i = low.indexOf(w);
      return [{ path, texts: [{ value: text.slice(i, i + w.length), type: 'hit' }] }];
    }
  }
  return undefined;
}

/**
 * The service's rows as the Atlas lane's page documents, in service order:
 * one `find` by page id (the `id` index), text and page number from Mongo.
 * A page gone since the last sync, renumbered to ≤ 0, retyped as non-content,
 * or moved to another book is dropped — the read-side check the delta relies
 * on (sync-delta.mjs). Throws on a Mongo error, so the caller falls back.
 */
export async function hydrateKeywordRows(db: Db, rows: KeywordServiceRow[], words: { query: string; variants?: string[] }): Promise<Document[]> {
  if (rows.length === 0) return [];
  const docs = await db.collection('pages')
    .find({ id: { $in: rows.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'translation.data': 1, 'ocr.data': 1 } })
    .maxTimeMS(5000)
    .toArray();
  const byId = new Map(docs.map((d) => [d.id as string, d]));
  const nonContent = new Set<string>(NON_CONTENT_PAGE_TYPES);
  const out: Document[] = [];
  for (const r of rows) {
    const d = byId.get(r.page_id);
    if (!d || d.book_id !== r.book_id || !(Number(d.page_number) > 0)) continue;
    if (nonContent.has(d.page_type as string)) continue;
    const hl = synthesizeHighlights(d as { translation?: { data?: string }; ocr?: { data?: string } }, r.src === 'variant' ? [...(words.variants || []), words.query] : [words.query]);
    out.push({ id: d.id, book_id: d.book_id, page_number: d.page_number, translation: d.translation, ocr: d.ocr, searchScore: r.score ?? 0, ...(hl ? { highlights: hl } : {}) });
  }
  return out;
}

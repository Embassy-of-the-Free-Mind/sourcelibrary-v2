/**
 * Hybrid search for the Librarian — fuses Atlas keyword, book-then-page
 * semantic, and global-page semantic via Reciprocal Rank Fusion.
 *
 * Eval (scripts/eval/librarian-search/): RRF beats single-path search on
 * P@1, P@5, MRR. Niche-passage R@5 nearly doubles (the Boehme case where
 * keyword finds "fountain spirits" verbatim while semantic whiffs because
 * the book embedding has no signal for that term). Verbatim-quote regresses
 * — semantic alone is better when the user types the book's distinctive
 * vocabulary — but the aggregate wins outweigh that case.
 *
 * Optional cross-encoder rerank: if COHERE_API_KEY or VOYAGE_API_KEY is set,
 * reranks the top candidates. No-op (skipped silently) when neither is set.
 */

import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { GLOBAL_SCOPE, tenantSearchScope, type SearchScope } from '@/lib/tenant-search-scope';
import {
  semanticBookSearch,
  semanticPageSearchScoped,
} from '@/lib/semantic-search';
import { conceptPageSearch } from '@/lib/search/concept-search';
import { diversify, type DiversityMode } from '@/lib/search/diversity';
import { buildBookSearchStage, buildPageSearchStage, PAGE_SEARCH_INDEX } from '@/lib/atlas-search';
import { expandNameQuery, expandPersonNames } from '@/lib/search/name-variants';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { authorSlug as toAuthorSlug } from '@/lib/slugify';
import { editionYear } from '@/lib/dedup';
import { resolveQuoteText } from '@/lib/quote-text';
import { isEnglishOriginalPage } from '@/lib/english-page-language';
import type { Page } from '@/lib/types';

// ── Types ────────────────────────────────────────────────────────────

export interface SearchPassage {
  book_id: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  page_number: number;
  text: string;
  score: number;
  source: string; // 'kw' | 'eo' | 'kwv' | 'btp' | 'gp' | 'gc' | 'rrf(...)' — for diagnostics + UI
  /**
   * Edition metadata, so a consumer can tell a 1591 original from a 1928
   * compendium quoting it. Without these the Librarian cited Manly P. Hall
   * and Waite as often as the sources they paraphrase (#4704).
   */
  year?: number;
  language?: string;
  /** `original` | `modern-translation` | `period-translation` (books.text_role). */
  textRole?: string;
  /**
   * True when `text` is the page's own untranslated text, in `language`: the
   * page has no English translation and was found by the original-text lane
   * (#5729). A consumer must not present it as an English rendering.
   */
  untranslated?: boolean;
  /** `books.tradition`, when the book carries one. */
  tradition?: string[];
}

export interface SearchBook {
  id: string;
  title: string;
  author?: string;
  /**
   * Resolvable slug for the author's page (`/author/<authorSlug>`). Prefers the
   * canonical thesaurus id (`books.author_id`); falls back to the slug of the
   * exact stored author name, which the `/author/[name]` route resolves via its
   * name→slug cache. Undefined only when the book has no author. The Librarian
   * MUST link authors with this — never by slugifying a name form it chose in
   * prose (Latinized/anglicized variants like "Robert Bellarmine" 404).
   */
  authorSlug?: string;
  year?: number;
  slug?: string;
}

export interface HybridSearchResult {
  passages: SearchPassage[];
  books: SearchBook[];
}

export interface HybridSearchOptions {
  /** Tenant scope. NULL/undefined = main-site (rows with tenant_id IS NULL). */
  tenantId?: string | null;
  /** Max passages to return (default 8). */
  limit?: number;
  /**
   * Nudge period editions (printed or written up to PERIOD_EDITION_YEAR) above
   * later compendia at equal relevance. Off by default so site search is
   * untouched; the Librarian turns it on. See applyPeriodEditionBoost.
   */
  preferPeriodEditions?: boolean;
  /** Max book-level results in `books` (default 5). */
  bookLimit?: number;
  /**
   * Optional collection slug to WEIGHT (not filter) results toward. When set,
   * the collection's own pages get extra weighted votes in the RRF merge, so
   * they dominate the top of the list while strong matches from the rest of the
   * library still surface. Soft bias — an unknown/empty slug is a no-op.
   */
  collection?: string | null;
  /**
   * How hard to lean toward `collection`. The collection-scoped lists contribute
   * `collectionWeight / (k + rank)` each in the RRF merge vs 1/(k+rank) for the
   * global lists. ~2 = strong lean but outsiders still break through; 1 = mild;
   * higher → closer to a hard filter. Default 2.
   */
  collectionWeight?: number;
  /**
   * Spread the passages across traditions (`tradition`) or authors
   * (`author`); `off` (the default) keeps the fused order. The Librarian
   * passes `defaultDiversity(query)`. Applied twice: to the global vector
   * lane's candidates, and to the fused list (#3514, #3895).
   */
  diversity?: DiversityMode;
}

// Atlas $in and the scoped page-vector scan both degrade on huge id lists, so
// cap how many of a collection's books we scope to. Larger collections
// contribute their most substantial books first (Mongo sorts by book_count);
// keyword recall across the rest still flows via the global keyword path, so
// nothing is hard-excluded — those pages just don't get the extra boost.
export const MAX_SCOPED_BOOKS = 400;

// ── Tenant visibility (Mongo book metadata enrichment) ───────────────

function tenantBookFilter(tenantId: string | null | undefined) {
  return {
    hidden: { $ne: true },
    // Match the reader gate (isHiddenBook → visible === false). The reader page
    // and content APIs 404 any book with visible:false (PR #2522), but ~1.1k
    // books drifted into visible:false while hidden stayed unset — so a
    // hidden-only filter surfaced them in the librarian and they 404'd on click
    // (Rainsford "Mytho-Hermetic Dictionary", etc.). Gate on visible too so the
    // librarian only returns books the reader will actually open. Narrow scope:
    // only explicit visible:false is excluded; null/missing stays public.
    visible: { $ne: false },
    // Main-site convention: tenantId null/undefined.
    // For specific tenants, equality.
    ...(tenantId
      ? { tenantId }
      : { tenantId: { $in: [null, undefined] } }),
  };
}

// ── Source 1: Atlas keyword (mirrors executeSearchCollection's stage) ─

interface RawHit {
  book_id: string;
  page_number: number;
  text: string;
  score: number;
  source: string;
  /** From the original-text lane: `text` is the page's own language. */
  untranslated?: boolean;
}

async function keywordSource(query: string, _opts: HybridSearchOptions): Promise<RawHit[]> {
  const db = await getDb();
  const searchStage = buildPageSearchStage(query);
  const rows = await db.collection('pages')
    .aggregate([
      searchStage,
      { $limit: 48 },
      { $project: { book_id: 1, page_number: 1, 'translation.data': 1, score: { $meta: 'searchScore' } } },
    ])
    .toArray();

  // Cap at 2 hits per book — keeps source-diversity in the merge.
  const perBook = new Map<string, number>();
  const out: RawHit[] = [];
  for (const r of rows) {
    const n = (perBook.get(r.book_id) || 0) + 1;
    if (n > 2) continue;
    perBook.set(r.book_id, n);
    const raw = r.translation?.data || '';
    out.push({
      book_id: r.book_id,
      page_number: r.page_number,
      text: raw.slice(0, 1200),
      score: r.score,
      source: 'kw',
    });
    if (out.length >= 20) break;
  }
  return out;
}

// ── Source 1a: keyword over English-original leaves (#5867) ──────────

/**
 * Pages whose printed text is English and that carry no translation: Birch's
 * *History of the Royal Society*, Pepys, Evelyn. Their reading text is the OCR.
 *
 * `keywordSource` cannot reach them for any name a translated book also prints.
 * It scores `translation.data` at 2× and `ocr.data` at 1×, so a translated page
 * matches twice (its translation and its OCR) and outscores an English
 * original, which can only match once. Measured 2026-10-07: "Kuffler" put 60
 * translated pages above Birch's Kuffler minutes (p.463, score 8.4 against a
 * top-48 floor of 13.4), so the Librarian never saw them. Here they compete
 * only with each other.
 *
 * The `mustNot` also admits untranslated FOREIGN pages; those are dropped by
 * `isEnglishOriginalPage`, the same test `resolveQuoteText` applies, so no hit
 * survives that the passage build would later throw away.
 */
async function englishOriginalSource(query: string): Promise<RawHit[]> {
  try {
    const isPhrase = /^".*"$/.test(query.trim());
    const q = isPhrase ? query.trim().slice(1, -1) : query;
    const db = await getDb();
    const rows = await db.collection('pages')
      .aggregate([
        {
          $search: {
            index: PAGE_SEARCH_INDEX,
            compound: {
              must: [isPhrase ? { phrase: { query: q, path: 'ocr.data' } } : { text: { query: q, path: 'ocr.data' } }],
              mustNot: [{ exists: { path: 'translation.data' } }],
              filter: [{ range: { path: 'page_number', gt: 0 } }],
            },
          },
        },
        { $limit: 48 },
        { $project: { book_id: 1, page_number: 1, 'ocr.data': 1, score: { $meta: 'searchScore' } } },
      ])
      .toArray();
    return selectEnglishOriginalHits(rows as EnglishOriginalRow[]);
  } catch {
    return [];
  }
}

interface EnglishOriginalRow {
  book_id: string;
  page_number: number;
  ocr?: { data?: string };
  score: number;
}

/** English-original leaves only, two per book, twenty in all — the kw lane's caps. */
export function selectEnglishOriginalHits(rows: EnglishOriginalRow[]): RawHit[] {
  const perBook = new Map<string, number>();
  const out: RawHit[] = [];
  for (const r of rows) {
    const ocr = r.ocr?.data || '';
    if (!isEnglishOriginalPage(ocr)) continue;
    const n = (perBook.get(r.book_id) || 0) + 1;
    if (n > 2) continue;
    perBook.set(r.book_id, n);
    out.push({ book_id: r.book_id, page_number: r.page_number, text: ocr.slice(0, 1200), score: r.score, source: 'eo' });
    if (out.length >= 20) break;
  }
  return out;
}

// ── Source 1b: keyword over the name's OTHER spellings (#5888) ───────

/**
 * Pages that print a person's name in a spelling the reader did not type — "Drebbel" as
 * Drebelius, Drebelii, Drebel. Translations keep the source's spelling, so these are the
 * period Latin and German pages the main keyword lane cannot reach.
 *
 * A lane of its own, not extra terms in `keywordSource`: that lane reads only its top 48, and
 * for any well-attested name those are all pages printing the typed spelling, so OR'd-in
 * variants would never be seen. Empty (and no query is run) when the query names no person.
 */
async function nameVariantSource(query: string): Promise<RawHit[]> {
  try {
    const { variants, topicWords } = await expandNameQuery(query);
    if (variants.length === 0) return [];
    const db = await getDb();
    const rows = await db.collection('pages')
      .aggregate([
        // "Paracelsus on the plague": a Paracelsi page must also be about the plague, or the
        // lane fills with pages that merely name him.
        buildPageSearchStage(query, undefined, { nameVariants: variants, requireNameVariant: true, requireWords: topicWords }),
        { $limit: 24 },
        { $project: { book_id: 1, page_number: 1, 'translation.data': 1, score: { $meta: 'searchScore' } } },
      ])
      .toArray();
    const perBook = new Map<string, number>();
    const out: RawHit[] = [];
    for (const r of rows) {
      const n = (perBook.get(r.book_id) || 0) + 1;
      if (n > 2) continue;
      perBook.set(r.book_id, n);
      out.push({
        book_id: r.book_id,
        page_number: r.page_number,
        text: (r.translation?.data || '').slice(0, 1200),
        score: r.score,
        source: 'kwv',
      });
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
}

function scopeFor(opts: HybridSearchOptions): Promise<SearchScope> | SearchScope {
  return opts.tenantId ? tenantSearchScope(opts.tenantId) : GLOBAL_SCOPE;
}

// ── Source 2: book-then-page (book discovery → page drill-down) ──────

async function bookThenPageSource(query: string, opts: HybridSearchOptions): Promise<RawHit[]> {
  // The vector lanes rank inside the caller's scope (#4330): a tenant id means
  // that tenant's book set, none means the whole index. The Mongo
  // book-metadata join below the RRF merge still applies `tenantBookFilter`,
  // so a stray page cannot survive into the final passages either way.
  try {
    const scope = await scopeFor(opts);
    const books = await semanticBookSearch(query, 12, { scope });
    if (books.length === 0) return [];
    const bookIds = books.map(b => b.book_id);
    const pages = await semanticPageSearchScoped(query, bookIds, 20);
    return pages.map(p => ({
      book_id: p.book_id,
      page_number: p.page_number,
      text: p.snippet,
      score: p.score,
      source: 'btp',
    }));
  } catch {
    return [];
  }
}

// ── Source 3: global page semantic ───────────────────────────────────

async function globalPageSource(query: string, opts: HybridSearchOptions): Promise<RawHit[]> {
  try {
    // English vectors, the original-text lane when it is on, spread by tradition
    // when the caller asked (src/lib/search/concept-search.ts).
    const { rows } = await conceptPageSearch(query, 20, {
      scope: await scopeFor(opts),
      maxPerBook: 2,
      diversity: opts.diversity ?? 'off',
    });
    return rows.map(p => ({
      book_id: p.book_id,
      page_number: p.page_number,
      text: p.snippet,
      score: p.score,
      source: p.text_lane === 'original' ? 'gpo' : 'gp',
      ...(p.text_lane === 'original' ? { untranslated: true } : {}),
    }));
  } catch {
    return [];
  }
}

// ── Source 3b: the concept-abstract lane (EXPERIMENTAL, #6173) ────────

/**
 * `off` unless LIBRARIAN_CONCEPT_LANE=on. The lane ranks pages by a
 * model-written abstract of their ideas (`page_concepts`); stage 1 holds 1,216
 * books, so with the flag on the Librarian leans toward those books on concept
 * questions. It is for judged runs, and a person switches it on.
 */
export function librarianConceptLaneEnabled(): boolean {
  return (process.env.LIBRARIAN_CONCEPT_LANE || '').trim().toLowerCase() === 'on';
}

async function conceptAbstractSource(query: string, opts: HybridSearchOptions): Promise<RawHit[]> {
  if (!librarianConceptLaneEnabled()) return [];
  try {
    const { rows } = await conceptPageSearch(query, 20, {
      scope: await scopeFor(opts),
      maxPerBook: 2,
      diversity: opts.diversity ?? 'off',
      abstractLane: true,
    });
    // `text` is the page's own text; the abstract never leaves the index.
    return rows.map(p => ({ book_id: p.book_id, page_number: p.page_number, text: p.snippet, score: p.score, source: 'gc' }));
  } catch {
    return [];
  }
}

// ── Collection-scoped sources (the weighting input) ──────────────────

/**
 * Resolve a collection slug to the book_ids we'll scope to (visibility/tenant
 * gated, capped at MAX_SCOPED_BOOKS, largest books first).
 */
async function collectionBookIds(slug: string, opts: HybridSearchOptions): Promise<string[]> {
  const db = await getDb();
  const rows = await db.collection('books')
    .find({ collections: slug, ...tenantBookFilter(opts.tenantId) })
    .project({ id: 1 })
    .sort({ book_count: -1, pages_count: -1 })
    .limit(MAX_SCOPED_BOOKS)
    .toArray();
  return rows.map(r => r.id).filter(Boolean);
}

/**
 * Run keyword + semantic search restricted to a collection's books. These two
 * ranked lists become extra, weighted inputs to the RRF merge — that's the
 * whole mechanism behind "lean toward this collection." Returns [] when the
 * collection is empty/unknown so the caller cleanly falls back to global only.
 */
async function collectionScopedSources(
  query: string,
  bookIds: string[],
): Promise<{ scopedKeyword: RawHit[]; scopedSemantic: RawHit[] }> {
  if (bookIds.length === 0) return { scopedKeyword: [], scopedSemantic: [] };
  const db = await getDb();
  const nameVariants = await expandPersonNames(query);

  const [kwRows, semRows] = await Promise.all([
    db.collection('pages')
      .aggregate([
        buildPageSearchStage(query, bookIds, { nameVariants }),
        { $limit: 24 },
        { $project: { book_id: 1, page_number: 1, 'translation.data': 1, score: { $meta: 'searchScore' } } },
      ])
      .toArray()
      .catch(() => [] as Record<string, unknown>[]),
    semanticPageSearchScoped(query, bookIds, 20).catch(() => []),
  ]);

  const scopedKeyword: RawHit[] = [];
  const perBook = new Map<string, number>();
  for (const r of kwRows as Array<{ book_id: string; page_number: number; translation?: { data?: string }; score: number }>) {
    const n = (perBook.get(r.book_id) || 0) + 1;
    if (n > 2) continue;
    perBook.set(r.book_id, n);
    scopedKeyword.push({
      book_id: r.book_id,
      page_number: r.page_number,
      text: (r.translation?.data || '').slice(0, 1200),
      score: r.score,
      source: 'cp_kw',
    });
  }

  const scopedSemantic: RawHit[] = semRows.map(p => ({
    book_id: p.book_id,
    page_number: p.page_number,
    text: p.snippet,
    score: p.score,
    source: 'cp_sem',
  }));

  return { scopedKeyword, scopedSemantic };
}

/**
 * RRF scores sit near 1/61 + 1/61 for a page both lanes found at rank 1 and
 * 1/61 for a page one lane found; 1.5 lets a one-lane source-language page
 * beat a one-lane English page a few ranks above it, never a two-lane one.
 */
const ORIGINAL_LANGUAGE_BOOST = 1.5;

/**
 * Passages ranked ONLY among `bookIds` — the filter is applied before ranking,
 * not after (#6077). The keyword and semantic lanes both take the id list as
 * part of the query, so a shelf with few translated books still returns its own
 * best pages instead of losing every slot to a larger shelf. Hidden and
 * tenant-foreign books are dropped at the metadata join, as in hybridSearch.
 *
 * Callers pass at most MAX_SCOPED_BOOKS ids (the lanes degrade beyond that).
 */
export async function scopedPassageSearch(
  query: string,
  bookIds: string[],
  opts: { limit?: number; maxPerBook?: number; tenantId?: string | null; preferOriginalLanguage?: boolean } = {},
): Promise<SearchPassage[]> {
  const limit = opts.limit ?? 3;
  const maxPerBook = opts.maxPerBook ?? 1;
  const ids = bookIds.slice(0, MAX_SCOPED_BOOKS);
  if (ids.length === 0) return [];

  const { scopedKeyword, scopedSemantic } = await collectionScopedSources(query, ids);
  let merged = rrfMerge([scopedKeyword, scopedSemantic]);

  const db = await getDb();
  const candidateIds = [...new Set(merged.map(h => h.book_id))];
  const bookDocs = candidateIds.length > 0
    ? await db.collection('books')
        .find({ id: { $in: candidateIds }, ...tenantBookFilter(opts.tenantId) })
        .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, text_role: 1 })
        .toArray()
    : [];
  const bookMap = new Map(bookDocs.map(b => [b.id, b]));

  // Ad fontes: on a shelf like Kabbalah the English studies (Blavatsky, Waite)
  // are translated in full and outrank the Hebrew sources they discuss. At
  // comparable relevance, hand over the source in its own language.
  if (opts.preferOriginalLanguage) {
    merged = merged
      .map(h => {
        const lang = bookMap.get(h.book_id)?.language;
        return typeof lang === 'string' && lang && !/^english$/i.test(lang) ? { ...h, score: h.score * ORIGINAL_LANGUAGE_BOOST } : h;
      })
      .sort((a, b) => b.score - a.score);
  }

  const pageTexts = await loadPassageTexts(merged.slice(0, Math.max(12, limit * 4)));
  merged = merged.map(h => ({ ...h, text: passageText(h, pageTexts) }));

  const perBook = new Map<string, number>();
  const passages: SearchPassage[] = [];
  for (const hit of merged) {
    const book = bookMap.get(hit.book_id);
    if (!book || !hit.text) continue;
    const n = (perBook.get(hit.book_id) || 0) + 1;
    if (n > maxPerBook) continue;
    perBook.set(hit.book_id, n);
    passages.push({
      book_id: hit.book_id,
      bookTitle: book.display_title || book.title || 'Unknown',
      bookAuthor: book.author || 'Unknown',
      bookSlug: book.slug,
      year: typeof book.year === 'number' ? book.year : undefined,
      language: typeof book.language === 'string' ? book.language : undefined,
      textRole: typeof book.text_role === 'string' ? book.text_role : undefined,
      page_number: hit.page_number,
      text: hit.text,
      score: hit.score,
      source: hit.source,
    });
    if (passages.length >= limit) break;
  }
  return passages;
}

// ── RRF merge ────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion (Cormack/Clarke/Buettcher 2009).
 * Each source contributes 1/(k + rank) per hit; scores summed across sources.
 * k=60 is the canonical default. Eval showed k=20 vs k=60 produce identical
 * rankings on the current golden set — stick with 60 for posterity.
 */
/**
 * RRF weight of the name-variant keyword list, against 1 for the other global lists (#5888).
 *
 * Just under 1 on purpose. At rank r a list contributes weight / (60 + r), so at 0.98 the best
 * variant page scores between another list's 2nd and 3rd hit: a page printing the spelling the
 * reader typed always beats the variant page of the same rank, and one uncorroborated variant
 * page still reaches a top-8. At 0.5 it scored below every other list's 20th hit, so a variant
 * page surfaced only when a semantic lane had found it anyway — which is not the gap.
 */
export const NAME_VARIANT_WEIGHT = 0.98;

/**
 * In the fused list a capped row is passed over only for a row within this
 * RRF score of it (diversity.ts `margin`). See the call in hybridSearch.
 */
export const RRF_DIVERSITY_MARGIN = 0.004;

/** A book printed or written in or before this year counts as a period edition. */
export const PERIOD_EDITION_YEAR = 1800;
/** Multiplier on the fused score of a period-edition hit. */
export const PERIOD_EDITION_BOOST = 1.25;

/**
 * Nudge period editions above later compendia at comparable relevance.
 *
 * Why: over 45 days, 35% of the Librarian's page citations landed on
 * 1850–1949 English compendia — Waite's Hermetic Museum and Hall's Secret
 * Teachings were the #2 and #3 most-cited books — while the originals they
 * paraphrase sat lower in the same result lists (#4704). Those books are dense
 * in the reader's keywords and in fluent English, so every lane ranks them
 * well; nothing in the fusion knew a 1928 handbook from a 1591 imprint.
 *
 * Mechanism: multiply the fused score of hits whose edition year is known and
 * ≤ PERIOD_EDITION_YEAR by PERIOD_EDITION_BOOST, then re-sort the head. A
 * nudge, not a filter — a compendium that is clearly the best hit stays
 * first, and a book with no known year is left alone. Only the top `head`
 * hits are considered, which is all the caller will read anyway.
 */
export function applyPeriodEditionBoost(
  hits: RawHit[],
  head: number,
  yearOf: (bookId: string) => number | null,
): RawHit[] {
  const top = hits.slice(0, head).map(h => {
    const year = yearOf(h.book_id);
    return year != null && year <= PERIOD_EDITION_YEAR
      ? { ...h, score: h.score * PERIOD_EDITION_BOOST }
      : h;
  });
  top.sort((a, b) => b.score - a.score);
  return [...top, ...hits.slice(head)];
}

function rrfMerge(rankedLists: RawHit[][], k = 60, weights?: number[]): RawHit[] {
  const scores = new Map<string, { hit: RawHit; score: number; sources: Set<string> }>();
  for (let li = 0; li < rankedLists.length; li++) {
    const list = rankedLists[li];
    const weight = weights?.[li] ?? 1;
    for (let i = 0; i < list.length; i++) {
      const hit = list[i];
      const key = `${hit.book_id}:${hit.page_number}`;
      const contribution = weight / (k + i + 1);
      const existing = scores.get(key);
      if (existing) {
        existing.score += contribution;
        existing.sources.add(hit.source);
        // Prefer the hit with longer text for downstream display
        if ((hit.text?.length || 0) > (existing.hit.text?.length || 0)) {
          existing.hit = hit;
        }
      } else {
        scores.set(key, { hit, score: contribution, sources: new Set([hit.source]) });
      }
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ hit, score, sources }) => ({
      ...hit,
      score,
      source: sources.size > 1 ? `rrf(${[...sources].join('+')})` : `rrf(${hit.source})`,
    }));
}

// ── Optional rerank ──────────────────────────────────────────────────

/**
 * Optional cross-encoder rerank. Activates only if COHERE_API_KEY or
 * VOYAGE_API_KEY is set. No-op silently otherwise. We pass query + snippet
 * text to the rerank API and reorder the top candidates by relevance score.
 *
 * Cost: ~$0.001 per query at typical rerank pricing. Latency: 100-200ms.
 *
 * Cohere rerank-3.5 returns indexed results with relevance_score in [0,1].
 * Voyage rerank-2 has the same shape.
 */
async function maybeRerank(query: string, hits: RawHit[]): Promise<RawHit[]> {
  const cohereKey = process.env.COHERE_API_KEY;
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!cohereKey && !voyageKey) return hits;
  if (hits.length < 2) return hits;

  const docs = hits.slice(0, 20).map(h => h.text.slice(0, 1500));

  try {
    if (cohereKey) {
      const res = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cohereKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'rerank-v3.5',
          query,
          documents: docs,
          top_n: docs.length,
        }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        const reranked: RawHit[] = [];
        for (const r of data.results || []) {
          const original = hits[r.index];
          if (!original) continue;
          reranked.push({ ...original, score: r.relevance_score, source: `rerank(${original.source})` });
        }
        // Append any hits beyond the top 20 we didn't rerank
        for (let i = 20; i < hits.length; i++) reranked.push(hits[i]);
        return reranked;
      }
    }
    if (voyageKey) {
      const res = await fetch('https://api.voyageai.com/v1/rerank', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${voyageKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'rerank-2',
          query,
          documents: docs,
          top_k: docs.length,
        }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        const reranked: RawHit[] = [];
        for (const r of data.data || []) {
          const original = hits[r.index];
          if (!original) continue;
          reranked.push({ ...original, score: r.relevance_score, source: `rerank(${original.source})` });
        }
        for (let i = 20; i < hits.length; i++) reranked.push(hits[i]);
        return reranked;
      }
    }
  } catch {
    // Rerank failed — fall through with original RRF order
  }
  return hits;
}

// ── Book-level Atlas search (for the books[] field) ──────────────────

async function findBooks(query: string, opts: HybridSearchOptions, limit: number): Promise<SearchBook[]> {
  const db = await getDb();
  const filter = tenantBookFilter(opts.tenantId);
  const stage = buildBookSearchStage(query, { hasTranslation: true }, { fuzzy: true });
  const rows = await db.collection('books')
    .aggregate([
      stage,
      { $match: filter },
      { $limit: limit },
      { $project: { id: 1, title: 1, display_title: 1, author: 1, author_id: 1, year: 1, slug: 1 } },
    ])
    .toArray();
  return rows.map(b => ({
    id: b.id,
    title: b.display_title || b.title,
    author: b.author,
    authorSlug: b.author ? (b.author_id || toAuthorSlug(b.author)) : undefined,
    year: b.year,
    slug: b.slug,
  }));
}

// ── Snippet cleanup (mirrors librarian.ts existing logic) ────────────

function stripAnnotations(text: string): string {
  // Editorial wrappers are dropped content-and-all by the canonical stripper —
  // the inline 4-tag copy this replaces missed <image-desc>/<warning>/… and
  // let AI plate descriptions into result snippets (#3820; same class as the
  // "mercury on page 89" misquote, Nirmal 2026-05-30). Remaining annotation
  // tags (note/term/margin/…) are unwrapped so no raw markup reaches the UI.
  return stripEditorialWrappers(
    text
      .replace(/\[\[[^\]]+\]\]/g, '')
      .replace(/^```(?:markdown)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, ''),
  )
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Public API ───────────────────────────────────────────────────────

const pageKey = (bookId: string, pageNumber: number) => `${bookId}:${pageNumber}`;

/**
 * The page text the Librarian should read for each hit, from Mongo (#5867).
 *
 * The semantic lanes carry `page_translations.translation`, which is EMPTY by
 * design whenever a page was embedded without a translation — every
 * English-original page (its OCR is the reading text) and any page embedded
 * before its translation landed (scripts/lib/page-embedding-text.mjs). The
 * vector still ranks, so the hit arrives with no words in it. It is also cut to
 * 300 chars. `resolveQuoteText` is the one place that decides what a page's
 * quotable English is, so use it rather than the lane's copy.
 */
async function loadPassageTexts(hits: RawHit[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (hits.length === 0) return out;
  try {
    const db = await getDb();
    const pages = await db.collection('pages')
      .find({ $or: hits.map(h => ({ book_id: h.book_id, page_number: h.page_number })) })
      .project({ book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 })
      .toArray();
    const untranslated = new Set(hits.filter(h => h.untranslated).map(h => pageKey(h.book_id, h.page_number)));
    for (const p of pages) {
      const resolved = resolveQuoteText(p as unknown as Page, p.book_id, 'en', { mark: false });
      if (resolved) out.set(pageKey(p.book_id, p.page_number), resolved.text);
      // No English on the page: an original-text hit reads its own OCR, whole,
      // so the passage window can find the query's sentence in it (#5729).
      else if (untranslated.has(pageKey(p.book_id, p.page_number)) && typeof p.ocr?.data === 'string') {
        out.set(pageKey(p.book_id, p.page_number), p.ocr.data);
      }
    }
  } catch {
    // Fall back to the lanes' own text — degraded, never broken.
  }
  return out;
}

const PASSAGE_CHARS = 1200;
const WINDOW_LEAD = 300;
const HEAD_CHARS = 60;
const WINDOW_STOPWORDS = new Set(['about', 'what', 'which', 'with', 'from', 'that', 'this', 'there', 'their', 'were', 'have', 'does', 'into', 'than', 'they', 'when', 'where', 'who', 'whom', 'whose']);

/**
 * The PASSAGE_CHARS of `text` that hold the most distinct query terms. A page
 * runs to 3,000+ characters and the matching sentence is often past the first
 * 1,200: Birch's Kuffler minutes start at character 1,928 of p.463, under a
 * running head that matches "Royal Society" — so the head of the page, and the
 * window at the first match, both omit the sentence the passage was found for.
 *
 * So a term counts 1/(times it occurs on the page): the word a page repeats is
 * what the page is about anyway, the word it prints once is what the reader
 * came for. Matches in the first HEAD_CHARS are the running head and do not
 * vote. Ties go to the earlier window; no match keeps the start of the page.
 */
export function passageWindow(text: string, query: string): string {
  if (text.length <= PASSAGE_CHARS) return text;
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(t => t.length >= 4 && !WINDOW_STOPWORDS.has(t)))];
  const lower = text.toLowerCase();
  const hits: { at: number; term: number }[] = [];
  const weight: number[] = [];
  terms.forEach((t, i) => {
    let n = 0;
    for (let at = lower.indexOf(t); at !== -1; at = lower.indexOf(t, at + t.length)) {
      n++;
      if (at >= HEAD_CHARS) hits.push({ at, term: i });
    }
    weight[i] = n ? 1 / n : 0;
  });
  let best = 0;
  let bestScore = 0;
  for (const h of hits.sort((a, b) => a.at - b.at)) {
    const start = Math.max(0, h.at - WINDOW_LEAD);
    const covered = new Set(hits.filter(x => x.at >= start && x.at < start + PASSAGE_CHARS - 20).map(x => x.term));
    const score = [...covered].reduce((sum, t) => sum + weight[t], 0);
    if (score > bestScore + 1e-9) { bestScore = score; best = start; }
  }
  if (best === 0) return text.slice(0, PASSAGE_CHARS);
  // Start on a word boundary, and say that the page began earlier.
  const space = text.indexOf(' ', best);
  const from = space !== -1 && space - best < 40 ? space + 1 : best;
  return '… ' + text.slice(from, from + PASSAGE_CHARS - 2);
}

/** Mongo text when it resolved, else the lane's own; cleaned and cut to the query's window. */
export function passageText(hit: Pick<RawHit, 'book_id' | 'page_number' | 'text'>, pageTexts: Map<string, string>, query = ''): string {
  const raw = pageTexts.get(pageKey(hit.book_id, hit.page_number)) || hit.text || '';
  return passageWindow(stripAnnotations(raw), query);
}

/**
 * Hybrid search. Fans out to keyword + book-then-page + global-page in
 * parallel, RRF-merges, optionally cross-encoder reranks, and resolves
 * book metadata from Mongo for display.
 *
 * The Librarian's `search` tool calls this. Other callers (eval, future
 * /api/search consumers) can use it directly.
 */
export async function hybridSearch(
  query: string,
  opts: HybridSearchOptions = {},
): Promise<HybridSearchResult> {
  const limit = opts.limit ?? 8;
  const bookLimit = opts.bookLimit ?? 5;
  const collectionWeight = opts.collectionWeight ?? 2;

  // If a collection is requested, resolve its books up front so the scoped
  // searches can run alongside the global ones.
  const scopedIds = opts.collection
    ? await collectionBookIds(opts.collection, opts)
    : [];

  // Fan out to the global page sources + book-level Atlas + (optionally) the
  // collection-scoped sources, all in parallel.
  const [kw, eo, kwv, btp, gp, gc, books, scoped] = await Promise.all([
    keywordSource(query, opts),
    englishOriginalSource(query),
    nameVariantSource(query),
    bookThenPageSource(query, opts),
    globalPageSource(query, opts),
    conceptAbstractSource(query, opts),
    findBooks(query, opts, bookLimit),
    scopedIds.length > 0
      ? collectionScopedSources(query, scopedIds)
      : Promise.resolve({ scopedKeyword: [] as RawHit[], scopedSemantic: [] as RawHit[] }),
  ]);

  // RRF merge. Global lists weight 1; the collection-scoped lists weight
  // `collectionWeight` (~2) so a page that's both relevant AND in the
  // collection outranks an equally-relevant page from elsewhere — without
  // excluding the elsewhere page. Collection hits also tend to appear in the
  // global lists too, compounding the lean.
  // The name-variant list votes just under 1 (see NAME_VARIANT_WEIGHT).
  let merged = rrfMerge(
    [kw, eo, kwv, btp, gp, gc, scoped.scopedKeyword, scoped.scopedSemantic],
    60,
    [1, 1, NAME_VARIANT_WEIGHT, 1, 1, 1, collectionWeight, collectionWeight],
  );

  // Real page text for the head of the list BEFORE the rerank reads it — an
  // English-original page would otherwise be scored on an empty string (#5867).
  // The window covers the rerank's top 20 and the passage build's limit * 3.
  const pageTexts = await loadPassageTexts(merged.slice(0, Math.max(20, limit * 3)));
  merged = merged.map(h => ({ ...h, text: passageText(h, pageTexts, query) }));

  // Optional cross-encoder rerank (no-op without API key)
  merged = await maybeRerank(query, merged);

  // Resolve book metadata for the top passages (slug + display title). Three
  // pages' worth, not two, so the period-edition boost below has candidates
  // from just below the cut to promote.
  const passageBookIds = [...new Set(merged.slice(0, limit * 3).map(h => h.book_id))];
  const db = await getDb();
  const bookDocs = passageBookIds.length > 0
    ? await db.collection('books')
        .find({ id: { $in: passageBookIds }, ...tenantBookFilter(opts.tenantId) })
        .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, text_role: 1, tradition: 1, work_id: 1, author_id: 1 })
        .toArray()
    : [];
  const bookMap = new Map(bookDocs.map(b => [b.id, b]));

  if (opts.preferPeriodEditions) {
    merged = applyPeriodEditionBoost(merged, limit * 3, id => {
      const b = bookMap.get(id);
      return b ? editionYear(b as { year?: number | null; published?: string | null }) : null;
    });
  }

  // Spread the head of the fused list across traditions and works (#3514,
  // #3895). Only rows whose book resolved take part, so a hidden book cannot
  // use up a tradition's places; the rest keep their order behind them.
  if (opts.diversity && opts.diversity !== 'off') {
    const head = merged.slice(0, limit * 3).filter(h => bookMap.has(h.book_id) && h.text);
    const facets = new Map(bookDocs.map(b => [b.id as string, {
      tradition: Array.isArray(b.tradition) ? b.tradition as string[] : null,
      work_id: (b.work_id as string) || null,
      author_id: (b.author_id as string) || null,
      author: (b.author as string) || null,
    }]));
    merged = [
      ...diversify(head, {
        mode: opts.diversity,
        bookId: h => h.book_id,
        facets,
        window: limit,
        // A fused score, not a cosine: one lane's best vote is 1/61. A row two
        // lanes agree on stands ~0.014 clear of any single-lane row, and is
        // never passed over for one.
        score: h => h.score,
        margin: RRF_DIVERSITY_MARGIN,
      }),
      ...merged.slice(limit * 3),
    ];
  }

  // Build final passage list — drop any hit whose book is hidden / wrong tenant
  const passages: SearchPassage[] = [];
  for (const hit of merged) {
    const book = bookMap.get(hit.book_id);
    if (!book) continue; // tenant-foreign or hidden
    const text = hit.text;
    if (!text) continue; // nothing quotable on the page — an empty passage only misleads the model
    passages.push({
      book_id: hit.book_id,
      bookTitle: book.display_title || book.title || 'Unknown',
      bookAuthor: book.author || 'Unknown',
      bookSlug: book.slug,
      year: typeof book.year === 'number' ? book.year : undefined,
      language: typeof book.language === 'string' ? book.language : undefined,
      textRole: typeof book.text_role === 'string' ? book.text_role : undefined,
      ...(hit.untranslated ? { untranslated: true } : {}),
      ...(Array.isArray(book.tradition) && book.tradition.length ? { tradition: book.tradition as string[] } : {}),
      page_number: hit.page_number,
      text,
      score: hit.score,
      source: hit.source,
    });
    if (passages.length >= limit) break;
  }

  return { passages, books };
}

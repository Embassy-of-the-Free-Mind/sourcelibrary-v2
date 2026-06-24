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
import {
  semanticBookSearch,
  semanticPageSearchScoped,
  semanticPageSearchGlobal,
} from '@/lib/semantic-search';
import { buildBookSearchStage, buildPageSearchStage } from '@/lib/atlas-search';

// ── Types ────────────────────────────────────────────────────────────

export interface SearchPassage {
  book_id: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  page_number: number;
  text: string;
  score: number;
  source: string; // 'kw' | 'btp' | 'gp' | 'rrf(...)' — for diagnostics + UI
}

export interface SearchBook {
  id: string;
  title: string;
  author?: string;
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
  /** Max book-level results in `books` (default 5). */
  bookLimit?: number;
}

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

// ── Source 2: book-then-page (book discovery → page drill-down) ──────

async function bookThenPageSource(query: string, opts: HybridSearchOptions): Promise<RawHit[]> {
  // semanticBookSearch on main typed as tenantId?: string; PR C extends to
  // accept null. Until C lands, convert null → undefined at the boundary.
  // semanticPageSearchScoped on main doesn't accept tenant opts — drop it.
  // Tenant scoping still happens via the Mongo book-metadata join below the
  // RRF merge, so a stray tenant page can't survive into the final passages.
  const tenantId = opts.tenantId ?? undefined;
  try {
    const books = await semanticBookSearch(query, 12, { tenantId });
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
  // semanticPageSearchGlobal accepts tenantId in its opts already (main).
  // Convert null → undefined for type compat; the RPC still defaults to NULL.
  const tenantId = opts.tenantId ?? undefined;
  try {
    const pages = await semanticPageSearchGlobal(query, 20, { tenantId, maxPerBook: 2 });
    return pages.map(p => ({
      book_id: p.book_id,
      page_number: p.page_number,
      text: p.snippet,
      score: p.score,
      source: 'gp',
    }));
  } catch {
    return [];
  }
}

// ── RRF merge ────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion (Cormack/Clarke/Buettcher 2009).
 * Each source contributes 1/(k + rank) per hit; scores summed across sources.
 * k=60 is the canonical default. Eval showed k=20 vs k=60 produce identical
 * rankings on the current golden set — stick with 60 for posterity.
 */
function rrfMerge(rankedLists: RawHit[][], k = 60): RawHit[] {
  const scores = new Map<string, { hit: RawHit; score: number; sources: Set<string> }>();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const hit = list[i];
      const key = `${hit.book_id}:${hit.page_number}`;
      const contribution = 1 / (k + i + 1);
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
      { $project: { id: 1, title: 1, display_title: 1, author: 1, year: 1, slug: 1 } },
    ])
    .toArray();
  return rows.map(b => ({
    id: b.id,
    title: b.display_title || b.title,
    author: b.author,
    year: b.year,
    slug: b.slug,
  }));
}

// ── Snippet cleanup (mirrors librarian.ts existing logic) ────────────

function stripAnnotations(text: string): string {
  return text
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/^```(?:markdown)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    // Drop editorial page-level wrappers content-and-all (multiline, any of
    // meta/summary/keywords/vocab). These describe the page — often naming
    // content from neighbouring pages — and must never be quoted as source
    // text. Old regex (<meta>[^<]*</meta>) missed multiline + the other tags
    // and was the root of the "mercury on page 89" misquote (Nirmal, 2026-05-30).
    .replace(/<(meta|summary|keywords|vocab)>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Public API ───────────────────────────────────────────────────────

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

  // Fan out to all three sources + book-level Atlas in parallel
  const [kw, btp, gp, books] = await Promise.all([
    keywordSource(query, opts),
    bookThenPageSource(query, opts),
    globalPageSource(query, opts),
    findBooks(query, opts, bookLimit),
  ]);

  // RRF merge passages
  let merged = rrfMerge([kw, btp, gp]);

  // Optional cross-encoder rerank (no-op without API key)
  merged = await maybeRerank(query, merged);

  // Resolve book metadata for the top passages (slug + display title)
  const passageBookIds = [...new Set(merged.slice(0, limit * 2).map(h => h.book_id))];
  const db = await getDb();
  const bookDocs = passageBookIds.length > 0
    ? await db.collection('books')
        .find({ id: { $in: passageBookIds }, ...tenantBookFilter(opts.tenantId) })
        .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1 })
        .toArray()
    : [];
  const bookMap = new Map(bookDocs.map(b => [b.id, b]));

  // Build final passage list — drop any hit whose book is hidden / wrong tenant
  const passages: SearchPassage[] = [];
  for (const hit of merged) {
    const book = bookMap.get(hit.book_id);
    if (!book) continue; // tenant-foreign or hidden
    passages.push({
      book_id: hit.book_id,
      bookTitle: book.display_title || book.title || 'Unknown',
      bookAuthor: book.author || 'Unknown',
      bookSlug: book.slug,
      page_number: hit.page_number,
      text: stripAnnotations(hit.text || '').slice(0, 1200),
      score: hit.score,
      source: hit.source,
    });
    if (passages.length >= limit) break;
  }

  return { passages, books };
}

/**
 * Search variants under test.
 *
 * Each variant is `async (query, ctx) => SearchHit[]` where SearchHit is
 *   { book_id, book_slug, page_number, snippet, score, source }
 *
 * ctx holds shared clients (`db`, `supabase`, `embedFn`) so variants don't
 * each open their own connections.
 *
 * The Atlas $search stage shape and the Supabase RPC parameters are mirrored
 * from `src/lib/atlas-search.ts` and `src/lib/semantic-search.ts`. Keep in
 * sync if those change — the eval is meaningless if it tests something the
 * Librarian doesn't actually run.
 *
 * Tenant filtering: the Librarian post-filters to main-site only (tenantId
 * null/undefined). We do the same here so the eval reflects what main-site
 * users actually see.
 */

const BOOK_SEARCH_INDEX = 'books_search';
const PAGE_SEARCH_INDEX = 'pages_search';

// ── Atlas keyword search (mirrors executeSearchCollection) ────────────

function pageSearchStage(query) {
  return {
    $search: {
      index: PAGE_SEARCH_INDEX,
      compound: {
        should: [
          { text: { query, path: 'translation.data', score: { boost: { value: 2 } } } },
          { text: { query, path: 'ocr.data' } },
        ],
        minimumShouldMatch: 1,
      },
    },
  };
}

async function tenantVisibleBooks(db, bookIds) {
  if (bookIds.length === 0) return new Map();
  const docs = await db.collection('books')
    .find({
      id: { $in: bookIds },
      hidden: { $ne: true },
      tenantId: { $in: [null, undefined] },
    })
    .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1 })
    .toArray();
  return new Map(docs.map(d => [d.id, d]));
}

export async function keywordVariant(query, ctx, limit = 8) {
  const pages = await ctx.db.collection('pages')
    .aggregate([
      pageSearchStage(query),
      { $limit: 48 }, // over-fetch for tenant filtering
      { $project: { book_id: 1, page_number: 1, 'translation.data': 1, score: { $meta: 'searchScore' } } },
    ])
    .toArray();

  const bookIds = [...new Set(pages.map(p => p.book_id))];
  const bookMap = await tenantVisibleBooks(ctx.db, bookIds);

  // Cap at 2 hits per book to match the Librarian's behavior
  const perBook = new Map();
  const hits = [];
  for (const p of pages) {
    const book = bookMap.get(p.book_id);
    if (!book) continue;
    const count = perBook.get(p.book_id) || 0;
    if (count >= 2) continue;
    perBook.set(p.book_id, count + 1);
    hits.push({
      book_id: p.book_id,
      book_slug: book.slug,
      page_number: p.page_number,
      snippet: (p.translation?.data || '').slice(0, 200),
      score: p.score,
      source: 'keyword',
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

// ── Semantic two-step (mirrors executeSearchSemantic) ─────────────────

async function bookThenPage(query, ctx, limit = 8) {
  const embedding = await ctx.embedFn(query, 768);
  if (!embedding) return [];

  const { data: books, error: bookErr } = await ctx.supabase.rpc('match_books_semantic', {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.3,
    match_count: 24, // over-request for tenant filter
    filter_language: null,
    filter_year_min: null,
    filter_year_max: null,
  });
  if (bookErr || !books?.length) return [];

  const bookIds = books.map(b => b.book_id);
  const bookMap = await tenantVisibleBooks(ctx.db, bookIds);
  const visibleBookIds = bookIds.filter(id => bookMap.has(id));
  if (!visibleBookIds.length) return [];

  const { data: pages, error: pageErr } = await ctx.supabase.rpc('match_pages_in_books', {
    query_embedding: JSON.stringify(embedding),
    book_ids: visibleBookIds,
    match_threshold: 0.3,
    match_count: limit,
  });
  if (pageErr) return [];

  // Keep best page per book, ordered by book similarity
  const bestPageByBook = new Map();
  for (const p of (pages || [])) {
    const existing = bestPageByBook.get(p.book_id);
    if (!existing || p.similarity > existing.similarity) {
      bestPageByBook.set(p.book_id, p);
    }
  }

  return books
    .filter(b => bookMap.has(b.book_id))
    .slice(0, limit)
    .map(b => {
      const page = bestPageByBook.get(b.book_id);
      const book = bookMap.get(b.book_id);
      return {
        book_id: b.book_id,
        book_slug: book.slug,
        page_number: page?.page_number || 0,
        snippet: (page?.translation || b.summary_text || '').slice(0, 200),
        score: b.similarity,
        source: 'book-then-page',
      };
    });
}

export async function bookThenPageVariant(query, ctx, limit = 8) {
  return bookThenPage(query, ctx, limit);
}

// ── Global page-level semantic (the path the Librarian doesn't use) ───

async function globalPage(query, ctx, limit = 8) {
  const embedding = await ctx.embedFn(query, 768);
  if (!embedding) return [];

  const { data, error } = await ctx.supabase.rpc('match_semantic', {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.3,
    match_count: 24, // over-request for tenant filter + per-book cap
    filter_tenant_id: null,
    filter_language: null,
    filter_year_min: null,
    filter_year_max: null,
    filter_languages: null,
    filter_exclude_languages: null,
  });
  if (error || !data?.length) return [];

  const bookIds = [...new Set(data.map(r => r.book_id))];
  const bookMap = await tenantVisibleBooks(ctx.db, bookIds);

  // Cap at 2 per book like the keyword path
  const perBook = new Map();
  const hits = [];
  for (const r of data) {
    const book = bookMap.get(r.book_id);
    if (!book) continue;
    const count = perBook.get(r.book_id) || 0;
    if (count >= 2) continue;
    perBook.set(r.book_id, count + 1);
    hits.push({
      book_id: r.book_id,
      book_slug: book.slug,
      page_number: r.page_number,
      snippet: (r.translation || '').slice(0, 200),
      score: r.similarity,
      source: 'global-page',
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function globalPageVariant(query, ctx, limit = 8) {
  return globalPage(query, ctx, limit);
}

// ── Auto-fallback: book-then-page, fall back to global if weak ────────

export async function autoFallbackVariant(query, ctx, limit = 8) {
  const primary = await bookThenPage(query, ctx, limit);
  // "Weak" = 0 results OR top result similarity < 0.5
  const isWeak = primary.length === 0 || (primary[0].score ?? 0) < 0.5;
  if (!isWeak) return primary;

  const fallback = await globalPage(query, ctx, limit);
  if (primary.length === 0) return fallback;

  // Merge primary first, then fill with fallback hits not already represented
  const seen = new Set(primary.map(h => `${h.book_id}:${h.page_number}`));
  const merged = [...primary];
  for (const h of fallback) {
    const key = `${h.book_id}:${h.page_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...h, source: 'global-page (fallback)' });
    if (merged.length >= limit) break;
  }
  return merged;
}

// ── RRF merge: keyword + book-then-page + global-page ─────────────────

/**
 * Reciprocal Rank Fusion. Each source contributes 1/(k+rank) per hit;
 * scores summed across sources. k=60 is the canonical default from the
 * Cormack/Clarke/Buettcher 2009 paper; lower k weights top results more.
 */
function rrfMerge(rankedLists, k = 60, limit = 8) {
  const scores = new Map(); // key → {hit, score}
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const hit = list[i];
      const key = `${hit.book_id}:${hit.page_number}`;
      const contribution = 1 / (k + i + 1);
      const existing = scores.get(key);
      if (existing) {
        existing.score += contribution;
        // Prefer the hit with the longer snippet for downstream display
        if ((hit.snippet?.length || 0) > (existing.hit.snippet?.length || 0)) {
          existing.hit = { ...hit, source: `rrf(${existing.hit.source}+${hit.source})` };
        }
      } else {
        scores.set(key, { hit, score: contribution });
      }
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ hit, score }) => ({ ...hit, score, source: hit.source.startsWith('rrf') ? hit.source : `rrf(${hit.source})` }));
}

export async function rrfVariant(query, ctx, limit = 8) {
  // Over-fetch from each source so the merge has material to rank
  const [kw, btp, gp] = await Promise.all([
    keywordVariant(query, ctx, 20),
    bookThenPageVariant(query, ctx, 20),
    globalPageVariant(query, ctx, 20),
  ]);
  return rrfMerge([kw, btp, gp], 60, limit);
}

// ── Variant registry ──────────────────────────────────────────────────

export const VARIANTS = {
  'keyword': {
    description: 'Atlas keyword search only (current search_collection)',
    fn: keywordVariant,
  },
  'book-then-page': {
    description: 'Semantic book discovery → page drill-down (current search_semantic)',
    fn: bookThenPageVariant,
  },
  'global-page': {
    description: 'Global page-level semantic search (not currently used by Librarian)',
    fn: globalPageVariant,
  },
  'auto-fallback': {
    description: 'book-then-page; fall back to global-page if weak',
    fn: autoFallbackVariant,
  },
  'rrf': {
    description: 'Reciprocal Rank Fusion of keyword + book-then-page + global-page',
    fn: rrfVariant,
  },
};

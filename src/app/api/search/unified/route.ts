import { NextRequest, NextResponse } from 'next/server';
import { textRoleRank } from '@/lib/text-role';
import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import type { BookSearchFilters } from '@/lib/atlas-search';
import type { SearchResult } from '@/lib/api-client/types/search';
import { searchBooksCatalog } from '@/lib/books-catalog';
import { searchBookIds } from '@/lib/books-catalog';
import { semanticBookSearch, semanticArtworkSearch } from '@/lib/semantic-search';
import { filterVisibleArtworks } from '@/lib/artwork-visibility';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { anonSearchGate, SIGNIN_URL } from '@/lib/anon-gate';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { CLIP_URL } from '@/lib/clip';
import { getBookThumbnailUrl } from '@/lib/utils';
import { logSearchEvent } from '@/lib/search-event-log';
import { assessMatchQuality } from '@/lib/search/match-quality';
import { collapseByWork, type WorkGroupable } from '@/lib/search/work-grouping';
import { fetchWorkFanouts } from '@/lib/search/work-fanout';

const ENTITIES_SEARCH_INDEX = 'entities_search';
const GALLERY_SEARCH_INDEX = 'gallery_search';

/** Parse year from published field — handles 3-digit years (e.g. "895") and 4-digit */
function parsePublishedYear(published: string | undefined): number {
  if (!published) return 9999;
  const match = published.match(/\d{3,4}/);
  return match ? parseInt(match[0]) : 9999;
}

export const preferredRegion = 'fra1';

interface IndexResult {
  type: 'concept' | 'person' | 'place' | 'keyword';
  term: string;
  book_id: string;
  book_slug?: string;
  book_title: string;
  pages?: number[];
}

interface GalleryResult {
  id: string;
  imageUrl: string;
  description: string;
  type?: string;
  bookTitle: string;
  bookId: string;
}

interface CollectionResult {
  slug: string;
  tenant_slug?: string | null;
  name: string;
  description?: string;
  book_count: number;
  featured_image?: string;
  hero_image?: string;
}

/**
 * GET /api/search/unified
 *
 * Fast unified search across books, index, and gallery in ONE request.
 * Designed for typeahead — no page content search (that's the slow part).
 */
export async function GET(request: NextRequest) {
  const rl = checkRateLimit({ name: 'search', limit: 60, windowSeconds: 60 }, getClientIp(request));
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const tenantContext = getTenantContextFromRequest(request.headers);
    const query = searchParams.get('q') || '';

    // Anonymous visitors get 5 distinct searches/hour, then a sign-in prompt.
    // Counts distinct query strings (not raw requests) so typeahead and filter
    // refinement of one search don't burn the allowance. Signed-in users, SEO
    // crawlers, and internal warmers are exempt (see anon-gate.ts).
    const gate = await anonSearchGate(request, query);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error: 'You\'ve used your 5 free searches this hour. Sign in (free) to keep searching.',
          code: 'SIGNIN_REQUIRED',
          sign_in: SIGNIN_URL,
        },
        { status: 401, headers: gate.retryAfter ? { 'Retry-After': String(gate.retryAfter) } : {} },
      );
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '8'), 12);
    const galleryLimit = Math.min(parseInt(searchParams.get('gallery_limit') || '6'), 12);

    // Parse filters
    const language = searchParams.get('language') || undefined;
    const category = searchParams.get('category') || undefined;
    const firstTranslation = searchParams.get('first_translation') === 'true';
    const hasTranslation = searchParams.get('has_translation') === 'true';
    const library = searchParams.get('library') || undefined;
    // Publication-year range. The search page shows these inputs on every tab
    // (and the ngram viewer deep-links into /search with a ±5y window), so a
    // range that isn't honoured here reads as "filter set, results ignore it".
    const parseYear = (v: string | null): number | undefined => {
      const n = parseInt(v || '', 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const yearFrom = parseYear(searchParams.get('date_from'));
    const yearTo = parseYear(searchParams.get('date_to'));
    // Shared by every lane. Index/gallery/CLIP/artwork rows carry no year of
    // their own, but each is attributed to a book that does — so the range is
    // expressible everywhere, via a book-id gate or the denormalized book_year.
    const yearRange = (yearFrom !== undefined || yearTo !== undefined)
      ? { min: yearFrom, max: yearTo }
      : undefined;

    if (!query || query.length < 2) {
      return NextResponse.json({
        query: '',
        books: { results: [], total: 0 },
        index: { results: [], total: 0 },
        gallery: { results: [], total: 0 },
      });
    }

    if (tenantContext.slug && !tenantContext.id) {
      return NextResponse.json({
        query,
        books: { results: [], total: 0 },
        index: { results: [], total: 0 },
        gallery: { results: [], total: 0 },
        visual: { results: [], total: 0 },
      });
    }

    const db = await getDb();
    // Strip surrounding quotes for regex/semantic matching (phrase detection handled by each subsystem)
    const isPhrase = /^".*"$/.test(query.trim());
    const matchQuery = isPhrase ? query.trim().slice(1, -1) : query;
    const queryRegex = new RegExp(matchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // Build Atlas Search filters
    const searchFilters: BookSearchFilters = {};
    if (language) searchFilters.language = language;
    if (category) searchFilters.category = category;
    if (firstTranslation) searchFilters.isFirstTranslation = true;
    if (hasTranslation) searchFilters.hasTranslation = true;
    if (yearFrom !== undefined) searchFilters.yearFrom = yearFrom;
    if (yearTo !== undefined) searchFilters.yearTo = yearTo;
    if (tenantContext.id) searchFilters.tenantId = tenantContext.id;

    // Run book, index, gallery, and visual search in parallel.
    // Each operation gets a hard timeout — Atlas Search $search doesn't respect maxTimeMS,
    // and hung operations would block the entire response indefinitely.
    const withTimeout = <T>(promise: Promise<T>, fallback: T, label: string, ms = 8000): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => {
          console.warn(`[unified-search] ${label} timed out after ${ms}ms`);
          resolve(fallback);
        }, ms)),
      ]);

    const emptyBooks = {
      results: [] as SearchResult[], total: 0, hasMore: false,
      groups: [] as ReturnType<typeof collapseByWork<WorkGroupable>>['groups'],
      workKeyByBookId: new Map<string, string>(),
    };
    const emptyIndex = { results: [] as IndexResult[], total: 0, hasMore: false };
    const emptyGallery = { results: [] as GalleryResult[], total: 0 };

    interface SemanticBookResult {
      book_id: string;
      title: string;
      author: string | null;
      language: string | null;
      year: number | null;
      summary_snippet: string;
      relevance_hint: string;
      similarity: number;
    }
    const emptySemanticBooks = { results: [] as SemanticBookResult[], total: 0 };

    interface ArtworkSearchResult {
      book_id: string;
      title: string;
      display_title: string | null;
      author: string | null;
      thumbnail_url: string | null;
      genre: string | null;
      period: string | null;
      similarity: number;
      slug?: string | null;
    }
    const emptyArtworks = { results: [] as ArtworkSearchResult[], total: 0 };
    const emptyCollections = { results: [] as CollectionResult[] };

    const emptyLexicalArtworks: ArtworkSearchResult[] = [];

    const [booksResultRaw, indexResult, galleryResult, visualResult, semanticResultRaw, artworkResult, lexicalArtworkResult, collectionsResult] = await Promise.all([
      withTimeout(searchBooks(query, limit, searchFilters, library), emptyBooks, 'books'),
      // Skip index/entity search for quoted phrases — autocomplete returns loose single-word noise
      isPhrase ? Promise.resolve(emptyIndex) : withTimeout(
        searchIndex(db, matchQuery, limit, tenantContext.id || undefined, yearRange).catch((err) => {
          console.error('Index search error:', err);
          return emptyIndex;
        }),
        emptyIndex, 'index',
      ),
      withTimeout(searchGallery(db, matchQuery, queryRegex, galleryLimit, tenantContext.id || undefined, yearRange), emptyGallery, 'gallery'),
      withTimeout(searchVisual(db, matchQuery, galleryLimit, yearRange), emptyGallery, 'visual', 5000),
      // Semantic search: book-level discovery via book_embeddings (HNSW, ~17K rows)
      withTimeout(
        semanticBookSearch(matchQuery, 12, { tenantId: tenantContext.id || undefined })
          .then(books => {
            const results = books.map(b => {
              // Extract clean summary (strip metadata lines like "Topics:", "People:", etc.)
              const summaryText = b.summary_text || '';
              const lines = summaryText.split('\n');
              const cleanLines = lines.filter(l =>
                !l.startsWith('Topics:') && !l.startsWith('People:') &&
                !l.startsWith('Places:') && !l.startsWith('Concepts:') &&
                !l.startsWith('Categories:') && !l.startsWith('Chapters:') &&
                !l.startsWith('Language:') && !l.startsWith('Published:')
              );
              // Skip the title line (first line) — we already show title separately
              const snippet = cleanLines.slice(1).join(' ').trim().slice(0, 200);

              // Build relevance hint from metadata
              const meta = (b.metadata || {}) as Record<string, any>;
              const cats = (meta.categories || []) as string[];
              const hint = cats.slice(0, 3).join(', ');

              return {
                book_id: b.book_id,
                title: b.title,
                author: b.author,
                language: b.language,
                year: b.year,
                summary_snippet: snippet,
                relevance_hint: hint,
                similarity: b.similarity,
              };
            });
            return { results, total: results.length };
          })
          .catch(() => emptySemanticBooks),
        emptySemanticBooks, 'semantic', 6000,
      ),
      // Artwork semantic search: dedicated artwork_embeddings table (3072 dims)
      withTimeout(
        semanticArtworkSearch(matchQuery, 4)
          // Drop hidden artworks — these RPC rows are returned to the client
          // directly (title/thumbnail), not re-resolved against Mongo below.
          .then(raw => filterVisibleArtworks(db, raw, yearRange))
          .then(artworks => ({
            results: artworks.map(a => ({
              book_id: a.book_id,
              title: a.title,
              display_title: a.display_title,
              author: a.author,
              thumbnail_url: a.thumbnail_url,
              genre: a.genre,
              period: a.period,
              similarity: a.similarity,
            })),
            total: artworks.length,
          }))
          .catch(() => emptyArtworks),
        emptyArtworks, 'artworks', 6000,
      ),
      // Artwork lexical recall: exact title/author match on content_type:'artwork'
      // books. The semantic lane above only returns the nearest few by vector, so a
      // literal query ("tarot", "emblem", "ouroboros") under-returns — ~115 tarot
      // cards exist but vector search surfaced 4. This lane fuses in every artwork
      // that literally contains the term (#2735).
      withTimeout(
        lexicalArtworkSearch(db, queryRegex, 24, tenantContext.id || undefined, yearRange)
          .catch(() => emptyLexicalArtworks),
        emptyLexicalArtworks, 'artworks-lexical', 3000,
      ),
      // Collection search: match collection names/descriptions (~300 docs, fast)
      withTimeout(
        searchCollections(db, queryRegex, matchQuery).catch(() => emptyCollections),
        emptyCollections, 'collections', 2000,
      ),
    ]);

    // One lookup serves two jobs: tenant attribution (below) and work identity
    // for the semantic lane. `match_books_semantic` returns no work_id — that
    // is exactly why the copies the keyword lane collapses came back through
    // the semantic lane (#4300, Kircher's Musurgia: 1 keyword row, 4 more
    // semantic rows of the same work).
    const resultBookIds = booksResultRaw.results.map((b: any) => b.id).filter(Boolean);
    const semanticBookIds = semanticResultRaw.results.map(s => s.book_id).filter(Boolean);
    const identityLookupIds = [...new Set([...resultBookIds, ...semanticBookIds])];
    const resultBooks = identityLookupIds.length > 0
      ? await db.collection('books').find(
        { id: { $in: identityLookupIds } },
        { projection: { _id: 0, id: 1, tenantId: 1, work_id: 1, work_id_aliases: 1, duplicate_of: 1 }, maxTimeMS: 5000 }
      ).toArray()
      : [];
    const identityByBookId = new Map<string, WorkGroupable>(
      resultBooks.map((b: any) => [b.id as string, {
        book_id: b.id, work_id: b.work_id, work_id_aliases: b.work_id_aliases, duplicate_of: b.duplicate_of,
      }]),
    );
    const collectionTenantIds = collectionsResult.results.map((c: any) => c.tenantId).filter(Boolean);
    const tenantIds = [...new Set([
      ...resultBooks.map((book: any) => book.tenantId).filter(Boolean),
      ...collectionTenantIds,
    ])];
    const tenants = tenantIds.length > 0
      ? await db.collection('tenants').find(
        { id: { $in: tenantIds }, status: { $ne: 'deleted' } },
        { projection: { _id: 0, id: 1, slug: 1 }, maxTimeMS: 5000 }
      ).toArray()
      : [];
    const tenantSlugById = new Map(tenants.map((tenant: any) => [tenant.id, tenant.slug]));
    const tenantIdByBookId = new Map(resultBooks.map((book: any) => [book.id, book.tenantId]));

    // `groups` / `workKeyByBookId` are internal plumbing for the collapse — they
    // carry raw catalogue rows and must never reach the wire.
    const { groups: _bookGroups, workKeyByBookId: _bookWorkKeys, ...booksResultPublic } = booksResultRaw;
    const booksResult = {
      ...booksResultPublic,
      results: booksResultRaw.results.map((book: any) => ({
        ...book,
        tenant_slug: tenantIdByBookId.get(book.id)
          ? tenantSlugById.get(tenantIdByBookId.get(book.id)) || null
          : null,
      })),
    };

    const collectionsWithTenantSlug = {
      ...collectionsResult,
      results: collectionsResult.results.map((collection: any) => ({
        ...collection,
        tenant_slug: collection.tenantId ? tenantSlugById.get(collection.tenantId) || null : null,
      })),
    };

    // Dedup semantic results: remove books already in keyword results
    const keywordBookIds = new Set(booksResult.results.map((b: any) => b.id));
    // Semantic search has no year predicate (vector index) — post-filter it so
    // the semantic lane obeys the same range as the keyword lane. A book with an
    // unknown year is dropped only when a range is actually set.
    const inYearRange = (year: number | null | undefined) => {
      if (yearFrom === undefined && yearTo === undefined) return true;
      if (typeof year !== 'number') return false;
      if (yearFrom !== undefined && year < yearFrom) return false;
      if (yearTo !== undefined && year > yearTo) return false;
      return true;
    };
    // Work-grain dedup, not just book-id dedup (#4300). Two things to remove:
    // a semantic hit on a work the keyword lane already represents, and several
    // semantic hits on ONE work (four scans of Musurgia Universalis are one
    // work, not four conceptual matches). Rows with no work identity are left
    // alone — an unkeyed book is not shown to be a copy of anything.
    const keywordWorkKeys = new Set(booksResultRaw.workKeyByBookId.values());
    const semanticInRange = semanticResultRaw.results
      .filter(s => !keywordBookIds.has(s.book_id))
      .filter(s => inYearRange(s.year));
    const semanticCollapsed = collapseByWork(semanticInRange, {
      getIdentity: s => identityByBookId.get(s.book_id) ?? { book_id: s.book_id },
    });
    // Every row a collapse removed, by work key — from the keyword lane, from
    // inside the semantic lane, and from the cross-lane suppression below. It
    // has to be one tally: a work whose siblings were all removed by the
    // CROSS-lane rule would otherwise show no fan-out at all, which is the
    // silent-hide this issue exists to end.
    const collapsedByKey = new Map<string, number>();
    const addCollapsed = (key: string, n: number) =>
      collapsedByKey.set(key, (collapsedByKey.get(key) ?? 0) + n);
    for (const g of booksResultRaw.groups) addCollapsed(g.key, g.collapsed.length);
    for (const g of semanticCollapsed.groups) addCollapsed(g.key, g.collapsed.length);

    // Canonical (alias-resolved) key per surviving semantic row — read off the
    // collapse rather than recomputed, so the two lanes compare the same keys.
    const semanticKeyByBookId = new Map<string, string>();
    for (const [key, group] of semanticCollapsed.byKey) {
      const bid = (group.primary as { book_id?: string }).book_id;
      if (bid) semanticKeyByBookId.set(bid, key);
    }
    const dedupedSemantic = semanticCollapsed.results.filter(s => {
      const key = semanticKeyByBookId.get(s.book_id);
      if (key && keywordWorkKeys.has(key)) {
        addCollapsed(key, 1);
        return false;
      }
      return true;
    });
    const semanticResult = { results: dedupedSemantic.slice(0, 6), total: dedupedSemantic.length };

    // Apply similarity floor to visual/semantic/artwork lanes.
    // Without this, nonsense queries like "xyznonexistent" return random results
    // because embeddings always find *something* in the vector space.
    // Calibrated 2026-04-23: real queries score 0.67+, nonsense scores 0.57-0.63.
    // When keyword search returns nothing, lower the semantic floor to surface
    // conceptual matches as a fallback (e.g. "help" finds charity/assistance books).
    const hasKeywordResults = booksResultRaw.results.length > 0 || indexResult.results.length > 0;
    const VISUAL_SIM_FLOOR = 0.28;
    const SEMANTIC_SIM_FLOOR = hasKeywordResults ? 0.65 : 0.55;
    const ARTWORK_SIM_FLOOR = hasKeywordResults ? 0.65 : 0.55;

    // Filter visual results by tenant if needed
    let filteredVisualResults = visualResult.results.filter((r: any) => (r.similarity ?? 1) >= VISUAL_SIM_FLOOR);
    if (tenantContext.id && filteredVisualResults.length > 0) {
      const visualBookIds = [...new Set(filteredVisualResults.map((r: any) => r.bookId).filter(Boolean))];
      if (visualBookIds.length > 0) {
        const allowedBooks = await db.collection('books')
          .find({ id: { $in: visualBookIds }, tenantId: tenantContext.id }, { projection: { id: 1 } })
          .toArray();
        const allowedBookIds = new Set(allowedBooks.map((b: any) => b.id));
        filteredVisualResults = filteredVisualResults.filter((r: any) => allowedBookIds.has(r.bookId));
      } else {
        filteredVisualResults = [];
      }
    }
    const filteredVisual = { results: filteredVisualResults, total: filteredVisualResults.length };

    const filteredSemantic = {
      results: semanticResult.results.filter(r => r.similarity >= SEMANTIC_SIM_FLOOR),
      total: 0,
    };
    filteredSemantic.total = filteredSemantic.results.length;

    // Fuse lexical + semantic artwork recall. Exact title/author matches lead
    // (they literally contain the query — they always belong); semantic fills in
    // conceptually-near artworks above the similarity floor, deduped by book_id.
    const lexicalArtworkIds = new Set(lexicalArtworkResult.map(a => a.book_id));
    const semanticArtworksAboveFloor = artworkResult.results.filter(
      r => r.similarity >= ARTWORK_SIM_FLOOR && !lexicalArtworkIds.has(r.book_id),
    );
    const ARTWORK_RESULT_LIMIT = 24;
    const artworksAboveFloor = [...lexicalArtworkResult, ...semanticArtworksAboveFloor]
      .slice(0, ARTWORK_RESULT_LIMIT);
    // Enrich artworks with slugs from MongoDB (needed for /artwork/[slug] links)
    // AND filter out non-visible artworks. The artwork_embeddings table has no
    // visibility column, so hidden/invisible artworks can surface from the
    // vector lane and 404 on click. Re-check visible:true here and drop any
    // artwork the query doesn't return.
    let visibleArtworks = artworksAboveFloor;
    if (artworksAboveFloor.length > 0) {
      try {
        const artworkIds = artworksAboveFloor.map(a => a.book_id);
        const artworkDocs = await db.collection('books').find(
          { id: { $in: artworkIds }, visible: true },
          { projection: { id: 1, slug: 1 } }
        ).maxTimeMS(2000).toArray();
        const slugMap = new Map(artworkDocs.map(d => [d.id, d.slug]));
        for (const a of artworksAboveFloor) {
          (a as any).slug = slugMap.get(a.book_id) || null;
        }
        // Keep only artworks confirmed visible (present in slugMap).
        visibleArtworks = artworksAboveFloor.filter(a => slugMap.has(a.book_id));
      } catch { /* non-fatal — fall through with unfiltered list */ }
    }
    let filteredArtworks = {
      results: visibleArtworks,
      total: visibleArtworks.length,
    };

    // Defense-in-depth tenant filter. When a tenant header is present,
    // every book-keyed lane is filtered against the tenant's books in
    // MongoDB. The books lane in particular cannot filter at the source
    // (Supabase books_catalog has no tenant column — see tenant-browse.ts),
    // and other lanes have had subtle filter bugs in the past. One MongoDB
    // round-trip here is a robust safety net.
    let scopedBooks = booksResult;
    let scopedIndex = indexResult;
    let scopedGallery = galleryResult;
    let scopedSemantic = filteredSemantic;
    if (tenantContext.id) {
      const collectIds = [
        ...booksResult.results.map((r: any) => r.id),
        ...indexResult.results.map((r: any) => r.book_id),
        ...galleryResult.results.map((r: any) => r.bookId),
        ...filteredSemantic.results.map(r => r.book_id),
        ...filteredArtworks.results.map(r => r.book_id),
      ].filter(Boolean);
      const uniqueIds = [...new Set(collectIds)];
      let allowed: Set<string> = new Set();
      if (uniqueIds.length > 0) {
        const docs = await db.collection('books')
          .find(
            { id: { $in: uniqueIds }, tenantId: tenantContext.id },
            { projection: { _id: 0, id: 1 }, maxTimeMS: 3000 },
          )
          .toArray();
        allowed = new Set(docs.map((d: any) => d.id));
      }
      const keepById = <T extends Record<string, any>>(arr: T[], idField: string) =>
        arr.filter(r => allowed.has(r[idField]));
      scopedBooks = { ...booksResult, results: keepById(booksResult.results, 'id'), total: 0, hasMore: false };
      scopedBooks.total = scopedBooks.results.length;
      scopedIndex = { ...indexResult, results: keepById(indexResult.results, 'book_id'), total: 0, hasMore: false };
      scopedIndex.total = scopedIndex.results.length;
      scopedGallery = { ...galleryResult, results: keepById(galleryResult.results, 'bookId'), total: 0 };
      scopedGallery.total = scopedGallery.results.length;
      scopedSemantic = { ...filteredSemantic, results: keepById(filteredSemantic.results, 'book_id'), total: 0 };
      scopedSemantic.total = scopedSemantic.results.length;
      filteredArtworks = { results: keepById(filteredArtworks.results, 'book_id'), total: 0 };
      filteredArtworks.total = filteredArtworks.results.length;
    }

    // Fan-out for every row that replaced siblings: "N editions of this work →".
    // The count is the WORK PAGE's own count (fetchWorkFanouts calls the same
    // `workEditionsFilter` /work/[id] renders from), never the number of rows we
    // hid — a card must count what its target page shows. Suppressed entirely
    // under a tenant: an edition census across the global library is not a
    // partner reading room's claim to make (tenant-lockdown.md).
    const fanouts = await fetchWorkFanouts(db, collapsedByKey, {
      tenantScoped: !!tenantContext.id || !!tenantContext.slug || tenantContext.isEmbedded,
    });
    if (fanouts.size > 0) {
      scopedBooks = {
        ...scopedBooks,
        results: scopedBooks.results.map((r: any) => {
          const key = booksResultRaw.workKeyByBookId.get(r.id);
          const fanout = key ? fanouts.get(key) : undefined;
          return fanout ? { ...r, work_group: fanout } : r;
        }),
      };
      scopedSemantic = {
        ...scopedSemantic,
        results: scopedSemantic.results.map((r: any) => {
          const key = semanticKeyByBookId.get(r.book_id);
          const fanout = key ? fanouts.get(key) : undefined;
          return fanout ? { ...r, work_group: fanout } : r;
        }),
      };
    }

    // Log search query (fire-and-forget) — see src/lib/search-event-log.ts
    logSearchEvent({
      request, db, query, source: 'unified',
      resultsCount: scopedBooks.total + scopedIndex.total + scopedGallery.total + filteredVisual.total + scopedSemantic.total + filteredArtworks.total,
      tenantId: tenantContext.id || null,
      filters: { language, category, library },
    });

    // Honest-failure flag (#4281): lanes merge by rank, so a set of stray
    // token matches renders exactly like a real answer. If no result across
    // any lane contains ALL the query's tokens, say so instead of bluffing.
    const matchQuality = assessMatchQuality(query, [
      ...scopedBooks.results.map((r: any) => [r.title, r.display_title, r.author, r.summary].filter(Boolean).join(' ')),
      ...scopedIndex.results.map((r: any) => [r.term, r.book_title].filter(Boolean).join(' ')),
      ...scopedGallery.results.map((r: any) => [r.description, r.bookTitle].filter(Boolean).join(' ')),
      ...filteredVisual.results.map((r: any) => [r.description, r.bookTitle].filter(Boolean).join(' ')),
      ...scopedSemantic.results.map((r: any) => [r.title, r.author, r.summary_snippet].filter(Boolean).join(' ')),
      ...filteredArtworks.results.map((r: any) => [r.title, r.display_title, r.author].filter(Boolean).join(' ')),
      ...collectionsWithTenantSlug.results.map((r: any) => [r.name, r.description].filter(Boolean).join(' ')),
    ]);

    return NextResponse.json({
      query,
      match_quality: matchQuality,
      books: scopedBooks,
      index: scopedIndex,
      gallery: scopedGallery,
      visual: filteredVisual,
      semantic: scopedSemantic,
      artworks: filteredArtworks,
      collections: collectionsWithTenantSlug,
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Unified search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

async function searchBooks(
  query: string,
  limit: number,
  searchFilters: BookSearchFilters,
  library?: string,
) {
  // Single Supabase query — no MongoDB round-trip
  const books = await searchBooksCatalog(query, {
    limit: (limit + 1) * 2,
    language: searchFilters.language,
    category: searchFilters.category,
    firstTranslation: searchFilters.isFirstTranslation,
    hasTranslation: searchFilters.hasTranslation,
    library,
    yearMin: searchFilters.yearFrom,
    yearMax: searchFilters.yearTo,
  });

  // Canon-weighted reranking: older editions first, original language preferred
  const stripped = /^".*"$/.test(query.trim()) ? query.trim().slice(1, -1) : query;
  const queryLower = stripped.toLowerCase();
  books.sort((a: any, b: any) => {
    // 1. Title match (strongest signal)
    const aTitle = (a.display_title || a.title || '').toLowerCase();
    const bTitle = (b.display_title || b.title || '').toLowerCase();
    const aTitleMatch = aTitle.includes(queryLower);
    const bTitleMatch = bTitle.includes(queryLower);
    if (aTitleMatch !== bTitleMatch) return aTitleMatch ? -1 : 1;

    // 2. Closeness to the source (#2395): originals beat period translations
    // beat modern translations; language is the fallback for unclassified rows.
    const aRank = textRoleRank(a.text_role, a.language);
    const bRank = textRoleRank(b.text_role, b.language);
    if (aRank !== bRank) return aRank - bRank;

    // 3. Older editions rank higher (earlier = closer to source)
    const aYear = parsePublishedYear(a.published);
    const bYear = parsePublishedYear(b.published);
    if (aYear !== bYear) return aYear - bYear;

    // 4. Quality score tie-breaker
    return (b.quality_score || 0) - (a.quality_score || 0);
  });

  // Work-level collapse: one row per work, best-ranked edition representing it
  // (#4300). The sort above IS the keeper choice, so this must run after it and
  // must not reorder. `collapseByWork` also honours `duplicate_of` and folds
  // retired work_ids into their survivor — see src/lib/search/work-grouping.ts
  // for why `edition_key` is deliberately not a grouping key.
  const collapsed = collapseByWork(books as WorkGroupable[]);
  const deduped = collapsed.results as any[];

  const hasMore = deduped.length > limit;
  const truncated = hasMore ? deduped.slice(0, limit) : deduped;

  // The work key of every row we return, so the route can (a) hang the
  // "N editions of this work" fan-out on a row that replaced siblings and
  // (b) keep the semantic lane from re-introducing the same work as a
  // separate result.
  const shownIds = new Set(truncated.map((b: any) => b.id));
  const workKeyByBookId = new Map<string, string>();
  for (const [key, group] of collapsed.byKey) {
    const primaryId = (group.primary as any).id;
    if (primaryId && shownIds.has(primaryId)) workKeyByBookId.set(primaryId as string, key);
  }

  return {
    groups: collapsed.groups,
    workKeyByBookId,
    results: truncated.map((b: any): SearchResult => {
      const summaryText = b.summary_text;
      return {
        id: b.id,
        type: 'book',
        book_id: b.id,
        slug: b.slug,
        title: b.title,
        display_title: b.display_title,
        author: b.author || 'Unknown',
        language: b.language || 'Unknown',
        published: b.published || 'Unknown',
        page_count: b.pages_count,
        translated_count: b.pages_translated,
        has_doi: !!b.doi,
        doi: b.doi,
        categories: b.categories,
        summary: summaryText ? summaryText.slice(0, 300) : undefined,
        snippet_type: summaryText ? 'summary' : undefined,
        thumbnail: b.thumbnail,
        thumbnail_blob: b.thumbnail_blob,
        quality_score: b.quality_score,
        // For the client's cross-lane dedup — /search merges this lane with a
        // separately-fetched conceptual lane and can otherwise only compare
        // book ids (#4300).
        work_id: b.work_id || undefined,
      };
    }),
    total: truncated.length,
    hasMore,
  };
}

async function searchIndex(db: any, query: string, limit: number, tenantId?: string, yearRange?: { min?: number; max?: number }) {
  // Skip index search for very short queries — autocomplete + fuzzy on 1-2 chars is too loose
  if (query.length < 3) return { results: [] as IndexResult[], total: 0, hasMore: false };
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const queryRegex = new RegExp(escapedQuery, 'i');

  let entities;
  try {
    // Use Atlas Search with autocomplete + fuzzy, boost by book_count for popularity
    entities = await db.collection('entities').aggregate([
      {
        $search: {
          index: ENTITIES_SEARCH_INDEX,
          compound: {
            should: [
              { autocomplete: { query, path: 'name', score: { boost: { value: 3 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
              { autocomplete: { query, path: 'aliases', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
            ],
            minimumShouldMatch: 1,
            // Boost score by book_count so popular entities rank higher
            score: { boost: { path: 'book_count', undefined: 1 } },
          },
        },
      },
      { $limit: limit * 3 },
      { $project: { name: 1, type: 1, books: 1 } },
    ], { maxTimeMS: 7000 }).toArray();
  } catch {
    // Fallback to regex if Atlas Search index not ready
    entities = await db.collection('entities')
      .find({
        $or: [
          { name: queryRegex },
          { aliases: queryRegex },
        ],
      })
      .project({ name: 1, type: 1, books: 1 })
      .sort({ book_count: -1 })
      .limit(limit * 3)
      .maxTimeMS(7000)
      .toArray();
  }

  // Expand each entity into per-book results (matching the IndexResult shape).
  // An index hit is an entity→book pair: the entity carries no year, but the
  // book does, so the publication range rides the same book-id gate the tenant
  // scoping already uses — one lookup covers both.
  const yearMatch: Record<string, number> = {};
  if (yearRange?.min !== undefined) yearMatch.$gte = yearRange.min;
  if (yearRange?.max !== undefined) yearMatch.$lte = yearRange.max;
  const hasYearRange = Object.keys(yearMatch).length > 0;

  let allowedBookIds: Set<string> | null = null;
  if (tenantId || hasYearRange) {
    const entityBookIds = [...new Set(
      entities.flatMap((e: any) => (e.books || []).map((b: any) => b.book_id).filter(Boolean)),
    )];
    if (entityBookIds.length > 0) {
      const allowedBooks = await db.collection('books')
        .find({
          id: { $in: entityBookIds },
          ...(tenantId ? { tenantId } : {}),
          ...(hasYearRange ? { year: yearMatch } : {}),
        }, { projection: { id: 1 } })
        .toArray();
      allowedBookIds = new Set(allowedBooks.map((b: any) => b.id));
    } else {
      allowedBookIds = new Set();
    }
  }

  const results: IndexResult[] = [];
  for (const entity of entities) {
    for (const book of (entity.books || []).slice(0, 2)) { // top 2 books per entity
      if (allowedBookIds && !allowedBookIds.has(book.book_id)) {
        continue;
      }
      results.push({
        type: entity.type === 'person' ? 'person' : entity.type === 'place' ? 'place' : 'concept',
        term: entity.name,
        book_id: book.book_id,
        book_title: book.book_title || '',
        pages: book.pages?.slice(0, 10),
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  // Fallback: if entities returned nothing, check book keyword indexes
  // (covers multi-word phrases like "sky people" not synced to entities)
  if (results.length === 0 && query.length >= 4) {
    const books = await db.collection('books').find({
      'index.generatedAt': { $exists: true },
      visible: true,
      ...(tenantId ? { tenantId } : {}),
      ...(hasYearRange ? { year: yearMatch } : {}),
      $or: [
        { 'index.concepts.term': queryRegex },
        { 'index.people.term': queryRegex },
        { 'index.places.term': queryRegex },
        { 'index.keywords.term': queryRegex },
      ],
    }).project({
      id: 1, slug: 1, title: 1, display_title: 1,
      'index.concepts': 1, 'index.people': 1, 'index.places': 1, 'index.keywords': 1,
    }).limit(limit).maxTimeMS(7000).toArray();

    // Merge full index from dedicated collection
    const fallbackBookIds = books.map((b: any) => b.id || b._id?.toString()).filter(Boolean);
    if (fallbackBookIds.length > 0) {
      const indexDocs = await db.collection('book_indexes')
        .find({ book_id: { $in: fallbackBookIds } }, { projection: { _id: 0 }, maxTimeMS: 5000 })
        .toArray().catch(() => []);
      const indexMap = new Map(indexDocs.map((d: any) => [d.book_id, d]));
      for (const book of books) {
        const bookId = book.id || book._id?.toString();
        const indexDoc = indexMap.get(bookId);
        if (indexDoc) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { book_id: _, ...indexFields } = indexDoc as any;
          (book as any).index = { ...(book as any).index, ...indexFields };
        }
      }
    }

    for (const book of books) {
      const allEntries = [
        ...(book.index?.concepts || []).map((e: any) => ({ ...e, type: 'concept' as const })),
        ...(book.index?.people || []).map((e: any) => ({ ...e, type: 'person' as const })),
        ...(book.index?.places || []).map((e: any) => ({ ...e, type: 'place' as const })),
        ...(book.index?.keywords || []).map((e: any) => ({ ...e, type: 'keyword' as const })),
      ];
      const match = allEntries.find(e => queryRegex.test(e.term));
      if (match) {
        results.push({
          type: match.type,
          term: match.term,
          book_id: book.id,
          book_slug: book.slug,
          book_title: book.display_title || book.title || '',
          pages: match.pages?.slice(0, 10),
        });
      }
      if (results.length >= limit) break;
    }
  }

  return { results, total: results.length, hasMore: results.length >= limit };
}

async function searchGallery(db: any, query: string, queryRegex: RegExp, limit: number, tenantId?: string, yearRange?: { min?: number; max?: number }): Promise<{ results: GalleryResult[]; total: number }> {
  try {
    // gallery_images denormalizes the owning book's year (book_year, present on
    // ~83% of rows), so the range needs no join. It is NOT in the Atlas Search
    // index mapping, so it can't ride in the compound filter — it goes in a
    // $match placed BEFORE $limit so a narrow range doesn't starve the page.
    const yearMatch: Record<string, number> = {};
    if (yearRange?.min !== undefined) yearMatch.$gte = yearRange.min;
    if (yearRange?.max !== undefined) yearMatch.$lte = yearRange.max;
    const hasYearRange = Object.keys(yearMatch).length > 0;
    let images;
    try {
      // Use Atlas Search with autocomplete on description + fuzzy text on other fields
      images = await db.collection('gallery_images').aggregate([
        {
          $search: {
            index: GALLERY_SEARCH_INDEX,
            compound: {
              should: [
                { autocomplete: { query, path: 'description', score: { boost: { value: 3 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                { text: { query, path: 'museum_description', score: { boost: { value: 2 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                { text: { query, path: 'metadata.subjects', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                { text: { query, path: 'metadata.figures', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
              ],
              minimumShouldMatch: 1,
              filter: [
                { range: { path: 'gallery_quality', gte: 0.5 } },
                ...(tenantId ? [{ equals: { path: 'tenantId', value: tenantId } }] : []),
              ],
            },
          },
        },
        ...(hasYearRange ? [{ $match: { book_year: yearMatch } }] : []),
        { $limit: limit * 2 },
        { $project: { page_id: 1, detection_index: 1, description: 1, type: 1, thumbnail_url: 1, extracted_url: 1, book_id: 1, book_title: 1, gallery_quality: 1 } },
      ], { maxTimeMS: 5000 }).toArray();
    } catch {
      // Fallback to regex if Atlas Search index not ready
      images = await db.collection('gallery_images')
        .find(
          {
            ...(tenantId ? { tenantId } : {}),
            ...(hasYearRange ? { book_year: yearMatch } : {}),
            gallery_quality: { $gte: 0.5 },
            book_visible: { $ne: false },
            extracted_url: { $ne: null },
            $or: [
              { description: queryRegex },
              { museum_description: queryRegex },
              { 'metadata.subjects': queryRegex },
              { 'metadata.figures': queryRegex },
            ],
          },
          { projection: { page_id: 1, detection_index: 1, description: 1, type: 1, thumbnail_url: 1, extracted_url: 1, book_id: 1, book_title: 1, gallery_quality: 1 } }
        )
        .sort({ gallery_quality: -1 })
        .limit(limit)
        .maxTimeMS(3000)
        .toArray();
    }

    // Filter out images without any thumbnail/extracted URL (detection without extraction)
    const withImages = images.filter((img: any) => img.thumbnail_url || img.extracted_url);

    // Drop images from hidden/removed books (takedowns, dedup hides). The
    // Atlas Search branch can't filter on book_visible, and the gallery_images
    // mirror can drift — check books.visible in Mongo, same as the artwork lanes.
    const visibleImages = await filterVisibleArtworks(db, withImages as Array<{ book_id: string }>, yearRange);

    return {
      results: visibleImages.slice(0, limit).map((img: any) => ({
        id: `${img.page_id}-${img.detection_index}`,
        imageUrl: img.thumbnail_url || img.extracted_url || '',
        description: img.description || '',
        type: img.type,
        bookTitle: img.book_title || '',
        bookId: img.book_id || '',
      })),
      total: visibleImages.length,
    };
  } catch (err) {
    console.error('Gallery search error:', err);
    return { results: [], total: 0 };
  }
}

/**
 * CLIP visual search: encode text query via CLIP, search against image embeddings.
 * Finds images by what they look like, not just their metadata.
 */
async function searchVisual(db: any, query: string, limit: number, yearRange?: { min?: number; max?: number }): Promise<{ results: GalleryResult[]; total: number }> {
  try {
    // Encode text via CLIP text encoder
    const clipResp = await fetch(`${CLIP_URL}/embed-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query }),
      signal: AbortSignal.timeout(4000),
    });
    if (!clipResp.ok) return { results: [], total: 0 };
    const { embedding } = await clipResp.json();
    if (!embedding) return { results: [], total: 0 };

    // Search Supabase CLIP embeddings
    const { data, error } = await supabase.rpc('match_clip_text', {
      query_embedding: embedding,
      // 0.22 → 0.26 (#4338): below ~0.26 CLIP hands back plausible-looking
      // junk (unrelated instruments, screenshots) that the client blends into
      // the image grid as if it matched the query.
      match_threshold: 0.26,
      match_count: limit * 2,
    });
    if (error || !data) return { results: [], total: 0 };

    // Keep only gallery-image rows and strip the clip_embeddings id prefix.
    // The clip table mixes three id namespaces: `gallery-<pageId>-<n>`,
    // `artwork-<bookId>`, and `cover-<bookId>`. Consumers link these ids to
    // /gallery/image/<id>, which only resolves bare `<pageId>-<n>` — the raw
    // clip ids all 404 there. Artworks/covers already have their own lanes
    // (artwork semantic+lexical, book search), so dropping them loses nothing.
    // Deduplicate by book (max 2 per book).
    const byBook = new Map<string, number>();
    const matches = (data as Array<{
      id: string; source_type: string; book_id: string; image_url: string; thumbnail_url: string;
      title: string; author: string; resource_type: string; similarity: number;
    }>).filter(m => {
      if (m.source_type !== 'gallery_image') return false;
      const count = byBook.get(m.book_id) || 0;
      if (count >= 2) return false;
      byBook.set(m.book_id, count + 1);
      return true;
    });

    // clip_embeddings is a snapshot with no visibility column — drop rows whose
    // book is hidden/removed in Mongo (takedowns), same as the other image lanes.
    const deduped = (await filterVisibleArtworks(db, matches, yearRange)).slice(0, limit);

    return {
      results: deduped.map(m => ({
        id: m.id.replace(/^gallery-/, ''),
        imageUrl: m.thumbnail_url || m.image_url || '',
        description: m.title || '',
        type: m.resource_type || undefined,
        bookTitle: m.title || '',
        bookId: m.book_id || '',
        similarity: m.similarity,
      })),
      total: deduped.length,
    };
  } catch {
    return { results: [], total: 0 };
  }
}

/**
 * Lexical (term) recall for artworks — substring match on artwork title/author.
 *
 * The semantic artwork lane returns only the nearest few by vector, so a literal
 * query under-returns (e.g. "tarot" → 4, while ~115 `content_type:'artwork'`
 * records have "tarot" in the title). This surfaces every artwork whose title or
 * author literally contains the term, to be fused with the semantic results (#2735).
 */
async function lexicalArtworkSearch(
  db: any,
  queryRegex: RegExp,
  limit: number,
  tenantId?: string,
  yearRange?: { min?: number; max?: number },
): Promise<Array<{
  book_id: string;
  title: string;
  display_title: string | null;
  author: string | null;
  thumbnail_url: string | null;
  genre: string | null;
  period: string | null;
  similarity: number;
  slug?: string | null;
}>> {
  const docs = await db.collection('books').find(
    {
      content_type: 'artwork',
      visible: true,
      ...(tenantId ? { tenantId } : {}),
      ...(yearRange && (yearRange.min !== undefined || yearRange.max !== undefined)
        ? { year: { ...(yearRange.min !== undefined ? { $gte: yearRange.min } : {}), ...(yearRange.max !== undefined ? { $lte: yearRange.max } : {}) } }
        : {}),
      $or: [
        { display_title: queryRegex },
        { title: queryRegex },
        { author: queryRegex },
      ],
    },
    {
      projection: {
        _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1,
        genre: 1, period: 1, resource_type: 1,
        image_display: 1, image_thumb: 1, thumbnail: 1, thumbnail_blob: 1,
        quality_score: 1,
      },
    },
  )
    .sort({ quality_score: -1 })
    .limit(limit)
    .maxTimeMS(3000)
    .toArray();

  return docs.map((d: any) => ({
    book_id: d.id,
    title: d.title,
    display_title: d.display_title ?? null,
    author: d.author ?? null,
    thumbnail_url: getBookThumbnailUrl(d, 'thumb'),
    genre: d.genre ?? d.resource_type ?? null,
    period: d.period ?? null,
    // Exact term match — rank ahead of vector neighbours (which sit below 1.0).
    similarity: 1,
    slug: d.slug ?? null,
  }));
}

/**
 * Search collections by name/description.
 * ~300 docs, fast regex on a small collection.
 */
async function searchCollections(db: any, queryRegex: RegExp, query: string): Promise<{ results: CollectionResult[] }> {
  const cols = await db.collection('collections')
    .find({
      visible: { $ne: false },
      book_count: { $gt: 0 },
      $or: [
        { name: queryRegex },
        { description: queryRegex },
        { slug: queryRegex },
      ],
    })
    .project({ slug: 1, tenantId: 1, name: 1, description: 1, book_count: 1, featured_image: 1, featured_images: { $slice: 1 } })
    .sort({ book_count: -1 })
    .limit(3)
    .maxTimeMS(2000)
    .toArray();

  return {
    results: cols.map((c: any) => {
      const hero = c.featured_images?.[0];
      const heroUrl = hero?.extracted_url || hero?.thumbnail_url || hero?.image_url;
      return {
        slug: c.slug,
        tenantId: c.tenantId,
        name: c.name,
        description: c.description?.slice(0, 150),
        book_count: c.book_count,
        featured_image: c.featured_image,
        hero_image: heroUrl || undefined,
      };
    }),
  };
}

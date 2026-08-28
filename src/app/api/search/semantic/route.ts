import { NextRequest, NextResponse } from 'next/server';
import { semanticBookSearch, semanticPageSearchGlobal } from '@/lib/semantic-search';
import { searchBooksCatalog } from '@/lib/books-catalog';
import { getDb } from '@/lib/mongodb';
import { logSearchQuery } from '@/lib/search-log';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { collapseByWork, type WorkGroupable } from '@/lib/search/work-grouping';
import { fetchWorkFanouts } from '@/lib/search/work-fanout';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search/semantic?q=transmutation+of+metals&limit=20
 *
 * Semantic search via Supabase pgvector. Two modes:
 *  - level=book (default): book_embeddings HNSW (~17K vectors)
 *  - level=page:           page-level embeddings (~2.6M vectors) — for finding
 *                          specific passages by concept (e.g. "distributed
 *                          cognition" → active intellect, art of memory passages).
 *
 * Replaces the broken hybrid_search on 3M+ page_translations (issue #1158).
 *
 * Query params:
 *   q             — search query (required)
 *   level         — 'book' (default) or 'page'
 *   limit         — max results (default 20, max 50)
 *   language      — filter by language (book-level only)
 *   year_min      — filter by minimum year (book + page level)
 *   year_max      — filter by maximum year (book + page level)
 *   max_per_book  — page-level only: cap on passages from any single book
 */
export async function GET(request: NextRequest) {
  const _searchStart = Date.now();
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();
  const level = searchParams.get('level') === 'page' ? 'page' : 'book';
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
  const language = searchParams.get('language') || undefined;
  const languagesParam = searchParams.get('languages');
  const excludeLanguagesParam = searchParams.get('exclude_languages');
  const languages = languagesParam ? languagesParam.split(',').map(l => l.trim()).filter(Boolean) : undefined;
  const excludeLanguages = excludeLanguagesParam ? excludeLanguagesParam.split(',').map(l => l.trim()).filter(Boolean) : undefined;
  const yearMin = searchParams.get('year_min') ? parseInt(searchParams.get('year_min')!, 10) : undefined;
  const yearMax = searchParams.get('year_max') ? parseInt(searchParams.get('year_max')!, 10) : undefined;
  const maxPerBook = searchParams.get('max_per_book') ? parseInt(searchParams.get('max_per_book')!, 10) : undefined;
  // Which TEXT store to search (#4095) — `en` reads `page_translations`,
  // anything else reads the language-keyed `page_texts`. Page level only: book
  // summaries have one embedding, in English, so `level=book` cannot honour it
  // and says so rather than pretending.
  const langParam = (searchParams.get('lang') || '').trim().toLowerCase();
  const textLang = /^[a-z]{2,3}$/.test(langParam) ? langParam : 'en';

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [], query: '' });
  }

  // Strip surrounding quotes for semantic search (embedding doesn't need them)
  const searchQuery = /^".*"$/.test(query) ? query.slice(1, -1) : query;

  if (level === 'page') {
    try {
      const pages = await semanticPageSearchGlobal(searchQuery, limit, { language, languages, excludeLanguages, yearMin, yearMax, maxPerBook, textLang });
      const bookIds = [...new Set(pages.map(p => p.book_id))];
      let slugMap: Record<string, string> = {};
      // Books hidden from the public reader (visible:false OR hidden:true). Embeddings
      // live in Supabase and aren't pruned when a book is hidden, so we drop them here —
      // otherwise they surface in search and 404 on click (matches the reader gate
      // isBookReadable / isHiddenBook, PR #2522).
      //
      // DELETED books are the other half of the same failure and need the inverse
      // test: a book absent from Mongo is in neither the slug map nor the hidden
      // set, so a hidden-only filter passes it through and the click 404s (#4216
      // — two deleted books, still in book_embeddings, surfaced this way). Drop
      // anything Mongo doesn't return — but only when the Mongo lookup actually
      // ran, so a Mongo blip degrades to the old behaviour instead of zeroing
      // every search result.
      const hiddenBookIds = new Set<string>();
      const liveBookIds = new Set<string>();
      let mongoOk = false;
      if (bookIds.length > 0) {
        try {
          const db = await getDb();
          const books = await db.collection('books').find(
            { id: { $in: bookIds } },
            { projection: { id: 1, slug: 1, visible: 1, hidden: 1 } }
          ).toArray();
          for (const b of books) {
            if (b.id) liveBookIds.add(b.id as string);
            if (b.id && b.slug) slugMap[b.id as string] = b.slug as string;
            if (b.id && (b.hidden === true || b.visible === false)) hiddenBookIds.add(b.id as string);
          }
          mongoOk = true;
        } catch { /* slug enrichment is best-effort */ }
      }
      const enriched = pages
        .filter(p => !hiddenBookIds.has(p.book_id))
        .filter(p => !mongoOk || liveBookIds.has(p.book_id))
        .map(p => ({
          ...p,
          slug: slugMap[p.book_id] || null,
        }));
      logSearchQuery({
        request, route: 'search.semantic.page', query: query!,
        total: enriched.length, ms: Date.now() - _searchStart, ok: true,
        filters: { language, languages, exclude_languages: excludeLanguages, year_min: yearMin, year_max: yearMax, max_per_book: maxPerBook, lang: textLang },
      });
      return NextResponse.json({
        results: enriched,
        query,
        total: enriched.length,
        mode: 'semantic',
        level: 'page',
        // Which text store answered. Snippets are in THIS language.
        lang: textLang,
      }, {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
      });
    } catch (error) {
      console.error('[semantic-search] page-level error:', error);
      logSearchQuery({
        request, route: 'search.semantic.page', query: query!,
        ms: Date.now() - _searchStart, ok: false,
      });
      return NextResponse.json(
        { error: 'Search failed', results: [], query },
        { status: 500 }
      );
    }
  }

  try {
    const books = await semanticBookSearch(searchQuery, limit, {
      language,
      yearMin,
      yearMax,
    });

    // Enrich with thumbnail + slug from MongoDB
    const bookIds = books.map(b => b.book_id);
    let thumbnailMap: Record<string, { thumbnail?: string; thumbnail_blob?: string; slug?: string }> = {};
    // Books hidden from the public reader (visible:false OR hidden:true). Embeddings
    // live in Supabase and aren't pruned when a book is hidden, so we drop them here —
    // otherwise they surface in search and 404 on click (matches the reader gate
    // isBookReadable / isHiddenBook, PR #2522).
    //
    // DELETED books need the inverse test — absent from Mongo means absent from
    // the hidden set too, so they passed a hidden-only filter and 404'd on click
    // (#4216). Drop non-live ids, but only when the Mongo lookup succeeded.
    const hiddenBookIds = new Set<string>();
    const liveBookIds = new Set<string>();
    // Work identity for the collapse below (#4300). `match_books_semantic`
    // returns no work_id, which is why four scans of Kircher's Musurgia came
    // back as four "conceptual matches" while the keyword lane showed one.
    const identityByBookId = new Map<string, WorkGroupable>();
    let mongoOk = false;
    if (bookIds.length > 0) {
      try {
        const db = await getDb();
        const mongoBooks = await db.collection('books').find(
          { id: { $in: bookIds } },
          { projection: { id: 1, _id: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, slug: 1, visible: 1, hidden: 1, work_id: 1, work_id_aliases: 1, duplicate_of: 1 } }
        ).toArray();
        for (const mb of mongoBooks) {
          const bid = mb.id || mb._id?.toString();
          if (bid) liveBookIds.add(bid as string);
          if (bid) thumbnailMap[bid] = { thumbnail: mb.thumbnail, thumbnail_blob: mb.thumbnail_blob, slug: mb.slug };
          if (bid && (mb.hidden === true || mb.visible === false)) hiddenBookIds.add(bid);
          if (bid) identityByBookId.set(bid as string, {
            book_id: bid as string,
            work_id: mb.work_id as string | undefined,
            work_id_aliases: mb.work_id_aliases as string[] | undefined,
            duplicate_of: mb.duplicate_of as string | undefined,
          });
        }
        mongoOk = true;
      } catch (e) {
        // Non-fatal — results still work without thumbnails
      }
    }

    // Filter out low-similarity results that are effectively random matches.
    // Calibrated 2026-04-23: real queries score 0.67+, nonsense scores 0.57-0.63.
    // Use a relaxed floor (0.55) since this endpoint is called as a fallback —
    // the search page only shows these when keyword search returned nothing.
    const SEMANTIC_SIM_FLOOR = 0.55;
    const enriched = books
      .filter(b => b.similarity >= SEMANTIC_SIM_FLOOR)
      .filter(b => !hiddenBookIds.has(b.book_id))
      .filter(b => !mongoOk || liveBookIds.has(b.book_id))
      .map(b => ({
        ...b,
        thumbnail: thumbnailMap[b.book_id]?.thumbnail || null,
        thumbnail_blob: thumbnailMap[b.book_id]?.thumbnail_blob || null,
        slug: thumbnailMap[b.book_id]?.slug || b.book_id,
      }));

    // Lexical fallback for named-entity / single-token queries (#3141).
    // Pure vector search returns nothing for a bare surname, proper noun, or
    // title fragment ("hartmann", "Voynich", "fludd") — the embedding of a name
    // has no conceptual neighbours above the floor, so this endpoint reported 0
    // results despite us holding many editions (31 daily-agent "hartmann" hits,
    // all zero). When semantic recall is empty, fall back to lexical trigram
    // search on title/author/display_title so these queries surface the held
    // editions. searchBooksCatalog already gates on visible:true && pages_count>0,
    // so the hidden-book concern the semantic lane guards against doesn't apply.
    let results: typeof enriched = enriched;
    let mode: 'semantic' | 'lexical' = 'semantic';
    if (enriched.length === 0) {
      try {
        const lexical = await searchBooksCatalog(searchQuery, { limit, language });
        const filtered = lexical.filter(b => {
          const y = typeof b.year === 'number' ? b.year : undefined;
          if (yearMin !== undefined && (y === undefined || y < yearMin)) return false;
          if (yearMax !== undefined && (y === undefined || y > yearMax)) return false;
          return true;
        });
        if (filtered.length > 0) {
          mode = 'lexical';
          // books_catalog carries work_id — keep it for the collapse below.
          for (const b of filtered) {
            if (b.id) identityByBookId.set(b.id, { book_id: b.id, work_id: (b as any).work_id });
          }
          results = filtered.map(b => ({
            book_id: b.id,
            title: b.title,
            author: b.author,
            year: typeof b.year === 'number' ? b.year : null,
            language: b.language,
            summary_text: b.summary_text,
            metadata: undefined,
            // Exact lexical match on title/author — rank as high confidence so
            // callers that sort by similarity keep these at the top.
            similarity: 1,
            thumbnail: b.thumbnail || null,
            thumbnail_blob: b.thumbnail_blob || null,
            slug: b.slug || b.id,
          })) as unknown as typeof enriched;
        }
      } catch (e) {
        console.warn('[semantic-search] lexical fallback failed:', e instanceof Error ? e.message : String(e));
      }
    }

    // One row per work (#4300). This endpoint is what the /search page renders
    // as "conceptual matches", and it had no work-grain dedup at all: a query
    // for a much-scanned work spent its whole result window on copies of that
    // one work. The collapse keeps the best-ranked (highest-similarity) row —
    // `results` is already in rank order and collapseByWork never reorders.
    const collapsed = collapseByWork(results, {
      getIdentity: r => identityByBookId.get((r as { book_id: string }).book_id) ?? {},
    });
    // Carry the work id out to the client: /search merges this lane with the
    // separately-fetched keyword lane and can otherwise only compare book ids,
    // which lets one more edition of an already-represented work back onto the
    // first screen (#4300).
    let grouped: Array<Record<string, unknown>> = collapsed.results.map(r => {
      const workId = identityByBookId.get((r as { book_id: string }).book_id)?.work_id;
      return workId ? { ...r, work_id: workId } : { ...r };
    });
    if (collapsed.groups.length > 0) {
      const collapsedByKey = new Map(collapsed.groups.map(g => [g.key, g.collapsed.length]));
      try {
        const db = await getDb();
        const tenant = getTenantContextFromRequest(request.headers);
        const fanouts = await fetchWorkFanouts(db, collapsedByKey, {
          tenantScoped: !!tenant.id || !!tenant.slug || tenant.isEmbedded,
        });
        if (fanouts.size > 0) {
          const keyByBookId = new Map<string, string>();
          for (const [key, group] of collapsed.byKey) {
            const bid = (group.primary as { book_id?: string }).book_id;
            if (bid) keyByBookId.set(bid, key);
          }
          grouped = grouped.map(r => {
            const key = keyByBookId.get((r as { book_id: string }).book_id);
            const fanout = key ? fanouts.get(key) : undefined;
            return fanout ? { ...r, work_group: fanout } : r;
          });
        }
      } catch {
        // A missing count renders as a plain collapsed row — never a guess.
      }
    }

    logSearchQuery({
      request, route: 'search.semantic.book', query: query!,
      total: grouped.length, ms: Date.now() - _searchStart, ok: true,
      filters: { language, year_min: yearMin, year_max: yearMax, mode },
    });
    return NextResponse.json({
      results: grouped,
      query,
      total: grouped.length,
      mode,
      // Book-level embeddings are one per book, composed from the English
      // summary and index. There is no localized store to point `lang` at, so
      // say `en` plainly rather than echo a request we did not honour.
      lang: 'en',
      ...(textLang !== 'en' ? { lang_note: `Book-level semantic search has only English embeddings; use level=page for ${textLang} passages.` } : {}),
    }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('[semantic-search] Error:', error);
    logSearchQuery({
      request, route: 'search.semantic.book', query: query!,
      ms: Date.now() - _searchStart, ok: false,
    });
    return NextResponse.json(
      { error: 'Search failed', results: [], query },
      { status: 500 }
    );
  }
}

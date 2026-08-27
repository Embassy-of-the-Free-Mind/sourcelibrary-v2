import { NextResponse } from 'next/server';
import { browseBooks, getLanguageCounts, type SortOption } from '@/lib/books-catalog';
import { parseCatalogParams, BROWSE_SORTS } from '@/lib/catalog-query';
import { semanticBookSearch, getQueryEmbedding } from '@/lib/semantic-search';

export const maxDuration = 20;

/** Hits the librarian's semantic lane pulls before the SQL filters narrow them. */
const ASK_POOL = 200;

/**
 * GET /api/catalog/browse
 *
 * Server-side paginated catalog browse powered by Supabase books_catalog.
 *
 * Every filter name is read through `parseCatalogParams` — the same module the
 * client builds its query string with, so the two cannot drift
 * (`.claude/docs/invariants/search-filters-and-lanes.md`).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const f = parseCatalogParams(searchParams);
    const limit = Math.min(120, Math.max(1, parseInt(searchParams.get('limit') || '60', 10)));
    const offset = (f.page - 1) * limit;
    const includeLangs = searchParams.get('langs') === '1';

    const filters = {
      language: f.language || undefined,
      collection: f.collection || undefined,
      category: f.category || undefined,
      provider: f.provider || undefined,
      yearMin: f.yearMin ?? undefined,
      yearMax: f.yearMax ?? undefined,
      // The reader asked for first translations, so give them the ones that
      // ARE first translations on screen — badge gate, not the raw flag.
      firstTranslationPublished: f.firstTranslation || undefined,
      hasTranslation: f.hasTranslation || undefined,
      hasOcr: f.hasOcr || undefined,
      search: f.q || undefined,
    };

    // A sort the SQL lane can serve. `relevance` is meaningful only inside an
    // ask; asked for anywhere else it falls back to the default.
    const browseSort: SortOption = (BROWSE_SORTS as readonly string[]).includes(f.sort)
      ? (f.sort as SortOption)
      : 'popular';

    const langsPromise = includeLangs
      ? getLanguageCounts({ collection: f.collection || undefined })
      : Promise.resolve(null);

    // ── The librarian's lane ────────────────────────────────────────────────
    // A vector lane carries no metadata predicate, so its hits are handed to
    // browseBooks as an id set and filtered by exactly the same SQL as an
    // ordinary browse. Never merge them in unfiltered.
    if (f.ask) {
      let ids: string[] = [];
      let rank = new Map<string, number>();
      let laneDown = false;

      try {
        // Embed first, so an unreachable embedder is distinguishable from a
        // query with no neighbours. `semanticBookSearch` returns [] for both,
        // and rendering "no books match" over a corpus that was never queried
        // is a lie about the corpus, not a result.
        const embedding = await getQueryEmbedding(f.ask);
        if (!embedding) {
          laneDown = true;
        } else {
          const hits = await semanticBookSearch(f.ask, ASK_POOL, { threshold: 0.3, embedding });
          ids = hits.map((h) => h.book_id).filter(Boolean);
          rank = new Map(ids.map((id, i) => [id, i]));
        }
      } catch (err) {
        console.error('[catalog] semantic lane failed:', (err as Error)?.message || err);
        laneDown = true;
      }

      // Degrade to literal matching on the same words rather than to nothing,
      // and flag it so the page can say which question it actually answered.
      if (laneDown) {
        const { books, total } = await browseBooks({
          ...filters,
          search: filters.search || f.ask,
          sort: browseSort,
          limit,
          offset,
          exactCount: true,
        });
        return NextResponse.json(
          { books, total, askDegraded: true },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }

      if (!ids.length) {
        const languages = await langsPromise;
        return NextResponse.json(
          { books: [], total: 0, ...(languages ? { languages } : {}) },
          { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60' } },
        );
      }

      // The pool is bounded (≤200 ids), so pull the whole filtered set once and
      // page it in memory — that keeps the count exact and lets `relevance`
      // order by similarity, which no SQL sort can express.
      const { books } = await browseBooks({
        ...filters,
        ids,
        sort: browseSort,
        limit: ASK_POOL,
        offset: 0,
        exactCount: true,
      });

      const ordered = f.sort === 'relevance'
        ? [...books].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9))
        : books;

      const languages = await langsPromise;
      return NextResponse.json(
        {
          books: ordered.slice(offset, offset + limit),
          total: ordered.length,
          poolCapped: ids.length >= ASK_POOL,
          ...(languages ? { languages } : {}),
        },
        { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } },
      );
    }

    const [result, languages] = await Promise.all([
      browseBooks({ ...filters, sort: browseSort, offset, limit, exactCount: true }),
      langsPromise,
    ]);

    return NextResponse.json(
      { books: result.books, total: result.total, ...(languages ? { languages } : {}) },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } },
    );
  } catch (err) {
    console.error('Catalog browse error:', err);
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}

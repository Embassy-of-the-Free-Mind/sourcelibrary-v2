import { NextResponse } from 'next/server';
import { browseBooks, type SortOption } from '@/lib/books-catalog';
import { parseCatalogParams, BROWSE_SORTS } from '@/lib/catalog-query';
import { semanticBookSearch, getQueryEmbedding } from '@/lib/semantic-search';

export const maxDuration = 20;

/** Hits the librarian's semantic lane pulls before the SQL filters narrow them. */
const ASK_POOL = 200;

/**
 * Cosine floor, the same 0.3 every other semantic lane uses.
 *
 * Raising it to 0.45 was tried and reverted: measured against the preview it
 * returned the identical set for a real query (32 books) and for a keyboard
 * mash (30), so the floor is not what decides the nonsense case. What decides
 * it is whether the librarian could read the request at all, which is a
 * question /api/catalog/ask can answer and a cosine cannot — see `unreadable`
 * there. Don't re-tune this without a measurement that moves.
 */
const ASK_THRESHOLD = 0.3;

/**
 * GET /api/catalog/browse
 *
 * Server-side paginated library browse powered by Supabase books_catalog.
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

    const filters = {
      languages: f.languages.length ? f.languages : undefined,
      collections: f.collections.length ? f.collections : undefined,
      categories: f.categories.length ? f.categories : undefined,
      providers: f.providers.length ? f.providers : undefined,
      textRoles: f.textRoles.length ? f.textRoles : undefined,
      yearMin: f.yearMin ?? undefined,
      yearMax: f.yearMax ?? undefined,
      pagesMin: f.pagesMin ?? undefined,
      pagesMax: f.pagesMax ?? undefined,
      // The reader asked for first translations, so give them the ones that
      // ARE first translations on screen — badge gate, not the raw flag.
      firstTranslationPublished: f.firstTranslation || undefined,
      hasTranslation: f.hasTranslation || undefined,
      hasOcr: f.hasOcr || undefined,
      hasDoi: f.hasDoi || undefined,
      search: f.q || undefined,
    };

    // A sort the SQL lane can serve. `relevance` is meaningful only inside an
    // ask; asked for anywhere else it falls back to the default.
    const browseSort: SortOption = (BROWSE_SORTS as readonly string[]).includes(f.sort)
      ? (f.sort as SortOption)
      : 'popular';

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
          const hits = await semanticBookSearch(f.ask, ASK_POOL, { threshold: ASK_THRESHOLD, embedding });
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
        return NextResponse.json(
          { books: [], total: 0 },
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

      return NextResponse.json(
        {
          books: ordered.slice(offset, offset + limit),
          total: ordered.length,
          poolCapped: ids.length >= ASK_POOL,
        },
        { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } },
      );
    }

    const result = await browseBooks({ ...filters, sort: browseSort, offset, limit, exactCount: true });

    return NextResponse.json(
      { books: result.books, total: result.total },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } },
    );
  } catch (err) {
    console.error('Catalog browse error:', err);
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}

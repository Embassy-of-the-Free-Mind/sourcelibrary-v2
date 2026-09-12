import { NextRequest, NextResponse } from 'next/server';
import { fetchWorksIndex, type WorkSummary } from '@/lib/works-index';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/works
 *
 * The works index: texts we hold in several editions across several centuries
 * — the same set `/works` shows humans, via the same `fetchWorksIndex()`.
 *
 * Why this exists (#4509): `/api/books/library?work_id=` could always filter by
 * a work, but nothing could LIST works, so an API consumer had no way to obtain
 * a work_id except by fetching a book first. Same defect the author facet had.
 *
 * COST NOTE — read before changing. `fetchWorksIndex()` groups every visible
 * book by work_id: 1.4–3.0s measured, and its own docstring says it is safe
 * only because `/works` is ISR and never runs it per request
 * (request-path-queries.md). This route therefore serves from a module-level
 * cache with a long TTL, so the aggregation runs at most once per WORKS_TTL_MS
 * regardless of traffic, plus CDN caching on top. Do not remove the cache to
 * "simplify"; a per-request version of this query is exactly the shape that
 * route invariant forbids.
 *
 * Query params:
 *   sort   - span (default) | witnesses | earliest | title
 *   limit  - max works to return (default all; the index is ~400 entries)
 *   offset - pagination offset
 */

const WORKS_TTL_MS = 30 * 60_000;
let worksCache: { data: WorkSummary[]; builtAt: number } | null = null;

async function getWorks(): Promise<WorkSummary[]> {
  const now = Date.now();
  if (worksCache && now - worksCache.builtAt < WORKS_TTL_MS) return worksCache.data;
  const data = await fetchWorksIndex();
  worksCache = { data, builtAt: now };
  return data;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const sort = searchParams.get('sort') || 'span';
    const limitRaw = parseInt(searchParams.get('limit') || '', 10);
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

    const all = await getWorks();
    const sorted = [...all];
    switch (sort) {
      case 'witnesses': sorted.sort((a, b) => b.witnesses - a.witnesses); break;
      case 'earliest': sorted.sort((a, b) => a.earliest - b.earliest); break;
      case 'title': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
      case 'span':
      default: sorted.sort((a, b) => b.span - a.span); break;
    }

    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : sorted.length;
    const page = sorted.slice(offset, offset + limit);

    return NextResponse.json({
      total: sorted.length,
      offset,
      limit,
      works: page.map((w) => ({
        work_id: w.workId,
        slug: w.slug,
        title: w.title,
        author: w.author,
        // How many editions/manuscripts of this text we hold, and the window
        // they span — the two numbers the works page leads with.
        witnesses: w.witnesses,
        earliest: w.earliest,
        latest: w.latest,
        span: w.span,
        languages: w.languages,
        libraries: w.libraries,
        pages_total: w.totalPages,
        // Feed work_id straight back to /api/books/library?work_id= for the
        // witness list, or open the human page.
        url: `https://sourcelibrary.org/work/${w.slug}`,
        books_url: `https://sourcelibrary.org/api/books/library?work_id=${encodeURIComponent(w.workId)}`,
      })),
    }, {
      headers: { 'Cache-Control': 'public, max-age=1800, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('Error in /api/works:', error);
    return NextResponse.json({ error: 'Failed to list works' }, { status: 500 });
  }
}

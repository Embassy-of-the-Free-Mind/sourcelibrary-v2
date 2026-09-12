import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
// getPartnerByProvider, NOT a direct LIBRARY_PARTNERS[provider] lookup: the
// record is keyed by human slug ('internet-archive', 'bavarian-state-library')
// while image_source.provider carries the wire value ('internet_archive',
// 'mdz'). Indexing directly misses essentially every row and degrades silently
// to raw slugs — which would make this endpoint useless while looking correct.
import { getPartnerByProvider } from '@/lib/library-partners';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/libraries
 *
 * The contributing-library directory: which institutions' scans we hold, how
 * many books from each, and what those provider slugs actually NAME.
 *
 * Why this exists (#4509): `library=` has long been a filter VALUE on
 * /api/books/library and /api/search, but nothing enumerated the valid values —
 * while `/languages` has /api/languages and `/browse/subjects` has
 * /api/categories. A consumer could filter by a provider only by guessing its
 * slug. /api/books/distributions returns provider COUNTS; this route adds the
 * half that only existed on the human page: the partner's display name, URL,
 * and description, so `bsb` can be rendered as "Bavarian State Library (MDZ)".
 *
 * Counted in Mongo rather than paging Supabase like /libraries does — the page
 * walks every catalog row in 1,000-row batches, which this route does not need
 * and which is the supabase-cap trap besides.
 *
 * Query params:
 *   include_unpartnered - "true" to include providers with no partner record
 *                         (default true; set false for the curated set only)
 */

// Infrastructure buckets, not institutions — the /libraries page hides these
// and so must the API, or a consumer renders "iiif" as a library.
const EXCLUDE_PROVIDERS = new Set(['user_upload', 'other', 'library', 'iiif']);

const LIBRARIES_TTL_MS = 30 * 60_000;
const cache = new Map<string, { data: string; builtAt: number }>();

export async function GET(request: NextRequest) {
  try {
    const includeUnpartnered = request.nextUrl.searchParams.get('include_unpartnered') !== 'false';
    const cacheKey = String(includeUnpartnered);

    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.builtAt < LIBRARIES_TTL_MS) {
      return new NextResponse(hit.data, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800, stale-while-revalidate=86400' },
      });
    }

    const db = await getReadDb();
    const rows = await db.collection('books').aggregate<{ _id: string; count: number; languages: string[] }>([
      { $match: { visible: true, pages_count: { $gt: 0 }, 'image_source.provider': { $type: 'string', $ne: '' } } },
      { $group: { _id: '$image_source.provider', count: { $sum: 1 }, languages: { $addToSet: '$language' } } },
      { $sort: { count: -1 } },
    ], { maxTimeMS: 30000 }).toArray();

    const libraries = rows
      .filter((r) => !EXCLUDE_PROVIDERS.has(r._id))
      .map((r) => {
        const partner = getPartnerByProvider(r._id);
        return {
          provider: r._id,
          // The display name is the point of this endpoint. Falling back to the
          // raw slug is honest — it says "we hold scans from this source and
          // have not catalogued who they are" rather than inventing a name.
          name: partner?.name || r._id,
          url: partner?.url || null,
          partner_slug: partner?.slug || null,
          book_count: r.count,
          languages: r.languages.filter(Boolean).sort(),
          books_url: `https://sourcelibrary.org/api/books/library?library=${encodeURIComponent(r._id)}`,
          ...(partner?.slug ? { page_url: `https://sourcelibrary.org/libraries/${partner.slug}` } : {}),
        };
      })
      .filter((l) => includeUnpartnered || l.partner_slug);

    const body = JSON.stringify({ total: libraries.length, libraries });
    cache.set(cacheKey, { data: body, builtAt: Date.now() });

    return new NextResponse(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('Error in /api/libraries:', error);
    return NextResponse.json({ error: 'Failed to list libraries' }, { status: 500 });
  }
}

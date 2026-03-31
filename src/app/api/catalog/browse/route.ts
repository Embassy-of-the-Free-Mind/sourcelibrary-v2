import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;

/**
 * GET /api/catalog/browse
 *
 * Returns lightweight manifest of all visible, translated books for
 * the full-library catalog view. Client-side filter/sort/paginate.
 *
 * Uses a cached snapshot in system_config (refreshed by ?refresh=1 or
 * when stale >6h). Direct query takes ~15s on Atlas — too slow for
 * every page load.
 */
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === '1';

    // Try cached snapshot first
    if (!forceRefresh) {
      const cached = await db.collection('system_config').findOne(
        { _id: 'catalog_browse_snapshot' } as any,
        { maxTimeMS: 3000 },
      );
      if (cached?.books && cached?.updated_at) {
        const age = Date.now() - new Date(cached.updated_at).getTime();
        // Serve cache if <6h old
        if (age < 6 * 60 * 60 * 1000) {
          return NextResponse.json(
            { books: cached.books, languages: cached.languages, total: cached.books.length },
            { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' } },
          );
        }
      }
    }

    // Cache miss or stale — rebuild from books collection
    const filter = {
      visible: true,
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
    };

    const projection = {
      _id: 0,
      id: 1,
      slug: 1,
      title: 1,
      display_title: 1,
      author: 1,
      year: 1,
      language: 1,
      pages_count: 1,
      pages_ocr: 1,
      pages_translated: 1,
      pages_blank: 1,
      published: 1,
      read_count: 1,
      thumbnail: 1,
      thumbnail_blob: 1,
      is_first_translation: 1,
      ft_disposition: 1,
      created_at: 1,
      last_translation_at: 1,
    };

    const books = await db
      .collection('books')
      .find(filter, { projection })
      .hint('books_visible_created_idx')
      .maxTimeMS(25000)
      .toArray();

    // Language facet
    const langMap = new Map<string, number>();
    for (const b of books) {
      if (b.language) {
        langMap.set(b.language, (langMap.get(b.language) || 0) + 1);
      }
    }
    const languages = [...langMap.entries()]
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);

    // Write snapshot to system_config (fire-and-forget)
    db.collection('system_config').updateOne(
      { _id: 'catalog_browse_snapshot' } as any,
      { $set: { books, languages, updated_at: new Date().toISOString() } },
      { upsert: true },
    ).catch(() => {});

    return NextResponse.json({ books, languages, total: books.length }, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    console.error('Catalog browse error:', err);

    // Last resort: try serving stale cache
    try {
      const db = await getDb();
      const cached = await db.collection('system_config').findOne(
        { _id: 'catalog_browse_snapshot' } as any,
        { maxTimeMS: 3000 },
      );
      if (cached?.books) {
        return NextResponse.json(
          { books: cached.books, languages: cached.languages, total: cached.books.length },
          { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' } },
        );
      }
    } catch { /* ignore */ }

    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}

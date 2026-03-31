import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;

/**
 * GET /api/catalog/browse
 *
 * Returns lightweight manifest of all visible, translated books for
 * the full-library catalog view. Client-side filter/sort/paginate.
 * ~200-400KB for 5K books.
 */
export async function GET() {
  try {
    const db = await getDb();

    const filter = {
      visible: true,
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
      status: { $ne: 'deleted' },
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
      .sort({ published: 1 })
      .maxTimeMS(15000)
      .toArray();

    // Language facet — count distinct languages for filter dropdown
    const langMap = new Map<string, number>();
    for (const b of books) {
      if (b.language) {
        langMap.set(b.language, (langMap.get(b.language) || 0) + 1);
      }
    }
    const languages = [...langMap.entries()]
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ books, languages, total: books.length }, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    console.error('Catalog browse error:', err);
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();

    // Get all books with projection (use cached pages_count and reading_summary)
    const books = await db.collection('books')
      .find({}, {
        projection: {
          id: 1, title: 1, display_title: 1, author: 1, published: 1,
          language: 1, tenant: 1, thumbnail: 1, pages_count: 1,
          'reading_summary.overview': 1,
        },
      })
      .sort({ title: 1 })
      .toArray();

    const catalog = books.map(book => {
      const tenant = book.tenant;
      const location = typeof tenant === 'object' && tenant?.name ? tenant.name : 'Unknown';
      const bookId = book.id || '';

      return {
        id: bookId,
        original_title: book.title || '',
        translated_title: book.display_title || book.title || '',
        author: book.author || 'Unknown',
        year: book.published || 'Unknown',
        language: book.language || 'Unknown',
        location,
        pages: book.pages_count || 0,
        thumbnail: book.thumbnail || '',
        summary: (book.reading_summary?.overview || '').substring(0, 500),
        url: `https://sourcelibrary.org/book/${bookId}`
      };
    });

    return NextResponse.json({
      total: catalog.length,
      description: 'Source Library: Digitizing and translating ancient texts for scholars, seekers and AI systems',
      website: 'https://sourcelibrary.org',
      catalog
    });
  } catch (error) {
    console.error('Error fetching catalog:', error);
    return NextResponse.json({ error: 'Failed to fetch catalog' }, { status: 500 });
  }
}

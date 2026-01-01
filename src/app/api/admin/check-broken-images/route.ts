import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Check for books with broken Internet Archive images (403 errors)
 * These are typically lending library books with restricted access
 *
 * GET /api/admin/check-broken-images?limit=50&test=true
 * - limit: max books to check (default 50)
 * - test: if true, actually test URLs (slower); if false, just list candidates
 *
 * Returns books with broken images that should be reviewed/deleted
 */

async function testImageUrl(url: string): Promise<{ status: number; accessible: boolean }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return {
      status: response.status,
      accessible: response.status === 200,
    };
  } catch (error) {
    return {
      status: 0,
      accessible: false,
    };
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const shouldTest = searchParams.get('test') === 'true';

  try {
    const db = await getDb();

    // Find books with IA-style thumbnails
    const books = await db.collection('books')
      .find({
        thumbnail: { $regex: 'archive.org/download', $options: 'i' }
      })
      .project({
        id: 1,
        title: 1,
        author: 1,
        published: 1,
        thumbnail: 1,
        ia_identifier: 1,
      })
      .limit(limit)
      .toArray();

    if (!shouldTest) {
      // Just return the list without testing
      return NextResponse.json({
        message: 'Add ?test=true to actually test URLs (slower)',
        count: books.length,
        books: books.map(b => ({
          id: b.id,
          title: b.title,
          author: b.author,
          year: b.published,
          ia_identifier: b.ia_identifier,
          thumbnail: b.thumbnail,
        })),
      });
    }

    // Test each book's thumbnail URL
    const results: Array<{
      id: string;
      title: string;
      author: string;
      year: string;
      ia_identifier: string;
      thumbnail: string;
      status: number;
      accessible: boolean;
    }> = [];

    const broken: typeof results = [];
    const accessible: typeof results = [];

    for (const book of books) {
      const testResult = await testImageUrl(book.thumbnail);

      const entry = {
        id: book.id,
        title: book.title,
        author: book.author,
        year: book.published,
        ia_identifier: book.ia_identifier,
        thumbnail: book.thumbnail,
        status: testResult.status,
        accessible: testResult.accessible,
      };

      results.push(entry);

      if (testResult.accessible) {
        accessible.push(entry);
      } else {
        broken.push(entry);
      }
    }

    return NextResponse.json({
      tested: results.length,
      broken_count: broken.length,
      accessible_count: accessible.length,
      broken: broken.map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        year: b.year,
        status: b.status,
        ia_identifier: b.ia_identifier,
      })),
      // Don't include full accessible list to keep response small
      accessible_sample: accessible.slice(0, 5).map(b => ({
        id: b.id,
        title: b.title,
      })),
    });
  } catch (error) {
    console.error('Error checking broken images:', error);
    return NextResponse.json({ error: 'Failed to check images' }, { status: 500 });
  }
}

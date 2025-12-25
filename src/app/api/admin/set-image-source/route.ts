import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { ImageSource, ImageSourceProvider } from '@/lib/types';

/**
 * Bulk set image_source for books
 *
 * POST /api/admin/set-image-source
 * Body: {
 *   book_ids?: string[],           // Specific book IDs, or omit for filter-based update
 *   filter?: {                     // Filter to find books (if book_ids not provided)
 *     has_image_source?: boolean,  // Filter by whether image_source exists
 *     ia_identifier?: boolean,     // Filter by whether ia_identifier exists
 *   },
 *   image_source: ImageSource      // The image_source to set
 * }
 *
 * GET /api/admin/set-image-source
 * Returns counts of books by image_source status
 */

export async function GET() {
  try {
    const db = await getDb();

    // Count books by image source status
    const stats = await db.collection('books').aggregate([
      {
        $group: {
          _id: {
            has_image_source: { $cond: [{ $ifNull: ['$image_source', false] }, true, false] },
            provider: '$image_source.provider',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.provider': 1 } },
    ]).toArray();

    // Also get list of books without image_source
    const booksWithoutSource = await db.collection('books')
      .find({ image_source: { $exists: false } })
      .project({ id: 1, title: 1, author: 1, ia_identifier: 1 })
      .limit(100)
      .toArray();

    // Categorize books without source by likely provider
    const categorized = {
      likely_ia: booksWithoutSource.filter(b => b.ia_identifier),
      unknown: booksWithoutSource.filter(b => !b.ia_identifier),
    };

    return NextResponse.json({
      stats,
      books_without_source: {
        total: booksWithoutSource.length,
        likely_ia: categorized.likely_ia.length,
        unknown: categorized.unknown.length,
        samples: {
          likely_ia: categorized.likely_ia.slice(0, 10).map(b => ({
            id: b.id,
            title: b.title,
            ia_identifier: b.ia_identifier,
          })),
          unknown: categorized.unknown.slice(0, 10).map(b => ({
            id: b.id,
            title: b.title,
            author: b.author,
          })),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching image source stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { book_ids, filter, image_source } = body as {
      book_ids?: string[];
      filter?: {
        has_image_source?: boolean;
        ia_identifier?: boolean;
      };
      image_source: ImageSource;
    };

    if (!image_source || !image_source.provider) {
      return NextResponse.json(
        { error: 'image_source with provider is required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    let query: Record<string, unknown> = {};

    if (book_ids && book_ids.length > 0) {
      // Update specific books
      query = { id: { $in: book_ids } };
    } else if (filter) {
      // Build filter query
      if (filter.has_image_source === false) {
        query.image_source = { $exists: false };
      } else if (filter.has_image_source === true) {
        query.image_source = { $exists: true };
      }

      if (filter.ia_identifier === true) {
        query.ia_identifier = { $exists: true, $ne: null };
      } else if (filter.ia_identifier === false) {
        query.$or = [
          { ia_identifier: { $exists: false } },
          { ia_identifier: null },
        ];
      }
    } else {
      return NextResponse.json(
        { error: 'Either book_ids or filter is required' },
        { status: 400 }
      );
    }

    // Add access_date if not provided
    const sourceToSet: ImageSource = {
      ...image_source,
      access_date: image_source.access_date || new Date(),
    };

    const result = await db.collection('books').updateMany(
      query,
      {
        $set: {
          image_source: sourceToSet,
          updated_at: new Date(),
        },
      }
    );

    return NextResponse.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      image_source: sourceToSet,
    });
  } catch (error) {
    console.error('Error setting image source:', error);
    return NextResponse.json(
      { error: 'Failed to set image source' },
      { status: 500 }
    );
  }
}

/**
 * Auto-fill image_source for books based on URL patterns or ia_identifier
 *
 * PATCH /api/admin/set-image-source
 * Body: { action: 'auto_fill_ia' | 'auto_detect' }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    const db = await getDb();

    if (action === 'auto_fill_ia') {
      // Find books with ia_identifier but no image_source
      const books = await db.collection('books')
        .find({
          ia_identifier: { $exists: true, $ne: null },
          image_source: { $exists: false },
        })
        .project({ id: 1, ia_identifier: 1 })
        .toArray();

      if (books.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No books to update',
          updated: 0,
        });
      }

      // Update each book with IA image_source
      const bulkOps = books.map(book => ({
        updateOne: {
          filter: { id: book.id },
          update: {
            $set: {
              image_source: {
                provider: 'internet_archive' as ImageSourceProvider,
                provider_name: 'Internet Archive',
                source_url: `https://archive.org/details/${book.ia_identifier}`,
                identifier: book.ia_identifier,
                license: 'publicdomain',
                access_date: new Date(),
              },
              updated_at: new Date(),
            },
          },
        },
      }));

      const result = await db.collection('books').bulkWrite(bulkOps);

      return NextResponse.json({
        success: true,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        message: `Updated ${result.modifiedCount} books with IA image_source`,
      });
    }

    if (action === 'auto_detect') {
      // Find all books without image_source
      const books = await db.collection('books')
        .find({ image_source: { $exists: false } })
        .project({ id: 1, title: 1, thumbnail: 1, ia_identifier: 1 })
        .toArray();

      if (books.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No books to update',
          updated: 0,
          by_provider: {},
        });
      }

      const bulkOps: Array<{
        updateOne: {
          filter: { id: string };
          update: { $set: Record<string, unknown> };
        };
      }> = [];
      const byProvider: Record<string, number> = {};
      const unknown: Array<{ id: string; title: string; thumbnail: string | null }> = [];

      for (const book of books) {
        const checkUrl = book.thumbnail || '';

        let provider: ImageSourceProvider | null = null;
        let providerName: string | null = null;
        let sourceUrl: string | null = null;
        let identifier: string | null = null;

        // Detect source from URL patterns
        if (checkUrl.includes('archive.org')) {
          provider = 'internet_archive';
          providerName = 'Internet Archive';
          const match = checkUrl.match(/archive\.org\/download\/([^/]+)/);
          if (match) {
            identifier = match[1];
            sourceUrl = `https://archive.org/details/${identifier}`;
          }
        } else if (checkUrl.includes('books.google')) {
          provider = 'google_books';
          providerName = 'Google Books';
          const match = checkUrl.match(/id=([^&]+)/);
          if (match) {
            identifier = match[1];
            sourceUrl = `https://books.google.com/books?id=${identifier}`;
          }
        } else if (checkUrl.includes('s3.amazonaws.com') || checkUrl.includes('.s3.')) {
          // S3 URLs are likely EFM scans
          provider = 'efm';
          providerName = 'Embassy of the Free Mind';
        } else if (checkUrl.startsWith('/Users/') || checkUrl.startsWith('/home/')) {
          // Local file paths - likely EFM scans
          provider = 'efm';
          providerName = 'Embassy of the Free Mind';
        } else if (book.ia_identifier) {
          // Has ia_identifier but thumbnail doesn't match
          provider = 'internet_archive';
          providerName = 'Internet Archive';
          identifier = book.ia_identifier;
          sourceUrl = `https://archive.org/details/${book.ia_identifier}`;
        }

        if (provider) {
          byProvider[provider] = (byProvider[provider] || 0) + 1;

          bulkOps.push({
            updateOne: {
              filter: { id: book.id },
              update: {
                $set: {
                  image_source: {
                    provider,
                    provider_name: providerName,
                    source_url: sourceUrl,
                    identifier: identifier || book.ia_identifier,
                    license: 'publicdomain',
                    access_date: new Date(),
                  },
                  updated_at: new Date(),
                },
              },
            },
          });
        } else {
          unknown.push({
            id: book.id,
            title: book.title,
            thumbnail: book.thumbnail,
          });
        }
      }

      let result = { matchedCount: 0, modifiedCount: 0 };
      if (bulkOps.length > 0) {
        result = await db.collection('books').bulkWrite(bulkOps);
      }

      return NextResponse.json({
        success: true,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        by_provider: byProvider,
        unknown_count: unknown.length,
        unknown_samples: unknown.slice(0, 10),
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: auto_fill_ia or auto_detect' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error auto-filling image source:', error);
    return NextResponse.json(
      { error: 'Failed to auto-fill image source' },
      { status: 500 }
    );
  }
}

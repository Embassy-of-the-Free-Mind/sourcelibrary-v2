import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import sharp from 'sharp';
import { images } from '@/lib/api-client';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * GET /api/admin/aspect-ratio-audit
 *
 * Lightweight bulk aspect ratio check for books. Samples page 10 of each book
 * and classifies as single-page or two-page spread based on width/height ratio.
 *
 * Query params:
 *   - limit: Max books to check (default 50)
 *   - uncheckedOnly: Only books without split_check (default true)
 *   - threshold: Aspect ratio threshold for spread detection (default 1.3)
 *   - update: Update book records with results (default false)
 *
 * Returns books sorted by aspect ratio descending (spreads first).
 */

const SAMPLE_PAGE = 10;
const ASPECT_SINGLE = 0.9;
const DEFAULT_SPREAD_THRESHOLD = 1.3;

interface AuditResult {
  bookId: string;
  title: string;
  pages: number;
  pageNumber: number;
  aspectRatio: number;
  width: number;
  height: number;
  classification: 'single' | 'spread' | 'ambiguous';
  imageUrl: string;
  error?: string;
}

export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') === 'true';

    const db = await getDb();

    // Report mode: fast query of already-checked books that need splitting
    if (report) {
      const needsSplitting = await db.collection('books')
        .find({ needs_splitting: true })
        .project({ id: 1, title: 1, pages_count: 1, split_check: 1 })
        .sort({ 'split_check.sample_results.0.aspectRatio': -1 })
        .toArray();

      // Check which ones already have crop data (already split)
      const bookIds = needsSplitting.map(b => b.id);
      const alreadySplit = new Set(
        await db.collection('pages').distinct('book_id', {
          book_id: { $in: bookIds },
          crop: { $exists: true }
        })
      );

      const results = needsSplitting.map(b => ({
        bookId: b.id,
        title: b.title,
        pages: b.pages_count,
        aspectRatio: b.split_check?.sample_results?.[0]?.aspectRatio || 0,
        alreadySplit: alreadySplit.has(b.id),
        url: `https://sourcelibrary.org/book/${b.id}`
      }));

      return NextResponse.json({
        total: results.length,
        alreadySplit: results.filter(r => r.alreadySplit).length,
        needsAction: results.filter(r => !r.alreadySplit).length,
        results
      });
    }

    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const uncheckedOnly = searchParams.get('uncheckedOnly') !== 'false';
    const threshold = parseFloat(searchParams.get('threshold') || String(DEFAULT_SPREAD_THRESHOLD));
    const update = searchParams.get('update') === 'true';

    // Find books to audit
    const bookQuery: Record<string, unknown> = {
      // Only check books that actually have pages
      pages_count: { $gt: 0 }
    };
    if (uncheckedOnly) {
      bookQuery['split_check'] = { $exists: false };
      // Also exclude books that already have split/cropped pages
      const booksWithSplits = await db.collection('pages').distinct('book_id', {
        crop: { $exists: true }
      });
      if (booksWithSplits.length > 0) {
        bookQuery['id'] = { $nin: booksWithSplits };
      }
    }

    // Prefer books with archived images (more reliable), then by recency
    const books = await db.collection('books')
      .find(bookQuery)
      .project({ id: 1, title: 1, pages_count: 1 })
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit * 2) // Fetch extra in case some have no usable pages
      .toArray();

    // Filter to books that actually have page records with images
    const bookIds_pre = books.map(b => b.id);
    const booksWithImages = await db.collection('pages').distinct('book_id', {
      book_id: { $in: bookIds_pre },
      $or: [
        { archived_photo: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } }
      ],
      page_number: { $gte: 5 } // Has pages near our sample point
    });
    const booksWithImageSet = new Set(booksWithImages);
    const filteredBooks = books.filter(b => booksWithImageSet.has(b.id)).slice(0, limit);

    if (filteredBooks.length === 0) {
      return NextResponse.json({
        message: 'No books with images to audit',
        results: [],
        summary: { total: 0, spreads: 0, single: 0, ambiguous: 0, errors: 0 }
      });
    }

    // Get page 10 (or nearest available) for each book in one query
    const bookIds = filteredBooks.map(b => b.id);
    const samplePages = await db.collection('pages')
      .find({
        book_id: { $in: bookIds },
        page_number: SAMPLE_PAGE
      })
      .project({ book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1 })
      .toArray();

    // Index by book_id for fast lookup
    const pageByBook = new Map<string, typeof samplePages[0]>();
    for (const p of samplePages) {
      pageByBook.set(p.book_id as string, p);
    }

    // For books without page 10, get any page near the start
    const missingBooks = bookIds.filter(id => !pageByBook.has(id));
    if (missingBooks.length > 0) {
      // Batch fallback: get one page per missing book
      const fallbackPages = await db.collection('pages')
        .aggregate([
          { $match: { book_id: { $in: missingBooks }, page_number: { $gte: 3 } } },
          { $sort: { page_number: 1 } },
          { $group: { _id: '$book_id', page: { $first: '$$ROOT' } } }
        ])
        .toArray();
      for (const f of fallbackPages) {
        pageByBook.set(f._id as string, f.page);
      }
    }

    // Check aspect ratios — process in parallel batches of 5
    const results: AuditResult[] = [];
    const bookMap = new Map(filteredBooks.map(b => [b.id, b]));
    const BATCH_SIZE = 10;

    for (let i = 0; i < bookIds.length; i += BATCH_SIZE) {
      const batch = bookIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (bookId) => {
          const book = bookMap.get(bookId)!;
          const page = pageByBook.get(bookId);

          if (!page) {
            return {
              bookId,
              title: book.title as string,
              pages: (book.pages_count || 0) as number,
              pageNumber: 0,
              aspectRatio: 0,
              width: 0,
              height: 0,
              classification: 'ambiguous' as const,
              imageUrl: '',
              error: 'No pages found'
            };
          }

          const imageUrl = (page.archived_photo || page.photo || page.photo_original) as string;
          if (!imageUrl) {
            return {
              bookId,
              title: book.title as string,
              pages: (book.pages_count || 0) as number,
              pageNumber: page.page_number as number,
              aspectRatio: 0,
              width: 0,
              height: 0,
              classification: 'ambiguous' as const,
              imageUrl: '',
              error: 'No image URL'
            };
          }

          try {
            const buffer = await images.fetchBuffer(imageUrl, { timeout: 10000 });
            const metadata = await sharp(buffer).metadata();

            if (!metadata.width || !metadata.height) {
              return {
                bookId,
                title: book.title as string,
                pages: (book.pages_count || 0) as number,
                pageNumber: page.page_number as number,
                aspectRatio: 0,
                width: 0,
                height: 0,
                classification: 'ambiguous' as const,
                imageUrl,
                error: 'Could not read dimensions'
              };
            }

            const ratio = metadata.width / metadata.height;
            const rounded = Math.round(ratio * 100) / 100;
            const classification = ratio < ASPECT_SINGLE ? 'single'
              : ratio > threshold ? 'spread'
              : 'ambiguous';

            return {
              bookId,
              title: book.title as string,
              pages: (book.pages_count || 0) as number,
              pageNumber: page.page_number as number,
              aspectRatio: rounded,
              width: metadata.width,
              height: metadata.height,
              classification: classification as 'single' | 'spread' | 'ambiguous',
              imageUrl
            };
          } catch (err) {
            return {
              bookId,
              title: book.title as string,
              pages: (book.pages_count || 0) as number,
              pageNumber: page.page_number as number,
              aspectRatio: 0,
              width: 0,
              height: 0,
              classification: 'ambiguous' as const,
              imageUrl,
              error: err instanceof Error ? err.message : 'Fetch failed'
            };
          }
        })
      );
      results.push(...batchResults);
    }

    // Sort by aspect ratio descending (spreads first)
    results.sort((a, b) => b.aspectRatio - a.aspectRatio);

    // Update book records if requested
    if (update) {
      const bulkOps = results
        .filter(r => !r.error && r.aspectRatio > 0)
        .map(r => ({
          updateOne: {
            filter: { id: r.bookId },
            update: {
              $set: {
                needs_splitting: r.classification === 'spread',
                split_check: {
                  checked_at: new Date(),
                  confidence: r.classification === 'ambiguous' ? 'low' as const : 'high' as const,
                  reasoning: `Page ${r.pageNumber} aspect ratio: ${r.aspectRatio} (${r.width}x${r.height}) → ${r.classification}`,
                  sample_results: [{
                    pageNumber: r.pageNumber,
                    aspectRatio: r.aspectRatio,
                    classification: r.classification
                  }]
                },
                updated_at: new Date()
              }
            }
          }
        }));

      if (bulkOps.length > 0) {
        await db.collection('books').bulkWrite(bulkOps);
      }
    }

    const summary = {
      total: results.length,
      spreads: results.filter(r => r.classification === 'spread').length,
      single: results.filter(r => r.classification === 'single').length,
      ambiguous: results.filter(r => r.classification === 'ambiguous' && !r.error).length,
      errors: results.filter(r => !!r.error).length
    };

    return NextResponse.json({
      threshold,
      update,
      offset,
      summary,
      results: results.map(r => ({
        bookId: r.bookId,
        title: r.title,
        pages: r.pages,
        pageChecked: r.pageNumber,
        aspectRatio: r.aspectRatio,
        dimensions: r.width && r.height ? `${r.width}x${r.height}` : null,
        classification: r.classification,
        imageUrl: r.imageUrl || undefined,
        error: r.error || undefined
      }))
    });

  } catch (error) {
    console.error('Aspect ratio audit error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Audit failed' },
      { status: 500 }
    );
  }
});

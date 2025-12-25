import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';

/**
 * Find all pages with crop data but no cropped_photo and queue a job to generate them.
 *
 * GET - Preview: returns count and sample of pages needing cropped images
 * POST - Execute: creates job to generate cropped images
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('bookId');

    const db = await getDb();

    // Find pages with crop data but no cropped_photo
    const query: Record<string, unknown> = {
      'crop.xStart': { $exists: true },
      $or: [
        { cropped_photo: { $exists: false } },
        { cropped_photo: null },
        { cropped_photo: '' }
      ]
    };

    if (bookId) {
      query.book_id = bookId;
    }

    const pages = await db.collection('pages')
      .find(query)
      .project({ id: 1, book_id: 1, page_number: 1, crop: 1, photo_original: 1, photo: 1 })
      .toArray();

    // Group by book
    const byBook: Record<string, number> = {};
    for (const page of pages) {
      const bid = page.book_id || 'unknown';
      byBook[bid] = (byBook[bid] || 0) + 1;
    }

    return NextResponse.json({
      totalPages: pages.length,
      byBook,
      sample: pages.slice(0, 5).map(p => ({
        id: p.id,
        book_id: p.book_id,
        page_number: p.page_number,
        crop: p.crop,
        hasPhotoOriginal: !!p.photo_original
      }))
    });
  } catch (error) {
    console.error('Error checking for pages needing cropped images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { bookId } = body;

    const db = await getDb();

    // Find pages with crop data but no cropped_photo
    const query: Record<string, unknown> = {
      'crop.xStart': { $exists: true },
      $or: [
        { cropped_photo: { $exists: false } },
        { cropped_photo: null },
        { cropped_photo: '' }
      ]
    };

    if (bookId) {
      query.book_id = bookId;
    }

    const pages = await db.collection('pages')
      .find(query)
      .project({ id: 1, book_id: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pages need cropped images',
        pagesFound: 0
      });
    }

    const pageIds = pages.map(p => p.id);

    // Get book info for job metadata
    const bookIds = [...new Set(pages.map(p => p.book_id))];
    const bookTitle = bookIds.length === 1
      ? (await db.collection('books').findOne({ id: bookIds[0] }))?.title || 'Unknown'
      : `${bookIds.length} books`;

    // Create the job
    const jobId = nanoid(12);
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'generate_cropped_images',
      status: 'pending',
      progress: {
        total: pageIds.length,
        completed: 0,
        failed: 0,
      },
      book_id: bookIds.length === 1 ? bookIds[0] : null,
      book_title: bookTitle,
      created_at: new Date(),
      updated_at: new Date(),
      results: [],
      config: {
        page_ids: pageIds,
        backfill: true,
      },
    });

    // Kick off processing (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    fetch(`${baseUrl}/api/jobs/${jobId}/process`, {
      method: 'POST',
    }).catch(() => {
      // Ignore - job will be picked up later
    });

    return NextResponse.json({
      success: true,
      jobId,
      pagesQueued: pageIds.length,
      bookIds,
      message: `Created job to generate cropped images for ${pageIds.length} pages`
    });
  } catch (error) {
    console.error('Error creating backfill job:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create job' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/detections
 *
 * Fetch pages with detected images for review.
 * Query params:
 *   - status: 'pending' | 'approved' | 'rejected' | 'all' (default: 'pending')
 *   - bookId: filter by book
 *   - limit: max pages (default 20)
 *   - offset: pagination
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const bookId = searchParams.get('bookId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getDb();

    // Build query for pages with detections
    const query: Record<string, unknown> = {
      'detected_images.0': { $exists: true },
      $or: [
        { cropped_photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } }
      ]
    };

    if (bookId) {
      query.book_id = bookId;
    }

    // Filter by detection status
    if (status !== 'all') {
      if (status === 'pending') {
        // Pending = no status field or status === 'pending'
        query['detected_images'] = {
          $elemMatch: {
            $or: [
              { status: { $exists: false } },
              { status: 'pending' }
            ]
          }
        };
      } else {
        query['detected_images.status'] = status;
      }
    }

    const total = await db.collection('pages').countDocuments(query);

    const pages = await db.collection('pages').aggregate([
      { $match: query },
      { $sort: { book_id: 1, page_number: 1 } },
      { $skip: offset },
      { $limit: limit },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          id: 1,
          page_number: 1,
          book_id: 1,
          photo: 1,
          photo_original: 1,
          cropped_photo: 1,
          detected_images: 1,
          'book.title': 1,
          'book.author': 1
        }
      }
    ]).toArray();

    // Get unique books for filter
    const books = await db.collection('pages').aggregate([
      { $match: { 'detected_images.0': { $exists: true } } },
      { $group: { _id: '$book_id' } },
      {
        $lookup: {
          from: 'books',
          localField: '_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: '$book' },
      { $project: { id: '$_id', title: '$book.title' } },
      { $sort: { title: 1 } }
    ]).toArray();

    // Count by status
    const statusCounts = await db.collection('pages').aggregate([
      { $match: { 'detected_images.0': { $exists: true } } },
      { $unwind: '$detected_images' },
      {
        $group: {
          _id: { $ifNull: ['$detected_images.status', 'pending'] },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const counts = {
      pending: 0,
      approved: 0,
      rejected: 0
    };
    for (const s of statusCounts) {
      if (s._id in counts) {
        counts[s._id as keyof typeof counts] = s.count;
      }
    }

    return NextResponse.json({
      pages: pages.map(p => ({
        pageId: p.id,
        bookId: p.book_id,
        pageNumber: p.page_number,
        imageUrl: p.cropped_photo || p.photo_original || p.photo,
        bookTitle: p.book?.title || 'Unknown',
        author: p.book?.author,
        detections: p.detected_images || []
      })),
      total,
      limit,
      offset,
      books,
      counts
    });
  } catch (error) {
    console.error('Detections GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch detections' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/detections
 *
 * Add a manual detection to a page.
 * Body: { pageId, bbox: { x, y, width, height }, description, type? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pageId, bbox, description, type } = body;

    if (!pageId || !bbox) {
      return NextResponse.json({ error: 'pageId and bbox required' }, { status: 400 });
    }

    const db = await getDb();

    const newDetection = {
      id: `manual-${Date.now()}`,
      description: description || 'Manual selection',
      type: type || 'illustration',
      bbox: {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height
      },
      detected_at: new Date(),
      detection_source: 'manual',
      status: 'approved' // Manual selections are auto-approved
    };

    const result = await db.collection('pages').updateOne(
      { id: pageId },
      { $push: { detected_images: newDetection } } as unknown as Record<string, unknown>
    );

    return NextResponse.json({
      success: result.modifiedCount > 0,
      detection: newDetection
    });
  } catch (error) {
    console.error('Detections POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add detection' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/detections
 *
 * Remove a detection from a page.
 * Body: { pageId, detectionIndex }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { pageId, detectionIndex } = body;

    if (!pageId || detectionIndex === undefined) {
      return NextResponse.json({ error: 'pageId and detectionIndex required' }, { status: 400 });
    }

    const db = await getDb();

    // Get the page first to find the detection
    const page = await db.collection('pages').findOne({ id: pageId });
    if (!page || !page.detected_images) {
      return NextResponse.json({ error: 'Page or detections not found' }, { status: 404 });
    }

    // Remove the detection at the specified index
    const detections = [...page.detected_images];
    detections.splice(detectionIndex, 1);

    const result = await db.collection('pages').updateOne(
      { id: pageId },
      { $set: { detected_images: detections } }
    );

    return NextResponse.json({ success: result.modifiedCount > 0 });
  } catch (error) {
    console.error('Detections DELETE error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete detection' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/detections
 *
 * Update detection status.
 * Body: { pageId, detectionIndex, status: 'approved' | 'rejected' | 'pending' }
 * Or bulk: { updates: [{ pageId, detectionIndex, status }] }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const db = await getDb();

    // Handle bulk updates
    const updates = body.updates || [body];
    const results = [];

    for (const update of updates) {
      const { pageId, detectionIndex, status } = update;

      if (!pageId || detectionIndex === undefined || !status) {
        results.push({ pageId, success: false, error: 'Missing required fields' });
        continue;
      }

      if (!['pending', 'approved', 'rejected'].includes(status)) {
        results.push({ pageId, success: false, error: 'Invalid status' });
        continue;
      }

      // Update the specific detection in the array
      const result = await db.collection('pages').updateOne(
        { id: pageId },
        {
          $set: {
            [`detected_images.${detectionIndex}.status`]: status,
            [`detected_images.${detectionIndex}.reviewed_at`]: new Date()
          }
        }
      );

      results.push({
        pageId,
        detectionIndex,
        status,
        success: result.modifiedCount > 0
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Detections PATCH error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update detection' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

interface BoundingBox {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

interface DetectionData {
  isTwoPageSpread: boolean;
  leftPage?: BoundingBox;
  rightPage?: BoundingBox;
}

interface SplitRequest {
  side?: 'left' | 'right'; // Which half to keep on this page (legacy)
  splitRatio?: number; // Where to split (0-100, default 50) (legacy)
  detection?: DetectionData; // AI detection with bounding boxes
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await params;
    const body: SplitRequest = await request.json();
    const { side, splitRatio = 50, detection } = body;

    const db = await getDb();

    // Get the current page
    const currentPage = await db.collection('pages').findOne({ id: pageId });
    if (!currentPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    if (!currentPage.photo) {
      return NextResponse.json({ error: 'Page has no image' }, { status: 400 });
    }

    // Get the book to find all pages and determine next page number
    const book = await db.collection('books').findOne({ id: currentPage.book_id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages for this book to find max page number
    const allPages = await db.collection('pages')
      .find({ book_id: currentPage.book_id })
      .sort({ page_number: 1 })
      .toArray();

    const currentPageNumber = currentPage.page_number;

    // Generate new page ID
    const newPageId = new ObjectId().toHexString();

    // Determine crop coordinates
    let leftCrop: { xStart: number; xEnd: number };
    let rightCrop: { xStart: number; xEnd: number };

    if (detection?.leftPage && detection?.rightPage) {
      // Use AI detection bounding boxes (0-1000 scale)
      leftCrop = {
        xStart: detection.leftPage.xmin,
        xEnd: detection.leftPage.xmax
      };
      rightCrop = {
        xStart: detection.rightPage.xmin,
        xEnd: detection.rightPage.xmax
      };
    } else {
      // Legacy: simple percentage split
      leftCrop = { xStart: 0, xEnd: splitRatio * 10 }; // Convert to 0-1000 scale
      rightCrop = { xStart: splitRatio * 10, xEnd: 1000 };
    }

    // Determine which side the current page keeps (default to left)
    const keepLeft = side !== 'right';
    const currentCrop = keepLeft ? leftCrop : rightCrop;
    const newCrop = keepLeft ? rightCrop : leftCrop;

    // Update current page with crop info
    await db.collection('pages').updateOne(
      { id: pageId },
      {
        $set: {
          crop: currentCrop,
          photo_original: currentPage.photo_original || currentPage.photo,
          updated_at: new Date()
        }
      }
    );

    // Create new page with the other half
    const newPageNumber = currentPageNumber + 0.5; // Will be renumbered

    const newPage = {
      id: newPageId,
      book_id: currentPage.book_id,
      page_number: newPageNumber,
      photo: currentPage.photo_original || currentPage.photo,
      photo_original: currentPage.photo_original || currentPage.photo,
      crop: newCrop,
      split_from: pageId,
      ocr: null,
      translation: null,
      summary: null,
      created_at: new Date(),
      updated_at: new Date()
    };

    await db.collection('pages').insertOne(newPage);

    // Renumber all pages - use bulkWrite for speed
    const updatedPages = await db.collection('pages')
      .find({ book_id: currentPage.book_id })
      .sort({ page_number: 1 })
      .toArray();

    // Bulk update all page numbers in one operation
    const bulkOps = updatedPages.map((p, i) => ({
      updateOne: {
        filter: { id: p.id },
        update: { $set: { page_number: i + 1 } }
      }
    }));

    if (bulkOps.length > 0) {
      await db.collection('pages').bulkWrite(bulkOps);
    }

    // Update book page count
    await db.collection('books').updateOne(
      { id: currentPage.book_id },
      { $set: { pages_count: updatedPages.length, updated_at: new Date() } }
    );

    return NextResponse.json({
      success: true,
      currentPage: {
        id: pageId,
        crop: currentCrop
      },
      newPage: {
        id: newPageId,
        crop: newCrop,
        page_number: currentPageNumber + 1
      }
    });
  } catch (error) {
    console.error('Error splitting page:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Split failed' },
      { status: 500 }
    );
  }
}

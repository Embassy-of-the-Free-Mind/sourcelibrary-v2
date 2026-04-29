import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { resolveTenantId } from '@/lib/tenant-context';

export const maxDuration = 60;

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

export const POST = withAuth(async (request, session, context) => {
  try {
    const { tenant, id: pageId } = await context.params;
    const db = await getDb();
    
    // Resolve tenant slug to UUID
    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    
    const body: SplitRequest = await request.json();
    const { side, splitRatio = 50, detection } = body;

    // Get the current page
    const currentPage = await db.collection('pages').findOne({ id: pageId, tenantId });
    if (!currentPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    if (!currentPage.photo) {
      return NextResponse.json({ error: 'Page has no image' }, { status: 400 });
    }

    // Idempotency: check if this page was already split (has a child page)
    const existingChild = await db.collection('pages').findOne({ split_from: pageId, tenantId });
    if (existingChild) {
      return NextResponse.json({ error: 'Page already split', existingChildPage: existingChild.page_number }, { status: 409 });
    }

    // Get the book to find all pages and determine next page number
    const book = await db.collection('books').findOne({ id: currentPage.book_id, tenantId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages for this book to find max page number
    const allPages = await db.collection('pages')
      .find({ book_id: currentPage.book_id, tenantId })
      .sort({ page_number: 1, _id: 1 })
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

    // Update current page with crop info and clear OCR/translation
    // (content has changed due to cropping, so existing OCR is invalid)
    await db.collection('pages').updateOne(
      { id: pageId, tenantId },
      {
        $set: {
          crop: currentCrop,
          photo_original: currentPage.photo_original || currentPage.photo,
          cropped_photo: null,
          ocr: null,
          translation: null,
          summary: null,
          updated_at: new Date()
        },
        $unset: { thumbnail_blob: '' }
      }
    );

    // Create new page with the other half
    const newPageNumber = currentPageNumber + 0.5; // Will be renumbered

    const newPage = {
      id: newPageId,
      book_id: currentPage.book_id,
      tenantId,
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
      .find({ book_id: currentPage.book_id, tenantId })
      .sort({ page_number: 1, _id: 1 })
      .toArray();

    // Bulk update all page numbers and clear stale thumbnails
    // (page numbers shifted, so blob paths like thumbnails/{bookId}/{oldNum}.jpg are wrong)
    const bulkOps = updatedPages.map((p, i) => ({
      updateOne: {
        filter: { id: p.id, tenantId },
        update: {
          $set: { page_number: i + 1 },
          $unset: { thumbnail_blob: '' }
        }
      }
    }));

    if (bulkOps.length > 0) {
      await db.collection('pages').bulkWrite(bulkOps);
    }

    // Update book page count
    await db.collection('books').updateOne(
      { id: currentPage.book_id, tenantId },
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
});

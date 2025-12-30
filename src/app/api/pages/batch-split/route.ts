import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';

interface SplitRequest {
  pageId: string;
  splitPosition: number; // 0-1000 scale
  detectedPosition?: number; // What the algorithm detected
  wasAdjusted?: boolean; // Whether user manually adjusted
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { splits }: { splits: SplitRequest[] } = body;

    if (!splits || splits.length === 0) {
      return NextResponse.json({ error: 'No splits provided' }, { status: 400 });
    }

    const db = await getDb();

    // Get all pages to split
    const pageIds = splits.map(s => s.pageId);
    const pages = await db.collection('pages')
      .find({ id: { $in: pageIds } })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found' }, { status: 404 });
    }

    // Get book_id from first page (all should be same book)
    const bookId = pages[0].book_id;

    // Create all new pages and update existing pages
    const newPages: Array<{
      id: string;
      book_id: string;
      page_number: number;
      photo: string;
      photo_original: string;
      crop: { xStart: number; xEnd: number };
      split_from: string;
      ocr: null;
      translation: null;
      summary: null;
      created_at: Date;
      updated_at: Date;
    }> = [];
    const updateOps: Array<{
      updateOne: {
        filter: { id: string };
        update: { $set: { crop: { xStart: number; xEnd: number }; photo_original: string; updated_at: Date } };
      };
    }> = [];

    for (const split of splits) {
      const page = pages.find(p => p.id === split.pageId);
      if (!page || !page.photo) continue;

      // Add 1% overlap (10 on 0-1000 scale) on each side
      const overlap = 10;
      const leftCrop = { xStart: 0, xEnd: Math.min(1000, split.splitPosition + overlap) };
      const rightCrop = { xStart: Math.max(0, split.splitPosition - overlap), xEnd: 1000 };

      // Update existing page with left crop
      updateOps.push({
        updateOne: {
          filter: { id: page.id },
          update: {
            $set: {
              crop: leftCrop,
              photo_original: page.photo_original || page.photo,
              updated_at: new Date()
            }
          }
        }
      });

      // Create new page for right side
      const newPageId = new ObjectId().toHexString();
      newPages.push({
        id: newPageId,
        book_id: bookId,
        page_number: page.page_number + 0.5, // Will be renumbered
        photo: page.photo_original || page.photo,
        photo_original: page.photo_original || page.photo,
        crop: rightCrop,
        split_from: page.id,
        ocr: null,
        translation: null,
        summary: null,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    // Execute updates and inserts in parallel
    await Promise.all([
      updateOps.length > 0 ? db.collection('pages').bulkWrite(updateOps) : Promise.resolve(),
      newPages.length > 0 ? db.collection('pages').insertMany(newPages) : Promise.resolve()
    ]);

    // Renumber all pages once at the end
    const allPages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1 })
      .toArray();

    const renumberOps = allPages.map((p, i) => ({
      updateOne: {
        filter: { id: p.id },
        update: { $set: { page_number: i + 1 } }
      }
    }));

    if (renumberOps.length > 0) {
      await db.collection('pages').bulkWrite(renumberOps);
    }

    // Update book page count
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { pages: allPages.length } }
    );

    // Queue job to generate cropped images for all split pages
    const splitPageIds = [
      ...splits.map(s => s.pageId),  // Original pages (left side)
      ...newPages.map(p => p.id),     // New pages (right side)
    ];

    let cropJobId: string | null = null;
    if (splitPageIds.length > 0) {
      cropJobId = nanoid(12);
      await db.collection('jobs').insertOne({
        id: cropJobId,
        type: 'generate_cropped_images',
        status: 'pending',
        progress: {
          total: splitPageIds.length,
          completed: 0,
          failed: 0,
        },
        book_id: bookId,
        created_at: new Date(),
        updated_at: new Date(),
        results: [],
        config: {
          page_ids: splitPageIds,
        },
      });

      // Fire off the first chunk processing (non-blocking)
      fetch(`${process.env.NEXT_PUBLIC_URL || ''}/api/jobs/${cropJobId}/process`, {
        method: 'POST',
      }).catch(() => {
        // Ignore errors - job will be picked up later
      });
    }

    // Log adjustments for algorithm learning (non-blocking)
    const adjustments = splits
      .filter(s => s.wasAdjusted && s.detectedPosition !== undefined)
      .map(s => ({
        pageId: s.pageId,
        bookId,
        detectedPosition: s.detectedPosition,
        chosenPosition: s.splitPosition,
        delta: s.splitPosition - (s.detectedPosition ?? 500),
        timestamp: new Date()
      }));

    if (adjustments.length > 0) {
      // Don't await - fire and forget
      db.collection('split_adjustments').insertMany(adjustments).catch(() => {});
      console.log(`[Split Learning] ${adjustments.length} adjustments logged:`,
        adjustments.map(a => `${a.detectedPosition} → ${a.chosenPosition} (Δ${a.delta > 0 ? '+' : ''}${a.delta})`).join(', ')
      );
    }

    // Trigger ML model auto-update with new training data (non-blocking)
    // This imports the user splits as training examples and retrains if we have enough data
    const leftPageIds = splits.map(s => s.pageId);
    fetch(`${process.env.NEXT_PUBLIC_URL || ''}/api/split-ml/auto-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageIds: leftPageIds,
        bookId,
        autoRetrain: true,
        minExamplesForRetrain: 20,
      }),
    }).catch((error) => {
      console.log('[Split Learning] Auto-update trigger failed:', error);
    });

    return NextResponse.json({
      success: true,
      splitCount: newPages.length,
      totalPages: allPages.length,
      adjustmentsLogged: adjustments.length,
      cropJobId,
      cropJobPagesCount: splitPageIds.length,
      message: cropJobId
        ? `Split complete. Generating cropped images for ${splitPageIds.length} pages...`
        : 'Split complete.'
    });
  } catch (error) {
    console.error('Error batch splitting pages:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch split failed' },
      { status: 500 }
    );
  }
}

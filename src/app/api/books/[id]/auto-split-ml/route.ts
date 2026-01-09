import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { extractFeatures, predictWithModel, type SplitModel } from '@/lib/splitDetectionML';
import { images } from '@/lib/api-client';

/**
 * POST /api/books/[id]/auto-split-ml
 *
 * Automatically split all two-page spreads in a book using the ML model.
 * Only processes pages that have photo_original but no crop.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const { limit = 50, dryRun = false } = await request.json().catch(() => ({}));

    const db = await getDb();

    // Get the active ML model
    const model = await db.collection('split_models')
      .findOne({ isActive: true }) as unknown as SplitModel | null;

    if (!model) {
      return NextResponse.json(
        { error: 'No trained ML model available' },
        { status: 400 }
      );
    }

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages that need splitting (have photo_original but no crop)
    const pagesToSplit = await db.collection('pages')
      .find({
        book_id: bookId,
        photo_original: { $exists: true, $ne: null },
        crop: { $exists: false }
      })
      .limit(limit)
      .toArray();

    if (pagesToSplit.length === 0) {
      return NextResponse.json({
        message: 'No pages need splitting',
        processed: 0
      });
    }

    const splits: Array<{
      pageId: string;
      splitPosition: number;
      detectedPosition: number;
    }> = [];
    const errors: string[] = [];

    for (const page of pagesToSplit) {
      try {
        // Fetch image - use smaller version for speed
        let imageUrl = page.photo_original;
        if (imageUrl.includes('archive.org') && imageUrl.includes('pct:50')) {
          imageUrl = imageUrl.replace('pct:50', 'pct:25');
        }

        const imageBuffer = await images.fetchBuffer(imageUrl, { timeout: 30000 });
        const features = await extractFeatures(imageBuffer);

        // Predict split position using ML
        const position = predictWithModel(features, model);

        splits.push({
          pageId: page.id,
          splitPosition: position,
          detectedPosition: position
        });

      } catch (error) {
        errors.push(`Error processing page ${page.page_number}: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    if (splits.length === 0) {
      return NextResponse.json({
        message: 'No pages to split',
        processed: 0,
        errors
      });
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        wouldSplit: splits.length,
        splits: splits.slice(0, 10), // Show first 10
        errors
      });
    }

    // Apply splits using batch-split endpoint logic
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

    const pages = await db.collection('pages')
      .find({ id: { $in: splits.map(s => s.pageId) } })
      .toArray();

    for (const split of splits) {
      const page = pages.find(p => p.id === split.pageId);
      if (!page || !page.photo_original) continue;

      const overlap = 10;
      const leftCrop = { xStart: 0, xEnd: Math.min(1000, split.splitPosition + overlap) };
      const rightCrop = { xStart: Math.max(0, split.splitPosition - overlap), xEnd: 1000 };

      updateOps.push({
        updateOne: {
          filter: { id: page.id },
          update: {
            $set: {
              crop: leftCrop,
              photo_original: page.photo_original,
              updated_at: new Date()
            }
          }
        }
      });

      const { ObjectId } = await import('mongodb');
      const newPageId = new ObjectId().toHexString();
      newPages.push({
        id: newPageId,
        book_id: bookId,
        page_number: page.page_number + 0.5,
        photo: page.photo_original,
        photo_original: page.photo_original,
        crop: rightCrop,
        split_from: page.id,
        ocr: null,
        translation: null,
        summary: null,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    // Execute updates and inserts
    await Promise.all([
      updateOps.length > 0 ? db.collection('pages').bulkWrite(updateOps) : Promise.resolve(),
      newPages.length > 0 ? db.collection('pages').insertMany(newPages) : Promise.resolve()
    ]);

    // Renumber all pages
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

    return NextResponse.json({
      success: true,
      splitCount: newPages.length,
      totalPages: allPages.length,
      errors,
      remainingToProcess: pagesToSplit.length - splits.length
    });

  } catch (error) {
    console.error('Auto-split ML error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Auto-split failed' },
      { status: 500 }
    );
  }
}

/**
 * GET - Check how many pages need splitting
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const needsSplitting = await db.collection('pages').countDocuments({
      book_id: bookId,
      photo_original: { $exists: true, $ne: null },
      crop: { $exists: false }
    });

    const alreadySplit = await db.collection('pages').countDocuments({
      book_id: bookId,
      crop: { $exists: true }
    });

    return NextResponse.json({
      bookId,
      title: book.title,
      needsSplitting,
      alreadySplit,
      totalPages: needsSplitting + alreadySplit
    });

  } catch (error) {
    console.error('Error checking split status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
}

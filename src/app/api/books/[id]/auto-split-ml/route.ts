import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { extractFeatures, predictWithModel, detectSplitWithGemini, type SplitModel } from '@/lib/page-split/splitDetectionML';
import { images } from '@/lib/api-client';
import { cropAndUploadHalf, generateAndUploadThumbnail } from '@/lib/page-split/split-processing';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * POST /api/books/[id]/auto-split-ml
 *
 * Automatically split all two-page spreads in a book.
 * Supports method: 'gemini' (default, uses Gemini vision) or 'ml' (local ML model).
 * Only processes pages that have photo_original but no crop.
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const { limit = 50, dryRun = false, method = 'gemini' } = await request.json().catch(() => ({}));

    const db = await getDb();

    // For ML method, load the trained model
    let model: SplitModel | null = null;
    if (method === 'ml') {
      model = await db.collection('split_models')
        .findOne({ isActive: true }) as unknown as SplitModel | null;
      if (!model) {
        return NextResponse.json(
          { error: 'No trained ML model available' },
          { status: 400 }
        );
      }
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
        let imageUrl = page.photo_original;
        if (imageUrl.includes('archive.org') && imageUrl.includes('pct:50')) {
          imageUrl = imageUrl.replace('pct:50', 'pct:25');
        }

        let position: number;

        if (method === 'gemini') {
          // Use Gemini vision for split detection
          const geminiResult = await detectSplitWithGemini(imageUrl);
          if (!geminiResult.isTwoPageSpread) {
            continue; // Gemini says it's not a spread — skip
          }
          position = geminiResult.splitPosition;
        } else {
          // Use local ML model
          const imageBuffer = await images.fetchBuffer(imageUrl, { timeout: 30000 });
          const features = await extractFeatures(imageBuffer);
          position = predictWithModel(features, model!);
        }

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

    // Apply splits
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
        update: { $set: Record<string, unknown>; $unset?: Record<string, string> };
      };
    }> = [];

    const pages = await db.collection('pages')
      .find({ id: { $in: splits.map(s => s.pageId) } })
      .toArray();

    // Count pages with existing OCR/translation that will be cleared
    const pagesWithOcr = pages.filter(p => p.ocr?.data).length;
    const pagesWithTranslation = pages.filter(p => p.translation?.data).length;

    for (const split of splits) {
      const page = pages.find(p => p.id === split.pageId);
      if (!page || !page.photo_original) continue;

      const overlap = 10;
      const leftCrop = { xStart: 0, xEnd: Math.min(1000, split.splitPosition + overlap) };
      const rightCrop = { xStart: Math.max(0, split.splitPosition - overlap), xEnd: 1000 };

      // Update existing page with left crop + clear stale OCR/translation
      updateOps.push({
        updateOne: {
          filter: { id: page.id },
          update: {
            $set: {
              crop: leftCrop,
              photo_original: page.photo_original,
              updated_at: new Date()
            },
            $unset: { ocr: '', translation: '', summary: '' }
          }
        }
      });

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

    // Renumber all pages - sort by page_number first, then _id to break ties deterministically
    // (new right-half pages get page_number + 0.5, so they sort after the left half)
    const allPages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1, _id: 1 })
      .toArray();

    const renumberOps = allPages.map((p, i) => ({
      updateOne: {
        filter: { id: p.id },
        update: {
          $set: { page_number: i + 1 },
          $unset: { thumbnail_blob: '' }
        }
      }
    }));

    if (renumberOps.length > 0) {
      await db.collection('pages').bulkWrite(renumberOps);
    }

    // Update book page count and OCR/translation caches
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          pages: allPages.length,
          pages_ocr: Math.max(0, (await db.collection('pages').countDocuments({
            book_id: bookId,
            'ocr.data': { $exists: true, $ne: '' }
          }))),
          pages_translated: Math.max(0, (await db.collection('pages').countDocuments({
            book_id: bookId,
            'translation.data': { $exists: true, $ne: '' }
          })))
        }
      }
    );

    // Generate cropped images + thumbnails inline
    const splitPageIds = [
      ...splits.map(s => s.pageId),
      ...newPages.map(p => p.id),
    ];

    const splitPagesForCrop = await db.collection('pages')
      .find({ id: { $in: splitPageIds } })
      .toArray();

    let imagesGenerated = 0;
    let thumbnailsGenerated = 0;
    let imageErrors = 0;

    const BATCH_SIZE = 5;
    for (let i = 0; i < splitPagesForCrop.length; i += BATCH_SIZE) {
      const batch = splitPagesForCrop.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (page) => {
          if (!page.crop) return;
          const sourceUrl = (page.archived_photo && page.archived_photo.startsWith('http')) ? page.archived_photo : (page.photo_original || page.photo);
          if (!sourceUrl) return;

          try {
            const buffer = await images.fetchBuffer(sourceUrl, { timeout: 30000 });
            const { url: croppedUrl, buffer: croppedBuffer } = await cropAndUploadHalf(
              buffer, page.crop, bookId, page.id
            );
            const { url: thumbnailUrl } = await generateAndUploadThumbnail(
              croppedBuffer, bookId, page.id
            );

            await db.collection('pages').updateOne(
              { id: page.id },
              { $set: { cropped_photo: croppedUrl, thumbnail_blob: thumbnailUrl, updated_at: new Date() } }
            );
            imagesGenerated++;
            thumbnailsGenerated++;
          } catch (err) {
            console.error(`[auto-split-ml] Failed to generate cropped image for page ${page.id}:`, err);
            imageErrors++;
          }
        })
      );
    }

    return NextResponse.json({
      success: true,
      splitCount: newPages.length,
      totalPages: allPages.length,
      ocrCleared: pagesWithOcr,
      translationCleared: pagesWithTranslation,
      imagesGenerated,
      thumbnailsGenerated,
      imageErrors,
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
});

/**
 * GET - Check how many pages need splitting
 */
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
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
});

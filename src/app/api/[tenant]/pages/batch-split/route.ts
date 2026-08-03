import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { images } from '@/lib/api-client';
import { cropAndUploadHalf, generateAndUploadThumbnail } from '@/lib/page-split/split-processing';
import { withAuth } from '@/lib/auth-helpers';
import { resolveTenantId } from '@/lib/tenant-context';

export const maxDuration = 300;

interface SplitRequest {
  pageId: string;
  splitPosition: number; // 0-1000 scale
  detectedPosition?: number; // What the algorithm detected
  wasAdjusted?: boolean; // Whether user manually adjusted
}

export const POST = withAuth(async (request, session, context) => {
  try {
    const { tenant } = await context.params;
    const db = await getDb();
    
    // Resolve tenant slug to UUID
    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    
    const body = await request.json();
    const { splits, confirmClearOcr }: { splits: SplitRequest[]; confirmClearOcr?: boolean } = body;

    if (!splits || splits.length === 0) {
      return NextResponse.json({ error: 'No splits provided' }, { status: 400 });
    }

    // Get all pages to split
    const pageIds = splits.map(s => s.pageId);
    const pages = await db.collection('pages')
      .find({ id: { $in: pageIds }, tenantId })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found' }, { status: 404 });
    }

    // Get book_id from first page (all should be same book)
    const bookId = pages[0].book_id;

    // Check for existing OCR/translation that will be cleared
    const pagesWithOcr = pages.filter(p => p.ocr?.data).length;
    const pagesWithTranslation = pages.filter(p => p.translation?.data).length;

    if ((pagesWithOcr > 0 || pagesWithTranslation > 0) && !confirmClearOcr) {
      return NextResponse.json({
        warning: true,
        pagesWithOcr,
        pagesWithTranslation,
        message: `${pagesWithOcr} pages have OCR and ${pagesWithTranslation} have translations. Splitting will clear this data.`
      });
    }

    // Create all new pages and update existing pages
    const newPages: Array<{
      id: string;
      book_id: string;
      tenantId: string;
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
        filter: { id: string; tenantId: string };
        update: { $set: Record<string, unknown>; $unset?: Record<string, string> };
      };
    }> = [];

    // Check for pages that were already split (have child pages)
    const existingChildren = await db.collection('pages')
      .find({ split_from: { $in: pageIds }, tenantId })
      .project({ split_from: 1 })
      .toArray();
    const alreadySplitIds = new Set(existingChildren.map(c => c.split_from));

    for (const split of splits) {
      const page = pages.find(p => p.id === split.pageId);
      if (!page || !page.photo) continue;
      if (alreadySplitIds.has(page.id)) continue; // Skip already-split pages

      // Add 1% overlap (10 on 0-1000 scale) on each side
      const overlap = 10;
      const leftCrop = { xStart: 0, xEnd: Math.min(1000, split.splitPosition + overlap) };
      const rightCrop = { xStart: Math.max(0, split.splitPosition - overlap), xEnd: 1000 };

      // Update existing page with left crop + clear stale OCR/translation
      updateOps.push({
        updateOne: {
          filter: { id: page.id, tenantId },
          update: {
            $set: {
              crop: leftCrop,
              photo_original: page.photo_original || page.photo,
              updated_at: new Date()
            },
            $unset: { ocr: '', translation: '', summary: '' }
          }
        }
      });

      // Create new page for right side
      const newPageId = new ObjectId().toHexString();
      newPages.push({
        id: newPageId,
        book_id: bookId,
        tenantId,
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
      .find({ book_id: bookId, tenantId })
      .sort({ page_number: 1, _id: 1 })
      .toArray();

    const renumberOps = allPages.map((p, i) => ({
      updateOne: {
        filter: { id: p.id, tenantId },
        update: {
          $set: { page_number: i + 1 },
          $unset: { thumbnail_blob: '' }
        }
      }
    }));

    if (renumberOps.length > 0) {
      await db.collection('pages').bulkWrite(renumberOps);
    }

    // Update book page count and clear stale OCR/translation caches
    await db.collection('books').updateOne(
      { id: bookId, tenantId },
      {
        $set: {
          pages: allPages.length,
          pages_ocr: Math.max(0, (await db.collection('pages').countDocuments({
            book_id: bookId,
            'ocr.data': { $exists: true, $ne: '' },
            tenantId
          }))),
          pages_translated: Math.max(0, (await db.collection('pages').countDocuments({
            book_id: bookId,
            'translation.data': { $exists: true, $ne: '' },
            tenantId
          })))
        }
      }
    );

    // Generate cropped images + thumbnails inline
    const splitPageIds = [
      ...splits.map(s => s.pageId),  // Original pages (left side)
      ...newPages.map(p => p.id),     // New pages (right side)
    ];

    // Re-fetch all split pages to get their current crop data
    const splitPages = await db.collection('pages')
      .find({ id: { $in: splitPageIds }, tenantId })
      .toArray();

    let imagesGenerated = 0;
    let thumbnailsGenerated = 0;
    let imageErrors = 0;

    // Process in batches of 5 to avoid overwhelming Blob storage
    const BATCH_SIZE = 5;
    for (let i = 0; i < splitPages.length; i += BATCH_SIZE) {
      const batch = splitPages.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (page) => {
          if (!page.crop) return;

          // Get source image URL (prefer archived_photo for reliability)
          const sourceUrl = page.archived_photo || page.photo_original || page.photo;
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
              { id: page.id, tenantId },
              {
                $set: {
                  cropped_photo: croppedUrl,
                  thumbnail_blob: thumbnailUrl,
                  updated_at: new Date()
                }
              }
            );

            imagesGenerated++;
            thumbnailsGenerated++;
          } catch (err) {
            console.error(`[batch-split] Failed to generate cropped image for page ${page.id}:`, err);
            imageErrors++;
          }
        })
      );

      // Count any additional failures from Promise.allSettled
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('[batch-split] Batch processing error:', r.reason);
          imageErrors++;
        }
      }
    }

    // Log adjustments for algorithm learning (non-blocking)
    const adjustments = splits
      .filter(s => s.wasAdjusted && s.detectedPosition !== undefined)
      .map(s => ({
        pageId: s.pageId,
        bookId,
        tenantId,
        detectedPosition: s.detectedPosition,
        chosenPosition: s.splitPosition,
        delta: s.splitPosition - (s.detectedPosition ?? 500),
        timestamp: new Date()
      }));

    if (adjustments.length > 0) {
      db.collection('split_adjustments').insertMany(adjustments).catch(() => {});
      console.log(`[Split Learning] ${adjustments.length} adjustments logged:`,
        adjustments.map(a => `${a.detectedPosition} -> ${a.chosenPosition} (d${a.delta > 0 ? '+' : ''}${a.delta})`).join(', ')
      );
    }

    // Trigger ML model auto-update with new training data (non-blocking)
    const leftPageIds = splits.map(s => s.pageId);
    fetch(`${process.env.NEXT_PUBLIC_URL || ''}/api/split-ml/auto-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageIds: leftPageIds,
        bookId,
        tenantId,
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
      ocrCleared: pagesWithOcr,
      translationCleared: pagesWithTranslation,
      imagesGenerated,
      thumbnailsGenerated,
      imageErrors,
      message: `Split complete. ${imagesGenerated} cropped images and ${thumbnailsGenerated} thumbnails generated.${imageErrors > 0 ? ` ${imageErrors} image errors.` : ''}`
    });
  } catch (error) {
    console.error('Error batch splitting pages:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch split failed' },
      { status: 500 }
    );
  }
}, { minRole: 'editor' });

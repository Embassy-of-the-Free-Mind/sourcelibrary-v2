import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { generateGalleryImages } from '@/lib/gallery-image-gen';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * POST /api/admin/generate-gallery-thumbnails
 *
 * Backfill pre-generated gallery images for detections that have bbox
 * but no extracted_url. Processes in batches of 5, up to 200 per invocation.
 *
 * Query params:
 *   - limit: max detections to process (default 200, max 500)
 *   - bookId: optional, process only this book
 *   - minQuality: minimum gallery_quality (default 0, e.g. 0.9 for best images)
 *   - archivedOnly: if 'true', only process pages with archived_photo (Blob URLs, much faster)
 *   - dry_run: if 'true', just count how many need processing
 */
export const POST = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);
    const bookId = searchParams.get('bookId');
    const minQuality = parseFloat(searchParams.get('minQuality') || '0');
    const dryRun = searchParams.get('dry_run') === 'true';
    const archivedOnly = searchParams.get('archivedOnly') === 'true';

    const db = await getDb();

    // Find pages with detections that have bbox but no extracted_url
    const matchFilter: Record<string, unknown> = {
      'detected_images': {
        $elemMatch: {
          bbox: { $exists: true },
          extracted_url: { $exists: false },
          detection_source: { $in: ['vision_model', 'manual', 'ocr_tag'] },
          ...(minQuality > 0 ? { gallery_quality: { $gte: minQuality } } : {}),
        }
      },
    };

    if (archivedOnly) {
      // Only pages with fast Vercel Blob URLs
      matchFilter.archived_photo = { $exists: true, $ne: '' };
    } else {
      matchFilter.$or = [
        { archived_photo: { $exists: true, $ne: '' } },
        { cropped_photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } },
      ];
    }
    if (bookId) matchFilter.book_id = bookId;

    if (dryRun) {
      const count = await db.collection('pages').countDocuments(matchFilter);
      return NextResponse.json({ needsProcessing: count, dryRun: true });
    }

    const pages = await db.collection('pages')
      .find(matchFilter)
      .limit(limit)
      .project({ id: 1, book_id: 1, detected_images: 1, archived_photo: 1, cropped_photo: 1, photo_original: 1, photo: 1 })
      .toArray();

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process in batches of 5
    for (let i = 0; i < pages.length; i += 5) {
      const batch = pages.slice(i, i + 5);
      const promises = batch.flatMap(page => {
        const sourceUrl = page.archived_photo || page.cropped_photo || page.photo_original || page.photo;
        if (!sourceUrl) return [];

        return (page.detected_images || [])
          .map((det: Record<string, unknown>, idx: number) => ({ det, idx }))
          .filter(({ det }: { det: Record<string, unknown> }) =>
            det.bbox && !det.extracted_url &&
            (minQuality <= 0 || (typeof det.gallery_quality === 'number' && det.gallery_quality >= minQuality))
          )
          .map(async ({ det, idx }: { det: Record<string, unknown>; idx: number }) => {
            try {
              const bbox = det.bbox as { x: number; y: number; width: number; height: number };
              const rotation = (det.rotation as 0 | 90 | 180 | 270) || 0;
              const result = await generateGalleryImages({
                sourceImageUrl: sourceUrl,
                bbox,
                rotation,
                bookId: page.book_id,
                pageId: page.id,
                detectionIndex: idx,
              });

              await db.collection('pages').updateOne(
                { id: page.id },
                {
                  $set: {
                    [`detected_images.${idx}.extracted_url`]: result.extractedUrl,
                    [`detected_images.${idx}.thumbnail_url`]: result.thumbnailUrl,
                  }
                }
              );
              processed++;
            } catch (err) {
              failed++;
              errors.push(`${page.id}:${idx} - ${err instanceof Error ? err.message : 'unknown'}`);
            }
          });
      });

      await Promise.all(promises);
    }

    return NextResponse.json({
      processed,
      failed,
      pagesScanned: pages.length,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    console.error('Generate gallery thumbnails error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
});

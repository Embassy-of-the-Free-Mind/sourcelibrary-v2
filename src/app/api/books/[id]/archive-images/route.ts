import { NextRequest, NextResponse } from 'next/server';
import { storagePut, pagePaths } from '@/lib/storage';
import { getDb } from '@/lib/mongodb';
import { images } from '@/lib/api-client/images';
import { compress_photo } from '@/lib/image-manipulation';
import { withAuth } from '@/lib/auth-helpers';
import sharp from 'sharp';
// Which source hosts we will fetch from — ONE list, shared with the watchdog and
// the cover archiver. See src/lib/archivable-sources.ts for why three private
// copies of this became a silent no-op.
import { ARCHIVABLE_SOURCES_REGEX } from '@/lib/archivable-sources';

// Increase timeout for archiving many images
export const maxDuration = 300;


/**
 * Recount archived pages and write the cached counter back onto the book (#3712).
 *
 * `books.pages_archived` is what selectors key on — `archive-erara.mjs` picks work with
 * `pages_archived: { $not: { $gte: 1 } }` and `archiving-watchdog.mjs` buckets a book as
 * "progressing" only when the counter is > 0. A book archived entirely through this route
 * used to leave the counter at 0 with every page on R2, so it stayed permanently eligible
 * for re-archiving and a re-run re-downloaded every page from the source.
 *
 * Recount rather than increment: the route is called repeatedly with `limit`, and it
 * routinely returns Cloudflare 524s (the edge times out at ~100s while the function works
 * on to its 300s maxDuration), so callers retry work that in fact completed. An increment
 * would drift on every one of those retries.
 *
 * Matches the counting predicate used by `scripts/workers/archive-bulk.mjs` — a non-empty
 * string, not merely a present field.
 */
async function syncArchivedCounter(
  db: Awaited<ReturnType<typeof getDb>>,
  bookId: string,
  pagesCount: number | undefined,
): Promise<number> {
  const archivedCount = await db.collection('pages').countDocuments(
    { book_id: bookId, archived_photo: { $exists: true, $nin: [null, ''] } },
    { maxTimeMS: 10000 },
  );

  const update: Record<string, unknown> = {
    pages_archived: archivedCount,
    updated_at: new Date(),
  };

  // Only claim a status when we know the denominator. A book with no pages_count
  // would otherwise be marked complete on the first archived page.
  if (typeof pagesCount === 'number' && pagesCount > 0) {
    const archiveStatus = archivedCount >= pagesCount ? 'archive_complete' : 'archive_partial';
    update.archive_status = archiveStatus;
    if (archiveStatus === 'archive_complete') {
      update.archive_completed_at = new Date();
    }
  }

  await db.collection('books').updateOne({ id: bookId }, { $set: update });
  return archivedCount;
}

/**
 * POST /api/books/[id]/archive-images
 *
 * Download images from external sources and upload to Vercel Blob.
 * Supports: Internet Archive, Gallica (BnF), MDZ (Bavarian State Library)
 * This makes images available even when source sites are down.
 *
 * Note: this route writes `archived_photo` but no `display_photo`, so a book archived
 * only through here has no R2 display variant and the reader falls back to the source
 * URL. That is expected — the Hetzner/local workers generate the display variants.
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const {
      limit = 50,
      dryRun = false,
      force = false,
    } = body;

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages that need archiving (from IA, Gallica, or MDZ)
    const query: Record<string, unknown> = {
      book_id: bookId,
      $or: [
        { photo: { $regex: ARCHIVABLE_SOURCES_REGEX } },
        { photo_original: { $regex: ARCHIVABLE_SOURCES_REGEX } },
      ],
    };

    // Skip already archived unless force=true
    if (!force) {
      query.archived_photo = { $exists: false };
    }

    const pagesToArchive = await db.collection('pages')
      .find(query)
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray();

    if (pagesToArchive.length === 0) {
      const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
      // Sync here too, not just after a successful batch: a book that was fully archived
      // by an earlier call (or by a call the edge timed out on) lands in exactly this
      // branch, and this is what lets a stale counter self-heal instead of keeping the
      // book selectable for re-archiving forever.
      const archivedPages = await syncArchivedCounter(db, bookId, book.pages_count ?? totalPages);

      return NextResponse.json({
        message: 'No pages need archiving',
        archived: 0,
        totalPages,
        archivedPages,
        percentArchived: totalPages > 0 ? Math.round((archivedPages / totalPages) * 100) : 0
      });
    }

    if (dryRun) {
      const totalNeeding = await db.collection('pages').countDocuments(query);
      return NextResponse.json({
        dryRun: true,
        wouldArchive: pagesToArchive.length,
        totalNeedingArchive: totalNeeding,
        samplePages: pagesToArchive.slice(0, 5).map(p => ({
          id: p.id,
          pageNumber: p.page_number,
          currentUrl: p.photo_original || p.photo
        }))
      });
    }

    // Process in batches of 5 to avoid overwhelming source servers
    const batchSize = 5;
    const results: Array<{
      pageId: string;
      pageNumber: number;
      success: boolean;
      error?: string;
      blobUrl?: string;
    }> = [];

    let totalBytesUploaded = 0;

    for (let i = 0; i < pagesToArchive.length; i += batchSize) {
      const batch = pagesToArchive.slice(i, i + batchSize);

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (page) => {
          const sourceUrl = page.photo_original || page.photo;

          try {
            // Download from source (IA, Gallica, or MDZ) with mime type detection
            const { buffer, mimeType } = await images.fetchBufferWithMimeType(sourceUrl);
            const bytes = buffer.byteLength;

            // Upload full-res to R2
            const paths = pagePaths(bookId, page.page_number);
            const blob = await storagePut(paths.full, buffer, {
              access: 'public',
              contentType: mimeType,
              addRandomSuffix: false,
              allowOverwrite: true,
            });

            // Generate 150px thumbnail
            let thumbnailUrl: string | undefined;
            try {
              const thumbBuffer = await compress_photo(buffer, 150, 60);
              const thumbBlob = await storagePut(paths.thumb, thumbBuffer, {
                access: 'public',
                contentType: 'image/jpeg',
                addRandomSuffix: false,
                allowOverwrite: true,
              });
              thumbnailUrl = thumbBlob.url;
            } catch {
              // Non-fatal — thumbnail can be generated later
            }

            // Read image dimensions from the full-res buffer
            let imageWidth: number | undefined;
            let imageHeight: number | undefined;
            try {
              const meta = await sharp(buffer).metadata();
              imageWidth = meta.width;
              imageHeight = meta.height;
            } catch {
              // Non-fatal — dimensions can be backfilled later
            }

            // Update page record
            const updateFields: Record<string, unknown> = {
              archived_photo: blob.url,
              'archive_metadata.archived_at': new Date(),
              'archive_metadata.source_url': sourceUrl,
              'archive_metadata.bytes': bytes,
              updated_at: new Date()
            };
            if (imageWidth) updateFields.image_width = imageWidth;
            if (imageHeight) updateFields.image_height = imageHeight;
            if (thumbnailUrl) {
              updateFields.thumbnail_blob = thumbnailUrl;
              updateFields.image_thumb = thumbnailUrl;
            }

            await db.collection('pages').updateOne(
              { id: page.id },
              { $set: updateFields }
            );

            totalBytesUploaded += bytes;

            return {
              pageId: page.id,
              pageNumber: page.page_number,
              success: true,
              blobUrl: blob.url
            };
          } catch (error) {
            return {
              pageId: page.id,
              pageNumber: page.page_number,
              success: false,
              error: error instanceof Error ? error.message : 'Archive failed'
            };
          }
        })
      );

      results.push(...batchResults);

      // Small delay between batches to be nice to source servers
      if (i + batchSize < pagesToArchive.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Get updated counts, and record the archived count on the book so selectors and the
    // watchdog can see this route's work (#3712).
    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
    const archivedPages = await syncArchivedCounter(db, bookId, book.pages_count ?? totalPages);
    const remainingCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      archived_photo: { $exists: false },
      $or: [
        { photo: { $regex: ARCHIVABLE_SOURCES_REGEX } },
        { photo_original: { $regex: ARCHIVABLE_SOURCES_REGEX } },
      ],
    });

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    // Estimate cost (Vercel Blob: $0.023/GB storage, $5/million uploads)
    const storageCostEstimate = (totalBytesUploaded / (1024 * 1024 * 1024)) * 0.023;
    const uploadCostEstimate = (successCount / 1000000) * 5;

    return NextResponse.json({
      success: true,
      archived: successCount,
      failed: failedCount,
      remaining: remainingCount,
      totalPages,
      archivedPages,
      percentArchived: totalPages > 0 ? Math.round((archivedPages / totalPages) * 100) : 0,
      usage: {
        bytesUploaded: totalBytesUploaded,
        megabytesUploaded: Math.round(totalBytesUploaded / (1024 * 1024) * 100) / 100,
        estimatedMonthlyCost: `$${(storageCostEstimate + uploadCostEstimate).toFixed(4)}`
      },
      results: results.slice(0, 20), // First 20 for debugging
    });

  } catch (error) {
    console.error('Archive images error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Archive failed' },
      { status: 500 }
    );
  }
});

/**
 * GET /api/books/[id]/archive-images
 *
 * Check archive status for a book
 */
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });

    const archivedPages = await db.collection('pages').countDocuments({
      book_id: bookId,
      archived_photo: { $exists: true, $ne: null }
    });

    const externalPages = await db.collection('pages').countDocuments({
      book_id: bookId,
      archived_photo: { $exists: false },
      $or: [
        { photo: { $regex: ARCHIVABLE_SOURCES_REGEX } },
        { photo_original: { $regex: ARCHIVABLE_SOURCES_REGEX } },
      ],
    });

    // Estimate total size based on archived pages
    const archivedWithSize = await db.collection('pages')
      .find({
        book_id: bookId,
        'archive_metadata.bytes': { $exists: true }
      })
      .project({ 'archive_metadata.bytes': 1 })
      .toArray();

    const totalArchivedBytes = archivedWithSize.reduce(
      (sum, p) => sum + (p.archive_metadata?.bytes || 0),
      0
    );

    const avgBytesPerPage = archivedWithSize.length > 0
      ? totalArchivedBytes / archivedWithSize.length
      : 500000; // Default 500KB estimate

    const estimatedTotalBytes = avgBytesPerPage * totalPages;

    return NextResponse.json({
      bookId,
      title: book.title,
      totalPages,
      archivedPages,
      externalPages,
      percentArchived: totalPages > 0 ? Math.round((archivedPages / totalPages) * 100) : 0,
      storage: {
        archivedBytes: totalArchivedBytes,
        archivedMB: Math.round(totalArchivedBytes / (1024 * 1024) * 100) / 100,
        estimatedTotalMB: Math.round(estimatedTotalBytes / (1024 * 1024) * 100) / 100,
      }
    });

  } catch (error) {
    console.error('Error checking archive status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
});

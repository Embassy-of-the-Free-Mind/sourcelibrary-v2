import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getDb } from '@/lib/mongodb';
import { images } from '@/lib/api-client/images';

// Increase timeout for archiving many images
export const maxDuration = 300;

// Regex pattern to match pages from external sources that can be archived
const ARCHIVABLE_SOURCES_REGEX = /archive\.org|gallica\.bnf\.fr|digitale-sammlungen\.de/;

/**
 * POST /api/books/[id]/archive-images
 *
 * Download images from external sources and upload to Vercel Blob.
 * Supports: Internet Archive, Gallica (BnF), MDZ (Bavarian State Library)
 * This makes images available even when source sites are down.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
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
      const archivedPages = await db.collection('pages').countDocuments({
        book_id: bookId,
        archived_photo: { $exists: true, $ne: null }
      });

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

            // Upload to Vercel Blob
            const filename = `archived/${bookId}/${page.page_number}.jpg`;
            const blob = await put(filename, buffer, {
              access: 'public',
              contentType: mimeType,
              addRandomSuffix: false,
            });

            // Update page record
            await db.collection('pages').updateOne(
              { id: page.id },
              {
                $set: {
                  archived_photo: blob.url,
                  'archive_metadata.archived_at': new Date(),
                  'archive_metadata.source_url': sourceUrl,
                  'archive_metadata.bytes': bytes,
                  updated_at: new Date()
                }
              }
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

    // Get updated counts
    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
    const archivedPages = await db.collection('pages').countDocuments({
      book_id: bookId,
      archived_photo: { $exists: true, $ne: null }
    });
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
      percentArchived: Math.round((archivedPages / totalPages) * 100),
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
}

/**
 * GET /api/books/[id]/archive-images
 *
 * Check archive status for a book
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
}

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import {
  buildEmbeddingText,
  generateEmbedding,
  EMBEDDING_MODEL,
  type GalleryEmbedding,
} from '@/lib/embeddings';
import { logGeminiCall } from '@/lib/gemini-logger';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;
export const preferredRegion = 'fra1';

/**
 * POST /api/admin/generate-embeddings
 *
 * Generates text embeddings for gallery images that have metadata but no embedding yet.
 * Uses Gemini text-embedding-004 (~$0.10 for 10k images).
 *
 * Query params:
 *   - limit: max images to process (default 200, max 1000)
 *   - bookId: optional, only process this book
 *   - minQuality: minimum gallery_quality (default 0.5)
 *   - dry_run: if 'true', just count
 */
export const POST = withAdminAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 1000);
    const bookId = searchParams.get('bookId');
    const minQuality = parseFloat(searchParams.get('minQuality') || '0.5');
    const dryRun = searchParams.get('dry_run') === 'true';

    const db = await getDb();

    // Find pages with detected images that have metadata
    const pageFilter: Record<string, unknown> = {
      'detected_images.0': { $exists: true },
      'detected_images.gallery_quality': { $gte: minQuality },
    };
    if (bookId) pageFilter.book_id = bookId;

    // Get pages with gallery-quality images
    const pages = await db
      .collection('pages')
      .find(pageFilter, {
        projection: {
          id: 1,
          book_id: 1,
          detected_images: 1,
        },
      })
      .limit(limit * 3) // Fetch extra since not all detections qualify
      .toArray();

    // Get existing embedding IDs to skip
    const existingIds = new Set(
      (
        await db
          .collection('gallery_embeddings')
          .find({}, { projection: { id: 1 } })
          .toArray()
      ).map((e) => e.id as string)
    );

    // Build work items: images with metadata but no embedding
    const workItems: {
      id: string;
      pageId: string;
      bookId: string;
      detectionIndex: number;
      text: string;
    }[] = [];

    for (const page of pages) {
      const detections = (page.detected_images || []) as Record<string, unknown>[];
      for (let idx = 0; idx < detections.length; idx++) {
        const det = detections[idx];
        const embId = `${page.id}-${idx}`;

        if (existingIds.has(embId)) continue;
        if (typeof det.gallery_quality === 'number' && det.gallery_quality < minQuality) continue;

        const text = buildEmbeddingText({
          description: (det.description as string) || '',
          museum_description: det.museum_description as string | undefined,
          type: det.type as string | undefined,
          metadata: det.metadata as {
            subjects?: string[];
            figures?: string[];
            symbols?: string[];
            style?: string;
            technique?: string;
          } | undefined,
        });

        if (!text.trim()) continue;

        workItems.push({
          id: embId,
          pageId: page.id as string,
          bookId: page.book_id as string,
          detectionIndex: idx,
          text,
        });

        if (workItems.length >= limit) break;
      }
      if (workItems.length >= limit) break;
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        needsEmbedding: workItems.length,
        existingEmbeddings: existingIds.size,
        sampleTexts: workItems.slice(0, 3).map((w) => ({
          id: w.id,
          textPreview: w.text.slice(0, 200),
        })),
      });
    }

    // Process in batches of 50
    const BATCH_SIZE = 50;
    let processed = 0;
    let failed = 0;
    let totalTokens = 0;

    for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
      const batch = workItems.slice(i, i + BATCH_SIZE);
      const docs: GalleryEmbedding[] = [];

      for (const item of batch) {
        try {
          const embedding = await generateEmbedding(item.text);
          docs.push({
            id: item.id,
            page_id: item.pageId,
            book_id: item.bookId,
            detection_index: item.detectionIndex,
            embedding,
            text_source: item.text,
            model: EMBEDDING_MODEL,
            generated_at: new Date(),
          });
          // Rough token estimate: ~1 token per 4 chars
          totalTokens += Math.ceil(item.text.length / 4);
          processed++;

          // Small delay to avoid rate limits
          if (processed % 10 === 0) {
            await new Promise((r) => setTimeout(r, 100));
          }
        } catch (err) {
          console.error(`Embedding failed for ${item.id}:`, err);
          failed++;
        }
      }

      // Bulk insert
      if (docs.length > 0) {
        await db.collection('gallery_embeddings').bulkWrite(
          docs.map((doc) => ({
            updateOne: {
              filter: { id: doc.id },
              update: { $set: doc },
              upsert: true,
            },
          }))
        );
      }
    }

    // Log to gemini_usage
    if (processed > 0) {
      await logGeminiCall({
        type: 'other',
        mode: 'realtime',
        model: EMBEDDING_MODEL,
        page_count: processed,
        input_tokens: totalTokens,
        output_tokens: 0,
        status: 'success',
        endpoint: '/api/admin/generate-embeddings',
      }).catch(() => {}); // Non-blocking
    }

    return NextResponse.json({
      success: true,
      processed,
      failed,
      totalTokens,
      existingEmbeddings: existingIds.size,
      estimatedCost: `$${(totalTokens * 0.00001).toFixed(4)}`,
    });
  } catch (error) {
    console.error('Generate embeddings error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});

/**
 * GET /api/admin/generate-embeddings
 *
 * Returns embedding stats.
 */
export const GET = withAdminAuth(async (request, session) => {
  try {
    const db = await getDb();

    const [totalEmbeddings, byBook] = await Promise.all([
      db.collection('gallery_embeddings').countDocuments(),
      db
        .collection('gallery_embeddings')
        .aggregate([
          { $group: { _id: '$book_id', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ])
        .toArray(),
    ]);

    return NextResponse.json({
      totalEmbeddings,
      model: EMBEDDING_MODEL,
      topBooks: byBook.map((b) => ({ bookId: b._id, count: b.count })),
    });
  } catch (error) {
    console.error('Embedding stats error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});

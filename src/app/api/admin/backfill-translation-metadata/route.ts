import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { extractTranslationMetadata } from '@/lib/translation-metadata';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * POST /api/admin/backfill-translation-metadata
 *
 * Harvests <summary> and <keywords> tags from existing translation text
 * and persists them as page-level fields (translation_summary, translation_keywords).
 *
 * Query params:
 *   - book_id: optional, scope to one book
 *   - limit: max pages to process (default 5000)
 *   - dry_run: if "true", count but don't write
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('book_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '5000'), 50000);
    const dryRun = searchParams.get('dry_run') === 'true';

    const db = await getDb();

    // Find pages with translation data but no harvested metadata
    const filter: Record<string, unknown> = {
      'translation.data': { $exists: true, $ne: '' },
      translation_summary: { $exists: false },
    };
    if (bookId) filter.book_id = bookId;

    const pages = await db.collection('pages')
      .find(filter, { projection: { id: 1, 'translation.data': 1 } })
      .limit(limit)
      .toArray();

    if (dryRun) {
      // Count total eligible
      const total = await db.collection('pages').countDocuments(filter);
      return NextResponse.json({
        dry_run: true,
        eligible_pages: total,
        sample_size: pages.length,
      });
    }

    let updated = 0;
    let withSummary = 0;
    let withKeywords = 0;
    const bulkOps = [];

    for (const page of pages) {
      const text = page.translation?.data;
      if (!text) continue;

      const meta = extractTranslationMetadata(text);
      if (!meta.translation_summary && !meta.translation_keywords) continue;

      if (meta.translation_summary) withSummary++;
      if (meta.translation_keywords) withKeywords++;

      bulkOps.push({
        updateOne: {
          filter: { id: page.id },
          update: { $set: meta },
        },
      });

      // Execute in batches of 500
      if (bulkOps.length >= 500) {
        await db.collection('pages').bulkWrite(bulkOps);
        updated += bulkOps.length;
        bulkOps.length = 0;
      }
    }

    // Flush remaining
    if (bulkOps.length > 0) {
      await db.collection('pages').bulkWrite(bulkOps);
      updated += bulkOps.length;
    }

    return NextResponse.json({
      success: true,
      pages_scanned: pages.length,
      pages_updated: updated,
      with_summary: withSummary,
      with_keywords: withKeywords,
    });
  } catch (error) {
    console.error('Error backfilling translation metadata:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to backfill' },
      { status: 500 }
    );
  }
});

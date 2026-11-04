import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { SKIP_TRANSLATION_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import {
  PAGE_COUNTERS, buildVisiblePageCountPipeline, initialPageCounters, pageCountersFromStats, recountBook,
  type PageCountStats,
} from '@/lib/page-counts';
import { isLazyPagesBook } from '../../../../../scripts/lib/pages-state.mjs';

export const maxDuration = 300;

/**
 * POST /api/admin/sync-page-counts
 *
 * Sync the page counters on books from the pages collection, through
 * recountBook() (src/lib/page-counts.ts), the counters' one writer.
 *
 * Requires authentication.
 */
export const POST = withAdminAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 0;
    const dryRun = searchParams.get('dry_run') === 'true';

    const db = await getDb();
    const books = db.collection('books');
    const pages = db.collection('pages');

    // The shared rule (#3293, #5056): recountBook writes, buildVisiblePageCountPipeline
    // previews. An inline `page_number > 0` aggregate here counted hidden repeat
    // captures back into pages_count, and the reconciler then flipped it again
    // (PR #7777 review S5).
    const projection = { _id: 1, id: 1, language: 1, content_type: 1, pages_state: 1, ...Object.fromEntries(PAGE_COUNTERS.map(c => [c, 1])) };
    const query = books.find({}, { projection });
    if (limit > 0) query.limit(limit);
    const allBooks = await query.toArray();

    let updatedCount = 0;
    let mismatchCount = 0;

    for (const book of allBooks) {
      const bookId = book.id || book._id?.toString();
      if (!bookId) continue;

      if (dryRun) {
        const [row] = await pages.aggregate<PageCountStats>(buildVisiblePageCountPipeline(bookId)).toArray();
        const after = isLazyPagesBook(book) ? initialPageCounters(Number(book.pages_count ?? 0)) : pageCountersFromStats(row);
        if (PAGE_COUNTERS.some(c => (book[c] ?? null) !== after[c])) mismatchCount++;
        continue;
      }
      const r = await recountBook(db, bookId, { reason: 'admin-sync-page-counts' });
      if (r.changed.length) { mismatchCount++; updatedCount++; }
    }

    const totalStats = await pages.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withOcr: {
            $sum: { $cond: [{ $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] } }, 0] }, 1, 0] }
          },
          withTranslation: {
            $sum: { $cond: [{ $or: [
              { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''] } }, 0] },
              { $in: [{ $ifNull: ['$page_type', ''] }, SKIP_TRANSLATION_PAGE_TYPES] },
            ] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    const totals = totalStats[0] || { total: 0, withOcr: 0, withTranslation: 0 };

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      books_processed: allBooks.length,
      books_updated: dryRun ? 0 : updatedCount,
      books_with_mismatches: mismatchCount,
      totals: { pages: totals.total, ocr: totals.withOcr, translation: totals.withTranslation },
    });
  } catch (error) {
    console.error('[sync-page-counts] Error:', error);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
});

export const GET = withAdminAuth(async () => {
  try {
    const db = await getDb();
    const pages = db.collection('pages');
    const books = db.collection('books');

    const pageStats = await pages.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withOcr: {
            $sum: { $cond: [{ $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] } }, 0] }, 1, 0] }
          },
          withTranslation: {
            $sum: { $cond: [{ $or: [
              { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''] } }, 0] },
              { $in: [{ $ifNull: ['$page_type', ''] }, SKIP_TRANSLATION_PAGE_TYPES] },
            ] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    const bookStats = await books.aggregate([
      {
        $group: {
          _id: null,
          total_pages: { $sum: '$pages_count' },
          total_ocr: { $sum: '$pages_ocr' },
          total_translated: { $sum: '$pages_translated' }
        }
      }
    ]).toArray();

    const actual = pageStats[0] || { total: 0, withOcr: 0, withTranslation: 0 };
    const counters = bookStats[0] || { total_pages: 0, total_ocr: 0, total_translated: 0 };

    return NextResponse.json({
      actual: { pages: actual.total, ocr: actual.withOcr, translation: actual.withTranslation },
      counters: { pages: counters.total_pages, ocr: counters.total_ocr, translation: counters.total_translated },
      discrepancy: {
        pages: actual.total - counters.total_pages,
        ocr: actual.withOcr - counters.total_ocr,
        translation: actual.withTranslation - counters.total_translated,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to check' }, { status: 500 });
  }
});

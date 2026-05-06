import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const R2_HOST_REGEX = /^https:\/\/images\.sourcelibrary\.org/;
const ARCHIVE_FAILED_REGEX = /^failed:/;

export const GET = withAdminAuth(async () => {
  const db = await getDb();

  const stuckBooks = await db.collection('books').find({
    'pipeline_auto.status': 'needs_attention',
    status: { $ne: 'deleted' },
    'pipeline_auto.error': { $regex: /image downloads failed/i },
  }).project({
    id: 1,
    title: 1,
    author: 1,
    language: 1,
    pages_count: 1,
    pages_ocr: 1,
    quality_score: 1,
    'image_source.provider': 1,
    'pipeline_auto.error': 1,
  }).toArray();

  const ids = stuckBooks.map(b => b.id as string);
  const stuckPageStats = ids.length === 0 ? [] : await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids } } },
    { $group: {
      _id: '$book_id',
      total: { $sum: 1 },
      r2: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: R2_HOST_REGEX } }, 1, 0] } },
      failed: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: ARCHIVE_FAILED_REGEX } }, 1, 0] } },
    }},
  ]).toArray();

  const statsById = new Map(stuckPageStats.map(s => [s._id, s]));
  const stuckRows = stuckBooks.map(b => {
    const s = statsById.get(b.id as string) || { total: b.pages_count || 0, r2: 0, failed: 0 };
    const unarchived = Math.max(0, s.total - s.r2 - s.failed);
    return {
      id: b.id,
      title: b.title,
      author: b.author,
      language: b.language,
      provider: b.image_source?.provider || null,
      quality_score: b.quality_score ?? null,
      pages_total: s.total,
      pages_r2: s.r2,
      pages_failed: s.failed,
      pages_unarchived: unarchived,
      r2_pct: s.total > 0 ? Math.round((s.r2 / s.total) * 100) : 0,
      error: b.pipeline_auto?.error?.slice(0, 80),
    };
  }).sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0) || b.pages_unarchived - a.pages_unarchived);

  const stuckByProvider: Record<string, { books: number; pages_unarchived: number }> = {};
  for (const r of stuckRows) {
    const p = r.provider || 'unknown';
    if (!stuckByProvider[p]) stuckByProvider[p] = { books: 0, pages_unarchived: 0 };
    stuckByProvider[p].books += 1;
    stuckByProvider[p].pages_unarchived += r.pages_unarchived;
  }

  const stuckTotals = stuckRows.reduce((acc, r) => {
    acc.books += 1;
    acc.pages_total += r.pages_total;
    acc.pages_r2 += r.pages_r2;
    acc.pages_unarchived += r.pages_unarchived;
    acc.pages_failed += r.pages_failed;
    return acc;
  }, { books: 0, pages_total: 0, pages_r2: 0, pages_unarchived: 0, pages_failed: 0 });

  const bookCoverage = await db.collection('books').aggregate([
    { $match: { status: { $ne: 'deleted' }, pages_count: { $gt: 0 } } },
    { $group: {
      _id: { $ifNull: ['$image_source.provider', 'unknown'] },
      books: { $sum: 1 },
      pages: { $sum: '$pages_count' },
    }},
    { $sort: { books: -1 } },
  ]).toArray();

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    stuck: {
      summary: stuckTotals,
      by_provider: stuckByProvider,
      books: stuckRows,
    },
    library_by_provider: bookCoverage.map(p => ({ provider: p._id, books: p.books, pages: p.pages })),
  });
});

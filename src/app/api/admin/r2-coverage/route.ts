import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export const GET = withAdminAuth(async () => {
  const db = await getDb();

  // Library-wide snapshot, computed by scripts/workers/r2-coverage-snapshot.mjs
  const snapshot = await db.collection('system_config').findOne({ _id: 'r2_coverage_snapshot' as unknown as never });

  // Live: stuck books explicitly errored on image downloads (always fresh — narrow query)
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
      r2: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: /^https:\/\/images\.sourcelibrary\.org/ } }, 1, 0] } },
      failed: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: /^failed:/ } }, 1, 0] } },
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

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    snapshot: snapshot ? {
      computed_at: snapshot.computed_at,
      computation_ms: snapshot.computation_ms,
      library: snapshot.library,
      coverage_buckets: snapshot.coverage_buckets,
      by_provider: snapshot.by_provider,
      partial_books_count: snapshot.partial_books_count,
      no_r2_books_count: snapshot.no_r2_books_count,
      partial_books_top200: snapshot.partial_books_top200,
      no_r2_books_top200: snapshot.no_r2_books_top200,
    } : null,
    stuck: {
      summary: stuckTotals,
      by_provider: stuckByProvider,
      books: stuckRows,
    },
  });
});

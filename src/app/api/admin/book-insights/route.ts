import { NextResponse } from 'next/server';
import { withInnerCircleAuth } from '@/lib/auth-helpers';
import { getReadDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/book-insights
 *
 * Book-centric analytics for the /analytics "Books" tab. All view/engagement
 * signals are human-only (traffic_class:'human') and drawn from:
 *   - books.read_count            → all-time views
 *   - analytics_events book_read  → time-series views (weekly / trending)
 *   - analytics_events download   → downloads by book
 *   - analytics_events search_query → top searches
 *   - likes (target_type:'book')  → most liked
 */
export const GET = withInnerCircleAuth(async () => {
  const db = await getReadDb();
  const AE = db.collection('analytics_events');
  const B = db.collection('books');
  const L = db.collection('likes');

  const now = Date.now();
  const d7 = new Date(now - 7 * 864e5);
  const d14 = new Date(now - 14 * 864e5);
  const d30 = new Date(now - 30 * 864e5);
  const wk16 = new Date(now - 16 * 7 * 864e5);
  const HUMAN = { traffic_class: 'human' };
  const MT = { maxTimeMS: 20000 };

  const [
    topViewed, weeklyRaw, cur7, prev7, dlRaw, likeRaw, langRaw, searchRaw,
    views7, views30, booksViewed, neverOpened, downloads30, bookLikes,
  ] = await Promise.all([
    // All-time most viewed (reliable cumulative counter)
    B.find({ read_count: { $gt: 0 }, visible: true },
      { projection: { _id: 0, id: 1, display_title: 1, title: 1, author: 1, slug: 1, read_count: 1, language: 1, pages_count: 1 } })
      .sort({ read_count: -1 }).limit(25).toArray(),
    // Weekly book-opens, last 16 weeks. NOT human-filtered: reliable human
    // classification only began 2026-07-28 (#3405), so a human-only weekly
    // trend would be a single bar. All-traffic gives the real 17-week shape;
    // the UI labels it as book-opens (all traffic) to be honest about the mix.
    AE.aggregate([
      { $match: { event: 'book_read', created_at: { $gte: wk16 } } },
      { $group: { _id: { $dateTrunc: { date: '$created_at', unit: 'week', startOfWeek: 'monday' } }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ], MT).toArray(),
    // Trending — per-book reads this 7d vs prior 7d
    AE.aggregate([{ $match: { event: 'book_read', ...HUMAN, created_at: { $gte: d7 } } }, { $group: { _id: '$book_id', n: { $sum: 1 } } }], MT).toArray(),
    AE.aggregate([{ $match: { event: 'book_read', ...HUMAN, created_at: { $gte: d14, $lt: d7 } } }, { $group: { _id: '$book_id', n: { $sum: 1 } } }], MT).toArray(),
    // Downloads by book, last 30d
    AE.aggregate([{ $match: { event: 'download', ...HUMAN, created_at: { $gte: d30 } } }, { $group: { _id: '$bookId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }], MT).toArray(),
    // Most-liked books
    L.aggregate([{ $match: { target_type: 'book' } }, { $group: { _id: '$target_id', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }], MT).toArray(),
    // Views by language (all-time read_count)
    B.aggregate([{ $match: { visible: true, read_count: { $gt: 0 } } }, { $group: { _id: '$language', views: { $sum: '$read_count' }, books: { $sum: 1 } } }, { $sort: { views: -1 } }, { $limit: 12 }], MT).toArray(),
    // Top searches, last 30d
    AE.aggregate([{ $match: { event: 'search_query', ...HUMAN, created_at: { $gte: d30 } } }, { $group: { _id: '$query', n: { $sum: 1 } } }, { $match: { _id: { $nin: [null, ''] } } }, { $sort: { n: -1 } }, { $limit: 20 }], MT).toArray(),
    // Summary counters
    AE.countDocuments({ event: 'book_read', ...HUMAN, created_at: { $gte: d7 } }),
    AE.countDocuments({ event: 'book_read', ...HUMAN, created_at: { $gte: d30 } }),
    B.countDocuments({ read_count: { $gt: 0 } }),
    B.countDocuments({ visible: true, pages_count: { $gt: 0 }, $or: [{ read_count: { $exists: false } }, { read_count: 0 }] }),
    AE.countDocuments({ event: 'download', ...HUMAN, created_at: { $gte: d30 } }),
    L.countDocuments({ target_type: 'book' }),
  ]);

  // ── Resolve titles for every book id referenced by the event aggregates ──
  const prevMap = new Map<string, number>(prev7.map((r) => [r._id, r.n]));
  const trendingIds = cur7.map((r) => r._id);
  const ids = [...new Set([
    ...trendingIds,
    ...dlRaw.map((r) => r._id),
    ...likeRaw.map((r) => r._id),
  ].filter(Boolean))] as string[];
  const bookDocs = ids.length
    ? await B.find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, display_title: 1, title: 1, author: 1, slug: 1 } }).toArray()
    : [];
  const meta = new Map(bookDocs.map((b) => [b.id, b]));
  const label = (id: string) => {
    const b = meta.get(id);
    return { id, title: (b?.display_title || b?.title || 'Untitled') as string, author: (b?.author || '') as string, slug: (b?.slug || id) as string };
  };

  const trending = cur7
    .map((r) => ({ ...label(r._id), now: r.n, prev: prevMap.get(r._id) || 0, delta: r.n - (prevMap.get(r._id) || 0) }))
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 15);

  const norm = (r: { _id: string; n: number }) => ({ ...label(r._id), count: r.n });
  const asRows = (a: unknown[]) => a as Array<{ _id: string; n: number }>;

  return NextResponse.json({
    summary: {
      views7, views30, booksViewed, neverOpened, downloads30, bookLikes,
      weeklyAvg: weeklyRaw.length ? Math.round(weeklyRaw.reduce((s, w) => s + w.n, 0) / weeklyRaw.length) : 0,
    },
    weekly: weeklyRaw.map((w) => ({ week: w._id, views: w.n })),
    topViewed: topViewed.map((b) => ({ id: b.id, title: b.display_title || b.title || 'Untitled', author: b.author || '', slug: b.slug || b.id, views: b.read_count, language: b.language, pages: b.pages_count })),
    trending,
    topDownloaded: asRows(dlRaw).map(norm),
    topLiked: asRows(likeRaw).map(norm),
    byLanguage: langRaw.map((l) => ({ language: l._id || 'Unknown', views: l.views, books: l.books })),
    topSearches: searchRaw.map((s) => ({ term: s._id, count: s.n })),
    generatedAt: new Date().toISOString(),
  });
});

import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getReadDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Agg = Array<{ _id: string; [k: string]: unknown }>;

/**
 * GET /api/admin/book-insights — book-centric analytics for the /analytics
 * "Books" tab. Human-only (traffic_class:'human') where the data supports it;
 * the weekly opens trend is all-traffic on purpose (reliable human read
 * tracking only began 2026-07-28, #3405). Sources: books.read_count,
 * analytics_events (book_read / page_read / download / search_query), likes.
 */
export const GET = withAdminAuth(async () => {
  const db = await getReadDb();
  const AE = db.collection('analytics_events');
  const B = db.collection('books');
  const L = db.collection('likes');

  const now = Date.now();
  const d7 = new Date(now - 7 * 864e5);
  const d14 = new Date(now - 14 * 864e5);
  const d30 = new Date(now - 30 * 864e5);
  const d90 = new Date(now - 90 * 864e5);
  const wk16 = new Date(now - 16 * 7 * 864e5);
  const HUMAN = { traffic_class: 'human' };
  const MT = { maxTimeMS: 25000 };

  const [
    topViewed, weeklyRaw, cur7, prev7, dlRaw, likeTop, likeAll, langRaw, searchRaw,
    geoRaw, gapsRaw, deepRaw, newArrivals,
    views7, views30, pageReads30, booksViewed, neverOpened, downloads30, bookLikes,
  ] = await Promise.all([
    B.find({ read_count: { $gt: 0 }, visible: true }, { projection: { _id: 0, id: 1, display_title: 1, title: 1, author: 1, slug: 1, read_count: 1, language: 1 } }).sort({ read_count: -1 }).limit(25).toArray(),
    AE.aggregate([{ $match: { event: 'book_read', timestamp: { $gte: wk16 } } }, { $group: { _id: { $dateTrunc: { date: '$timestamp', unit: 'week', startOfWeek: 'monday' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }], MT).toArray(),
    AE.aggregate([{ $match: { event: 'book_read', ...HUMAN, timestamp: { $gte: d7 } } }, { $group: { _id: '$book_id', n: { $sum: 1 } } }], MT).toArray(),
    AE.aggregate([{ $match: { event: 'book_read', ...HUMAN, timestamp: { $gte: d14, $lt: d7 } } }, { $group: { _id: '$book_id', n: { $sum: 1 } } }], MT).toArray(),
    AE.aggregate([{ $match: { event: 'download', ...HUMAN, timestamp: { $gte: d30 } } }, { $group: { _id: '$bookId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }], MT).toArray(),
    L.aggregate([{ $match: { target_type: 'book' } }, { $group: { _id: '$target_id', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }], MT).toArray(),
    L.aggregate([{ $match: { target_type: 'book' } }, { $group: { _id: '$target_id', n: { $sum: 1 } } }, { $match: { n: { $gte: 2 } } }], MT).toArray(),
    B.aggregate([{ $match: { visible: true, read_count: { $gt: 0 } } }, { $group: { _id: '$language', views: { $sum: '$read_count' }, books: { $sum: 1 } } }, { $sort: { views: -1 } }, { $limit: 12 }], MT).toArray(),
    AE.aggregate([{ $match: { event: 'search_query', ...HUMAN, timestamp: { $gte: d30 } } }, { $group: { _id: '$query', n: { $sum: 1 } } }, { $match: { _id: { $nin: [null, ''] } } }, { $sort: { n: -1 } }, { $limit: 20 }], MT).toArray(),
    AE.aggregate([{ $match: { event: { $in: ['search_query', 'download'] }, ...HUMAN, country: { $nin: [null, ''] }, timestamp: { $gte: d30 } } }, { $group: { _id: '$country', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }], MT).toArray(),
    AE.aggregate([{ $match: { event: 'search_query', ...HUMAN, timestamp: { $gte: d30 }, results_count: { $lte: 2 } } }, { $group: { _id: '$query', n: { $sum: 1 }, res: { $max: '$results_count' } } }, { $match: { _id: { $nin: [null, ''] } } }, { $sort: { n: -1 } }, { $limit: 15 }], MT).toArray(),
    AE.aggregate([{ $match: { event: 'page_read', ...HUMAN, timestamp: { $gte: d30 } } }, { $group: { _id: '$book_id', pages: { $sum: 1 } } }, { $sort: { pages: -1 } }, { $limit: 20 }], MT).toArray(),
    B.find({ visible: true, read_count: { $gt: 0 }, created_at: { $gte: d90 } }, { projection: { _id: 0, id: 1, display_title: 1, title: 1, author: 1, slug: 1, read_count: 1, created_at: 1 } }).sort({ read_count: -1 }).limit(15).toArray(),
    AE.countDocuments({ event: 'book_read', ...HUMAN, timestamp: { $gte: d7 } }),
    AE.countDocuments({ event: 'book_read', ...HUMAN, timestamp: { $gte: d30 } }),
    AE.countDocuments({ event: 'page_read', ...HUMAN, timestamp: { $gte: d30 } }),
    B.countDocuments({ read_count: { $gt: 0 } }),
    B.countDocuments({ visible: true, pages_count: { $gt: 0 }, $or: [{ read_count: { $exists: false } }, { read_count: 0 }] }),
    AE.countDocuments({ event: 'download', ...HUMAN, timestamp: { $gte: d30 } }),
    L.countDocuments({ target_type: 'book' }),
  ]);

  // ── Resolve titles + read_count for every referenced book id ──
  const prevMap = new Map((prev7 as Agg).map((r) => [r._id, r.n as number]));
  const ids = [...new Set([
    ...(cur7 as Agg).map((r) => r._id),
    ...(dlRaw as Agg).map((r) => r._id),
    ...(likeTop as Agg).map((r) => r._id),
    ...(likeAll as Agg).map((r) => r._id),
    ...(deepRaw as Agg).map((r) => r._id),
  ].filter(Boolean))] as string[];
  const bookDocs = ids.length
    ? await B.find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, display_title: 1, title: 1, author: 1, slug: 1, read_count: 1 } }).toArray()
    : [];
  const meta = new Map(bookDocs.map((b) => [b.id, b]));
  const label = (id: string) => { const b = meta.get(id); return { id, title: (b?.display_title || b?.title || 'Untitled') as string, author: (b?.author || '') as string, slug: (b?.slug || id) as string }; };
  const rows = (a: unknown[], key = 'n') => (a as Agg).map((r) => ({ ...label(r._id), count: r[key] as number }));

  const trending = (cur7 as Agg)
    .map((r) => ({ ...label(r._id), now: r.n as number, prev: prevMap.get(r._id) || 0, delta: (r.n as number) - (prevMap.get(r._id) || 0) }))
    .filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 15);

  // Punching above weight — likes per 100 views (needs enough views to matter)
  const punching = (likeAll as Agg)
    .map((r) => { const b = meta.get(r._id); const views = (b?.read_count as number) || 0; return { ...label(r._id), likes: r.n as number, views, per100: views ? ((r.n as number) / views) * 100 : 0 }; })
    .filter((r) => r.views >= 25).sort((a, b) => b.per100 - a.per100).slice(0, 12);

  const geoTotal = (geoRaw as Agg).reduce((s, g) => s + (g.n as number), 0);

  return NextResponse.json({
    summary: { views7, views30, pageReads30, booksViewed, neverOpened, downloads30, bookLikes },
    weekly: (weeklyRaw as Agg).map((w) => ({ week: w._id, views: w.n })),
    topViewed: topViewed.map((b) => ({ id: b.id, title: b.display_title || b.title || 'Untitled', author: b.author || '', slug: b.slug || b.id, count: b.read_count, language: b.language })),
    trending,
    topDownloaded: rows(dlRaw),
    topLiked: rows(likeTop),
    deepestRead: rows(deepRaw, 'pages'),
    punching,
    newArrivals: newArrivals.map((b) => ({ id: b.id, title: b.display_title || b.title || 'Untitled', author: b.author || '', slug: b.slug || b.id, count: b.read_count, added: b.created_at })),
    byLanguage: (langRaw as Agg).map((l) => ({ language: (l._id as string) || 'Unknown', views: l.views as number, books: l.books as number })),
    topSearches: (searchRaw as Agg).map((s) => ({ term: s._id, count: s.n as number })),
    searchGaps: (gapsRaw as Agg).map((s) => ({ term: s._id, count: s.n as number, results: s.res as number })),
    geo: (geoRaw as Agg).map((g) => ({ country: g._id, count: g.n as number, pct: geoTotal ? Math.round(((g.n as number) / geoTotal) * 100) : 0 })),
    generatedAt: new Date().toISOString(),
  });
});

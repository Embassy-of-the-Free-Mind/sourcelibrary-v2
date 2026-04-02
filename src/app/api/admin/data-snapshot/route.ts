import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

/**
 * Computes the full stats needed by /data and /data?admin=true,
 * caches the result in system_config._id: 'data_page_snapshot'.
 *
 * Called by Hetzner enrichment-snapshot worker or manually.
 * The /data page reads from this snapshot — never computes inline.
 */

interface LibraryData {
  totalBooks: number;
  totalPages: number;
  totalOcr: number;
  totalTranslated: number;
  totalIllustrations: number;
  firstTranslations: number;
  languages: Array<{ language: string; count: number }>;
  centuries: Array<{ century: number; label: string; count: number }>;
  categories: Array<{ slug: string; name: string; count: number }>;
  providers: Array<{ name: string; count: number }>;
  collections: Array<{ slug: string; name: string; book_count: number }>;
  // Admin fields
  hiddenCount: number;
  pipelineStatuses: Array<{ status: string; count: number }>;
  hasSummary: number;
  hasIndex: number;
  hasChapters: number;
  hasSourceDates: number;
  hasEditions: number;
  ocrTiers: Array<{ tier: string; count: number }>;
  translationTiers: Array<{ tier: string; count: number }>;
  emptyShells: number;
}

function formatCentury(yearBucket: number): string {
  if (yearBucket <= 0) return '1st c.';
  const c = Math.floor(yearBucket / 100) + 1;
  const mod10 = c % 10;
  const mod100 = c % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
  return `${c}${suffix} c.`;
}

const PIPELINE_STATUS_ORDER = [
  'queued', 'archiving', 'archive_complete', 'ocr_submitted', 'ocr_complete',
  'metadata_enriched', 'translate_submitted', 'translate_complete',
  'enriching', 'enriched', 'chapters', 'chapters_complete',
  'images_submitted', 'images_complete', 'complete', 'needs_attention', 'failed',
] as const;

function buildCoverageTiers(field: string) {
  return [
    {
      $facet: {
        zero: [
          { $match: { pages_count: { $gt: 0 }, [field]: { $in: [0, null, undefined] } } },
          { $count: 'n' },
        ],
        low: [
          {
            $match: {
              pages_count: { $gt: 0 },
              [field]: { $gt: 0 },
              $expr: { $lt: [{ $divide: [`$${field}`, '$pages_count'] }, 0.5] },
            },
          },
          { $count: 'n' },
        ],
        mid: [
          {
            $match: {
              pages_count: { $gt: 0 },
              $expr: {
                $and: [
                  { $gte: [{ $divide: [`$${field}`, '$pages_count'] }, 0.5] },
                  { $lt: [{ $divide: [`$${field}`, '$pages_count'] }, 1] },
                ],
              },
            },
          },
          { $count: 'n' },
        ],
        full: [
          {
            $match: {
              pages_count: { $gt: 0 },
              $expr: { $gte: [{ $divide: [`$${field}`, '$pages_count'] }, 1] },
            },
          },
          { $count: 'n' },
        ],
      },
    },
  ];
}

function extractTiers(
  result: Array<{
    zero: Array<{ n: number }>;
    low: Array<{ n: number }>;
    mid: Array<{ n: number }>;
    full: Array<{ n: number }>;
  }>
): Array<{ tier: string; count: number }> {
  const r = result[0] ?? { zero: [], low: [], mid: [], full: [] };
  return [
    { tier: '0%', count: r.zero[0]?.n ?? 0 },
    { tier: '1–49%', count: r.low[0]?.n ?? 0 },
    { tier: '50–99%', count: r.mid[0]?.n ?? 0 },
    { tier: '100%', count: r.full[0]?.n ?? 0 },
  ];
}

async function computeDataPageSnapshot(db: any): Promise<LibraryData> {
  const books = db.collection('books');
  const maxTimeMS = 45000;

  // Only count books that actually have content (not empty catalog stubs)
  const real = { visible: true, pages_count: { $gt: 0 } };

  // Run queries sequentially in groups to avoid saturating Atlas
  // Group 1: counts
  const [totalBooks, firstTranslations, hiddenCount, emptyShells] = await Promise.all([
    books.countDocuments(real, { maxTimeMS }),
    books.countDocuments({ ...real, is_first_translation: true }, { maxTimeMS }),
    books.countDocuments({ hidden: true }, { maxTimeMS }),
    books.countDocuments({ visible: true, $or: [{ pages_count: 0 }, { pages_count: { $exists: false } }] }, { maxTimeMS }),
  ]);

  // Group 2: aggregations (breakdowns)
  const [languagesAgg, centuriesAgg, pageTotalsAgg] = await Promise.all([
    books.aggregate([
      { $match: real },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ], { maxTimeMS }).toArray(),
    books.aggregate([
      { $match: { ...real, year: { $exists: true, $type: 'number' } } },
      {
        $addFields: {
          century: { $multiply: [{ $floor: { $divide: ['$year', 100] } }, 100] },
        },
      },
      { $group: { _id: '$century', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ], { maxTimeMS }).toArray(),
    books.aggregate([
      { $match: real },
      {
        $group: {
          _id: null,
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      },
    ], { maxTimeMS }).toArray(),
  ]);

  // Group 3: categories, providers, collections, illustrations
  const [categoriesAgg, providersAgg, collectionsAgg, totalIllustrations] = await Promise.all([
    books.aggregate([
      { $match: { ...real, categories: { $exists: true } } },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ], { maxTimeMS }).toArray(),
    books.aggregate([
      { $match: { ...real, 'image_source.provider_name': { $exists: true } } },
      { $group: { _id: '$image_source.provider_name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ], { maxTimeMS }).toArray(),
    db.collection('collections').find({}).sort({ order: 1 }).project({ slug: 1, name: 1, book_count: 1, _id: 0 }).toArray(),
    db.collection('gallery_images').estimatedDocumentCount(),
  ]);

  // Group 4: admin-only enrichment counts
  const [hasSummary, hasIndex, hasChapters, hasSourceDates, hasEditions] = await Promise.all([
    books.countDocuments({ 'reading_summary.overview': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'index.generatedAt': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'chapters.0': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'source_work_dates.0': { $exists: true } }, { maxTimeMS }),
    db.collection('editions').estimatedDocumentCount(),
  ]);

  // Group 5: pipeline statuses + coverage tiers (heaviest — run last)
  const [pipelineAgg, ocrTiersAgg, translationTiersAgg] = await Promise.all([
    books.aggregate([
      { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ], { maxTimeMS }).toArray(),
    books.aggregate(buildCoverageTiers('pages_ocr'), { maxTimeMS: 45000 }).toArray(),
    books.aggregate(buildCoverageTiers('pages_translated'), { maxTimeMS: 45000 }).toArray(),
  ]);

  const pageTotals = pageTotalsAgg[0] ?? { pages: 0, ocr: 0, translated: 0 };

  // Build pipeline status array in canonical order
  const pipelineMap = new Map<string, number>();
  for (const p of pipelineAgg) {
    pipelineMap.set(p._id ?? 'no pipeline', p.count);
  }
  const pipelineStatuses: Array<{ status: string; count: number }> = [];
  for (const s of PIPELINE_STATUS_ORDER) {
    const count = pipelineMap.get(s);
    if (count) pipelineStatuses.push({ status: s, count });
  }
  const noPipeline = pipelineMap.get('no pipeline');
  if (noPipeline) pipelineStatuses.push({ status: 'no pipeline', count: noPipeline });

  return {
    totalBooks,
    totalPages: pageTotals.pages,
    totalOcr: pageTotals.ocr,
    totalTranslated: pageTotals.translated,
    totalIllustrations,
    firstTranslations,
    hiddenCount,
    emptyShells,
    hasSummary,
    hasIndex,
    hasChapters,
    hasSourceDates,
    hasEditions,
    pipelineStatuses,
    ocrTiers: extractTiers(ocrTiersAgg as any),
    translationTiers: extractTiers(translationTiersAgg as any),
    languages: languagesAgg
      .filter((l: any) => l._id && l._id !== 'Unknown')
      .map((l: any) => ({ language: l._id, count: l.count })),
    centuries: centuriesAgg.map((c: any) => ({
      century: c._id,
      label: formatCentury(c._id),
      count: c.count,
    })),
    categories: categoriesAgg.map((c: any) => ({
      slug: c._id,
      name: c._id.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      count: c.count,
    })),
    providers: providersAgg
      .filter((p: any) => p._id)
      .map((p: any) => ({ name: p._id, count: p.count })),
    collections: collectionsAgg as Array<{ slug: string; name: string; book_count: number }>,
  };
}

// GET: read cached snapshot (fast, no Atlas aggregation)
export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const snapshot = await db.collection('system_config').findOne({ _id: 'data_page_snapshot' as any });

  if (!snapshot?.data) {
    return NextResponse.json(
      { _computing: true, message: 'No snapshot yet. POST to this endpoint to generate one.' },
      { status: 202 },
    );
  }

  const age = Date.now() - new Date(snapshot.updated_at).getTime();
  return NextResponse.json({
    ...snapshot.data,
    _snapshot: { updated_at: snapshot.updated_at, age_hours: +(age / 3600000).toFixed(1) },
  });
});

// POST: recompute snapshot. Called from Hetzner cron or manually.
export const POST = withAdminAuth(async () => {
  const db = await getDb();
  const data = await computeDataPageSnapshot(db);
  await db.collection('system_config').updateOne(
    { _id: 'data_page_snapshot' as any },
    { $set: { data, updated_at: new Date() } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, updated_at: new Date() });
});

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * Catalog Coverage API — query the unified USTC coverage database.
 *
 * GET /api/catalog/coverage?mode=summary
 *   Returns aggregate stats: total editions, % scanned, % translated, by language
 *
 * GET /api/catalog/coverage?mode=search&q=ficino&language=Latin&has_scan=true
 *   Returns matching editions with coverage flags
 *
 * GET /api/catalog/coverage?mode=timeline&language=Latin
 *   Returns decade-by-decade scan/translation coverage
 *
 * GET /api/catalog/coverage?mode=works&language=Latin
 *   Returns work-level (deduplicated) coverage stats
 */
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'summary';

    switch (mode) {
      case 'summary':
        return handleSummary(db);
      case 'search':
        return handleSearch(db, searchParams);
      case 'timeline':
        return handleTimeline(db, searchParams);
      case 'works':
        return handleWorks(db, searchParams);
      default:
        return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Catalog coverage API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleSummary(db: any) {
  const col = db.collection('catalog_coverage');

  // Check if collection exists / has data
  const total = await col.estimatedDocumentCount();
  if (total === 0) {
    return NextResponse.json({
      status: 'empty',
      message: 'catalog_coverage collection is empty. Run the build script first.',
    });
  }

  // Aggregate by language
  const byLanguage = await col.aggregate([
    {
      $group: {
        _id: '$language',
        editions: { $sum: 1 },
        with_scan: { $sum: { $cond: ['$has_scan', 1, 0] } },
        with_translation: { $sum: { $cond: ['$has_published_translation', 1, 0] } },
        in_source_library: { $sum: { $cond: ['$in_source_library', 1, 0] } },
        distinct_works: { $addToSet: '$work_cluster_id' },
      }
    },
    { $addFields: { distinct_work_count: { $size: '$distinct_works' } } },
    { $project: { distinct_works: 0 } },
    { $sort: { editions: -1 } },
  ]).toArray();

  // Grand totals
  const grandTotal = byLanguage.reduce((acc: { editions: number; with_scan: number; with_translation: number; in_source_library: number; distinct_works: number }, l: any) => ({
    editions: acc.editions + l.editions,
    with_scan: acc.with_scan + l.with_scan,
    with_translation: acc.with_translation + l.with_translation,
    in_source_library: acc.in_source_library + l.in_source_library,
    distinct_works: acc.distinct_works + l.distinct_work_count,
  }), { editions: 0, with_scan: 0, with_translation: 0, in_source_library: 0, distinct_works: 0 });

  // Build metadata
  const meta = await db.collection('catalog_coverage_meta').findOne({ _id: 'latest_build' });

  return NextResponse.json({
    status: 'ok',
    built_at: meta?.built_at,
    total: grandTotal,
    by_language: byLanguage.map((l: any) => ({
      language: l._id,
      editions: l.editions,
      with_scan: l.with_scan,
      pct_scanned: l.editions > 0 ? +(l.with_scan / l.editions * 100).toFixed(1) : 0,
      with_translation: l.with_translation,
      pct_translated: l.editions > 0 ? +(l.with_translation / l.editions * 100).toFixed(1) : 0,
      in_source_library: l.in_source_library,
      distinct_works: l.distinct_work_count,
    })),
  });
}

async function handleSearch(db: any, params: URLSearchParams) {
  const col = db.collection('catalog_coverage');
  const q = params.get('q');
  const language = params.get('language');
  const hasScan = params.get('has_scan');
  const hasTranslation = params.get('has_translation');
  const inSL = params.get('in_source_library');
  const yearMin = params.get('year_min');
  const yearMax = params.get('year_max');
  const limit = Math.min(parseInt(params.get('limit') || '50'), 200);
  const skip = parseInt(params.get('skip') || '0');

  const filter: Record<string, any> = {};
  if (q) {
    filter.$or = [
      { title: { $regex: q, $options: 'i' } },
      { author: { $regex: q, $options: 'i' } },
    ];
  }
  if (language) filter.language = language;
  if (hasScan === 'true') filter.has_scan = true;
  if (hasScan === 'false') filter.has_scan = false;
  if (hasTranslation === 'true') filter.has_published_translation = true;
  if (hasTranslation === 'false') filter.has_published_translation = false;
  if (inSL === 'true') filter.in_source_library = true;
  if (yearMin) filter.year = { ...filter.year, $gte: parseInt(yearMin) };
  if (yearMax) filter.year = { ...filter.year, $lte: parseInt(yearMax) };

  const [results, count] = await Promise.all([
    col.find(filter)
      .sort({ year: 1, author_surname: 1 })
      .skip(skip)
      .limit(limit)
      .project({
        ustc_id: 1, title: 1, author: 1, year: 1, language: 1, place: 1, format: 1,
        has_scan: 1, scan_sources: 1, iiif_manifest_url: 1,
        has_published_translation: 1, translation_sources: 1,
        in_source_library: 1, source_library_id: 1,
        ocr_status: 1, translation_status: 1, sl_translation_percent: 1,
        work_cluster_id: 1,
      })
      .toArray(),
    col.countDocuments(filter),
  ]);

  return NextResponse.json({ results, total: count, limit, skip });
}

async function handleTimeline(db: any, params: URLSearchParams) {
  const col = db.collection('catalog_coverage');
  const language = params.get('language');

  const matchStage: Record<string, any> = {};
  if (language) matchStage.language = language;

  const timeline = await col.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { $subtract: ['$year', { $mod: ['$year', 10] }] },
        editions: { $sum: 1 },
        with_scan: { $sum: { $cond: ['$has_scan', 1, 0] } },
        with_translation: { $sum: { $cond: ['$has_published_translation', 1, 0] } },
        in_source_library: { $sum: { $cond: ['$in_source_library', 1, 0] } },
      }
    },
    { $sort: { _id: 1 } },
  ]).toArray();

  return NextResponse.json({
    language: language || 'all',
    decades: timeline.map((d: any) => ({
      decade: d._id,
      editions: d.editions,
      with_scan: d.with_scan,
      pct_scanned: d.editions > 0 ? +(d.with_scan / d.editions * 100).toFixed(1) : 0,
      with_translation: d.with_translation,
      pct_translated: d.editions > 0 ? +(d.with_translation / d.editions * 100).toFixed(1) : 0,
      in_source_library: d.in_source_library,
    })),
  });
}

async function handleWorks(db: any, params: URLSearchParams) {
  const col = db.collection('catalog_coverage');
  const language = params.get('language');

  const matchStage: Record<string, any> = {};
  if (language) matchStage.language = language;

  const works = await col.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$work_cluster_id',
        editions: { $sum: 1 },
        any_scan: { $max: { $cond: ['$has_scan', 1, 0] } },
        any_translation: { $max: { $cond: ['$has_published_translation', 1, 0] } },
        any_sl: { $max: { $cond: ['$in_source_library', 1, 0] } },
        sample_title: { $first: '$title' },
        sample_author: { $first: '$author' },
        year_min: { $min: '$year' },
        year_max: { $max: '$year' },
      }
    },
    {
      $group: {
        _id: null,
        total_works: { $sum: 1 },
        works_with_scan: { $sum: '$any_scan' },
        works_with_translation: { $sum: '$any_translation' },
        works_in_sl: { $sum: '$any_sl' },
        works_scanned_not_translated: {
          $sum: { $cond: [{ $and: [{ $eq: ['$any_scan', 1] }, { $eq: ['$any_translation', 0] }] }, 1, 0] }
        },
        works_neither: {
          $sum: { $cond: [{ $and: [{ $eq: ['$any_scan', 0] }, { $eq: ['$any_translation', 0] }] }, 1, 0] }
        },
      }
    },
  ]).toArray();

  const result = works[0] || { total_works: 0, works_with_scan: 0, works_with_translation: 0, works_in_sl: 0, works_scanned_not_translated: 0, works_neither: 0 };

  return NextResponse.json({
    language: language || 'all',
    ...result,
    _id: undefined,
    pct_scanned: result.total_works > 0 ? +(result.works_with_scan / result.total_works * 100).toFixed(2) : 0,
    pct_translated: result.total_works > 0 ? +(result.works_with_translation / result.total_works * 100).toFixed(2) : 0,
  });
}

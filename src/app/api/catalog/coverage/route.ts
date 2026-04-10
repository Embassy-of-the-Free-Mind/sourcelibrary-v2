import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';

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

async function handleSummary(_db: any) {
  // Query coverage stats from Supabase (migrated from Atlas catalog_coverage_meta)
  const { data: rows, error } = await supabase.rpc('get_coverage_stats');

  if (error || !rows || rows.length === 0) {
    return NextResponse.json({
      status: 'empty',
      message: 'Coverage data not available. Run the build script first.',
    });
  }

  const languages = (rows as any[]).map((r: any) => ({
    language: r.language,
    editions: Number(r.editions),
    with_scan: Number(r.with_scan),
    pct_scanned: Number(r.editions) > 0 ? +(Number(r.with_scan) / Number(r.editions) * 100).toFixed(1) : 0,
    with_translation: Number(r.with_translation),
    pct_translated: Number(r.editions) > 0 ? +(Number(r.with_translation) / Number(r.editions) * 100).toFixed(1) : 0,
    in_source_library: Number(r.in_sl),
    distinct_works: 0,
  })).sort((a, b) => b.editions - a.editions);

  const totals = languages.reduce((acc, l) => ({
    editions: acc.editions + l.editions,
    scanned: acc.scanned + l.with_scan,
    translated: acc.translated + l.with_translation,
    in_sl: acc.in_sl + l.in_source_library,
  }), { editions: 0, scanned: 0, translated: 0, in_sl: 0 });

  return NextResponse.json({
    status: 'ok',
    built_at: new Date().toISOString(),
    total: {
      editions: totals.editions,
      with_scan: totals.scanned,
      with_translation: totals.translated,
      in_source_library: totals.in_sl,
      distinct_works: 0,
    },
    by_language: languages,
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
  let useTextScore = false;
  if (q) {
    // Try text index first (fast), fall back to author_surname index
    filter.$text = { $search: q };
    useTextScore = true;
  }
  if (language) filter.language = language;
  if (hasScan === 'true') filter.has_iiif_scan = true;
  if (hasScan === 'false') filter.has_iiif_scan = false;
  if (hasTranslation === 'true') filter.has_english_translation = true;
  if (hasTranslation === 'false') filter.has_english_translation = false;
  if (inSL === 'true') filter.in_source_library = true;
  if (yearMin) filter.year = { ...filter.year, $gte: parseInt(yearMin) };
  if (yearMax) filter.year = { ...filter.year, $lte: parseInt(yearMax) };

  const projection: Record<string, number> = {
    ustc_id: 1, title: 1, author: 1, year: 1, language: 1, place: 1, format: 1,
    has_iiif_scan: 1, scan_sources: 1, scan_quality: 1, iiif_manifest_url: 1, viewer_url: 1,
    has_english_translation: 1, translation_sources: 1,
    in_source_library: 1, source_library_id: 1,
    ocr_status: 1, translation_status: 1, sl_translation_percent: 1,
    work_cluster_id: 1,
  };
  const sort: Record<string, any> = useTextScore
    ? { score: { $meta: 'textScore' } }
    : { year: 1, author_surname: 1 };
  if (useTextScore) projection.score = { $meta: 'textScore' } as any;

  try {
    const [results, count] = await Promise.all([
      col.find(filter).sort(sort).skip(skip).limit(limit).project(projection).toArray(),
      col.countDocuments(filter),
    ]);
    return NextResponse.json({ results, total: count, limit, skip });
  } catch (err: any) {
    // If text index doesn't exist, fall back to author_surname index
    if (err?.codeName === 'IndexNotFound' || err?.code === 27) {
      if (q) {
        delete filter.$text;
        filter.author_surname = q.toLowerCase().trim().split(/\s+/)[0];
      }
      const [results, count] = await Promise.all([
        col.find(filter).sort({ year: 1, author_surname: 1 }).skip(skip).limit(limit).project(projection).toArray(),
        col.countDocuments(filter),
      ]);
      return NextResponse.json({ results, total: count, limit, skip });
    }
    throw err;
  }
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
        with_scan: { $sum: { $cond: ['$has_iiif_scan', 1, 0] } },
        with_translation: { $sum: { $cond: ['$has_english_translation', 1, 0] } },
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
  // Use pre-computed stats from build — live aggregation is too heavy for Vercel
  const meta = await db.collection('catalog_coverage_meta').findOne({ _id: 'latest_build' });
  const result = meta?.works || { total_works: 0, works_with_scan: 0, works_with_translation: 0, works_in_sl: 0, works_scanned_not_translated: 0, works_scanned_not_translated_non_english: 0, works_neither: 0 };

  return NextResponse.json({
    language: params.get('language') || 'all',
    ...result,
    pct_scanned: result.total_works > 0 ? +(result.works_with_scan / result.total_works * 100).toFixed(2) : 0,
    pct_translated: result.total_works > 0 ? +(result.works_with_translation / result.total_works * 100).toFixed(2) : 0,
  });
}

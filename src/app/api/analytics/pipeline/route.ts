import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { supabase } from '@/lib/supabase';

export const maxDuration = 30;

// In-memory cache (1 minute) — Supabase queries are fast
let pipelineCache: { data: any; key: string; ts: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

/**
 * GET /api/analytics/pipeline
 *
 * Returns pipeline observability data:
 * - Recent snapshots (velocity, trend lines)
 * - Cron health (last runs, errors)
 * - Needs-attention books (drill-down)
 * - Stall detection (stages growing/shrinking)
 *
 * Query params:
 *   ?hours=24   — snapshot window (default 24)
 */
export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Math.min(parseInt(searchParams.get('hours') || '24', 10), 336); // max 14 days

    // Check cache
    const cacheKey = `pipeline-${hours}`;
    if (pipelineCache && pipelineCache.key === cacheKey && Date.now() - pipelineCache.ts < CACHE_TTL_MS) {
      return NextResponse.json(pipelineCache.data);
    }

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const db = await getDb();

    const [snapshots, cronRuns, needsAttention, recentErrors, recentDecisions] = await Promise.all([
      // 1. Pipeline snapshots from Supabase (fast time-series query)
      supabase
        .from('pipeline_snapshots')
        .select('timestamp, funnel, pages, books, active_batch')
        .gte('timestamp', cutoff.toISOString())
        .order('timestamp', { ascending: true })
        .then(({ data }) => data || []),

      // 2. Recent cron runs from Supabase
      supabase
        .from('cron_runs')
        .select('cron, timestamp, duration_ms, actions, errors, error_count, status')
        .gte('timestamp', cutoff.toISOString())
        .order('timestamp', { ascending: false })
        .limit(50)
        .then(({ data }) => data || []),

      // 3. Books needing attention (with error details)
      db.collection('books')
        .find({ 'pipeline_auto.status': { $in: ['needs_attention', 'failed'] } })
        .project({
          _id: 0, id: 1, title: 1, language: 1,
          pages_count: 1, pages_ocr: 1, pages_translated: 1,
          'pipeline_auto.status': 1, 'pipeline_auto.error': 1,
          'pipeline_auto.last_updated': 1, 'pipeline_auto.retry_count': 1,
          'image_source.provider': 1,
        })
        .sort({ 'pipeline_auto.last_updated': -1 })
        .limit(50)
        .toArray(),

      // 4. Recent errors from Supabase gemini_usage (last 6h)
      supabase
        .from('gemini_usage')
        .select('type, error_category, error_message, timestamp')
        .eq('status', 'failed')
        .gte('timestamp', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order('timestamp', { ascending: false })
        .limit(100)
        .then(({ data }) => {
          if (!data) return [];
          // Group in JS (Supabase doesn't support GROUP BY via REST)
          const groups = new Map<string, { count: number; lastError: string; lastAt: string }>();
          for (const row of data) {
            const key = `${row.type}|${row.error_category || 'unknown'}`;
            const existing = groups.get(key);
            if (existing) {
              existing.count++;
            } else {
              groups.set(key, { count: 1, lastError: row.error_message || '', lastAt: row.timestamp });
            }
          }
          return Array.from(groups.entries())
            .map(([key, v]) => {
              const [type, category] = key.split('|');
              return { _id: { type, category }, count: v.count, lastError: v.lastError, lastAt: v.lastAt };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);
        }),

      // 5. Recent decisions from Supabase cron_runs
      supabase
        .from('cron_runs')
        .select('cron, timestamp, decisions')
        .gte('timestamp', cutoff.toISOString())
        .not('decisions', 'is', null)
        .order('timestamp', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          if (!data) return [];
          const results: any[] = [];
          for (const row of data) {
            const decisions = row.decisions as any[];
            if (!Array.isArray(decisions)) continue;
            for (const decision of decisions) {
              results.push({ cron: row.cron, timestamp: row.timestamp, decision });
              if (results.length >= 50) break;
            }
            if (results.length >= 50) break;
          }
          return results;
        }),
    ]);

    // 6. Pipeline funnel + enrichment coverage + milestones — use pre-computed snapshot (2h cache)
    //    instead of expensive live aggregations that take 10-30s on Atlas
    const snapshot = await db.collection('system_config').findOne({ _id: 'enrichment_snapshot' as any });

    const funnel = snapshot?.funnel || {};
    const enrichment = snapshot?.enrichment || {};
    const galleryCount = snapshot?.gallery?.gallery_images || 0;
    const booksWithImages = snapshot?.gallery?.books_with_images ? Array(snapshot.gallery.books_with_images).fill('') : [];
    const firstTranslations = snapshot?.milestones?.first_translations || 0;
    const nearComplete = snapshot?.milestones?.over_90_pct || 0;

    // Compute velocity from snapshots (deltas between consecutive points)
    const velocity = computeVelocity(snapshots);

    // Summarize cron health per cron name
    const cronHealth = summarizeCronHealth(cronRuns);

    // Detect stalls (funnel stages that are growing without corresponding outflow)
    const stalls = detectStalls(snapshots);

    const responseData = {
      snapshots: snapshots.length > 200
        ? downsample(snapshots, 200)
        : snapshots,
      velocity,
      cronHealth,
      stalls,
      needsAttention: needsAttention.map((b: any) => ({
        id: b.id,
        title: b.title,
        language: b.language,
        pages: b.pages_count || 0,
        ocr: b.pages_ocr || 0,
        translated: b.pages_translated || 0,
        status: b.pipeline_auto?.status,
        error: b.pipeline_auto?.error,
        lastUpdated: b.pipeline_auto?.last_updated,
        retryCount: b.pipeline_auto?.retry_count || 0,
        provider: b.image_source?.provider,
      })),
      recentErrors: recentErrors.map((e: any) => ({
        type: e._id.type,
        category: e._id.category || 'unknown',
        count: e.count,
        lastError: e.lastError?.substring(0, 200),
        lastAt: e.lastAt,
      })),
      recentDecisions: recentDecisions.map((d: any) => ({
        cron: d.cron,
        timestamp: d.timestamp,
        type: d.decision?.type,
        reason: d.decision?.reason,
        data: d.decision?.data,
      })),
      funnel,
      enrichmentCoverage: {
        total: enrichment.total || 0,
        ocr: enrichment.has_ocr || 0,
        translation: enrichment.has_translation || 0,
        metadata: enrichment.has_metadata || 0,
        ftVerification: enrichment.has_ft_verification || 0,
        summary: enrichment.has_summary || 0,
        chapters: enrichment.has_chapters || 0,
        collections: enrichment.has_collections || 0,
        qualityScore: enrichment.has_quality_score || 0,
        facetedTags: enrichment.has_faceted_tags || 0,
        authorEntity: enrichment.has_author_entity || 0,
        imageExtraction: booksWithImages.length,
        galleryImages: galleryCount,
        pipelineComplete: enrichment.pipeline_complete || 0,
      },
      milestones: {
        firstTranslations,
        nearComplete, // >90% translated
      },
      query: { hours },
    };

    // Update cache
    pipelineCache = { data: responseData, key: cacheKey, ts: Date.now() };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Pipeline analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline analytics', details: String(error) },
      { status: 500 }
    );
  }
});


function computeVelocity(snapshots: any[]): {
  ocr_per_hour: number;
  translate_per_hour: number;
  books_completing_per_day: number;
  period_hours: number;
} {
  if (snapshots.length < 2) {
    return { ocr_per_hour: 0, translate_per_hour: 0, books_completing_per_day: 0, period_hours: 0 };
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const hours = (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / (1000 * 60 * 60);

  if (hours < 0.1) {
    return { ocr_per_hour: 0, translate_per_hour: 0, books_completing_per_day: 0, period_hours: 0 };
  }

  const ocrDelta = (last.pages?.ocr || 0) - (first.pages?.ocr || 0);
  const translateDelta = (last.pages?.translated || 0) - (first.pages?.translated || 0);
  const completeDelta = (last.funnel?.complete || 0) - (first.funnel?.complete || 0);

  return {
    ocr_per_hour: Math.round(Math.max(0, ocrDelta) / hours),
    translate_per_hour: Math.round(Math.max(0, translateDelta) / hours),
    books_completing_per_day: Math.round(Math.max(0, completeDelta) / hours * 24),
    period_hours: Math.round(hours * 10) / 10,
  };
}


function summarizeCronHealth(runs: any[]): Record<string, {
  lastRun: Date | null;
  lastDuration: number;
  runsInPeriod: number;
  failures: number;
  avgDuration: number;
  recentErrors: string[];
}> {
  const byCron: Record<string, any[]> = {};
  for (const run of runs) {
    const name = run.cron || 'unknown';
    (byCron[name] ||= []).push(run);
  }

  const result: Record<string, any> = {};
  for (const [name, cronRuns] of Object.entries(byCron)) {
    const sorted = cronRuns.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const latest = sorted[0];
    const failures = sorted.filter(r => r.failed).length;
    const durations = sorted.map(r => r.duration_ms).filter(Boolean);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
      : 0;

    // Collect unique recent errors (normalize objects to strings)
    const errors = sorted
      .flatMap(r => r.errors || [])
      .filter(Boolean)
      .map(e => typeof e === 'string' ? e : (e as any)?.message || String(e))
      .slice(0, 10);

    result[name] = {
      lastRun: latest?.timestamp || null,
      lastDuration: latest?.duration_ms || 0,
      runsInPeriod: sorted.length,
      failures,
      avgDuration,
      recentErrors: [...new Set(errors)].slice(0, 5),
    };
  }

  return result;
}


function detectStalls(snapshots: any[]): Array<{
  stage: string;
  direction: 'growing' | 'shrinking' | 'stalled';
  delta: number;
  current: number;
}> {
  if (snapshots.length < 6) return []; // need at least 1 hour of data at 10-min intervals

  // Compare first third vs last third for trend
  const third = Math.floor(snapshots.length / 3);
  const earlySlice = snapshots.slice(0, third);
  const lateSlice = snapshots.slice(-third);

  const avgFunnel = (slice: any[], stage: string) => {
    const vals = slice.map(s => s.funnel?.[stage] || 0);
    return vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
  };

  const stages = [
    'archive_complete', 'ocr_submitted', 'ocr_complete',
    'metadata_enriched', 'translate_submitted', 'translate_complete',
    'enriching', 'enriched', 'chapters', 'chapters_complete',
    'images_submitted', 'images_complete', 'complete', 'failed', 'needs_attention',
  ];

  const stalls: any[] = [];
  const latest = snapshots[snapshots.length - 1];

  for (const stage of stages) {
    const early = avgFunnel(earlySlice, stage);
    const late = avgFunnel(lateSlice, stage);
    const current = latest.funnel?.[stage] || 0;
    const delta = Math.round(late - early);

    // Only report meaningful changes (>5 books or >20% change)
    if (Math.abs(delta) >= 5 || (early > 0 && Math.abs(delta / early) > 0.2)) {
      stalls.push({
        stage,
        direction: delta > 0 ? 'growing' : delta < 0 ? 'shrinking' : 'stalled',
        delta,
        current,
      });
    }
  }

  return stalls.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}


/** Downsample snapshots to N evenly-spaced points */
function downsample(snapshots: any[], target: number): any[] {
  if (snapshots.length <= target) return snapshots;
  const step = snapshots.length / target;
  const result = [];
  for (let i = 0; i < target; i++) {
    result.push(snapshots[Math.floor(i * step)]);
  }
  // Always include the last point
  if (result[result.length - 1] !== snapshots[snapshots.length - 1]) {
    result.push(snapshots[snapshots.length - 1]);
  }
  return result;
}

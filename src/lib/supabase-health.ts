/**
 * Supabase sync health checker.
 *
 * Calls the sync_health() RPC function (created by supabase-sync-health.sql)
 * which uses pg_class for instant approximate counts and indexed lookups
 * for latest timestamps. Falls back to individual queries if the RPC
 * doesn't exist yet.
 */

import { supabase, supabaseAdmin } from './supabase';

// The anon key cannot execute sync_health() — Postgres returns 42501
// (permission denied for table gemini_usage), which silently forced the
// fallback path (and its hardcoded 'warning') on every health check until
// 2026-07-23. Server-side health checks must use the service-role client.
const client = supabaseAdmin ?? supabase;

interface SyncHealthResult {
  status: 'ok' | 'warning' | 'critical';
  pages?: { approx_count: number; latest_updated_at: string | null; latest_ocr_at: string | null; latest_translation_at: string | null };
  entities?: { approx_count: number; latest_updated_at: string | null };
  gemini_usage?: { approx_count: number; latest_at: string | null };
  lag_minutes?: Record<string, number | null>;
  checked_at?: string;
  error?: string;
  note?: string;
}

export async function getSupabaseSyncHealth(
  opts: { pipelinePaused?: boolean } = {},
): Promise<SyncHealthResult> {
  // Try the RPC function first (instant, uses pg_class)
  const { data, error } = await client.rpc('sync_health');

  if (error) {
    // RPC doesn't exist yet — fall back to lightweight individual queries
    return getFallbackHealth();
  }

  const result = data as {
    pages: { approx_count: number; latest_updated_at: string | null; latest_ocr_at: string | null; latest_translation_at: string | null };
    entities: { approx_count: number; latest_updated_at: string | null };
    gemini_usage: { approx_count: number; latest_at: string | null };
    checked_at: string;
  };

  // Calculate lag: how many minutes since the latest update in each table
  const now = Date.now();
  const lag: Record<string, number | null> = {};

  if (result.pages?.latest_updated_at) {
    lag.pages = Math.round((now - new Date(result.pages.latest_updated_at).getTime()) / 60000);
  }
  if (result.entities?.latest_updated_at) {
    lag.entities = Math.round((now - new Date(result.entities.latest_updated_at).getTime()) / 60000);
  }
  if (result.gemini_usage?.latest_at) {
    lag.gemini_usage = Math.round((now - new Date(result.gemini_usage.latest_at).getTime()) / 60000);
  }

  // Status: only `gemini_usage` represents a live-written, no-known-gap table —
  // its lag is the one that actually indicates a sync outage.
  //   - `pages`: no INSERT path from the live pipeline (#2020). Lag floor is the
  //     timestamp of the last PATCH against pre-migration rows.
  //   - `entities`: manual-only sync (.claude/docs/supabase.md Gap D). Lag accrues
  //     by design between hand-runs of sync-entities.mjs.
  // Both are still reported in `lag_minutes` for visibility but don't drive status.
  const liveLag = lag.gemini_usage ?? 0;
  // While the pipeline is deliberately paused, nothing writes gemini_usage —
  // its lag measures the pause, not a sync outage. A paused system reporting
  // stale gemini_usage is normal, not an incident.
  const paused = opts.pipelinePaused === true;
  const status = paused ? 'ok'
    : liveLag > 360 ? 'critical'
    : liveLag > 60 ? 'warning'
    : 'ok';

  return {
    status,
    pages: result.pages,
    entities: result.entities,
    gemini_usage: result.gemini_usage,
    lag_minutes: lag,
    checked_at: result.checked_at,
    ...(paused && liveLag > 60
      ? { note: 'gemini_usage lag not escalated: pipeline is deliberately paused, so the source table is not being written' }
      : {}),
  };
}

/** Fallback when the sync_health() RPC hasn't been created yet */
async function getFallbackHealth(): Promise<SyncHealthResult> {
  const now = Date.now();
  const lag: Record<string, number | null> = {};

  // Entities — has an index on updated_at, should be fast
  const { data: entityRow } = await client
    .from('entities')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (entityRow?.updated_at) {
    lag.entities = Math.round((now - new Date(entityRow.updated_at).getTime()) / 60000);
  }

  // Pages — may timeout without the index, use a 3s abort
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const { data: pageRow } = await client
      .from('pages')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .abortSignal(controller.signal)
      .single();
    clearTimeout(timeout);

    if (pageRow?.updated_at) {
      lag.pages = Math.round((now - new Date(pageRow.updated_at).getTime()) / 60000);
    }
  } catch {
    lag.pages = null; // timed out — index not yet created
  }

  // Fallback path can't see gemini_usage; without the live signal we can't tell
  // a sync outage apart from documented gaps, so don't escalate to critical.
  const status: 'ok' | 'warning' = 'warning';

  return {
    status,
    lag_minutes: lag,
    checked_at: new Date().toISOString(),
    ...(lag.pages === null ? { error: 'pages query timed out — run supabase-sync-health.sql to add idx_pages_updated_at' } : {}),
  };
}

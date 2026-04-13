import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getSupabaseSyncHealth } from '@/lib/supabase-health';

export const maxDuration = 10;

/**
 * GET /api/admin/supabase-sync
 *
 * Lightweight Supabase sync health check.
 * Returns approximate row counts, latest update timestamps,
 * and lag in minutes for each synced table.
 *
 * Requires the sync_health() RPC on Supabase for best results.
 * Falls back to individual queries if the RPC doesn't exist yet.
 */
export const GET = withAdminAuth(async () => {
  const started = Date.now();
  const result = await getSupabaseSyncHealth();

  return NextResponse.json({
    ...result,
    duration_ms: Date.now() - started,
  });
});

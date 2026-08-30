import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createCronLogger } from '@/lib/cron-logger';
import { refreshDashboardSnapshot } from '@/lib/dashboard-snapshot';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Hourly refresh of `system_config.dashboard_snapshot`.
 *
 * This is the writer the snapshot never had. `POST /api/admin/dashboard` was
 * the only thing that recomputed it and nothing called POST, so the document
 * sat at its 2026-04-01 value for 138 days while `/admin`, `/contribute` and
 * `/developers/pipeline` rendered it as current.
 *
 * Measured at ~10s against production, so it fits the 60s cap comfortably; if
 * that ever stops being true, move it to the Hetzner worker fleet rather than
 * letting it fail silently every hour.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const log = createCronLogger('dashboard-snapshot');
  try {
    const db = await getDb();
    const data = await refreshDashboardSnapshot(db);
    log.action('system_config_updated');
    await log.flush();
    return NextResponse.json({
      ok: true,
      books: data.canon.total_books,
      pages: data.canon.total_pages,
      cost_truncated: data.economics.truncated,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('dashboard-snapshot cron error:', error);
    log.error(msg);
    log.setFailed();
    await log.flush();
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

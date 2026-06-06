import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/key-fingerprints — SHA-256 fingerprints of this deployment's
 * Gemini API keys (#2455).
 *
 * Lets the Hetzner health worker detect key drift between Vercel and the
 * pipeline box: Gemini Batch jobs are visible only to their creating key, so a
 * key present here but absent on Hetzner means the collector silently fails
 * every job that key submits (348 jobs were falsely failed this way on
 * 2026-06-05 — see memory/pipeline-ops.md).
 *
 * Returns 12-hex-char SHA-256 prefixes — enough to diff key sets, useless for
 * recovering key material. CRON_SECRET bearer auth, same as other admin crons.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fingerprints: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('GEMINI_API_KEY') || !value) continue;
    fingerprints[name] = createHash('sha256').update(value).digest('hex').slice(0, 12);
  }

  return NextResponse.json({ host: 'vercel', fingerprints });
}

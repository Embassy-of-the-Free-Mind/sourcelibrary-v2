/**
 * Append-only usage log for the public-API gate. One doc per gated call.
 *
 * Indexes (created lazily on first write — idempotent, MongoDB no-ops if present):
 *   - { ts: 1 } plain (NO TTL — retention is manual per #2976 decision 2026-07-05;
 *     prune with scripts/maintenance/prune-telemetry.mjs on explicit request only)
 *   - { user_id: 1, ts: -1 } for "what did this user do" views
 *   - { api_key_id: 1, ts: -1 } for "what is this key being used for"
 *   - { route: 1, ts: -1 } for hot-route analysis
 *
 * Writes are fire-and-forget; logging failures never affect the response.
 * IPs are hashed (SHA-256, 16 hex chars) so the collection isn't a PII liability
 * but we can still de-dupe by source.
 */
import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getClientIp } from '@/lib/rate-limit';
import type { ApiIdentity } from '@/lib/api-auth';

const COLLECTION = 'api_usage';

let indexesEnsured = false;
async function ensureIndexes() {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    const db = await getDb();
    const col = db.collection(COLLECTION);
    await Promise.all([
      // Plain index — deliberately NO expireAfterSeconds. Automated retention
      // was removed per #2976 (decision 2026-07-05); pruning is manual via
      // scripts/maintenance/prune-telemetry.mjs. Do not re-add a TTL here.
      col.createIndex({ ts: 1 }),
      col.createIndex({ user_id: 1, ts: -1 }),
      col.createIndex({ api_key_id: 1, ts: -1 }),
      col.createIndex({ ip_hash: 1, ts: -1 }),
      col.createIndex({ route: 1, ts: -1 }),
    ]);
  } catch (e) {
    // Code 85 (IndexOptionsConflict): the legacy TTL index still exists on the
    // same key until the post-deploy swap (#2976 runbook,
    // scripts/maintenance/swap-ttl-to-plain-indexes.mjs) runs. Treat as ensured
    // so we don't re-attempt createIndex on every single write in the interim.
    if ((e as { code?: number } | null)?.code !== 85) indexesEnsured = false;
  }
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

export interface LogApiUsageInput {
  request: NextRequest;
  identity: ApiIdentity;
  route: string;
  status: number;
  ms: number;
  wouldBlock: boolean;     // would the gate have blocked this call?
  blocked: boolean;        // did the gate actually block it (enforce mode)?
  reason?: string;
  /** Number of "billable" pages this call returned. Used by the bulk-page budget. */
  pagesServed?: number;
}

export function logApiUsage(input: LogApiUsageInput): void {
  // Fire-and-forget; never await.
  void writeLogEntry(input).catch(() => {});
}

async function writeLogEntry(input: LogApiUsageInput) {
  await ensureIndexes();
  const db = await getDb();
  const ip = getClientIp(input.request);

  await db.collection(COLLECTION).insertOne({
    ts: new Date(),
    identity_kind: input.identity.kind,
    user_id: input.identity.userId || null,
    api_key_id: input.identity.apiKeyId || null,
    api_key_tier: input.identity.apiKeyTier || null,
    bot: input.identity.bot || null,
    route: input.route,
    method: input.request.method,
    path: input.request.nextUrl.pathname,
    status: input.status,
    ms: input.ms,
    ip_hash: hashIp(ip),
    user_agent: (input.request.headers.get('user-agent') || '').slice(0, 200),
    would_block: input.wouldBlock,
    blocked: input.blocked,
    reason: input.reason || null,
    pages_served: input.pagesServed || 0,
  });
}

/**
 * Read pages-served-today for the budget gate. Sums `pages_served` over the
 * last 24h, scoped by the strongest identifier we have for the caller:
 *   apikey  → api_key_id
 *   session → user_id
 *   anon    → ip_hash (best-effort, hashed)
 *
 * Same-origin browser callers are scoped by ip_hash too. That's intentional —
 * a determined scraper can spoof Origin in server-to-server requests, but the
 * IP-scoped budget still bites.
 */
export async function getPagesServedLast24h(input: {
  identity: ApiIdentity;
  request: NextRequest;
  /**
   * Restrict the sum to one logical route (e.g. 'image'), so surfaces with
   * their own budgets don't drain each other's. Omitted = all routes (the
   * original /text behaviour — existing callers are unchanged).
   */
  route?: string;
}): Promise<number> {
  await ensureIndexes();
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const filter: Record<string, unknown> = { ts: { $gte: since }, pages_served: { $gt: 0 } };
  // Image-proxy rows are a separate budget pool: an omitted route means "all
  // TEXT surfaces" (the pre-image-gate behaviour), never text + images —
  // otherwise 500 image loads would silently zero the same caller's /text
  // budget. Only an explicit route:'image' reads the image pool.
  filter.route = input.route ?? { $ne: 'image' };
  if (input.identity.apiKeyId) filter.api_key_id = input.identity.apiKeyId;
  else if (input.identity.userId) filter.user_id = input.identity.userId;
  else filter.ip_hash = hashIp(getClientIp(input.request));

  const result = await db.collection(COLLECTION).aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: '$pages_served' } } },
  ]).toArray();

  return result[0]?.total || 0;
}

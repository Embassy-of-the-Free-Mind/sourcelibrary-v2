/**
 * Append-only usage log for the public-API gate. One doc per gated call.
 *
 * Indexes (created lazily on first write — idempotent, MongoDB no-ops if present):
 *   - { ts: 1 } TTL 90 days for raw events
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
      col.createIndex({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }),
      col.createIndex({ user_id: 1, ts: -1 }),
      col.createIndex({ api_key_id: 1, ts: -1 }),
      col.createIndex({ ip_hash: 1, ts: -1 }),
      col.createIndex({ route: 1, ts: -1 }),
    ]);
  } catch {
    indexesEnsured = false;
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
}): Promise<number> {
  await ensureIndexes();
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const filter: Record<string, unknown> = { ts: { $gte: since }, pages_served: { $gt: 0 } };
  if (input.identity.apiKeyId) filter.api_key_id = input.identity.apiKeyId;
  else if (input.identity.userId) filter.user_id = input.identity.userId;
  else filter.ip_hash = hashIp(getClientIp(input.request));

  const result = await db.collection(COLLECTION).aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: '$pages_served' } } },
  ]).toArray();

  return result[0]?.total || 0;
}

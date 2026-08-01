/**
 * Append-only query log for direct (non-MCP) search endpoints.
 *
 * The MCP path already logs to `mcp_tool_calls` (one doc per tool call, with
 * args.query). This collection fills the gap for callers that hit /api/search
 * and /api/search/semantic directly — browser users, scrapers, partner sites.
 *
 * Indexes (created lazily, idempotent):
 *   - { ts: 1 } plain (NO TTL — retention is manual per #2976 decision 2026-07-05)
 *   - { route: 1, ts: -1 }
 *   - { ip_hash: 1, ts: -1 }
 *
 * Fire-and-forget — logging failures never affect the response.
 * IPs are hashed (SHA-256, 16 hex chars) to keep the collection PII-light.
 */
import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getClientIp } from '@/lib/rate-limit';
import type { ApiIdentity } from '@/lib/api-auth';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { resolveHostFromHeaders } from '@/lib/analytics-ingest';

const COLLECTION = 'search_queries';
const MAX_QUERY_LEN = 500;

let indexesEnsured = false;
async function ensureIndexes() {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    const db = await getDb();
    const col = db.collection(COLLECTION);
    await Promise.all([
      // Plain index — deliberately NO expireAfterSeconds (#2976, 2026-07-05).
      // Pruning is manual via scripts/maintenance/prune-telemetry.mjs.
      col.createIndex({ ts: 1 }),
      col.createIndex({ route: 1, ts: -1 }),
      col.createIndex({ ip_hash: 1, ts: -1 }),
    ]);
  } catch (e) {
    // Code 85 (IndexOptionsConflict): a legacy TTL index may still exist on
    // the same key (search_queries.ts_1 is TTL in prod until a human swaps it
    // — see #2976). Treat as ensured so we don't retry on every write.
    if ((e as { code?: number } | null)?.code !== 85) indexesEnsured = false;
  }
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

export interface LogSearchQueryInput {
  request: NextRequest;
  identity?: ApiIdentity;
  /** Logical route name, e.g. 'search', 'search.semantic.book', 'search.semantic.page' */
  route: string;
  /** The user-supplied query string (will be truncated to MAX_QUERY_LEN). */
  query: string;
  /** Total result count returned to the caller, if available. */
  total?: number;
  /** Wall-clock duration in ms. */
  ms: number;
  /** False if the request errored. */
  ok: boolean;
  /** Free-form bag of filter params (language, year range, etc.). Values
   *  are coerced to primitives; arrays of strings preserved. */
  filters?: Record<string, unknown>;
  /** Per-lane latency breakdown for `/api/search` (book / page / semantic_book /
   *  semantic_page). Total wall-clock = max(lanes) since they run in parallel.
   *  Lets us correlate slow queries with which lane stalled. */
  stage_ms?: Record<string, number>;
  /** True if the page-content Atlas Search lane hit its hardcoded timeout and
   *  returned empty results. Used to size the quality-vs-latency tradeoff. */
  page_search_timed_out?: boolean;
}

export function logSearchQuery(input: LogSearchQueryInput): void {
  void writeEntry(input).catch(() => {});
}

async function writeEntry(input: LogSearchQueryInput) {
  if (!input.query || input.query.trim().length < 1) return; // skip empty
  await ensureIndexes();
  const db = await getDb();
  const ip = getClientIp(input.request);

  const filters: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.filters || {})) {
    if (v == null) continue;
    if (typeof v === 'string') filters[k] = v.slice(0, 100);
    else if (typeof v === 'number' || typeof v === 'boolean') filters[k] = v;
    else if (Array.isArray(v)) filters[k] = v.slice(0, 10).map(x => String(x).slice(0, 100));
  }

  // Tenant + host are derived here rather than threaded through every caller.
  // This log had NEITHER field, which made its four months of rows structurally
  // unattributable: a partner subdomain's `/search?q=…` is rewritten by
  // proxy.ts to `/embed/<tenant>/search`, which re-exports the main SearchPage
  // and therefore lands in `/api/search` — indistinguishable from a main-site
  // search. A usage report consequently labelled the whole table "main site
  // only", which it never was. Deriving inside the writer means a new caller
  // cannot forget it (see src/lib/search-event-log.ts for the sibling rule).
  const tenant = getTenantContextFromRequest(input.request.headers);

  await db.collection(COLLECTION).insertOne({
    ts: new Date(),
    route: input.route,
    query: input.query.slice(0, MAX_QUERY_LEN),
    total: input.total ?? null,
    ms: input.ms,
    ok: input.ok,
    identity_kind: input.identity?.kind || 'anon',
    user_id: input.identity?.userId || null,
    api_key_id: input.identity?.apiKeyId || null,
    tenant_id: tenant?.id || null,
    tenant_slug: tenant?.slug || null,
    host: resolveHostFromHeaders(input.request.headers),
    ip_hash: hashIp(ip),
    user_agent: (input.request.headers.get('user-agent') || '').slice(0, 200),
    filters,
    ...(input.stage_ms ? { stage_ms: input.stage_ms } : {}),
    ...(input.page_search_timed_out ? { page_search_timed_out: true } : {}),
  });
}

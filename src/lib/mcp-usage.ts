/**
 * Append-only per-tool log for the MCP server. One doc per tool call.
 *
 * The HTTP-level `api_usage` log captures every POST to /api/mcp but doesn't
 * know which tool was invoked. This log fills that gap so we can answer
 * "which tools are getting used, how often, how fast, and where they fail."
 *
 * Indexes (created lazily on first write):
 *   - { ts: 1 } plain (NO TTL — retention is manual per #2976 decision 2026-07-05)
 *   - { tool: 1, ts: -1 } for "how is search_translations doing"
 *   - { ip_hash: 1, ts: -1 } for per-client analysis
 *
 * Fire-and-forget; logging failures never affect the tool response.
 */
import { createHash } from 'crypto';
import { getDb } from '@/lib/mongodb';

const COLLECTION = 'mcp_tool_calls';

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
      col.createIndex({ tool: 1, ts: -1 }),
      col.createIndex({ ip_hash: 1, ts: -1 }),
    ]);
  } catch (e) {
    // Code 85 (IndexOptionsConflict): a legacy TTL index may still exist on
    // the same key (mcp_tool_calls.ts_1 is TTL in prod until a human swaps it
    // — see #2976). Treat as ensured so we don't retry on every write.
    if ((e as { code?: number } | null)?.code !== 85) indexesEnsured = false;
  }
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

export interface LogMcpToolCallInput {
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  error?: string | null;
  ip: string;
  userAgent: string | null;
}

export function logMcpToolCall(input: LogMcpToolCallInput): void {
  void writeEntry(input).catch(() => {});
}

async function writeEntry(input: LogMcpToolCallInput) {
  await ensureIndexes();
  const db = await getDb();

  // Truncated, JSON-safe arg summary. We keep keys + small string/number values
  // so we can see "what does search_translations get queried for" without
  // storing megabyte payloads or arbitrary nested user input.
  const argSummary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.args || {})) {
    if (v == null) argSummary[k] = v;
    else if (typeof v === 'string') argSummary[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') argSummary[k] = v;
    else argSummary[k] = typeof v;
  }

  await db.collection(COLLECTION).insertOne({
    ts: new Date(),
    tool: input.tool,
    args: argSummary,
    ms: input.ms,
    ok: !input.error,
    error: input.error || null,
    ip_hash: hashIp(input.ip),
    user_agent: (input.userAgent || '').slice(0, 200),
  });
}

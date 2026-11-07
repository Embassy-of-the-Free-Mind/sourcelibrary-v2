/**
 * Append-only per-tool log for the MCP server. One doc per tool call.
 *
 * The HTTP-level `api_usage` log captures every POST to /api/mcp but doesn't
 * know which tool was invoked. This log fills that gap so we can answer
 * "which tools are getting used, how often, how fast, and where they fail."
 *
 * It cannot answer "which CLIENT is calling", though: the server is stateless,
 * so a tool call arrives in its own HTTP request carrying no client identity,
 * and `Claude-User` traffic all originates from Anthropic egress IPs — so
 * distinct `ip_hash` badly undercounts real installs there and overcounts
 * elsewhere. The only place a client names itself is the `initialize`
 * handshake; `logMcpInitialize` below captures that (see `mcp_clients`).
 *
 * Indexes (created lazily on first write):
 *   - { ts: 1 } plain (NO TTL — retention is manual per #2976 decision 2026-07-05)
 *   - { tool: 1, ts: -1 } for "how is search_translations doing"
 *   - { ip_hash: 1, ts: -1 } for per-client analysis
 *
 * Fire-and-forget; logging failures never affect the tool response.
 */
import { createHash, randomUUID } from 'crypto';
import { after } from 'next/server';
import { getDb } from '@/lib/mongodb';

const COLLECTION = 'mcp_tool_calls';

/**
 * Hand deferred work to the platform instead of orphaning a floating promise.
 *
 * A bare `void writeEntry()` is not fire-and-forget on serverless — it is
 * fire-and-*maybe*. Vercel freezes the instance once the response is sent, so
 * an insert that hasn't finished is suspended mid-flight and only resumes if
 * some later request happens to thaw that same instance. Measured on a cold
 * preview (2026-08-05): an `initialize` row appeared ~40s after the request,
 * on the back of an unrelated later call, and a tool-call row from the same
 * deployment never landed at all. Warm production instances usually win the
 * race, which is precisely what makes the loss invisible — the log undercounts
 * silently and disproportionately drops COLD starts, i.e. new clients.
 *
 * `after()` keeps the function alive until the callback settles. Bounded, so a
 * slow Atlas write can't hold the slot; the fallback covers non-request scopes
 * (tests, scripts) where `after()` throws. Same shape as
 * src/app/api/track/route.ts.
 */
const DB_TIMEOUT_MS = 3000;

export function deferDbWrite(work: () => Promise<void>): void {
  const bounded = async () => {
    try {
      await Promise.race([
        work(),
        new Promise<void>((resolve) => setTimeout(resolve, DB_TIMEOUT_MS)),
      ]);
    } catch {
      // Telemetry must never surface to the caller.
    }
  };
  try {
    after(bounded);
  } catch {
    void bounded();
  }
}

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

// ── Session id: joins a handshake to the tool calls that followed it ──

/**
 * A random id handed to the client on `initialize` (`Mcp-Session-Id`); the MCP
 * spec has the client echo it on every later request. The server stores no
 * session and validates nothing, so it stays stateless on serverless.
 *
 * It exists for MEASUREMENT only: "of the chats that connected, how many used a
 * tool, and how many calls did they make?" No tool call could answer that
 * before, because a call carries no client identity and Claude traffic shares
 * Anthropic's egress IPs.
 *
 * The client chooses what it echoes, so NEVER key a budget, a limit or an abuse
 * decision on this value. A scraper can drop it or send a new one per call.
 */
const SESSION_ID_SHAPE = /^[A-Za-z0-9._:-]{8,128}$/;

export function mintMcpSessionId(): string {
  return randomUUID();
}

export function readMcpSessionId(headers: Pick<Headers, 'get'>): string | null {
  const value = headers.get('mcp-session-id');
  return value && SESSION_ID_SHAPE.test(value) ? value : null;
}

/**
 * How many results a tool returned, or null when its shape does not say. The
 * null matters: an empty search used to log as a plain success, and "unknown"
 * must stay distinguishable from "measured zero".
 */
export function countToolResults(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  for (const key of ['total_matches', 'total', 'returned']) {
    if (typeof r[key] === 'number') return r[key] as number;
  }
  for (const key of ['results', 'passages', 'books', 'images']) {
    if (Array.isArray(r[key])) return (r[key] as unknown[]).length;
  }
  return null;
}

export interface LogMcpToolCallInput {
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  error?: string | null;
  ip: string;
  userAgent: string | null;
  sessionId?: string | null;
  resultCount?: number | null;
}

export function logMcpToolCall(input: LogMcpToolCallInput): void {
  deferDbWrite(() => writeEntry(input));
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
    session_id: input.sessionId ?? null,
    result_count: input.resultCount ?? null,
  });
}

// ── Client identity: the `initialize` handshake ────────────────────

/**
 * One doc per MCP `initialize` call. This is the only message where a client
 * states who it is (`params.clientInfo = { name, version }`), so it's the only
 * way to count installs rather than IP addresses: "claude-ai" vs "Claude Code"
 * vs "cline" vs a registry crawler that handshakes and never calls a tool.
 *
 * Registry crawlers and uptime monitors handshake constantly (~24k/month from
 * one liveness prober alone as of 2026-08), so treat the raw row count as
 * discovery noise and read the DISTINCT client_name/client_version instead.
 *
 * Same retention posture as `mcp_tool_calls`: no TTL (#2976), fire-and-forget.
 */
const CLIENTS_COLLECTION = 'mcp_clients';

let clientIndexesEnsured = false;
async function ensureClientIndexes() {
  if (clientIndexesEnsured) return;
  clientIndexesEnsured = true;
  try {
    const db = await getDb();
    const col = db.collection(CLIENTS_COLLECTION);
    await Promise.all([
      col.createIndex({ ts: 1 }),
      col.createIndex({ client_name: 1, ts: -1 }),
      col.createIndex({ ip_hash: 1, ts: -1 }),
    ]);
  } catch (e) {
    if ((e as { code?: number } | null)?.code !== 85) clientIndexesEnsured = false;
  }
}

export interface LogMcpInitializeInput {
  clientName: string | null;
  clientVersion: string | null;
  clientTitle?: string | null;
  protocolVersion: string | null;
  ip: string;
  userAgent: string | null;
  sessionId?: string | null;
}

export function logMcpInitialize(input: LogMcpInitializeInput): void {
  deferDbWrite(() => writeClientEntry(input));
}

async function writeClientEntry(input: LogMcpInitializeInput) {
  await ensureClientIndexes();
  const db = await getDb();
  const str = (v: string | null | undefined) =>
    typeof v === 'string' && v.length > 0 ? v.slice(0, 120) : null;

  await db.collection(CLIENTS_COLLECTION).insertOne({
    ts: new Date(),
    client_name: str(input.clientName),
    client_version: str(input.clientVersion),
    client_title: str(input.clientTitle),
    protocol_version: str(input.protocolVersion),
    ip_hash: hashIp(input.ip),
    user_agent: (input.userAgent || '').slice(0, 200),
    session_id: input.sessionId ?? null,
  });
}

/**
 * Shadow mode for the reader wall (#90; ops reports/access-layers-2026-11-05.md, step 1).
 *
 * PRIOR ART: src/lib/metered-gate.ts is the wall itself. It writes a `gate_hit` row only
 * when METERED_READER=1, which is off, so it records nothing today. src/lib/api-usage.ts
 * has a `would_block` field, but it is the daily-budget verdict of the API routes, not the
 * free-sample wall. src/lib/pages-api-meter.ts writes a `pages_api` row per page call
 * without saying whether the wall would have stripped it or who the caller was.
 * src/lib/bot-reads.ts logs known bots only.
 *
 * What this does. With the wall OFF, every call into gatePagesForRequest asks the same
 * question the wall would ask, after the response has gone out, and writes one
 * `wall_shadow` row when the answer is "strip this": the kind of caller, why, and how
 * many pages. It changes nothing a reader or a crawler receives, and it adds no work
 * before the response (everything runs in next/server `after()`).
 *
 * Assistants (step 2 of the report). A User-Agent naming Claude-User, ChatGPT-User,
 * Perplexity-User, Claude-SearchBot or OAI-SearchBot is checked against the operator's
 * published address list (assistant-fetchers.ts), the check isTrustedBot already makes.
 * Rows say which: `assistant_proven` (the wall would let it through, logged as `pass`)
 * or `assistant_unproven` (the name is on an address the operator does not publish, so
 * the wall would treat it as anyone else).
 *
 * Cost control. Sampling is by CALLER, not by request: an address is in or out for the
 * whole UTC day, chosen by a hash. So a sampled caller's pages are counted exactly, and
 * distinct callers divide by the rate without bias. Signed-in readers, the pipeline,
 * tenant rooms and proven crawlers are never written, because the wall exempts them.
 *
 * Switches: WALL_SHADOW=off stops it. WALL_SHADOW_SAMPLE (default 0.25) is the share
 * of callers kept. WALL_SHADOW_UNTIL (default 2026-12-01) ends it by itself, so two
 * weeks of logging cannot quietly become a permanent write. It never runs while
 * METERED_READER=1, when the wall's own gate_hit rows take over.
 *
 * Read it with scripts/audit/wall-shadow-report.mjs.
 */
import { createHash } from 'crypto';
import { after } from 'next/server';
import type { Db } from 'mongodb';
import { auth } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';
import { hasCronAuth } from '@/lib/book-access';
import { isBot, isSearchCrawler, isTrustedBot } from '@/lib/bot-gate';
import { namesListedClient, provenByPublishedList } from '@/lib/assistant-fetchers';
import { freeMaxPage, isPageFree, meteredReaderEnabled } from '@/lib/free-preview';

export const WALL_SHADOW_COLLECTION = 'wall_shadow';
const DEFAULT_SAMPLE = 0.25;
const DEFAULT_UNTIL = '2026-12-01';

export type ShadowKind =
  | 'assistant_proven'
  | 'assistant_unproven'
  | 'crawler_name_unproven'
  | 'declared_bot'
  | 'anon_browser'
  | 'anon_script';

export type ShadowAction = 'would_strip' | 'pass';

const REASONS: Record<ShadowKind, string> = {
  assistant_proven: 'assistant name on its operator\'s published address list',
  assistant_unproven: 'assistant name from an address its operator does not publish',
  crawler_name_unproven: 'search crawler name the reverse DNS check calls forged',
  declared_bot: 'declared bot, not a search crawler or a proven assistant',
  anon_browser: 'signed out, browser-shaped, past the free sample',
  anon_script: 'signed out, no browser headers, past the free sample',
};

function sampleRate(): number {
  const raw = process.env.WALL_SHADOW_SAMPLE;
  const n = raw === undefined || raw === '' ? DEFAULT_SAMPLE : Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_SAMPLE;
}

/** On unless switched off, past its end date, or the real wall is on. */
export function wallShadowEnabled(now: Date = new Date()): boolean {
  if (process.env.WALL_SHADOW === 'off' || meteredReaderEnabled()) return false;
  const until = Date.parse(process.env.WALL_SHADOW_UNTIL || DEFAULT_UNTIL);
  if (Number.isFinite(until) && now.getTime() >= until) return false;
  return sampleRate() > 0;
}

/** Same 16-hex hash api_usage stores, so the two logs join on a caller. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/** Is this caller in today's sample? Stable for the UTC day, independent of the path. */
export function callerSampled(ipHash: string, day: string, rate: number = sampleRate()): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const h = createHash('sha256').update(`wall-shadow:${day}:${ipHash}`).digest();
  return h.readUInt32BE(0) / 0x100000000 < rate;
}

/** A real browser sends fetch metadata or client hints; plain HTTP libraries send neither. */
function browserShaped(headers: Headers): boolean {
  return headers.has('sec-fetch-mode') || headers.has('sec-ch-ua');
}

/**
 * What the wall would do with a caller who is not signed in and not the pipeline.
 * Null = the wall exempts it and nothing is logged (a proven crawler, an API key).
 */
export async function classifyShadowCaller(
  request: Request,
): Promise<{ kind: ShadowKind; action: ShadowAction } | null> {
  const ua = request.headers.get('user-agent') || '';
  const listed = namesListedClient(ua);
  const trusted = await isTrustedBot(request);
  if (listed && provenByPublishedList(ua, getClientIp(request))) {
    return { kind: 'assistant_proven', action: 'pass' };
  }
  if (trusted) return null;
  if (listed) return { kind: 'assistant_unproven', action: 'would_strip' };
  if (isSearchCrawler(request)) return { kind: 'crawler_name_unproven', action: 'would_strip' };
  if (isBot(request)) return { kind: 'declared_bot', action: 'would_strip' };
  return browserShaped(request.headers)
    ? { kind: 'anon_browser', action: 'would_strip' }
    : { kind: 'anon_script', action: 'would_strip' };
}

type ShadowPage = { book_id?: string; page_number?: number | null; seo_indexable?: boolean };

async function shadowOnce(db: Db, request: Request, pages: ShadowPage[], ipHash: string, day: string, rate: number) {
  const session = await auth().catch(() => null);
  if (session?.user) return; // the wall exempts signed-in readers

  const bookIds = [...new Set(pages.map((p) => p.book_id).filter(Boolean))] as string[];
  if (bookIds.length === 0) return;
  const books = await db.collection('books').find(
    { id: { $in: bookIds } },
    { projection: { _id: 0, id: 1, pages_count: 1 }, maxTimeMS: 3000 },
  ).toArray();
  const counts = new Map(books.map((b) => [b.id as string, (b.pages_count as number) || 0]));

  const gated = pages.filter((p) => {
    const n = counts.get(p.book_id as string);
    return n !== undefined && !isPageFree(p, n); // unresolved book: the wall fails open too
  });
  if (gated.length === 0) return;

  const verdict = await classifyShadowCaller(request);
  if (!verdict) return;

  const first = gated[0];
  const url = new URL(request.url);
  await db.collection(WALL_SHADOW_COLLECTION).insertOne({
    ts: new Date(),
    day,
    kind: verdict.kind,
    action: verdict.action,
    reason: REASONS[verdict.kind],
    path: url.pathname.slice(0, 200),
    host: (request.headers.get('host') || '').slice(0, 120) || null,
    book_id: first.book_id ?? null,
    books: bookIds.length,
    pages_requested: pages.length,
    pages_past_sample: gated.length,
    first_gated_page: first.page_number ?? null,
    free_max_page: freeMaxPage(counts.get(first.book_id as string) || 0),
    ip_hash: ipHash,
    user_agent: (request.headers.get('user-agent') || '').slice(0, 200),
    ch_ua: request.headers.get('sec-ch-ua')?.slice(0, 160) ?? null,
    sample_rate: rate,
  });
}

let indexed = false;
async function ensureIndex(db: Db) {
  if (indexed) return;
  indexed = true;
  try {
    await db.collection(WALL_SHADOW_COLLECTION).createIndex({ ts: 1 });
  } catch {
    indexed = false;
  }
}

/**
 * Record what the wall would have done with these pages. Returns at once; the work runs
 * after the response. Never throws, never changes `pages`.
 */
export function shadowWall(db: Db, request: Request, pages: ShadowPage[]): void {
  try {
    if (pages.length === 0 || !wallShadowEnabled() || hasCronAuth(request)) return;
    const rate = sampleRate();
    const day = new Date().toISOString().slice(0, 10);
    const ipHash = hashIp(getClientIp(request) || 'unknown');
    if (!callerSampled(ipHash, day, rate)) return;
    // Copy the three fields now: the caller may replace these objects before after() runs.
    const snapshot = pages.map((p) => ({ book_id: p.book_id, page_number: p.page_number, seo_indexable: p.seo_indexable }));
    const work = () => ensureIndex(db).then(() => shadowOnce(db, request, snapshot, ipHash, day, rate)).catch(() => {});
    try {
      after(work);
    } catch {
      void work(); // outside a request scope (tests, scripts)
    }
  } catch {
    /* a shadow log never costs a reader anything */
  }
}

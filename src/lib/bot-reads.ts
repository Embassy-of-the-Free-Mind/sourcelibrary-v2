/**
 * First-party record of which crawler read which book (#4309).
 *
 * PRIOR ART: src/lib/api-usage.ts — per-call rows, but only on routes that call
 * logApiUsage, and it never names the book; src/app/api/analytics/bots — per
 * bot + path PREFIX (`/book/*`), so it cannot say which book; src/lib/agent-requests.ts
 * — per operator per day, no path at all. None answers "how many pages has
 * GPTBot read from book X since June", which is the question this collection
 * exists for.
 *
 * Aggregate, not per-request: one document per (day, bot, book, route, trusted).
 * Crawler volume is unbounded but the key space is not — it grows with books
 * actually read, so a 30K-book crawl costs 30K small upserts' worth of rows per
 * bot per day at worst, never one row per hit. No IPs are stored: a rotating
 * fleet (26K residential IPs in #4476) would make any per-IP set unbounded.
 *
 * NO TTL — retention is manual per the #2976 decision (2026-07-05), same as
 * api_usage. Writes are fire-and-forget; a measurement never delays or fails
 * a read.
 *
 * Two kinds of row:
 *   - app rows (`route` = quote | text | dts | iiif-search | read): written at
 *     the bot-gate decision with the resolved book id, the requested page span,
 *     the bot ceiling, and whether the clamp fired;
 *   - html rows (`route` = 'html'): written in src/proxy.ts for /book/<ref>/…
 *     paths. The proxy has not resolved the book, so `book` is the URL segment
 *     (slug OR id; `book_is_url_segment: true`). Cloudflare cache HITs never
 *     reach the proxy, so html rows UNDERCOUNT — they are a floor.
 */
import { getDb } from '@/lib/mongodb';
import { botNameFor } from '@/lib/bot-gate';

const COLLECTION = 'bot_reads';

export type BotReadRoute = 'quote' | 'text' | 'dts' | 'iiif-search' | 'read' | 'html';

export interface BotReadInput {
  route: BotReadRoute;
  /** Resolved books.id — or, for html rows, the raw /book/<segment>. */
  book: string;
  /** True when `book` is an unresolved URL segment (slug or id). */
  bookIsUrlSegment?: boolean;
  /** Trusted bots (search crawlers, user fetches, key holders) bypass the clamp. */
  trusted: boolean;
  /** Requested page span, when the route has one. */
  pageFrom?: number;
  pageTo?: number;
  /** The bot ceiling applied (botMaxPage), when the clamp applies. */
  maxPage?: number;
  /** Did the clamp refuse or truncate this read? */
  clamped: boolean;
}

/** Pure: the upsert for one read. Exported for tests. */
export function botReadUpdate(bot: string, input: BotReadInput, now: Date) {
  const day = now.toISOString().slice(0, 10);
  const trust = input.trusted ? 'trusted' : 'gated';
  const filter = { _id: `${day}|${bot}|${input.book}|${input.route}|${trust}` };

  const $min: Record<string, number> = {};
  const $max: Record<string, number> = {};
  if (typeof input.pageFrom === 'number' && Number.isFinite(input.pageFrom)) $min.page_min = input.pageFrom;
  // Highest page that could have been SERVED: the request's end, capped by the
  // ceiling when the clamp applies.
  const top = input.pageTo ?? input.pageFrom;
  const served = typeof top === 'number' && Number.isFinite(top)
    ? (typeof input.maxPage === 'number' && !input.trusted ? Math.min(top, input.maxPage) : top)
    : undefined;
  if (served !== undefined) $max.page_max_served = served;

  const update: Record<string, unknown> = {
    $inc: { reads: 1, clamped: input.clamped ? 1 : 0 },
    $set: { last_ts: now, ...(typeof input.maxPage === 'number' ? { max_page: input.maxPage } : {}) },
    $setOnInsert: {
      day,
      bot,
      book: input.book,
      book_is_url_segment: !!input.bookIsUrlSegment,
      route: input.route,
      trusted: input.trusted,
      first_ts: now,
    },
  };
  if (Object.keys($min).length) update.$min = $min;
  if (Object.keys($max).length) update.$max = $max;
  return { filter, update };
}

let indexesEnsured = false;
async function ensureIndexes() {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    const col = (await getDb()).collection(COLLECTION);
    await Promise.all([
      // Plain indexes — deliberately NO expireAfterSeconds (#2976).
      col.createIndex({ book: 1, day: -1 }),
      col.createIndex({ bot: 1, day: -1 }),
    ]);
  } catch {
    indexesEnsured = false;
  }
}

/**
 * Record one read by a KNOWN_BOTS crawler. No-op for humans and our own MCP.
 * Fire-and-forget: never await, never throws.
 */
export function logBotRead(request: Request, input: BotReadInput): void {
  try {
    const bot = botNameFor(request);
    if (!bot || !input.book) return;
    const { filter, update } = botReadUpdate(bot, input, new Date());
    void (async () => {
      await ensureIndexes();
      const db = await getDb();
      await db.collection(COLLECTION).updateOne(filter as never, update, { upsert: true });
    })().catch(() => {});
  } catch {
    // a measurement never surfaces
  }
}

/**
 * The book segment of a reader URL, or null. Matches /book/<ref> and anything
 * under it (/page/<id>, /read, …). Used by the proxy for html rows.
 */
export function bookSegmentFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/book\/([^/?#]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

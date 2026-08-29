/**
 * Metered-reader enforcement for the page-content API routes (#4357 Phase 2).
 *
 * The reader's client-side page turns fetch content from /api/pages/[id],
 * /api/pages/batch and their /api/[tenant]/ twins — so this, not the ISR
 * HTML, is where the wall actually holds. The ISR reader page applies the
 * same policy to the first page it embeds (see free-preview.ts for the
 * policy and the master METERED_READER switch).
 *
 * Like anon-gate.ts (and unlike withApiAuth), same-origin browser traffic is
 * NOT exempt — metering logged-out humans in the reader is the whole point.
 * Exempt: signed-in sessions, cron/pipeline (Bearer CRON_SECRET), trusted
 * bots (search crawlers, user-initiated assistant fetches, API-key holders,
 * our MCP server — bot-gate's isTrustedBot), and any tenant-scoped request
 * (partner reading rooms; the routes pass `exempt` for those).
 */
import type { Db } from 'mongodb';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { getClientIp } from '@/lib/rate-limit';
import { anonymizeIp } from '@/lib/anonymize-ip';
import { hasCronAuth } from '@/lib/book-access';
import { isTrustedBot } from '@/lib/bot-gate';
import { meteredReaderEnabled, isPageFree, stripGatedPage } from '@/lib/free-preview';

/**
 * One row per walled request in analytics_events (same shape as
 * anon-gate.ts's logGateHit) — the conversion signal Phase 3 pricing needs.
 * Fire-and-forget; never throws, never delays the response.
 */
function logGateHit(request: Request, pagesGated: number): void {
  try {
    const country = request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || 'Unknown';
    const ip = anonymizeIp(getClientIp(request) || 'unknown');
    Promise.race([
      (async () => {
        const db = await getDb();
        await db.collection('analytics_events').insertOne({
          event: 'gate_hit', feature: 'metered-reader', pages_gated: pagesGated,
          country, ip, timestamp: new Date(), created_at: new Date(),
        });
      })(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).catch(() => {});
  } catch {
    /* never throw */
  }
}

type PageDoc = Record<string, unknown> & {
  book_id?: string;
  page_number?: number | null;
  seo_indexable?: boolean;
};

/**
 * Apply the metered-reader policy to page docs about to be returned to the
 * client: strip the text from pages outside their book's free sample unless
 * the caller is entitled to them. Returns the input array (same order),
 * with gated pages replaced by stripped copies.
 *
 * `exempt` short-circuits everything (tenant-scoped routes pass true).
 * With METERED_READER unset this is a no-op costing one env read.
 */
export async function gatePagesForRequest<T extends PageDoc>(
  db: Db,
  request: Request,
  pages: T[],
  { exempt = false }: { exempt?: boolean } = {},
): Promise<T[]> {
  if (!meteredReaderEnabled() || exempt || pages.length === 0) return pages;
  if (hasCronAuth(request)) return pages;

  const session = await auth().catch(() => null);
  if (session?.user) return pages;
  if (await isTrustedBot(request)) return pages;

  // pages_count per distinct book (usually exactly one — the reader batches
  // within a single book).
  const bookIds = [...new Set(pages.map((p) => p.book_id).filter(Boolean))] as string[];
  if (bookIds.length === 0) return pages;
  const books = await db.collection('books').find(
    { id: { $in: bookIds } },
    { projection: { _id: 0, id: 1, pages_count: 1 }, maxTimeMS: 5000 }
  ).toArray();
  const pagesCountByBook = new Map(books.map((b) => [b.id as string, (b.pages_count as number) || 0]));

  let gatedCount = 0;
  const result = pages.map((p) => {
    const pagesCount = pagesCountByBook.get(p.book_id as string);
    // A page whose book we can't resolve stays ungated: fail open — a
    // transient lookup miss must not wall content the policy says is free.
    if (pagesCount === undefined) return p;
    if (isPageFree(p, pagesCount)) return p;
    gatedCount++;
    return stripGatedPage(p, pagesCount) as unknown as T;
  });

  if (gatedCount > 0) logGateHit(request, gatedCount);
  return result;
}

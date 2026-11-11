/**
 * PRIOR ART: src/lib/read-budget.ts — the same identity → daily budget → usage-row pattern for /book/<id>/read. It
 * gets the identity from requireApiAccess, which also counts the public API's hourly rate limit; the reader's page
 * turns must not spend that, so this reads the session directly. src/lib/api-budget.ts checkPageBudget picks the
 * /text limits, not this pool's. src/lib/metered-gate.ts strips text for anonymous callers past a book's free sample;
 * it does nothing for a signed-in caller, which is the gap this closes.
 *
 * The reader's own page routes, /api/pages/[id] and /api/pages/batch (20 pages a call), had no budget and wrote no
 * usage row: one free account's session cookie could read every public page by script, and nothing recorded it.
 * Now every call writes an `api_usage` row (route `pages_api`, pages_served = pages that carried text), and a
 * signed-in account is capped at API_LIMITS.session.readerPagesPerDay (2,000) pages with text per rolling 24h, a pool
 * of its own (it never drains the /text budget, see SEPARATE_BUDGET_ROUTES). Far above a person reading: the busiest
 * 0.1% of readers open about 26 books a day, a few pages each.
 *
 * Not capped, but logged: anonymous callers (the metered gate already limits them to each book's free sample),
 * tenant reading rooms (partners were promised open rooms, tenant-lockdown.md), editors and admins, and the pipeline
 * (CRON_SECRET). Logging writes through next/server `after()`.
 *
 * Rollback: PAGES_API_BUDGET=off stops the cap and keeps the log; PAGES_API_LOG=off stops both.
 */
import { after, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { hasCronAuth } from '@/lib/book-access';
import type { ApiIdentity } from '@/lib/api-auth';
import { getPagesServedLast24h, writeApiUsage } from '@/lib/api-usage';
import { API_LIMITS } from '@/lib/api-limits';

export const PAGES_API_ROUTE = 'pages_api';
const DAILY = Number(process.env.PAGES_API_SESSION_PAGES_PER_DAY || API_LIMITS.session.readerPagesPerDay);
const UNCAPPED_ROLES = new Set(['editor', 'admin', 'superadmin', 'inner_circle', 'curator']);

export interface PagesApiMeter {
  identity: ApiIdentity;
  capped: boolean;
  used: number;
  limit: number;
  overBudget: boolean;
  startedAt: number;
}

/** Who is asking, and are they over today's reader-page budget? Null when logging is off or the check failed. */
export async function checkPagesApiBudget(request: NextRequest, { exempt = false }: { exempt?: boolean } = {}): Promise<PagesApiMeter | null> {
  if (process.env.PAGES_API_LOG === 'off') return null;
  const startedAt = Date.now();
  try {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;
    const identity: ApiIdentity = userId ? { kind: 'session', userId } : { kind: 'anon' };
    const role = (session?.user as { role?: string } | undefined)?.role;
    const capped = !!userId && !exempt && process.env.PAGES_API_BUDGET !== 'off'
      && !hasCronAuth(request) && !(role && UNCAPPED_ROLES.has(role));
    if (!capped) return { identity, capped, used: 0, limit: -1, overBudget: false, startedAt };
    const used = await getPagesServedLast24h({ identity, request, route: PAGES_API_ROUTE });
    return { identity, capped, used, limit: DAILY, overBudget: used >= DAILY, startedAt };
  } catch {
    return null; // a metering failure never stops a reader
  }
}

/** Pages in a response that carried text (a page the metered gate stripped is not counted). */
export function pagesWithText(pages: Array<Record<string, unknown> | null | undefined>): number {
  const has = (v: unknown) => typeof (v as { data?: unknown } | undefined)?.data === 'string' && ((v as { data: string }).data.length > 0);
  return pages.filter((p) => p && (has(p.translation) || has(p.ocr))).length;
}

/** One api_usage row for this call, written after the response. */
export function recordPagesApi(request: NextRequest, meter: PagesApiMeter | null, { status, pagesServed }: { status: number; pagesServed: number }): void {
  if (!meter) return;
  const row = {
    request,
    identity: meter.identity,
    route: PAGES_API_ROUTE,
    status,
    ms: Date.now() - meter.startedAt,
    wouldBlock: meter.overBudget,
    blocked: meter.overBudget,
    reason: meter.overBudget ? 'reader_page_budget' : undefined,
    pagesServed,
  };
  try {
    after(() => writeApiUsage(row).catch(() => {}));
  } catch {
    void writeApiUsage(row).catch(() => {}); // outside a request scope (tests)
  }
}

/** The 429 a capped account gets once over budget. */
export function pagesApiOverBudgetBody(meter: PagesApiMeter) {
  return {
    error: `Daily reading limit reached (${meter.used.toLocaleString('en-US')}/${meter.limit.toLocaleString('en-US')} pages in the last 24h). It resets on a rolling 24-hour window. For bulk or research access, see https://sourcelibrary.org/developers or https://sourcelibrary.org/licensing.`,
    used: meter.used,
    limit: meter.limit,
  };
}

/**
 * /book/<id>/read serves a whole book in a few requests, so it shares the daily page
 * budget of the bulk routes and writes the same usage rows.
 *
 * PRIOR ART: src/lib/api-budget.ts holds the budget and is reused here, and
 * src/lib/api-usage.ts the log. withApiAuth cannot wrap this: it wraps route handlers
 * and this is a page. src/lib/bot-reads.ts logs /read too, but only for clients on the
 * known-bot list, so a plain script or a forged browser left no row anywhere.
 *
 * Why HTML is metered here and not on the reader: the budget's own reasoning is that a
 * reader page is one page behind the crawl brake. A part of /read is about 60 pages, and
 * a whole book is a handful of requests, well under a brake that counts page loads.
 *
 * Over budget, an anonymous caller gets the free sample and the sign-in notice /read
 * already has. A signed-in reader is capped too (Derek, 2026-11-08: one free account
 * could otherwise read every book in full here), at the session budget of 1,000 pages
 * a day it shares with the API, and /read tells them the page-by-page reader is not
 * counted. A failure here never stops a reader.
 * Addresses can be shared by a whole library: READ_PAGE_BUDGET=off is the rollback.
 */
import { NextRequest } from 'next/server';
import type { ApiIdentity } from '@/lib/api-auth';
import { requireApiAccess } from '@/lib/api-auth';
import { checkPageBudget } from '@/lib/api-budget';
import { logApiUsage } from '@/lib/api-usage';

export interface ReadMeter {
  request: NextRequest;
  identity: ApiIdentity;
  overBudget: boolean;
}

/** A prefetch is not a read: nobody has asked for those pages yet. */
function isPrefetch(request: NextRequest): boolean {
  return request.headers.has('next-router-prefetch') || request.headers.get('purpose') === 'prefetch';
}

/** Null means do not meter this request: rolled back, a prefetch, or the check failed. */
export async function checkReadBudget(request: NextRequest): Promise<ReadMeter | null> {
  if (process.env.READ_PAGE_BUDGET === 'off' || isPrefetch(request)) return null;
  try {
    // The decision's `allowed` is the API's hourly limit, not this page's: only the identity is used.
    const { identity } = await requireApiAccess(request);
    const budget = await checkPageBudget({ identity, request });
    return { request, identity, overBudget: !budget.allowed };
  } catch {
    return null;
  }
}

/** One usage row, fire-and-forget. A later check counts these pages. */
export function chargeRead(meter: ReadMeter | null, pagesServed: number, ms: number): void {
  if (!meter) return;
  logApiUsage({
    request: meter.request,
    identity: meter.identity,
    route: 'book_read',
    status: 200,
    ms,
    wouldBlock: meter.overBudget,
    blocked: meter.overBudget,
    reason: meter.overBudget ? 'read_page_budget' : undefined,
    pagesServed,
  });
}

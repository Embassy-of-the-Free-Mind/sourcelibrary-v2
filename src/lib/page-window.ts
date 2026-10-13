/**
 * Page-list windows on the book API (#6281 step 1).
 *
 * `GET /api/books/[id]` (and its tenant twin) used to hand every page id of a
 * book to one anonymous request — `pageLimit=0` meant "all", and was the
 * default. Page ids are unguessable on purpose, so the full list is exactly
 * what a fleet needs to read a whole book page by page with no referrer
 * (#5993: 96% of AS401560's reads were deep page URLs). Anonymous callers and
 * bots now get at most ANON_PAGE_WINDOW pages per request; signed-in readers
 * and API keys keep the whole list. Every response carries `pages_window` so a
 * client knows whether more exist and pages through (BookPagesSection).
 *
 * PRIOR ART: src/lib/bot-gate.ts — gates page TEXT by percentage for known
 * bots; this caps the page-id LIST per request for every unidentified caller,
 * a different axis. src/lib/api-budget.ts — counts pages served per day; it
 * meters, it does not shape a single response.
 */
import type { ApiIdentityKind } from '@/lib/api-auth';

/** Default window. Env-overridable (`API_ANON_PAGE_WINDOW`) for rollback. */
export const DEFAULT_ANON_PAGE_WINDOW = 100;

export function anonPageWindow(): number {
  const raw = Number(process.env.API_ANON_PAGE_WINDOW);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ANON_PAGE_WINDOW;
}

/** Callers that get the capped window. Session and apikey see every page. */
export function isWindowedCaller(kind: ApiIdentityKind): boolean {
  return kind === 'anon' || kind === 'bot';
}

export interface PagesWindow {
  offset: number;
  /** The limit actually applied; 0 = no limit (uncapped callers asking for all). */
  limit: number;
  returned: number;
  /** Pages matching the same filter, across the whole book. */
  total: number;
}

/**
 * Resolve the `pageOffset` / `pageLimit` query params into the skip/limit the
 * query runs with. For windowed callers `pageLimit=0` (the old "all") or
 * anything above the cap becomes the cap.
 */
export function resolvePageWindow(
  searchParams: URLSearchParams,
  windowed: boolean,
): { offset: number; limit: number } {
  const offsetRaw = parseInt(searchParams.get('pageOffset') || '0');
  const limitRaw = parseInt(searchParams.get('pageLimit') || '0'); // 0 = all (backwards-compat)
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  let limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 0;
  if (windowed) {
    const cap = anonPageWindow();
    if (limit === 0 || limit > cap) limit = cap;
  }
  return { offset, limit };
}

/**
 * The `total` for `pages_window`. Skips the count query when the page we just
 * read already proves where the book ends (fewer rows than the limit).
 */
export async function countPagesForWindow(
  offset: number,
  limit: number,
  returned: number,
  count: () => Promise<number>,
): Promise<number> {
  const reachedEnd = limit === 0 || returned < limit;
  if (reachedEnd && (returned > 0 || offset === 0)) return offset + returned;
  return count();
}

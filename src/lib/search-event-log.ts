import type { NextRequest } from 'next/server';
import type { Db } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { classifyRequest } from '@/lib/analytics-ingest';

/**
 * The single writer for `analytics_events` `search_query` documents.
 *
 * Why this file exists — two failures found together on 2026-07-31:
 *
 * 1. **A whole search box recorded nothing.** The BPH reading room's
 *    front-page catalogue search (`BphCatalogBrowser` → `/api/catalog/bph`)
 *    had no logging of any kind. It is the first thing a visitor to the
 *    reading room sees, and over four months it produced zero rows. The only
 *    BPH searches we could see were in-book search and the site's unified
 *    search — 644 records that were then mistaken for the whole picture, and
 *    briefly reported to the partner as "readers here don't search."
 *
 * 2. **Every writer was hand-rolled and they had drifted.** Five routes each
 *    built their own `insertOne`, so the fields disagreed: `/api/search/unified`
 *    stored `country`, the book-search routes did not; **none** stored `host`,
 *    which is why all 94,442 stored events had `host: null` and reading-room
 *    searches could not be separated from main-site searches at all. That is
 *    the same shape as the five `entities.books[]` writers in CLAUDE.md.
 *
 * The rule this module enforces: **a search that a human can type is a search
 * that gets logged, through here, with the request classified at write time.**
 * `classifyRequest()` is the shared classifier from `analytics-ingest` — it
 * yields `traffic_class`, `user_agent` and `host`, so a new search surface
 * cannot be born contaminated or unattributable (see CLAUDE.md, "The
 * measurement layer fails silently, and always toward good news").
 *
 * Fire-and-forget by design: logging must never fail or slow a search
 * response. Callers do not await it.
 */

/** Where the search was typed. One value per distinct search box in the UI. */
export type SearchSource =
  /** Site-wide search on the main site (`/api/search`). */
  | 'global'
  /** The "All" tab / homepage search (`/api/search/unified`). */
  | 'unified'
  /** Search inside a single open book (`/api/books/[id]/search` + tenant twin). */
  | 'book_search'
  /** Entity/index search (`/api/search/index`). */
  | 'index'
  /** The BPH-style partner catalogue browser (`/api/catalog/bph`). */
  | 'catalogue';

export interface LogSearchEventInput {
  request: NextRequest;
  /** Raw user query. Trimmed and truncated before storage. */
  query: string;
  /** Number of results the caller returned. Use 0 for a genuine no-hit. */
  resultsCount: number;
  /** Which search box this came from. */
  source: SearchSource;
  /** Tenant the search was scoped to, when the surface is tenant-scoped. */
  tenantId?: string | null;
  /** Extra per-surface filter context (language, year range, book id, …). */
  filters?: Record<string, unknown>;
  /**
   * Reuse an already-open handle instead of resolving a new one. Routes that
   * already hold a `Db` should pass it; the write is on the response path.
   */
  db?: Db;
}

const MAX_QUERY_LEN = 300;
const MAX_FILTER_STR = 100;

/** Country from the edge headers — same source the pageview log uses. */
function edgeCountry(request: NextRequest): string {
  return (
    request.headers.get('x-vercel-ip-country') ||
    request.headers.get('cf-ipcountry') ||
    'Unknown'
  );
}

/** Coerce a free-form filter bag to primitives so one bad value can't bloat a doc. */
function normalizeFilters(filters: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filters || {})) {
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v.slice(0, MAX_FILTER_STR);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => String(x).slice(0, MAX_FILTER_STR));
  }
  return out;
}

/**
 * Record one search. Fire-and-forget — never throws, never awaited by callers.
 *
 * Empty and whitespace-only queries are dropped: they are typeahead noise, not
 * searches, and they were a meaningful share of the old zero-result lists.
 */
export function logSearchEvent(input: LogSearchEventInput): void {
  void writeSearchEvent(input).catch(() => {});
}

async function writeSearchEvent(input: LogSearchEventInput): Promise<void> {
  const query = (input.query || '').trim();
  if (!query) return;

  const { cls, userAgent, ip, host } = classifyRequest(input.request);
  const db = input.db ?? (await getDb());

  await db.collection('analytics_events').insertOne({
    event: 'search_query',
    query: query.slice(0, MAX_QUERY_LEN),
    results_count: input.resultsCount,
    filters: {
      ...normalizeFilters(input.filters),
      source: input.source,
      tenantId: input.tenantId ?? null,
    },
    // Promoted out of `filters` so a tenant breakdown is an indexable field
    // rather than a nested path. `filters.tenantId` stays for back-compat
    // with the existing four months of rows and the admin search dashboards.
    tenantId: input.tenantId ?? null,
    source: input.source,
    // Stored at write time — the only moment the evidence exists.
    traffic_class: cls,
    user_agent: userAgent,
    host,
    ip,
    country: edgeCountry(input.request),
    timestamp: new Date(),
    created_at: new Date(),
  });
}

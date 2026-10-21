/**
 * Books shown only in some countries (#7092).
 *
 * PRIOR ART: src/lib/book-access.ts — gates HIDDEN books for everyone; this gates a
 * visible book per visitor country, and isBookReadable() there calls in here.
 * src/lib/free-preview.ts / metered-gate.ts — per-reader text stripping, but keyed
 * on session and page number, never on where the reader is.
 *
 * Some books are public domain in the US and protected in the EU. The first case
 * is Manly P. Hall's The Secret Teachings of All Ages (1928): public domain in the
 * US (95 years from publication), protected in the EU until 2061 (Hall died 1990).
 * The posture is HathiTrust's "full view, US only" (Derek, 2026-10-21): a visitor
 * in an allowed country reads the book like any other; everyone else sees the
 * catalogue record and one line saying the book is not available in their
 * country — no page images, no text.
 *
 * TWO COPIES OF THE RULE, ON PURPOSE.
 *   - `books.rights_geo` ({ allow, reason, decided, issue }) is the record.
 *   - `rights-geo-books.json` is the edge copy. src/proxy.ts and next.config.ts
 *     cannot query Mongo per request, and they are the only places a decision
 *     can be made before a cache answers.
 *   `scripts/audit/rights-geo-registry.mjs` fails when they disagree. A book is
 *   treated as gated if EITHER says so.
 *
 * CACHING IS THE TRAP. Cloudflare holds /book HTML for 24h and caches /api JSON
 * that says it may; Vercel ISR keeps one render per path. Any response shared
 * between countries defeats the gate. So:
 *   - a gated book's paths are `no-store` at both CDNs (next.config.ts, from
 *     geoNoStoreHeaderRules below; middleware cannot override the CDN header an
 *     ISR page sets, proxy.ts says why);
 *   - the decision is made in proxy.ts, which runs before Vercel's cache: a
 *     visitor outside the allowed countries never reaches the ISR render;
 *   - surfaces whose responses are shared by construction (search results,
 *     galleries, sitemaps, the Librarian, social cards) treat a gated book as
 *     absent for EVERYONE, US included — they cannot know who is asking.
 *
 * Unknown country is NOT allowed. A request with no country header (in-process
 * MCP calls, internal fetches) or Cloudflare's XX / T1 is refused.
 *
 * Keep this file free of `@/` imports: next.config.ts and proxy.ts both load it.
 */
import registry from './rights-geo-books.json';

export interface GeoRule {
  /** ISO 3166-1 alpha-2 countries where the book may be shown, upper case. */
  allow: string[];
}

export interface GeoRegistryEntry extends GeoRule {
  id: string;
  /** Every URL segment that addresses the book: id, slug, slug aliases. Lower case. */
  segments: string[];
  title: string;
  author: string;
  published: string;
  issue: number;
}

export const GEO_GATED_BOOKS: readonly GeoRegistryEntry[] = registry.books;

const BY_ID = new Map(GEO_GATED_BOOKS.map(e => [e.id, e]));
const BY_SEGMENT = new Map(GEO_GATED_BOOKS.flatMap(e => e.segments.map(s => [s.toLowerCase(), e] as const)));

/** Book ids under a country rule (edge copy). For post-filtering shared result lists. */
export const GEO_GATED_BOOK_IDS: ReadonlySet<string> = new Set(BY_ID.keys());

/**
 * A caller that cannot vouch for the reader's country (our MCP server calling its
 * own API on behalf of a remote assistant user) sends this. It can only ever
 * RESTRICT: its presence makes the country unknown, so forging it gains nothing.
 */
export const GEO_UNKNOWN_HEADER = 'x-sl-geo-unknown';

/** Response headers for any response about a gated book: never shared by a cache. */
export const GEO_NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
};

type HeaderSource = { get(name: string): string | null };

/** Visitor country from Cloudflare (`cf-ipcountry`), falling back to Vercel. Null = unknown. */
export function requestCountry(headers: HeaderSource): string | null {
  if (headers.get(GEO_UNKNOWN_HEADER)) return null;
  const raw = headers.get('cf-ipcountry') || headers.get('x-vercel-ip-country') || '';
  const c = raw.trim().toUpperCase();
  // XX = unknown, T1 = Tor (Cloudflare). Neither is a country.
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return null;
  return c;
}

function idOf(book: object): string | null {
  const b = book as { id?: unknown; _id?: unknown };
  if (typeof b.id === 'string' && b.id) return b.id;
  if (b._id != null) return String(b._id);
  return null;
}

/**
 * The country rule for a book, or null when it has none. The registry wins over
 * the document (a projection may have left `rights_geo` out); either one gates.
 */
export function geoRuleForBook(book: object | null | undefined): GeoRule | null {
  if (!book) return null;
  const id = idOf(book);
  const entry = id ? BY_ID.get(id) : undefined;
  if (entry) return entry;
  const field = (book as { rights_geo?: { allow?: unknown } }).rights_geo;
  if (field && typeof field === 'object') {
    const allow = Array.isArray(field.allow)
      ? field.allow.filter((c): c is string => typeof c === 'string').map(c => c.toUpperCase())
      : [];
    return { allow }; // a malformed rule allows nobody
  }
  return null;
}

export function isGeoGatedBook(book: object | null | undefined): boolean {
  return geoRuleForBook(book) !== null;
}

export function isGeoGatedBookId(id: string | null | undefined): boolean {
  return !!id && GEO_GATED_BOOK_IDS.has(id);
}

export function isCountryAllowed(rule: GeoRule, country: string | null): boolean {
  return country !== null && rule.allow.includes(country);
}

/** May this book's images and text be shown to the visitor these headers describe? */
export function isAllowedHere(book: object | null | undefined, headers: HeaderSource): boolean {
  const rule = geoRuleForBook(book);
  if (!rule) return true;
  return isCountryAllowed(rule, requestCountry(headers));
}

/** Drop rows that belong to a gated book. For lists shared between countries. */
export function dropGeoGated<T extends { book_id?: string | null }>(rows: T[]): T[] {
  if (GEO_GATED_BOOK_IDS.size === 0) return rows;
  return rows.filter(r => !isGeoGatedBookId(r.book_id ?? null));
}

/** Path segments that put a book id/slug in the NEXT segment. */
const BOOK_ADDRESS_SEGMENTS = new Set(['book', 'books', 'iiif']);

function decodeSegment(s: string): string {
  try { return decodeURIComponent(s).toLowerCase(); } catch { return s.toLowerCase(); }
}

/**
 * The gated book a path addresses, or null. Matches any `…/book/<seg>…`,
 * `…/books/<seg>…` or `…/iiif/<seg>…`, which covers the reader and its locale,
 * embed and tenant twins, `/api/books/<seg>/*`, `/api/<tenant>/books/<seg>/*` and
 * `/api/iiif/<seg>/*` in one rule, so a new route under any of them is covered
 * without being listed.
 */
export function geoEntryForPath(pathname: string): GeoRegistryEntry | null {
  if (BY_SEGMENT.size === 0) return null;
  const segs = pathname.split('/');
  for (let i = 1; i < segs.length; i++) {
    if (!BOOK_ADDRESS_SEGMENTS.has(segs[i - 1].toLowerCase())) continue;
    const entry = BY_SEGMENT.get(decodeSegment(segs[i]));
    if (entry) return entry;
  }
  return null;
}

/**
 * True when `pathname` addresses `book` by a segment the edge knows. A gated
 * book reached by any OTHER segment (a slug renamed after the registry was
 * written) bypassed the proxy and the no-store rules, so callers must refuse it.
 */
export function pathCoversBook(pathname: string, book: object): boolean {
  const entry = geoEntryForPath(pathname);
  return !!entry && entry.id === idOf(book);
}

/** True for a request carrying the pipeline's CRON_SECRET bearer (same test as book-access.ts). */
export function hasCronBearer(headers: HeaderSource): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && headers.get('authorization') === `Bearer ${secret}`;
}

// ── What a visitor outside the allowed countries receives ────────────────────

export const GEO_UNAVAILABLE_LINE = 'This book is not available in your country.';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * The catalogue record and the one line. Self-contained HTML rendered in the
 * proxy, so it carries no site chrome (nothing to leak on a partner subdomain),
 * needs no database, and can never be an ISR entry. Status 451.
 */
export function geoUnavailableHtml(entry: GeoRegistryEntry): string {
  const title = escapeHtml(entry.title);
  const byline = escapeHtml([entry.author, entry.published].filter(Boolean).join(', '));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} | Source Library</title>
<style>
body{margin:0;font-family:Georgia,'Times New Roman',serif;background:#faf8f4;color:#2b2622}
main{max-width:40rem;margin:0 auto;padding:4rem 1.5rem}
.k{font:600 .75rem/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7a6f63}
h1{font-size:1.9rem;line-height:1.25;margin:.75rem 0 .5rem}
.by{font-size:1.1rem;color:#5a5048;margin:0 0 2rem}
.note{font:1rem/1.5 system-ui,sans-serif;border-top:1px solid #e3ddd3;padding-top:1.25rem}
a{color:#7a4b2a}
</style></head>
<body><main>
<div class="k">Catalogue record</div>
<h1>${title}</h1>
<p class="by">${byline}</p>
<p class="note">${GEO_UNAVAILABLE_LINE}</p>
<p class="note"><a href="/">Source Library</a></p>
</main></body></html>`;
}

export function geoUnavailableJson(entry: GeoRegistryEntry): Record<string, unknown> {
  return {
    error: 'not_available_in_your_country',
    message: GEO_UNAVAILABLE_LINE,
    book: { id: entry.id, title: entry.title, author: entry.author, published: entry.published },
  };
}

// ── next.config.ts ───────────────────────────────────────────────────────────

const LOCALE_PREFIXES = ['', '/es', '/la', '/nl', '/zh'];

/**
 * `headers()` rules that make every path of a gated book `no-store` at both CDNs.
 * They must come LAST in next.config.ts: where several rules set one key, the
 * last match wins, and the broad `/book/:path*` rule sets a 24h CDN TTL.
 */
export function geoNoStoreHeaderRules(): Array<{ source: string; headers: Array<{ key: string; value: string }> }> {
  const headers = Object.entries(GEO_NO_STORE_HEADERS).map(([key, value]) => ({ key, value }));
  const sources: string[] = [];
  for (const entry of GEO_GATED_BOOKS) {
    for (const seg of entry.segments) {
      for (const loc of LOCALE_PREFIXES) sources.push(`${loc}/book/${seg}`, `${loc}/book/${seg}/:path*`);
      sources.push(
        `/embed/:tenant/book/${seg}`, `/embed/:tenant/book/${seg}/:path*`,
        `/api/books/${seg}`, `/api/books/${seg}/:path*`,
        `/api/:tenant/books/${seg}`, `/api/:tenant/books/${seg}/:path*`,
        `/api/iiif/${seg}/:path*`,
      );
    }
  }
  return sources.map(source => ({ source, headers }));
}

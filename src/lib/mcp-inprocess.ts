/**
 * In-process API calls for the MCP route (#6853, #4307).
 *
 * PRIOR ART: the `apiGet` self-call in src/app/api/mcp/route.ts, which this
 *   replaces for the search tools. No LRU or TTL cache exists under src/lib
 *   (searched `lru`, `TtlCache`); mcp-server/src/api.ts is the stdio client
 *   and has to go over HTTP.
 *
 * The MCP tools used to fetch `https://sourcelibrary.org/api/...`. That is a
 * second trip through Cloudflare into a second Vercel function, which can
 * itself be cold, and the hop arrived as an anonymous caller on a Vercel
 * egress IP, so every downstream gate and log saw the proxy rather than the
 * caller (#4307).
 *
 * Here the same route handler runs in this function instead. The response
 * body is the handler's own, so the tool output stays byte-identical. Two
 * things change, both on purpose:
 *
 *  - The downstream `withApiAuth` gate is not run again. The caller already
 *    passed it once, as themselves, on /api/mcp; the second pass only
 *    charged a pool shared by every MCP user.
 *  - The caller's identity and IP travel with the request: the identity as the
 *    handler's own argument (or, for a handler without one, through
 *    `inProcessCaller` in src/lib/inprocess-caller.ts), the IP as `x-forwarded-for`. `search_queries` rows
 *    from MCP now carry the real caller, not the proxy.
 *
 * The edge cache used to answer a repeated query in ~0.2 s. A small LRU (60 s,
 * per instance) keeps that, and it caches only what the edge would have
 * cached: a `no-store` response (a lane timed out, #6613) is never kept.
 *
 * Kill switch: MCP_INPROCESS=0 sends every call back over HTTP.
 */
import { NextRequest } from 'next/server';
import type { ApiIdentity } from '@/lib/api-auth';
import { setInProcessCaller } from '@/lib/inprocess-caller';

const API_ORIGIN = 'https://sourcelibrary.org';
const API_BASE = `${API_ORIGIN}/api`;
/** What the self-call sent. `search_queries.user_agent` is how MCP traffic is counted (#2049). */
export const MCP_HEADERS = { 'User-Agent': 'SourceLibrary-MCP/4.3', 'Accept-Language': 'en' };

export interface McpCaller {
  identity: ApiIdentity;
  /** The real client IP, as the MCP route resolved it. */
  ip: string;
}

type Handler = (request: NextRequest, ctx: unknown, identity: ApiIdentity) => Promise<Response> | Response;

/**
 * The routes served in-process, each loaded on first use so `initialize` and
 * `tools/list` never pay for the search stack. `/api/search` is wrapped in
 * `withApiAuth`; `.handler` is the route body without the gate.
 */
const ROUTES: Record<string, () => Promise<Handler>> = {
  '/search': async () => (await import('@/app/api/search/route')).GET.handler as Handler,
  '/search/semantic': async () => {
    const { GET } = await import('@/app/api/search/semantic/route');
    return (request) => GET(request);
  },
};

/**
 * Book-scoped routes take their id from the dynamic segment, so they are
 * matched by pattern rather than listed above.
 *
 *  - `/books/<id>/search` (search_within_book, #2049).
 *  - `/books/<id>/quote` and `/books/<id>/text` (get_quote, get_quotes,
 *    get_book_text). Over HTTP these spent the route's own page budget as the
 *    proxy, one anonymous pool shared by every MCP user, so a keyed caller was
 *    refused once strangers had used it up (#4307). The MCP route already
 *    enforces and logs the page budget per caller, so `.handler` (the body
 *    without the logging gate) is called and pages are not counted twice.
 *
 * None of them is edge-cached with `s-maxage`, so the LRU never keeps them:
 * /text marks its text per key and sends `private, no-store` for a keyed caller.
 */
const BOOK_ROUTES: Array<[RegExp, () => Promise<(request: NextRequest, ctx: { params: Promise<{ id: string }> }, identity: ApiIdentity) => Promise<Response> | Response>]> = [
  [/^\/books\/([^/?#]+)\/search$/, async () => (await import('@/app/api/books/[id]/search/route')).GET],
  [/^\/books\/([^/?#]+)\/quote$/, async () => (await import('@/app/api/books/[id]/quote/route')).GET.handler],
  [/^\/books\/([^/?#]+)\/text$/, async () => (await import('@/app/api/books/[id]/text/route')).GET.handler],
];

// One import per route module, shared: get_quotes fans out up to 25 pages at
// once, and each would otherwise start its own first import of the route.
const loaded = new Map<RegExp, ReturnType<(typeof BOOK_ROUTES)[number][1]>>();

function routeFor(path: string): (() => Promise<Handler>) | undefined {
  if (path in ROUTES) return ROUTES[path];
  for (const [pattern, importRoute] of BOOK_ROUTES) {
    const load = () => {
      let p = loaded.get(pattern);
      if (!p) {
        p = importRoute();
        p.catch(() => loaded.delete(pattern));
        loaded.set(pattern, p);
      }
      return p;
    };
    const m = pattern.exec(path);
    if (!m) continue;
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return undefined; // a malformed %-escape: over HTTP, which answers it as before
    }
    return async () => {
      const handler = await load();
      return (request, _ctx, identity) => handler(request, { params: Promise.resolve({ id }) }, identity);
    };
  }
  return undefined;
}

export function inProcessEnabled(path: string): boolean {
  return process.env.MCP_INPROCESS !== '0' && routeFor(path) !== undefined;
}

// ── The cache ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
/** Bodies over this are served but not kept: 200 of them must fit in an instance. */
const CACHE_MAX_BODY = 512 * 1024;

const cache = new Map<string, { body: string; expires: number }>();
const inFlight = new Map<string, Promise<{ body: string; cacheable: boolean }>>();

function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // Re-insert to mark it most recently used.
  cache.delete(key);
  cache.set(key, hit);
  return hit.body;
}

function cacheSet(key: string, body: string): void {
  if (body.length > CACHE_MAX_BODY) return;
  cache.set(key, { body, expires: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/** Cacheable exactly when a shared cache would have kept it. */
function sharedCacheable(res: Response): boolean {
  const cc = (res.headers.get('cache-control') || '').toLowerCase();
  return res.ok && /\bs-maxage=\d*[1-9]/.test(cc) && !/no-store|private/.test(cc);
}

/** Test seam. */
export function clearInProcessCache(): void {
  cache.clear();
  inFlight.clear();
}

// ── The call ───────────────────────────────────────────────────────────────

async function runInProcess(path: string, url: string, caller: McpCaller): Promise<{ body: string; cacheable: boolean }> {
  const handler = await routeFor(path)!();
  const headers = new Headers(MCP_HEADERS);
  if (caller.ip && caller.ip !== 'unknown') headers.set('x-forwarded-for', caller.ip);
  const request = new NextRequest(url, { headers });
  setInProcessCaller(request, caller.identity);
  const res = await handler(request, {}, caller.identity);
  const body = await res.text();
  // The same failure the self-call raised, so classifyApiError reads it alike.
  if (!res.ok) throw new Error(`API ${res.status}: ${body}`);
  return { body, cacheable: sharedCacheable(res) };
}

async function overHttp(url: string): Promise<string> {
  const res = await fetch(url, { headers: MCP_HEADERS });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.text();
}

/**
 * GET an API path and parse its JSON: in-process where the route is served
 * here, over HTTP otherwise (or when MCP_INPROCESS=0).
 */
export async function mcpApiGet(path: string, params: URLSearchParams | undefined, caller: McpCaller | undefined): Promise<unknown> {
  return JSON.parse(await mcpApiGetText(path, params, caller));
}

/** The same call, returning the body as text (get_book_text's `format=plain`). */
export async function mcpApiGetText(path: string, params: URLSearchParams | undefined, caller: McpCaller | undefined): Promise<string> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  if (!caller || !inProcessEnabled(path)) return overHttp(url);

  const cached = cacheGet(url);
  if (cached !== null) return cached;

  // Concurrent identical calls share one run, as they would one edge fill.
  let pending = inFlight.get(url);
  if (!pending) {
    pending = runInProcess(path, url, caller).finally(() => inFlight.delete(url));
    inFlight.set(url, pending);
  }
  const { body, cacheable } = await pending;
  if (cacheable) cacheSet(url, body);
  return body;
}

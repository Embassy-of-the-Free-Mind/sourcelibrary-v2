/**
 * Reader-origin split for the staged traffic test (#8384).
 *
 * PRIOR ART: workers/image-resize (the zone's only other Worker) serves R2 images and
 * routes nothing; a Cloudflare Load Balancer was rejected in the plan because it splits a
 * whole hostname (logins, payments and /api would move too).
 *
 * Routes: `sourcelibrary.org/book` and `/book/*` (reader pages) and `sourcelibrary.org/_box/*` (the box
 * build's own CSS and JS, which only box-rendered pages reference).
 *
 * A /book request goes to the box only when ALL hold:
 *   - GET;
 *   - no session cookie (a signed-in reader always stays on Vercel);
 *   - not a known bot, unless INCLUDE_BOTS=1 (search engines keep seeing Vercel, trap 5);
 *   - the staff cookie matches STAFF_TOKEN (stage 0), or the reader's bucket (a sticky
 *     0–99 cookie, so one reader stays on one origin) is under PERCENT.
 * Everything else passes straight to Vercel, untouched.
 *
 * If the box errors (network, 5xx) or has not answered within BOX_TIMEOUT_MS (3 s), the
 * same request is retried on Vercel and counted as a fallback, so a box failure costs a
 * reader a few seconds and never an error page.
 *
 * PERCENT is the kill switch: 0 (the default, and what any unparsable value means) sends
 * nobody but staff. Deleting the route removes the Worker entirely.
 */

export interface AnalyticsEngine {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface Env {
  /** Share of anonymous readers sent to the box, 0–100. Default 0. */
  PERCENT?: string;
  /** e.g. https://box1.sourcelibrary.org — no trailing slash needed. */
  BOX_ORIGIN?: string;
  /** Shared secret; the box's Caddy refuses any request without it. A Worker secret. */
  BOX_SECRET?: string;
  /** Stage 0: a reader whose sl_box_staff cookie equals this goes to the box. A Worker secret. */
  STAFF_TOKEN?: string;
  /** Time to response headers before falling back to Vercel. Default 3000. */
  BOX_TIMEOUT_MS?: string;
  /** "1" to send known bots too (stage 3). Default: bots stay on Vercel. */
  INCLUDE_BOTS?: string;
  /** Workers Analytics Engine dataset: one point per request, for the fallback counters. */
  METRICS?: AnalyticsEngine;
}

type Fetcher = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export const BUCKET_COOKIE = 'sl_bucket';
export const STAFF_COOKIE = 'sl_box_staff';
const BUCKET_MAX_AGE_S = 30 * 24 * 3600;
const DEFAULT_TIMEOUT_MS = 3000;

// Matches every NextAuth/Auth.js session cookie, including chunked ones (`.0`, `.1`) and
// the `__Secure-` prefixed name production uses (src/lib/auth.ts).
const SESSION_COOKIE_RE = /(^|[._-])session-token(\.\d+)?$/;

// Known crawlers and scripted clients. Deliberately broad: a human misfiled as a bot just
// stays on Vercel, which is the safe side.
const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|headless|phantom|python|curl|wget|httpclient|okhttp|java\/|go-http|axios|node-fetch|undici|scrapy|libwww|perl|ruby|semrush|ahrefs|mj12|petal|yandex|baidu|bytespider|gptbot|claude|anthropic|perplexity|ccbot|chatgpt|oai-search|amazonbot|applebot|bingpreview|duckduck|lighthouse|pagespeed|monitor|uptime|check_http|statuscake|pingdom/i;

export type Outcome = 'box' | 'vercel' | 'fallback';

export interface Decision {
  target: 'box' | 'vercel';
  reason: string;
  bucket: number | null;
  /** True when the request had no valid bucket cookie and the response must set one. */
  newBucket: boolean;
}

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

export function percentOf(env: Env): number {
  const n = Number(env.PERCENT);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

export function isBot(ua: string | null): boolean {
  if (!ua || ua.length < 10) return true;
  return BOT_RE.test(ua);
}

function readBucket(cookies: Map<string, string>): number | null {
  const raw = cookies.get(BUCKET_COOKIE);
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  return Number(raw);
}

function newBucketValue(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % 100;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function isReaderPath(pathname: string): boolean {
  return pathname === '/book' || pathname.startsWith('/book/');
}

export function isBoxAssetPath(pathname: string): boolean {
  return pathname.startsWith('/_box/');
}

/** Which origin a /book request goes to, and why. Pure: no I/O. */
export function decide(request: Request, env: Env, rand: () => number = newBucketValue): Decision {
  const cookies = parseCookies(request.headers.get('cookie'));
  const existing = readBucket(cookies);
  const bucket = existing ?? rand();
  const base = { bucket, newBucket: existing === null };
  const vercel = (reason: string): Decision => ({ target: 'vercel', reason, ...base });

  if (!env.BOX_ORIGIN || !env.BOX_SECRET) return vercel('unconfigured');
  if (request.method !== 'GET') return vercel('method');
  if (!isReaderPath(new URL(request.url).pathname)) return vercel('path');
  for (const name of cookies.keys()) if (SESSION_COOKIE_RE.test(name)) return vercel('session');

  const staff = cookies.get(STAFF_COOKIE);
  if (staff && env.STAFF_TOKEN && timingSafeEqual(staff, env.STAFF_TOKEN)) {
    return { target: 'box', reason: 'staff', ...base };
  }
  if (env.INCLUDE_BOTS !== '1' && isBot(request.headers.get('user-agent'))) return vercel('bot');
  if (bucket < percentOf(env)) return { target: 'box', reason: 'bucket', ...base };
  return vercel('bucket');
}

/** The request as the box receives it: same path and query, plus the secret and the client. */
export function boxRequest(request: Request, env: Env): Request {
  const src = new URL(request.url);
  const url = new URL(src.pathname + src.search, env.BOX_ORIGIN);
  const headers = new Headers(request.headers);
  headers.set('X-SL-Origin-Secret', env.BOX_SECRET ?? '');
  // A Worker subrequest to another host may carry Cloudflare's own address in
  // CF-Connecting-IP, so the reader's address and country travel in our own headers.
  // The box's Caddy turns them back into CF-Connecting-IP / CF-IPCountry (trap 2).
  const cf = (request as unknown as { cf?: { country?: string } }).cf;
  headers.set('X-SL-Client-IP', request.headers.get('cf-connecting-ip') ?? '');
  headers.set('X-SL-Client-Country', cf?.country ?? request.headers.get('cf-ipcountry') ?? '');
  return new Request(url.toString(), { method: request.method, headers, redirect: 'manual' });
}

function withHeaders(res: Response, origin: string, decision: Decision | null): Response {
  const out = new Response(res.body, res);
  out.headers.set('X-SL-Origin', origin);
  if (decision?.newBucket && decision.bucket !== null) {
    out.headers.append(
      'Set-Cookie',
      `${BUCKET_COOKIE}=${decision.bucket}; Path=/; Max-Age=${BUCKET_MAX_AGE_S}; Secure; SameSite=Lax`,
    );
  }
  return out;
}

function record(env: Env, outcome: Outcome, reason: string, kind: string, ms: number, status: number) {
  try {
    env.METRICS?.writeDataPoint({ blobs: [outcome, reason, kind], doubles: [ms, status], indexes: [outcome] });
  } catch {
    // never let a counter fail a reader's request
  }
}

/** Fetch from the box with a deadline on the response headers. Throws on error, timeout or 5xx. */
async function fetchBox(request: Request, env: Env, fetchImpl: Fetcher): Promise<Response> {
  const timeout = Number(env.BOX_TIMEOUT_MS) > 0 ? Number(env.BOX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('box_timeout')), timeout);
  try {
    const res = await Promise.race([
      fetchImpl(boxRequest(request, env), { signal: ctrl.signal }),
      new Promise<never>((_, reject) =>
        ctrl.signal.addEventListener('abort', () => reject(new BoxError('timeout'))),
      ),
    ]);
    if (res.status >= 500) throw new BoxError(`status_${res.status}`);
    return res;
  } catch (e) {
    if (e instanceof BoxError) throw e;
    throw new BoxError(ctrl.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

export class BoxError extends Error {}

export async function handle(request: Request, env: Env, fetchImpl: Fetcher = fetch): Promise<Response> {
  const t0 = Date.now();
  const path = new URL(request.url).pathname;

  // The box build's assets: only a box page asks for them, so there is nothing on Vercel
  // to fall back to. A failure is counted and answered as a plain 502.
  if (isBoxAssetPath(path)) {
    if (!env.BOX_ORIGIN || !env.BOX_SECRET || request.method !== 'GET') return fetchImpl(request);
    try {
      const res = await fetchBox(request, env, fetchImpl);
      record(env, 'box', 'asset', 'asset', Date.now() - t0, res.status);
      return withHeaders(res, 'box', null);
    } catch (e) {
      const why = e instanceof BoxError ? e.message : 'network';
      record(env, 'fallback', why, 'asset', Date.now() - t0, 502);
      return new Response('', { status: 502, headers: { 'X-SL-Origin': 'box-failed' } });
    }
  }

  const decision = decide(request, env);
  if (decision.target === 'vercel') {
    const res = await fetchImpl(request);
    record(env, 'vercel', decision.reason, 'page', Date.now() - t0, res.status);
    // A bot or signed-in reader gets no bucket cookie: only readers the split could apply to.
    const sticky = decision.reason === 'bucket' ? decision : null;
    return withHeaders(res, 'vercel', sticky);
  }

  try {
    const res = await fetchBox(request, env, fetchImpl);
    record(env, 'box', decision.reason, 'page', Date.now() - t0, res.status);
    return withHeaders(res, 'box', decision);
  } catch (e) {
    const why = e instanceof BoxError ? e.message : 'network';
    console.log(JSON.stringify({ fallback: why, path, ms: Date.now() - t0 }));
    const res = await fetchImpl(request);
    record(env, 'fallback', why, 'page', Date.now() - t0, res.status);
    return withHeaders(res, 'vercel-fallback', decision);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};

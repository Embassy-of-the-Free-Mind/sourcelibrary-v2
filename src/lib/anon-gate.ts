/**
 * Anonymous-access gates for the public AI surfaces (Librarian text chat, voice,
 * and search). These let signed-out visitors use the features a few times, then
 * return a 401 that the client turns into a "sign in (free) to continue" prompt —
 * driving sign-ups while keeping the door open for a real first taste.
 *
 * These intentionally differ from `withApiAuth` (src/lib/api-auth.ts): that gate
 * meters EXTERNAL API consumers and deliberately EXEMPTS same-origin browser
 * traffic. The gates here are for the browser UI itself, so same-origin is NOT
 * exempt — the whole point is to meter logged-out humans on the site.
 *
 * Always exempt: signed-in users, verified SEO crawlers, and internal cache
 * warmers (which send `X-Warm-Ping`).
 */
import { auth } from '@/lib/auth';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';
import { getDb } from '@/lib/mongodb';
import { anonymizeIp } from '@/lib/anonymize-ip';

export const SIGNIN_URL = 'https://sourcelibrary.org/auth/signin';

/**
 * Record when an anonymous visitor hits the "sign in to continue" wall — the
 * conversion trigger. One row per blocked attempt in analytics_events; pair
 * with signups to see whether hitting the wall converts. Fire-and-forget.
 */
function logGateHit(request: Request, feature: string): void {
  try {
    const country = request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || 'Unknown';
    const ip = anonymizeIp(getClientIp(request) || 'unknown');
    Promise.race([
      (async () => {
        const db = await getDb();
        await db.collection('analytics_events').insertOne({
          event: 'gate_hit', feature, country, ip,
          timestamp: new Date(), created_at: new Date(),
        });
      })(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).catch(() => {});
  } catch {
    /* never throw */
  }
}

// Same list withApiAuth uses — UA substrings that get the SEO-crawler bypass so
// indexing is never walled. Spoofable, but the worst case is a scraper getting
// the same access as a logged-out human.
const VERIFIED_BOT_UAS = [
  'googlebot', 'google-extended', 'bingbot', 'msnbot',
  'duckduckbot', 'applebot', 'mojeekbot',
];

function isVerifiedBot(request: Request): boolean {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  return VERIFIED_BOT_UAS.some(sig => ua.includes(sig));
}

async function hasSession(): Promise<boolean> {
  try {
    const session = await auth();
    return !!session?.user?.id;
  } catch {
    // auth() can throw in some runtime contexts — treat as anonymous.
    return false;
  }
}

/**
 * True when this request should bypass anon gating entirely.
 *
 * `allowBotBypass` exists because the UA check above is spoofable and its
 * stated worst case — "a scraper getting the same access as a logged-out
 * human" — only holds for CONTENT. For an action that spends money per call,
 * `curl -A googlebot` would buy unlimited Gemini requests, so spend-class
 * call sites pass false. A crawler has no business asking us to transliterate
 * a page anyway: it indexes what is already there.
 */
async function isExempt(request: Request, allowBotBypass = true): Promise<boolean> {
  if (request.headers.get('x-warm-ping')) return true;              // internal cache warmers
  if (allowBotBypass && isVerifiedBot(request)) return true;        // SEO crawlers
  if (await hasSession()) return true;                              // signed-in users
  return false;
}

export interface GateResult {
  allowed: boolean;
  /** Seconds until the window resets, when blocked. */
  retryAfter?: number;
}

/**
 * Per-IP hourly action gate for anonymous users. Use for discrete, expensive
 * actions where one request == one action (e.g. starting a voice session,
 * sending a Librarian message).
 */
export async function anonActionGate(
  request: Request,
  opts: { name: string; limit: number; windowSeconds?: number; allowBotBypass?: boolean },
): Promise<GateResult> {
  if (await isExempt(request, opts.allowBotBypass ?? true)) return { allowed: true };
  // Shared (cross-instance) cap — these actions are Gemini-backed, so the limit
  // has to be a real global cap, not a per-lambda soft cap. Falls back to the
  // in-memory limiter automatically if Mongo is slow/unavailable.
  const rl = await checkRateLimitShared(
    { name: opts.name, limit: opts.limit, windowSeconds: opts.windowSeconds ?? 3600 },
    getClientIp(request),
  );
  if (rl.allowed) return { allowed: true };
  logGateHit(request, opts.name);
  return { allowed: false, retryAfter: rl.retryAfter };
}

// ── Distinct-query quota (search) ──────────────────────────────────────────
// Search is typeahead: the /search page fires /api/search/unified on debounced
// input AND on every filter change, so one user "search" is several requests.
// Counting raw requests would wall a visitor mid-first-search. Instead we count
// DISTINCT normalized query strings per IP per window — refining filters or
// re-running the same query is free; the Nth *new* query trips the gate.

interface SearchBucket { queries: Set<string>; resetAt: number }
const searchBuckets = new Map<string, SearchBucket>();

function distinctQueryQuota(
  ip: string,
  query: string,
  limit: number,
  windowSeconds: number,
): GateResult {
  const now = Date.now();

  // Prune stale buckets occasionally to bound memory.
  if (searchBuckets.size > 5000 && Math.random() < 0.01) {
    for (const [key, val] of searchBuckets) if (val.resetAt < now) searchBuckets.delete(key);
  }

  let bucket = searchBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { queries: new Set(), resetAt: now + windowSeconds * 1000 };
    searchBuckets.set(ip, bucket);
  }

  const norm = query.trim().toLowerCase().slice(0, 200);
  if (!norm) return { allowed: true };           // empty query — never counts
  if (bucket.queries.has(norm)) return { allowed: true }; // already counted this query
  if (bucket.queries.size >= limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.queries.add(norm);
  return { allowed: true };
}

/**
 * Anonymous search gate: N distinct queries per hour, then sign-in. Exempts
 * signed-in users, SEO crawlers, and internal warmers.
 */
export async function anonSearchGate(
  request: Request,
  query: string,
  limit = 5,
): Promise<GateResult> {
  if (await isExempt(request)) return { allowed: true };
  const result = distinctQueryQuota(getClientIp(request), query, limit, 3600);
  if (!result.allowed) logGateHit(request, 'search');
  return result;
}

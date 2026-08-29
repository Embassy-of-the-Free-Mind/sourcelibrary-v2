/**
 * Access gate for the image proxy (`/api/image`, `/api/crop-image`).
 *
 * Policy (mirrors the /text budget and the funnel-not-wall posture of
 * .claude/docs/invariants/crawler-access-gate.md): readers, our own pipeline,
 * search crawlers, social-card scrapers, and user-initiated assistant fetches
 * are never gated. Bulk extraction by anonymous scripts is budgeted per IP per
 * rolling 24h; API keys lift the budget per their tier (paid tiers unlimited,
 * free Explorer capped) and make the traffic attributable in `api_usage`
 * (#4356 — before this, a full-tier partner pulling thousands of images was
 * indistinguishable from an anonymous bot, and uncounted).
 *
 * Ladder, cheapest check first. Every rung is deliberate:
 *
 *   1. browser-shaped  — Sec-Fetch-Dest of a browser subresource load, or a
 *                        Referer from one of our own properties. This is the
 *                        hot reader path: NO auth resolution, NO DB, NO log.
 *   2. internal (itk)  — HMAC-signed URL from our own server-side consumers
 *                        (exports, OCR crops, MCP thumbnails). See
 *                        src/lib/image-proxy-auth.ts.
 *   3. API key         — Bearer sl_data_…; tier budget via pickLimit()
 *                        (paid = unlimited, Explorer = its published daily
 *                        cap), counted over route:'image' rows. Logged.
 *   4. trusted bot     — search crawlers / assistant user-fetch agents
 *                        (isTrustedBot) plus social-card scrapers, so link
 *                        previews and image indexing never break.
 *   5. session         — signed-in non-browser caller (scripts with cookies).
 *                        Generous daily budget. Logged.
 *   6. anon            — everything else: per-IP daily image budget. Under it,
 *                        served AND logged (so the budget accumulates); over
 *                        it, 429 with the get-a-key / licensing pitch.
 *
 * Everything UA/header-based here is honor-system, same as the rest of the
 * app-layer gate — a scraper that forges browser headers gets what a browser
 * gets. The point is to stop naive bulk clients, price the rest via
 * /licensing, and force the sophisticated ones into explicit forgery (which
 * matters for the Art. 4 TDM posture). CDN cache HITs never reach this gate;
 * only origin misses are counted — bulk pulls of DISTINCT images are all
 * misses, which is exactly the traffic this exists to see.
 *
 * Rollback: IMAGE_GATE_ENFORCE=0 turns blocking off (decisions still log
 * `would_block`, like API_AUTH_ENFORCE's log-only mode).
 */
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { validateApiKey } from '@/lib/dataset/api-keys';
import type { ApiKeyDoc } from '@/lib/dataset/types';
import type { ApiIdentity } from '@/lib/api-auth';
import { pickLimit } from '@/lib/api-budget';
import { getPagesServedLast24h } from '@/lib/api-usage';
import { isTrustedBot } from '@/lib/bot-gate';
import { verifyImageProxyToken } from '@/lib/image-proxy-auth';
import { API_LIMITS } from '@/lib/api-limits';
import { checkKeyRequestRate } from '@/lib/dataset/api-keys';

const IMAGE_ROUTE = 'image';

// Daily image budgets, rolling 24h, counted over api_usage route:'image'.
// Anon 500 mirrors the /text anon budget (#2983): roughly a book a day of
// headroom for a one-off script, far under mass extraction (the day-one
// observed bulk puller did 3,000+). Env-overridable for instant tuning.
const IMAGE_ANON_PER_DAY = Number(process.env.IMAGE_ANON_PAGES_PER_DAY || API_LIMITS.anon.imagesPerDay);
const IMAGE_SESSION_PER_DAY = Number(process.env.IMAGE_SESSION_PAGES_PER_DAY || API_LIMITS.session.imagesPerDay);

// Sec-Fetch-Dest values a real browser uses for subresource/navigation image
// loads. 'empty' (fetch/XHR) is deliberately absent — the site's own client JS
// passes via the Referer check instead, and bare scripts get budgeted.
const BROWSER_FETCH_DESTS = new Set(['image', 'document', 'iframe', 'embed', 'object']);

// Referer hosts that mark the site's own pages (including tenant subdomains,
// the Ficino Society domains, previews, and local dev). Matched on a dot
// boundary — see image-proxy-hosts.ts for why a bare suffix match is a hole.
const OWN_REFERER_HOSTS = [
  'sourcelibrary.org',
  'ficinosociety.org',
  'vercel.app',
  'localhost',
  '127.0.0.1',
];

// Social-card scrapers fetching preview images for shared links. Not in
// bot-gate's SEARCH_CRAWLERS (they must NOT get page-text access) but link
// previews die if their image fetch 429s, so they pass the IMAGE gate only.
const SOCIAL_CARD_UAS = [
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'slackbot',
  'discordbot', 'whatsapp', 'telegrambot', 'pinterest', 'redditbot',
];

function hostMatchesOwn(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return OWN_REFERER_HOSTS.some((own) => h === own || h.endsWith('.' + own));
}

/** Browser-shaped: a subresource load any real browser performs. */
export function isBrowserShapedImageRequest(request: {
  headers: { get(name: string): string | null };
}): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  if (dest && BROWSER_FETCH_DESTS.has(dest.toLowerCase())) return true;
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      if (hostMatchesOwn(new URL(referer).hostname)) return true;
    } catch {
      /* malformed referer — fall through */
    }
  }
  return false;
}

export function isSocialCardScraper(request: {
  headers: { get(name: string): string | null };
}): boolean {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  return SOCIAL_CARD_UAS.some((sig) => ua.includes(sig));
}

export type ImageIdentity = Omit<ApiIdentity, 'kind'> & {
  kind: ApiIdentity['kind'] | 'internal';
};

export interface ImageAccessDecision {
  allowed: boolean;
  /** 429 when a budget is exhausted (only meaningful when !allowed). */
  status: number;
  identity: ImageIdentity;
  /** Log this request to api_usage (keyed/session/anon traffic; never the hot browser path). */
  shouldLog: boolean;
  reason?: string;
  /** Budget snapshot for the 429 body. */
  used?: number;
  limit?: number;
}

const enforceImageGate = () => process.env.IMAGE_GATE_ENFORCE !== '0';

export async function checkImageAccess(request: NextRequest): Promise<ImageAccessDecision> {
  // 1) Browser subresource loads — the hot path. Nothing else runs.
  if (isBrowserShapedImageRequest(request)) {
    return { allowed: true, status: 200, identity: { kind: 'anon' }, shouldLog: false };
  }

  // 2) Signed internal URL (our own exports / OCR / MCP fetchers).
  const itk = request.nextUrl.searchParams.get('itk');
  const sourceParam = request.nextUrl.searchParams.get('url') || '';
  if (itk && verifyImageProxyToken(sourceParam, itk)) {
    return { allowed: true, status: 200, identity: { kind: 'internal' }, shouldLog: false };
  }

  // 3) API key — the sanctioned bulk path. Attributable, tier-budgeted.
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const keyDoc = await validateApiKey(authHeader);
    if (keyDoc) {
      const identity: ApiIdentity = {
        kind: 'apikey',
        apiKeyId: String((keyDoc as ApiKeyDoc)._id),
        userId: keyDoc.user_id,
        apiKeyTier: keyDoc.tier,
      };
      // Per-key requests/minute applies here too (same rule as the text APIs).
      const rpm = checkKeyRequestRate(keyDoc as ApiKeyDoc);
      if (!rpm.allowed && enforceImageGate()) {
        return {
          allowed: false, status: 429, identity, shouldLog: true,
          reason: 'key_rate_limit',
        };
      }
      const { limit } = pickLimit(identity);
      if (!Number.isFinite(limit)) {
        return { allowed: true, status: 200, identity, shouldLog: true };
      }
      const used = await getPagesServedLast24h({ identity, request, route: IMAGE_ROUTE });
      if (used >= limit && enforceImageGate()) {
        return {
          allowed: false, status: 429, identity, shouldLog: true,
          reason: 'image_budget_apikey', used, limit,
        };
      }
      return {
        allowed: true, status: 200, identity, shouldLog: true,
        reason: used >= limit ? 'image_budget_apikey' : undefined,
      };
    }
    // Invalid key: fall through — the caller is at best anonymous.
  }

  // 4) Search crawlers, assistant user-fetch agents, social-card scrapers.
  if (isSocialCardScraper(request) || (await isTrustedBot(request))) {
    return { allowed: true, status: 200, identity: { kind: 'bot' }, shouldLog: false };
  }

  // 5) Signed-in caller without browser headers (credentialed scripts).
  try {
    const session = await auth();
    if (session?.user?.id) {
      const identity: ApiIdentity = { kind: 'session', userId: session.user.id };
      const used = await getPagesServedLast24h({ identity, request, route: IMAGE_ROUTE });
      if (used >= IMAGE_SESSION_PER_DAY && enforceImageGate()) {
        return {
          allowed: false, status: 429, identity, shouldLog: true,
          reason: 'image_budget_session', used, limit: IMAGE_SESSION_PER_DAY,
        };
      }
      return { allowed: true, status: 200, identity, shouldLog: true };
    }
  } catch {
    /* auth() can throw in edge contexts — treat as anonymous */
  }

  // 6) Anonymous non-browser traffic — per-IP daily budget.
  const identity: ApiIdentity = { kind: 'anon' };
  const used = await getPagesServedLast24h({ identity, request, route: IMAGE_ROUTE });
  if (used >= IMAGE_ANON_PER_DAY && enforceImageGate()) {
    return {
      allowed: false, status: 429, identity, shouldLog: true,
      reason: 'image_budget_anon', used, limit: IMAGE_ANON_PER_DAY,
    };
  }
  return {
    allowed: true, status: 200, identity, shouldLog: true,
    reason: used >= IMAGE_ANON_PER_DAY ? 'image_budget_anon' : undefined,
  };
}

/** 429 body: what happened, and the funnel — key, sign-in, licensing. */
export function imageBudgetExceededBody(decision: ImageAccessDecision) {
  if (decision.reason === 'key_rate_limit') {
    return {
      error: 'Your API key\'s requests-per-minute limit was reached. Slow your request rate — the daily budget is unaffected. Higher rates come with paid tiers: https://sourcelibrary.org/licensing.',
      next_steps: { upgrade: 'https://sourcelibrary.org/licensing' },
      retry_after_seconds: 60,
    };
  }
  const next =
    decision.identity.kind === 'apikey'
      ? `Your free Explorer key is capped at ${decision.limit} images/day. Paid tiers are uncapped — see https://sourcelibrary.org/licensing.`
      : 'Bulk image access requires an API key — free at https://sourcelibrary.org/developers; paid tiers (uncapped) at https://sourcelibrary.org/licensing.';
  return {
    error: `Daily image budget reached (${decision.used}/${decision.limit} in the last 24h). ${next}`,
    used: decision.used,
    limit: decision.limit,
    next_steps: {
      get_api_key: 'https://sourcelibrary.org/developers',
      upgrade: 'https://sourcelibrary.org/licensing',
      sign_in: 'https://sourcelibrary.org/auth/signin',
    },
    retry_after_seconds: 3600,
  };
}

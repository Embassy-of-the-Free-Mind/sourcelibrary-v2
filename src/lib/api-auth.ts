/**
 * Public-API auth gate. Three identities:
 *
 *   1. session   — NextAuth cookie (signed-in user, generous tier)
 *   2. apikey    — Bearer sl_data_... (existing dataset keys, tier-based)
 *   3. anon      — per-IP token bucket (drives signups via 401)
 *
 * Plus a verified-bot exemption (Googlebot/Bingbot UA + same-origin web traffic),
 * so SEO indexing and the React frontend are never blocked.
 *
 * Soft-launch contract: enforcement is OFF unless API_AUTH_ENFORCE=1. In log-only
 * mode every call is logged with `would_block: true|false` so we can size the
 * anonymous tier from real traffic before turning on the gate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { validateApiKey } from '@/lib/dataset/api-keys';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logApiUsage } from '@/lib/api-usage';
import type { ApiKeyDoc } from '@/lib/dataset/types';

export type ApiIdentityKind = 'session' | 'apikey' | 'bot' | 'anon';

export interface ApiIdentity {
  kind: ApiIdentityKind;
  userId?: string;
  apiKeyId?: string;
  apiKeyTier?: string;
  bot?: string;
}

export interface ApiAuthDecision {
  allowed: boolean;
  identity: ApiIdentity;
  status: number;       // 200, 401, or 429
  retryAfter?: number;  // seconds, when 429
  reason?: string;      // why blocked (for logging + error body)
}

// Tier limits applied per IP / user / key per window.
// Anon 60/hr — calibrated to flag bursty scrapers without bothering casual
// browsing. Session 1,000/hr — generous for any human research session;
// dropped from 5,000 after 16h of data showed the heaviest signed-in user
// did 13 hits in 16h. Anyone hitting 1,000/hr is using a key anyway.
const ANON_LIMIT_PER_HOUR = Number(process.env.API_ANON_LIMIT_PER_HOUR || 60);
const SESSION_LIMIT_PER_HOUR = Number(process.env.API_SESSION_LIMIT_PER_HOUR || 1000);

// User-Agent substrings that get the verified-bot bypass. Reverse-DNS verification
// would be the gold standard; for now we rely on UA strings since the only cost
// of a false positive is one extra unauthenticated call slipping through.
const VERIFIED_BOT_UAS = [
  'googlebot', 'google-extended', 'bingbot', 'msnbot',
  'duckduckbot', 'applebot', 'mojeekbot',
];

function detectVerifiedBot(ua: string): string | null {
  const lower = ua.toLowerCase();
  for (const sig of VERIFIED_BOT_UAS) if (lower.includes(sig)) return sig;
  return null;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const o = new URL(origin).hostname.toLowerCase();
    return o === 'sourcelibrary.org' || o.endsWith('.sourcelibrary.org');
  } catch {
    return false;
  }
}

/** Resolve the request's identity and decide whether it gets through the gate. */
export async function requireApiAccess(request: NextRequest): Promise<ApiAuthDecision> {
  // 1) NextAuth session cookie — best identity, generous limit.
  try {
    const session = await auth();
    if (session?.user?.id) {
      const ip = getClientIp(request);
      const rl = checkRateLimit(
        { name: 'api:session', limit: SESSION_LIMIT_PER_HOUR, windowSeconds: 3600 },
        `${session.user.id}:${ip}`,
      );
      if (!rl.allowed) {
        return {
          allowed: false,
          status: 429,
          retryAfter: rl.retryAfter,
          identity: { kind: 'session', userId: session.user.id },
          reason: 'session_rate_limit',
        };
      }
      return { allowed: true, status: 200, identity: { kind: 'session', userId: session.user.id } };
    }
  } catch {
    // auth() can throw in edge contexts — fall through, treat as anonymous.
  }

  // 2) Bearer API key. validateApiKey already updates last_used_at atomically.
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const keyDoc = await validateApiKey(authHeader);
    if (keyDoc) {
      return {
        allowed: true,
        status: 200,
        identity: {
          kind: 'apikey',
          apiKeyId: String((keyDoc as ApiKeyDoc)._id),
          userId: keyDoc.user_id,
          apiKeyTier: keyDoc.tier,
        },
      };
    }
  }

  // 3) Verified bot or same-origin web traffic — exempt from the gate.
  // Same-origin covers the React frontend's own /api/books/[id] calls during
  // server/client renders. Spoofable, but the worst case is the scraper
  // gets the same access as a logged-out human, which is what they get today.
  const ua = request.headers.get('user-agent') || '';
  const bot = detectVerifiedBot(ua);
  if (bot) {
    return { allowed: true, status: 200, identity: { kind: 'bot', bot } };
  }
  if (sameOrigin(request)) {
    return { allowed: true, status: 200, identity: { kind: 'anon' } };
  }

  // 4) Anonymous — token bucket per IP. Past the limit, return 401 with a
  // signup CTA in the body so MCP/SDK clients surface the message verbatim.
  const ip = getClientIp(request);
  const rl = checkRateLimit(
    { name: 'api:anon', limit: ANON_LIMIT_PER_HOUR, windowSeconds: 3600 },
    ip,
  );
  if (!rl.allowed) {
    return {
      allowed: false,
      status: 401,
      retryAfter: rl.retryAfter,
      identity: { kind: 'anon' },
      reason: 'anon_rate_limit',
    };
  }
  return { allowed: true, status: 200, identity: { kind: 'anon' } };
}

// URLs are baked into the `error` string itself so clients that render only
// the top-level error field still surface a callable next step. The structured
// fields stay alongside for clients that pick them out programmatically.
const SIGNIN_URL = 'https://sourcelibrary.org/auth/signin';
const KEYS_URL = 'https://sourcelibrary.org/developers';

/** Body returned to anonymous callers who blew the rate limit. */
function buildAnonRateLimitBody(retryAfter?: number) {
  return {
    error:
      `Anonymous rate limit exceeded. Sign in (free, generous limit) at ${SIGNIN_URL} ` +
      `or get an API key at ${KEYS_URL}.`,
    next_steps: {
      sign_in: SIGNIN_URL,
      get_api_key: KEYS_URL,
      docs: 'https://sourcelibrary.org/developers',
    },
    retry_after_seconds: retryAfter,
  };
}

/** Body returned to a signed-in user who blew their (high) rate limit. */
function buildSessionRateLimitBody(retryAfter?: number) {
  return {
    error:
      `Rate limit exceeded for your session. Wait ${retryAfter ?? '?'}s, or use ` +
      `an API key (no per-session cap) — generate one at ${KEYS_URL}.`,
    next_steps: { get_api_key: KEYS_URL },
    retry_after_seconds: retryAfter,
  };
}

type RouteHandler<C = unknown> = (
  request: NextRequest,
  ctx: C,
  identity: ApiIdentity,
) => Promise<Response> | Response;

export interface WithApiAuthOptions {
  /** Logical name of the route, recorded in api_usage for grouping. */
  route: string;
  /**
   * Error response format when blocked.
   *  - 'http' (default): plain JSON body with `error`, `next_steps`, `retry_after_seconds`
   *  - 'jsonrpc': JSON-RPC 2.0 error envelope, for MCP / RPC endpoints whose clients
   *    expect that shape and will swallow plain HTTP error bodies.
   */
  errorFormat?: 'http' | 'jsonrpc';
}

type RateLimitBody = ReturnType<typeof buildAnonRateLimitBody>
  | ReturnType<typeof buildSessionRateLimitBody>;

/** JSON-RPC error envelope for MCP-style clients. */
function buildJsonRpcError(httpStatus: number, body: RateLimitBody) {
  // -32001 is in the JSON-RPC reserved server-error range (-32099..-32000)
  // and is the convention for "auth required / quota" application errors.
  const code = httpStatus === 401 ? -32001 : -32002;
  return {
    jsonrpc: '2.0' as const,
    error: { code, message: body.error, data: body },
    id: null,
  };
}

/**
 * Wrap an API route with the public-API gate. Honours API_AUTH_ENFORCE: when
 * unset (or 0), every call goes through with `would_block` flagged in the log
 * so you can size the anon tier from real traffic before flipping the switch.
 */
export function withApiAuth<C = unknown>(
  handler: RouteHandler<C>,
  opts: WithApiAuthOptions,
) {
  const enforce = process.env.API_AUTH_ENFORCE === '1';

  return async (request: NextRequest, ctx: C): Promise<Response> => {
    const start = Date.now();
    const decision = await requireApiAccess(request);

    if (!decision.allowed && enforce) {
      const httpBody =
        decision.status === 401 ? buildAnonRateLimitBody(decision.retryAfter)
        : buildSessionRateLimitBody(decision.retryAfter);

      const headers: Record<string, string> = {};
      if (decision.retryAfter) headers['Retry-After'] = String(decision.retryAfter);
      // RFC 7235: 401 responses must carry a WWW-Authenticate challenge so HTTP-aware
      // clients (curl --user, fetch wrappers, MCP transports) discover the auth scheme.
      if (decision.status === 401) {
        headers['WWW-Authenticate'] =
          `Bearer realm="sourcelibrary.org", get_key="${KEYS_URL}", sign_in="${SIGNIN_URL}"`;
      }

      logApiUsage({
        request, identity: decision.identity, route: opts.route,
        status: decision.status, ms: Date.now() - start,
        wouldBlock: true, blocked: true, reason: decision.reason,
      });

      const responseBody = opts.errorFormat === 'jsonrpc'
        ? buildJsonRpcError(decision.status, httpBody)
        : httpBody;
      return NextResponse.json(responseBody, { status: decision.status, headers });
    }

    const response = await handler(request, ctx, decision.identity);

    // Bulk endpoints (e.g. /api/books/[id]/text) set X-Pages-Served so the
    // budget check on the next call sees the running total.
    const pagesServed = parseInt(response.headers.get('x-pages-served') || '0') || undefined;

    logApiUsage({
      request, identity: decision.identity, route: opts.route,
      status: response.status, ms: Date.now() - start,
      pagesServed,
      wouldBlock: !decision.allowed,
      blocked: false,
      reason: decision.reason,
    });

    return response;
  };
}

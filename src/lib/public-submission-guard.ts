import { NextResponse } from 'next/server';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';

/**
 * Rate limit for the public, unauthenticated submission inboxes (#3509).
 *
 * Three routes accept writes from anyone — `/api/feedback`,
 * `/api/share-findings`, `/api/collection-proposals`. All three already cap
 * field sizes and land in an admin-reviewed queue that never renders publicly,
 * so the exposure is not injection; it is that a stranger can fill a human
 * being's worklist. `/api/mcp` sits behind `withApiAuth` (anon 60/hr) and so
 * covers MCP-originated writes, but each route is reachable directly, and the
 * on-page feedback widget posts to `/api/feedback` with no gate at all.
 *
 * This lives in one place rather than being inlined three times because the
 * recurring defect in this codebase is a fourth writer added later that quietly
 * skips the step (see the five `entities.books[]` writers, and the six search
 * boxes of which one logged nothing for four months). A new public submission
 * route calls this or it is unlimited.
 *
 * Uses the Mongo-backed limiter, not the in-memory one: these run on Vercel
 * where each instance has its own memory, so a per-instance counter is a
 * per-instance counter times however many instances are warm.
 */

/** Shared-Mongo limiter is keyed on this name — changing it resets the window. */
export type PublicSubmissionRoute =
  | 'feedback'
  | 'share-findings'
  | 'collection-proposals';

const LIMITS: Record<PublicSubmissionRoute, number> = {
  // A reader flagging translation issues page by page is doing exactly what we
  // asked them to, so this is the loosest of the three.
  feedback: 10,
  // A dossier and a collection proposal are both considered submissions; more
  // than a handful an hour from one address is not a person thinking.
  'share-findings': 5,
  'collection-proposals': 5,
};

const WINDOW_SECONDS = 3600;

/**
 * Returns a 429 response to send back, or `null` when the caller may proceed.
 *
 * If Mongo is slow or down, `checkRateLimitShared` degrades to the in-memory
 * per-instance cap rather than refusing — a limiter outage must not swallow a
 * reader's feedback.
 *
 * Note on the key: `getClientIp` reads `cf-connecting-ip` first, which is
 * correct behind the CDN (#3491) but is caller-supplied on any hostname that
 * bypasses Cloudflare. `alias-host-scope.ts` 308s those away from the API
 * surface, so the spoofable path is closed elsewhere rather than here — worth
 * re-checking if a new alias is ever allowed to serve `/api/*`.
 */
export async function guardPublicSubmission(
  request: Request,
  route: PublicSubmissionRoute,
): Promise<NextResponse | null> {
  const result = await checkRateLimitShared(
    { name: route, limit: LIMITS[route], windowSeconds: WINDOW_SECONDS },
    getClientIp(request),
  );

  if (result.allowed) return null;

  return NextResponse.json(
    { error: 'Too many submissions. Please try again later.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
  );
}

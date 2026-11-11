/**
 * Cloudflare edge challenges, seen from CI (#6485).
 *
 * Since 2026-10-11 a Cloudflare custom rule managed-challenges reader pages
 * (`/book/`) requested from hosting/cloud networks, Azure among them (#6463,
 * `.claude/docs/crawl-register.md`). GitHub-hosted runners are Azure, so the
 * scheduled suite gets Cloudflare's "Performing security verification" page,
 * HTTP 403, for every /book/ URL and every /q/ shortlink that redirects to one.
 * That is the rule working, not a broken page.
 *
 * Cloudflare marks every challenge response with `cf-mitigated: challenge`
 * (the same signal `scripts/workers/edge-crawl-alert.mjs --canary` reads). A
 * 403 from our own proxy or app layer never carries it, so counting only
 * header-marked responses as challenged keeps real 403s failing.
 */

type HasHeaders = { headers: () => Record<string, string> } | null | undefined;

export function isEdgeChallenge(response: HasHeaders): boolean {
  return response?.headers()['cf-mitigated'] === 'challenge';
}

export const EDGE_CHALLENGE_REASON =
  'Cloudflare challenged this request (cf-mitigated: challenge): the hosting-network rule (#6463) challenges CI runners on /book/. Not a broken page (#6485).';

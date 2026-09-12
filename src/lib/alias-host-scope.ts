import { canonicalPath } from '@/lib/locale-path';

/**
 * Scoping non-canonical hosts to the surface they exist for.
 *
 * `ficinosociety.org` is an alias on the same Vercel project. `SOCIETY_DOMAINS`
 * in the proxy was written as an *additive* allowlist: it rewrites `/` →
 * `/ficino-society` and lifts `/discussions` and `/members` onto the domain
 * root. It never restricted anything, so every other route — `/book/*`,
 * `/artwork/*`, `/collections/*`, the whole library — fell through and was
 * served from that hostname too.
 *
 * That mattered more than duplicate content. `ficinosociety.org` resolves
 * straight to Vercel (name.com nameservers, no `cf-ray` on any response), so
 * the entire Cloudflare layer is absent there: the AS132203 blocks, the bot
 * rules, the first layer of the three-layer crawler gate. Measured 2026-07-29,
 * minutes after `host` was added to read events: **3,791 of ~6,276 `page_read`
 * events came from the Tencent fleet via `ficinosociety.org`, and zero came
 * from the fleet via `sourcelibrary.org`** — the edge block works, they were
 * simply walking in through the unguarded door.
 *
 * So a request to a non-canonical host for something outside that host's own
 * surface is answered with a 308 to the canonical domain, where every layer
 * applies. Redirecting rather than blocking keeps shared links working and
 * consolidates the duplicate content, and a crawler that follows the redirect
 * arrives somewhere it can be governed.
 *
 * The allowlist is deliberately explicit. Anything the society pages genuinely
 * need — their own routes, framework assets, auth, presence, telemetry — stays;
 * everything else leaves. If a society feature breaks, the fix is to add its
 * prefix here, never to widen this to a catch-all.
 */

export const CANONICAL_HOST = 'sourcelibrary.org';

/** Prefixes that must keep working on an alias host. */
const ALIAS_ALLOWED_PREFIXES = [
  // The society surface itself, plus the two paths the proxy lifts to root.
  '/ficino-society',
  '/discussions',
  '/members',
  // Framework + static assets. Redirecting these would break the page that is
  // legitimately served here.
  '/_next',
  '/static',
  '/images',
  '/fonts',
  // Auth and the society's own APIs. A cross-origin redirect on a credentialed
  // XHR fails, so these must be answered in place.
  '/api/auth',
  '/api/ficino',
  '/api/presence',
  '/api/me',
  // Telemetry: keep it local so this host's traffic keeps being measurable —
  // losing that visibility is how the bypass stayed invisible in the first place.
  '/api/analytics',
  '/api/track',
  '/api/errors',
  '/api/feedback',
];

/** Exact paths allowed on an alias host. */
const ALIAS_ALLOWED_EXACT = new Set(['/', '/favicon.ico', '/manifest.json', '/opensearch.xml']);

/**
 * The project's bare Vercel production alias is the SAME shape of hole.
 *
 * `sourcelibrary-v2.vercel.app` resolves straight to Vercel — no `cf-ray`, so
 * none of the edge layer applies — and it answers the entire library. The
 * traffic detector has flagged reader traffic on it every run since #3446. It
 * is the last known unguarded door of the kind the AS132203 fleet walked
 * through, and nobody reads books there on purpose.
 *
 * It cannot simply 308 everything, which is the trap here: `scripts/uptime-
 * monitor.mjs` probes it, and the Playwright suite defaults its `BASE_URL` to
 * it — `e2e/crawl-all-pages.spec.ts` in particular. A catch-all redirect would
 * not merely break those; it would silently repoint a page-crawler at
 * production. So the allowlist keeps exactly the operational paths those two
 * consumers use, and nothing that serves a book.
 *
 * Note the EXACT matches: `/api/books` is the monitor's listing probe, while
 * `/api/books/<id>/text` and `/quote` — the bulk-read routes — are deliberately
 * not covered by it. Same for the three `/embed/*` landing pages, whose reading
 * rooms below them still redirect.
 */
const DEPLOYMENT_ALLOWED_PREFIXES = ['/_next', '/static', '/api/health'];
const DEPLOYMENT_ALLOWED_EXACT = new Set([
  '/',
  '/favicon.ico',
  '/api/books',
  '/embed/bph',
  '/embed/ficino',
  '/embed/bhutan',
]);

/**
 * Matched EXACTLY, never by substring. A `host.includes('vercel.app')` test
 * here would catch every preview deployment too — those get their own,
 * lighter policy below rather than this allowlist.
 */
export const DEPLOYMENT_ALIAS_HOSTS = new Set(['sourcelibrary-v2.vercel.app']);

/**
 * Preview deployments (`sourcelibrary-v2-git-*.vercel.app` and the
 * team-scoped `*-dereklomas-projects.vercel.app`) were a known, accepted
 * exposure: they must serve the whole site or branch review stops working,
 * and they sit outside Cloudflare, so the edge layer of the crawler gate is
 * absent there. What ended the acceptance (2026-08-09): this repo is public
 * and the Vercel bot posts every preview URL on its PR, so the set of
 * unguarded doors is enumerable by anyone — and the traffic detector caught
 * an outside party reading books through a stale worktree preview.
 *
 * The preview policy gates CONTENT for ANONYMOUS callers only. A request
 * carrying a session cookie (a signed-in dev — email sign-in works on any
 * host) or an Authorization header (API key / CRON_SECRET, verified at the
 * app layer) passes untouched, so branch review still works. Everything
 * that isn't book content — UI pages, assets, auth, APIs the pages need —
 * is untouched for everyone.
 *
 * Anonymous content requests get a 403 with a pointer at the canonical
 * domain, NOT a 308. A redirect would keep a shared link working, but it
 * would also make an e2e run pointed at a preview silently crawl
 * PRODUCTION — the exact trap the deployment allowlist above documents.
 * A loud refusal is the honest failure mode.
 */
const PREVIEW_HOST_RE = /^sourcelibrary-v2-git-[a-z0-9-]+\.vercel\.app$|-dereklomas-projects\.vercel\.app$/;

/**
 * Content surfaces gated for anonymous callers on preview hosts: the reader,
 * the book APIs beneath it, and the embed reading rooms. Additive by design —
 * if a new content surface appears, add its prefix here.
 */
const PREVIEW_GATED_PREFIXES = ['/book', '/api/books', '/embed'];

export type AliasPolicy = 'society' | 'deployment' | 'preview';

/** Which scoping policy applies to this host, if any. Ports are ignored. */
export function aliasPolicyForHost(host: string): AliasPolicy | null {
  const bare = (host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  if (!bare) return null;
  if (DEPLOYMENT_ALIAS_HOSTS.has(bare)) return 'deployment';
  if (PREVIEW_HOST_RE.test(bare)) return 'preview';
  if (bare.includes('ficinosociety.org') || bare.includes('ficino.sourcelibrary.org')) {
    return 'society';
  }
  return null;
}

/**
 * Is this a content path the preview policy withholds from anonymous callers?
 *
 * Matched on the LOCALE-STRIPPED path: `/es/book/x` is the same book as
 * `/book/x` and must be gated identically. Matching the raw pathname left the
 * Spanish twin wide open on every preview from the day `/es/book` shipped —
 * `/book/dawn-rising-boehme` 403'd and `/es/book/dawn-rising-boehme` returned
 * the whole record. Because it strips ANY prefixed locale, a future `/fr` is
 * covered the moment the locale is registered, with no edit here.
 */
export function isPreviewGatedPath(pathname: string): boolean {
  const canonical = canonicalPath(pathname);
  return PREVIEW_GATED_PREFIXES.some(
    (p) => canonical === p || canonical.startsWith(p + '/'),
  );
}

/** Plain-text body for the anonymous-on-preview refusal. */
export function previewGateResponse(pathname: string): string {
  return [
    'This is a preview deployment — book content is not served here to anonymous visitors.',
    `Read this page on the canonical site: https://${CANONICAL_HOST}${pathname}`,
    'Reviewing a branch? Sign in on this host (email sign-in works on previews), or send an Authorization header.',
  ].join('\n');
}

/**
 * Should this path be redirected off an alias host to the canonical domain?
 * Callers apply it only when the request is already known to be on an alias.
 */
export function shouldRedirectToCanonical(
  pathname: string,
  policy: AliasPolicy = 'society'
): boolean {
  // Preview hosts never redirect — their gate is the anonymous-content 403
  // above, precisely so a misdirected crawl fails loudly instead of silently
  // landing on production.
  if (policy === 'preview') return false;
  const exact = policy === 'deployment' ? DEPLOYMENT_ALLOWED_EXACT : ALIAS_ALLOWED_EXACT;
  const prefixes = policy === 'deployment' ? DEPLOYMENT_ALLOWED_PREFIXES : ALIAS_ALLOWED_PREFIXES;
  if (exact.has(pathname)) return false;
  return !prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** The canonical URL a redirected alias request should land on. */
export function canonicalUrl(pathname: string, search: string): string {
  return `https://${CANONICAL_HOST}${pathname}${search || ''}`;
}

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import nextConfig from '../../next.config';

/**
 * A route cannot be both `force-dynamic` and edge-cached. If it is, the dynamic
 * setting silently does nothing.
 *
 * `CDN-Cache-Control` in next.config.ts is applied by PATH, independently of the
 * route's own rendering mode. So a page marked `force-dynamic` that also matches
 * a `public, max-age=…` rule is still cached at the edge — Cloudflare serves one
 * visitor's render to everyone for the TTL, and the per-request work runs once
 * and is thrown away.
 *
 * This shipped in #3646: `/support` was made `force-dynamic` so the giving form
 * could default its tax route from `x-vercel-ip-country`, while `/support` sits
 * in the static-pages rule at `max-age=86400`. Production answered
 * `cf-cache-status: HIT` with `age: 1202` on a supposedly dynamic page — every
 * visitor got whichever country warmed the cache, plus a wasted Mongo call per
 * request. Nothing failed; the personalisation was simply inert.
 *
 * This is an ABSENCE invariant across two files that cannot be checked from
 * either one alone, and no unit-testable function expresses it — the pairing
 * only exists at the edge. That is the case where a source-shape assertion earns
 * its keep (CLAUDE.md: "A test that greps source is not a guard" — and its stated
 * exception for absence invariants, like the soft-404 loading guard).
 *
 * Negative control, verified by hand: restoring `export const dynamic =
 * 'force-dynamic'` to src/app/support/page.tsx turns this test red and names the
 * route and the rule it collides with.
 */

const APP_DIR = join(__dirname, '../../src/app');

/**
 * Convert a next.config `source` pattern into a matcher over app route paths.
 *
 * Handles the three shapes this config actually uses, including a `:param` in
 * the MIDDLE of a path (`/book/:id/preview`) — an earlier version only matched
 * params in trailing position, so the two editor `/preview` overrides silently
 * never matched and the test reported them as unprotected. A matcher that
 * quietly fails to match reads exactly like a rule that isn't there.
 *
 * App routes carry Next's dynamic segments literally (`/book/[id]/preview`), and
 * `[^/]+` matches `[id]` fine — no need to normalise the other side.
 */
function sourceMatcher(source: string): (route: string) => boolean {
  const pattern = source
    // Escape regex metacharacters EXCEPT the ones we are about to interpret:
    // `(`/`)`/`|` form alternation groups, `:`/`*` form params.
    .replace(/[.+?^${}\\]/g, '\\$&')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    // `:name*` — zero or more trailing segments.
    .replace(/:[a-zA-Z]+\*/g, '(?:.*)')
    // `:name` — exactly one segment.
    .replace(/:[a-zA-Z]+/g, '[^/]+');

  // `/book/:path*` must match the bare `/book` too, not just `/book/x`.
  const re = new RegExp(`^${pattern.replace(/\/\(\?:\.\*\)$/, '(?:/.*)?')}$`);
  return (route) => re.test(route);
}

/** Walk src/app and return { route, file } for every page.tsx. */
function collectPages(dir: string, out: { route: string; file: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '_archived' || entry === 'api') continue;
      collectPages(full, out);
    } else if (entry === 'page.tsx') {
      // src/app/support/page.tsx -> /support ; strip route groups and drop
      // dynamic segments, which no CDN rule in this config keys on literally.
      const rel = relative(APP_DIR, dir).replace(/\\/g, '/');
      const route =
        '/' +
        rel
          .split('/')
          .filter((s) => s && !s.startsWith('(') && !s.startsWith('@'))
          .join('/');
      out.push({ route: route === '/' ? '/' : route, file: full });
    }
  }
  return out;
}

/**
 * EVERY CDN-Cache-Control rule from the real config, in declaration order.
 *
 * Order is load-bearing and must not be collapsed. next.config.ts deliberately
 * places narrow overrides AFTER the broad rule they correct — `/book/:id/preview`
 * is `private, no-store` sitting after `/book/:path*` is `max-age=86400`, with a
 * comment saying exactly that. A matcher that returns "any matching rule" reports
 * those correctly-protected editor routes as cache collisions; only the LAST
 * match is the effective header. (First version of this test did that and
 * produced two false positives — the fixture was wrong, not the code.)
 */
async function cdnRules(): Promise<{ source: string; value: string }[]> {
  const headers = await (nextConfig as { headers?: () => Promise<unknown[]> }).headers?.();
  expect(Array.isArray(headers)).toBe(true);

  const rules: { source: string; value: string }[] = [];
  for (const entry of headers as {
    source: string;
    headers: { key: string; value: string }[];
  }[]) {
    for (const h of entry.headers ?? []) {
      if (h.key.toLowerCase() !== 'cdn-cache-control') continue;
      rules.push({ source: entry.source, value: h.value });
    }
  }
  return rules;
}

function isPublicCached(value: string): boolean {
  if (!/public/i.test(value)) return false;
  const maxAge = value.match(/max-age=(\d+)/i);
  return !!maxAge && Number(maxAge[1]) > 0;
}

/** The effective CDN-Cache-Control for a route: the last rule that matches it. */
function effectiveRule(
  route: string,
  rules: { source: string; value: string }[],
): { source: string; value: string } | undefined {
  let winner: { source: string; value: string } | undefined;
  for (const r of rules) if (sourceMatcher(r.source)(route)) winner = r;
  return winner;
}

/** Routes whose effective CDN rule caches them publicly at the edge. */
async function publicCdnRules(): Promise<{ source: string; value: string }[]> {
  return (await cdnRules()).filter((r) => isPublicCached(r.value));
}

describe('no route is both force-dynamic and edge-cached', () => {
  it('reads real CDN rules out of next.config.ts', async () => {
    const rules = await publicCdnRules();
    // If this ever hits zero the test has stopped testing anything — the config
    // shape changed and every assertion below would pass vacuously.
    expect(rules.length).toBeGreaterThan(5);
    expect(rules.some((r) => r.source.includes('/book/'))).toBe(true);
  });

  it('finds the app routes it is supposed to be checking', () => {
    const pages = collectPages(APP_DIR);
    expect(pages.length).toBeGreaterThan(50);
    expect(pages.some((p) => p.route === '/support')).toBe(true);
    expect(pages.some((p) => p.route === '/give')).toBe(true);
  });

  /**
   * Pre-existing collisions, inherited — NOT introduced by #3646/#3647.
   *
   * Each of these declares `force-dynamic` while its effective CDN rule caches it
   * publicly for 24h, so the dynamic rendering is served from cache anyway. Not
   * fixed here because each needs its own judgement: some may be dynamic to read
   * `headers()` for tenant scoping (safe, since Cloudflare keys the cache per
   * hostname), others may genuinely want the TTL gone. Filed for triage rather
   * than changed blind — this PR's job is to stop ADDING to the list.
   *
   * Shrink this array when you fix one. Never grow it without saying why.
   */
  const KNOWN_COLLISIONS = new Set([
    '/blog/man-his-own-maker',
    '/blog/singularity-1486',
    '/book/[id]/overview',
    '/browse/artists/[letter]',
    '/browse/authors/[letter]',
    '/browse/titles/[letter]',
    '/browse/years/[period]',
    '/collections/[id]',
    '/collections/mycology',
    '/libraries/[slug]',
  ]);

  it('no NEW force-dynamic page sits under a public max-age CDN rule', async () => {
    const rules = await cdnRules();

    const collisions: string[] = [];
    for (const { route, file } of collectPages(APP_DIR)) {
      const src = readFileSync(file, 'utf8');
      // Strip comments so prose ABOUT force-dynamic (this fix leaves plenty)
      // cannot masquerade as the declaration itself.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (!/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(code)) continue;

      const hit = effectiveRule(route, rules);
      if (!hit || !isPublicCached(hit.value)) continue;
      if (KNOWN_COLLISIONS.has(route)) continue;
      collisions.push(`${route} (${relative(APP_DIR, file)}) vs rule "${hit.source}" → ${hit.value}`);
    }

    expect(collisions).toEqual([]);
  });

  it('the editor-only preview routes are protected by their narrower later rule', async () => {
    // Guards the precedence the config comment depends on: `/book/:id/preview` is
    // declared `private, no-store` AFTER the broad `/book/:path*` max-age rule.
    // If someone reorders those, a cached editor 200 could be served to anon
    // users — the leak the override exists to prevent.
    const rules = await cdnRules();
    for (const route of ['/book/[id]/preview', '/book/[id]/page/[pageId]/preview']) {
      const hit = effectiveRule(route, rules);
      expect(hit, `no CDN rule matched ${route}`).toBeDefined();
      expect(isPublicCached(hit!.value), `${route} is publicly edge-cached`).toBe(false);
    }
  });

  it('/give — the country-aware giving surface — is NOT edge-cached', async () => {
    // The whole point of the fix: personalisation lives on the uncached route.
    const rules = await publicCdnRules();
    const matched = rules.filter((r) => sourceMatcher(r.source)('/give'));
    expect(matched).toEqual([]);
  });

  it('/support IS edge-cached, so nothing there may depend on the request', async () => {
    // Stated as a positive assertion so that removing /support from the static
    // rule (which would reopen the scraper exposure the rule exists for) is a
    // deliberate, visible change rather than a silent one.
    const rules = await publicCdnRules();
    const matched = rules.filter((r) => sourceMatcher(r.source)('/support'));
    expect(matched.length).toBeGreaterThan(0);
  });
});

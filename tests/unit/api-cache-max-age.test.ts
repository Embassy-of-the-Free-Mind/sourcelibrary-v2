import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards issue #3309: an API response sent as `public, s-maxage=<n>` with NO
 * `max-age` is cached by the *browser* (RFC 9111 heuristic freshness) and then
 * served with zero network requests — unreachable by a Cloudflare purge. A tab
 * open during a backfill keeps rendering the stale body for days.
 *
 * The fix is `max-age=0` on every content-derived route (browser revalidates;
 * `s-maxage` still governs the shared CDN edge, so load is absorbed there).
 * This test pins the invariant across ALL route files so it cannot drift back
 * in one route at a time.
 *
 * Allowlisted: routes whose body is genuinely static config, deliberately
 * CDN-only, and NOT corrected out-of-band by a purge/backfill. Add here ONLY
 * with a reason.
 */
const ALLOWLIST = new Set<string>([
  // Static app config — deliberately CDN-only, not purge-driven (#3309 scope note).
  'src/app/api/config/route.ts',
]);

const API_DIR = join(process.cwd(), 'src', 'app', 'api');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

// Matches a Cache-Control string literal that sets s-maxage, capturing the value.
const CACHE_CONTROL_RE = /['"]([^'"]*\bs-maxage=[^'"]*)['"]/gi;

describe('API Cache-Control: s-maxage always pairs with max-age (#3309)', () => {
  it('every s-maxage response header also sets max-age (browser-cache reachable by purge)', () => {
    const offenders: string[] = [];

    for (const file of routeFiles(API_DIR)) {
      const rel = file.slice(file.indexOf('src/'));
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(CACHE_CONTROL_RE)) {
        const header = m[1];
        if (!/\bmax-age=/i.test(header)) {
          offenders.push(`${rel}: "${header}"`);
        }
      }
    }

    expect(
      offenders,
      `These API responses set s-maxage without max-age, so browsers cache them ` +
        `invisibly to a Cloudflare purge (#3309). Add max-age=0 (keep s-maxage for the CDN):\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});

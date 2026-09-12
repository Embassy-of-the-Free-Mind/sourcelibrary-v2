/**
 * Who owns the first path segment.
 *
 * Segment 0 is claimed by three namespaces — tenants (`/bph/…`), locale
 * prefixes (`/es/…`) and every global route root (`/book/…`, `/upload`, …).
 * The client-side resolver decided by EXCLUDING global routes from a
 * hand-written list, which had drifted 39 entries behind `src/app/`. Anything
 * missing from it read as a tenant, so api-client sent that page's calls to
 * `/api/<segment>/…` — a tenant-scoped URL resolving to no tenant, answered
 * with a flat 404. Measured on production before the fix:
 *
 *   PATCH /api/es/books/<id>      404 {"error":"Book not found"}   (cover picker on /es/book/…)
 *   POST  /api/upload/books       404, vs 401 on /api/books        (upload page)
 *   POST  /api/es/analytics/loading 400 {"error":"Tenant not found"}
 *
 * The resolver now matches an ALLOWLIST (`TENANT_ROOT_PATHS`, shared with the
 * proxy). These tests pin that inversion: the tenant roots resolve, and every
 * route root in `src/app/` resolves to null — including ones added after this
 * test was written, which is the part a denylist could never guarantee.
 */
import { readdirSync } from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

import { getTenantSlugFromPathname } from '@/lib/api-client/client';
import { PREFIXED_LOCALES } from '@/lib/locale-path';
import { TENANT_ROOT_PATHS } from '@/lib/tenant-roots';

/** Route roots as Next.js sees them: real directories under src/app, minus
 *  dynamic segments and route groups. */
function appRouteRoots(): string[] {
  return readdirSync(path.join(process.cwd(), 'src/app'), { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('('))
    .map(d => d.name);
}

describe('getTenantSlugFromPathname', () => {
  it('resolves the tenant roots the proxy gates on', () => {
    for (const slug of TENANT_ROOT_PATHS) {
      expect(getTenantSlugFromPathname(`/${slug}`)).toBe(slug);
      expect(getTenantSlugFromPathname(`/${slug}/book/x`)).toBe(slug);
    }
  });

  it('treats every global route root as global, including future ones', () => {
    const roots = appRouteRoots();
    // Guard the guard: if this ever reads zero directories the assertion below
    // passes vacuously.
    expect(roots.length).toBeGreaterThan(50);

    const claimed = roots.filter(
      r =>
        !TENANT_ROOT_PATHS.has(r) &&
        // `/embed` is the one root that deliberately carries a tenant in its
        // NEXT segment; covered by its own test below.
        r !== 'embed' &&
        getTenantSlugFromPathname(`/${r}/anything`) !== null,
    );
    expect(claimed).toEqual([]);
  });

  it('does not mistake a locale prefix for a tenant', () => {
    for (const locale of PREFIXED_LOCALES) {
      expect(getTenantSlugFromPathname(`/${locale}`)).toBeNull();
      expect(getTenantSlugFromPathname(`/${locale}/`)).toBeNull();
      expect(getTenantSlugFromPathname(`/${locale}/book/celestial-hierarchy`)).toBeNull();
      expect(getTenantSlugFromPathname(`/${locale}/collections/alchemy`)).toBeNull();
    }
  });

  it('still resolves a tenant sitting under a locale prefix', () => {
    for (const locale of PREFIXED_LOCALES) {
      expect(getTenantSlugFromPathname(`/${locale}/bph/book/x`)).toBe('bph');
      expect(getTenantSlugFromPathname(`/${locale}/embed/bph/book/x`)).toBe('bph');
    }
  });

  it('reads the tenant from the reserved slot in /embed/<tenant>/…', () => {
    expect(getTenantSlugFromPathname('/embed/bph/book/x')).toBe('bph');
    // Embed-only partners need no entry in TENANT_ROOT_PATHS — the position is
    // unambiguous, and the server resolves the slug against the DB.
    expect(getTenantSlugFromPathname('/embed/some-partner/book/x')).toBe('some-partner');
    expect(getTenantSlugFromPathname('/embed')).toBeNull();
  });

  it('leaves unprefixed global routes alone', () => {
    expect(getTenantSlugFromPathname('/')).toBeNull();
    expect(getTenantSlugFromPathname('/book/celestial-hierarchy')).toBeNull();
    expect(getTenantSlugFromPathname('/gallery')).toBeNull();
  });
});

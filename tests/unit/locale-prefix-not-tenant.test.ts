/**
 * A locale prefix is not a tenant slug.
 *
 * `/es/book/<id>` is the Spanish rendering of a GLOBAL route, but the
 * client-side tenant resolver read its first path segment and returned `es`,
 * so every api-client call fired from a Spanish page went to `/api/es/...`.
 * No tenant has that slug, so the route answered 404 — which surfaced to a
 * reader as "Book not found" inside the cover picker on /es/book/…, and as
 * "Tenant not found" on the loading-analytics endpoint.
 *
 * The resolver must strip a locale prefix before looking for a tenant, while
 * still resolving a real tenant that happens to sit under one.
 */
import { describe, it, expect } from 'vitest';

import { getTenantSlugFromPathname } from '@/lib/api-client/client';
import { PREFIXED_LOCALES } from '@/lib/locale-path';

describe('getTenantSlugFromPathname', () => {
  it('returns null for global routes under a locale prefix', () => {
    for (const locale of PREFIXED_LOCALES) {
      expect(getTenantSlugFromPathname(`/${locale}`)).toBeNull();
      expect(getTenantSlugFromPathname(`/${locale}/`)).toBeNull();
      expect(getTenantSlugFromPathname(`/${locale}/book/celestial-hierarchy`)).toBeNull();
      expect(getTenantSlugFromPathname(`/${locale}/collections/alchemy`)).toBeNull();
    }
  });

  it('still resolves a tenant that sits under a locale prefix', () => {
    for (const locale of PREFIXED_LOCALES) {
      expect(getTenantSlugFromPathname(`/${locale}/bph/book/x`)).toBe('bph');
      expect(getTenantSlugFromPathname(`/${locale}/embed/bph/book/x`)).toBe('bph');
    }
  });

  it('leaves unprefixed routes alone', () => {
    expect(getTenantSlugFromPathname('/book/celestial-hierarchy')).toBeNull();
    expect(getTenantSlugFromPathname('/gallery')).toBeNull();
    expect(getTenantSlugFromPathname('/bph/book/x')).toBe('bph');
    expect(getTenantSlugFromPathname('/embed/bph/book/x')).toBe('bph');
  });
});

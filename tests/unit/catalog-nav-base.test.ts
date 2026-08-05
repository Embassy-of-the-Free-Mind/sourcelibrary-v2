/**
 * The catalogue toolbar answers on two URL shapes for the same routes:
 *
 *   bph.sourcelibrary.org/catalog/4201       (proxy rewrite)
 *   <host>/embed/bph/catalog/4201            (direct embed path)
 *
 * The toolbar used to hardcode `/catalog/…`, which 404s on any host without
 * the tenant subdomain — including every preview deployment. These pin the
 * rule that decides the prefix.
 */
import { describe, it, expect } from 'vitest';
import { catalogBasePath } from '@/lib/catalog-nav';
import { toLibrarianFeedback } from '@/lib/feedback-origin';

describe('catalogBasePath', () => {
  it('uses the bare /catalog prefix on a tenant subdomain', () => {
    expect(catalogBasePath('subdomain', 'bph')).toBe('/catalog');
  });

  it('uses the embed prefix for a direct /embed/ URL', () => {
    expect(catalogBasePath('embed-path', 'bph')).toBe('/embed/bph/catalog');
  });

  it('falls back to the embed prefix when the source is unknown', () => {
    // The embed form is valid on every host; /catalog is valid only on one.
    expect(catalogBasePath(null, 'bph')).toBe('/embed/bph/catalog');
    expect(catalogBasePath('referer', 'bph')).toBe('/embed/bph/catalog');
  });

  it('encodes the tenant slug', () => {
    expect(catalogBasePath('embed-path', 'a b')).toBe('/embed/a%20b/catalog');
  });
});

describe('toLibrarianFeedback', () => {
  const raw = {
    _id: 'abc123',
    message: 'The year of publication is wrong',
    page: '/embed/bph/catalog/27637',
    name: 'Laura KM',
    email: 'laura@example.com',
    ip: '203.0.113.9',
    user_agent: 'Mozilla/5.0',
    created_at: new Date('2026-08-05T10:00:00Z'),
    read: false,
    addressed: false,
    surface: 'catalog',
    embedded: true,
    tenant_slug: 'bph',
  };

  it('strips every PII field', () => {
    const out = toLibrarianFeedback(raw) as Record<string, unknown>;
    expect(out.email).toBeUndefined();
    expect(out.ip).toBeUndefined();
    expect(out.user_agent).toBeUndefined();
  });

  it('is an allowlist, so unknown fields never pass through', () => {
    const out = toLibrarianFeedback({ ...raw, secret_internal_note: 'do not leak' }) as Record<
      string,
      unknown
    >;
    expect(out.secret_internal_note).toBeUndefined();
  });

  it('keeps what a librarian needs', () => {
    const out = toLibrarianFeedback(raw);
    expect(out.message).toBe('The year of publication is wrong');
    expect(out.name).toBe('Laura KM');
    expect(out.page).toBe('/embed/bph/catalog/27637');
    expect(out.surface).toBe('catalog');
    expect(out.embedded).toBe(true);
    expect(out.created_at).toBe('2026-08-05T10:00:00.000Z');
  });

  it('reports contactability without exposing the address', () => {
    expect(toLibrarianFeedback(raw).has_contact).toBe(true);
    expect(toLibrarianFeedback({ ...raw, email: null }).has_contact).toBe(false);
    expect(toLibrarianFeedback({ ...raw, email: 'not-an-address' }).has_contact).toBe(false);
  });

  it('survives rows missing the newer fields', () => {
    const out = toLibrarianFeedback({ _id: 'x', message: 'hi' });
    expect(out.surface).toBeNull();
    expect(out.embedded).toBe(false);
    expect(out.created_at).toBeNull();
    expect(out.read).toBe(false);
  });
});

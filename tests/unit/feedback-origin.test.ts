/**
 * Feedback origin tagging (Phase 1 of the BPH feedback split).
 *
 * The point of these helpers is to replace a path-prefix guess with something
 * the server observes. The two cases that matter most are the ones the old
 * heuristic in `scripts/analytics/feedback-triage.mjs` got wrong:
 *
 *   - `/catalog/scholar` on the global site was classified as partner-CMS
 *   - `/catalogue` on the BPH subdomain was not classified as partner-CMS
 *
 * Both are pinned below. Note that surface alone never decides tenancy —
 * `tenant_slug` does, and it comes from the proxy headers.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveSurface,
  isEmbeddedOrigin,
  parseEmbedTenantSlug,
  refererPathname,
} from '@/lib/feedback-origin';

describe('refererPathname', () => {
  it('extracts the path from an absolute referer', () => {
    expect(refererPathname('https://bph.sourcelibrary.org/catalog/4201')).toBe('/catalog/4201');
  });

  it('returns null for absent or unparseable values rather than throwing', () => {
    expect(refererPathname(null)).toBeNull();
    expect(refererPathname(undefined)).toBeNull();
    expect(refererPathname('')).toBeNull();
    expect(refererPathname('not a url')).toBeNull();
    expect(refererPathname('/catalog/4201')).toBeNull(); // relative, no origin
  });
});

describe('parseEmbedTenantSlug', () => {
  it('reads the slug out of an /embed/<slug>/… path', () => {
    expect(parseEmbedTenantSlug('/embed/bph/catalog/4201')).toBe('bph');
    expect(parseEmbedTenantSlug('/embed/bph')).toBe('bph');
  });

  it('ignores paths that are not embed paths', () => {
    expect(parseEmbedTenantSlug('/catalog/4201')).toBeNull();
    expect(parseEmbedTenantSlug('/book/123')).toBeNull();
    expect(parseEmbedTenantSlug('/')).toBeNull();
    expect(parseEmbedTenantSlug(null)).toBeNull();
  });

  it('rejects implausible slugs so a hostile Referer cannot inject one', () => {
    expect(parseEmbedTenantSlug('/embed/../admin')).toBeNull();
    expect(parseEmbedTenantSlug('/embed/UPPER')).toBeNull();
    expect(parseEmbedTenantSlug('/embed/-leading-dash')).toBeNull();
    expect(parseEmbedTenantSlug(`/embed/${'a'.repeat(64)}`)).toBeNull();
  });
});

describe('deriveSurface', () => {
  it('classifies the catalogue index, which the old path heuristic missed', () => {
    // `/catalogue` has no trailing slash and never matched `startsWith('/catalog/')`.
    expect(deriveSurface('/catalogue', null)).toBe('catalog');
    expect(deriveSurface('/catalog', null)).toBe('catalog');
  });

  it('classifies catalogue records', () => {
    expect(deriveSurface('/catalog/4201', null)).toBe('catalog');
    expect(deriveSurface('/catalogue/4201', null)).toBe('catalog');
  });

  it('classifies reading surfaces', () => {
    expect(deriveSurface('/book/12345', null)).toBe('reader');
    expect(deriveSurface('/read/12345', null)).toBe('reader');
  });

  it('treats an embedded catalogue path the same as a subdomain one', () => {
    expect(deriveSurface('/embed/bph/catalog/4201', null)).toBe('catalog');
    expect(deriveSurface('/embed/bph', null)).toBe('global');
  });

  it('falls back to the client-supplied page when the referer is stripped', () => {
    expect(deriveSurface(null, '/catalog/4201')).toBe('catalog');
    expect(deriveSurface(null, null)).toBe('global');
    expect(deriveSurface(null, 'nonsense')).toBe('global');
  });

  it('prefers the referer over the client-supplied page', () => {
    expect(deriveSurface('/book/1', '/catalog/4201')).toBe('reader');
  });

  it('does not confuse similarly-prefixed global routes', () => {
    expect(deriveSurface('/catalogs-of-interest', null)).toBe('global');
    expect(deriveSurface('/bookshelf', null)).toBe('global');
  });

  /**
   * `/catalog/scholar` IS a catalogue surface, so surface alone cannot tell it
   * apart from a BPH record. That separation is tenant_slug's job: on the
   * global site no tenant header is stamped, so the row stays untagged.
   */
  it('classifies the global /catalog/scholar route as a catalogue surface', () => {
    expect(deriveSurface('/catalog/scholar', null)).toBe('catalog');
  });
});

describe('isEmbeddedOrigin', () => {
  it('trusts the proxy header when it is set', () => {
    expect(isEmbeddedOrigin(true, '/catalog/4201')).toBe(true);
  });

  it('detects an embed path when the header is absent', () => {
    expect(isEmbeddedOrigin(false, '/embed/bph/catalog/4201')).toBe(true);
  });

  it('is false for ordinary global pages', () => {
    expect(isEmbeddedOrigin(false, '/book/123')).toBe(false);
    expect(isEmbeddedOrigin(false, null)).toBe(false);
  });
});

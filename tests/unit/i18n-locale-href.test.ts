import { describe, it, expect } from 'vitest';
import { canonicalPath, localeHref, localeFromPathname, LOCALIZED_PATHS } from '@/lib/i18n';

describe('canonicalPath', () => {
  it('drops the /es prefix', () => {
    expect(canonicalPath('/es')).toBe('/');
    expect(canonicalPath('/es/support')).toBe('/support');
    expect(canonicalPath('/es/auth/signin')).toBe('/auth/signin');
  });
  it('leaves English paths and null/undefined sane', () => {
    expect(canonicalPath('/support')).toBe('/support');
    expect(canonicalPath('/')).toBe('/');
    expect(canonicalPath(null)).toBe('/');
    expect(canonicalPath(undefined)).toBe('/');
  });
  it('does not mis-strip a non-locale path that merely starts with "es"', () => {
    // '/esoterica' must NOT become '/oterica'
    expect(canonicalPath('/esoterica')).toBe('/esoterica');
  });
});

describe('localeHref (sitewide toggle, #2763)', () => {
  it('EN always returns the canonical page so the reader stays put', () => {
    expect(localeHref('en', '/es')).toBe('/');
    expect(localeHref('en', '/es/support')).toBe('/support');
    expect(localeHref('en', '/book/foo')).toBe('/book/foo');
  });

  it('ES links to the /es twin when one exists', () => {
    expect(localeHref('es', '/')).toBe('/es');
    expect(localeHref('es', '/es')).toBe('/es');
    // Path FAMILIES with twins (LOCALIZED_PREFIXES): collections and books (#4082).
    expect(localeHref('es', '/collections/alchemy')).toBe('/es/collections/alchemy');
    expect(localeHref('es', '/book/foo')).toBe('/es/book/foo');
    expect(localeHref('es', '/book/foo/page/bar')).toBe('/es/book/foo/page/bar');
  });

  it('ES falls back to the Spanish homepage on pages with no twin', () => {
    // Deep pages (no /es twin) front-door to /es rather than 404.
    expect(localeHref('es', '/gallery')).toBe('/es');
    expect(localeHref('es', '/bookshelf')).toBe('/es'); // prefix match is segment-wise, not string-wise
  });

  it('round-trips a localized twin path', () => {
    // Simulate the funnel PR registering /support as localized.
    LOCALIZED_PATHS.add('/support');
    try {
      expect(localeHref('es', '/support')).toBe('/es/support');
      expect(localeHref('es', '/es/support')).toBe('/es/support');
      expect(localeHref('en', '/es/support')).toBe('/support');
    } finally {
      LOCALIZED_PATHS.delete('/support');
    }
  });
});

describe('localeFromPathname (unchanged, guarded here)', () => {
  it('detects /es and /es/* as Spanish, everything else English', () => {
    expect(localeFromPathname('/es')).toBe('es');
    expect(localeFromPathname('/es/support')).toBe('es');
    expect(localeFromPathname('/')).toBe('en');
    expect(localeFromPathname('/esoterica')).toBe('en');
  });
});

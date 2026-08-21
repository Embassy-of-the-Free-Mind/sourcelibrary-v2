import { describe, it, expect } from 'vitest';
import { canonicalPath, localeHref, localeFromPathname, localePath, LOCALIZED_PATHS } from '@/lib/i18n';

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
    // Book SUB-routes without a twin must not be claimed by the /book family:
    // /es/book/x/overview is served by nothing (#4082).
    expect(localeHref('es', '/book/foo/overview')).toBe('/es');
    expect(localeHref('es', '/book/foo/guide')).toBe('/es');
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

describe('localePath (keep an internal link on its locale, #4082)', () => {
  it('is a no-op in English', () => {
    expect(localePath('/book/foo', 'en')).toBe('/book/foo');
    expect(localePath('/gallery', 'en')).toBe('/gallery');
  });

  it('prefixes paths that have a twin route', () => {
    expect(localePath('/book/foo', 'es')).toBe('/es/book/foo');
    expect(localePath('/book/foo/page/bar', 'es')).toBe('/es/book/foo/page/bar');
    expect(localePath('/book/foo/page-number/12', 'es')).toBe('/es/book/foo/page-number/12');
    expect(localePath('/collections/alchemy', 'es')).toBe('/es/collections/alchemy');
    expect(localePath('/', 'es')).toBe('/es');
  });

  it('leaves a path with NO twin alone rather than minting a 404', () => {
    expect(localePath('/book/foo/overview', 'es')).toBe('/book/foo/overview');
    expect(localePath('/gallery?bookId=x', 'es')).toBe('/gallery?bookId=x');
    expect(localePath('/artwork/foo', 'es')).toBe('/artwork/foo');
    expect(localePath('/author/paracelsus', 'es')).toBe('/author/paracelsus');
  });

  it('passes through absolute URLs, anchors and already-prefixed paths', () => {
    expect(localePath('https://example.org/book/x', 'es')).toBe('https://example.org/book/x');
    expect(localePath('#pages', 'es')).toBe('#pages');
    expect(localePath('/es/book/foo', 'es')).toBe('/es/book/foo');
    expect(localePath('', 'es')).toBe('');
  });

  it('keeps the query string when it prefixes', () => {
    expect(localePath('/book/foo?v=2', 'es')).toBe('/es/book/foo?v=2');
  });
});

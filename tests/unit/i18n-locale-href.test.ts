import { describe, it, expect } from 'vitest';
import { canonicalPath, localeHref, localeFromPathname, localePath, LOCALIZED_PATHS, hasLocalizedTwin } from '@/lib/i18n';

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
  });

  it('ES falls back to the Spanish homepage on pages with no twin', () => {
    // Deep pages (no /es twin) front-door to /es rather than 404.
    expect(localeHref('es', '/book/foo')).toBe('/es');
    expect(localeHref('es', '/gallery')).toBe('/es');
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

describe('reader route shape (LOCALIZED_PATTERNS, groundwork for reader-v2 ES chrome)', () => {
  it('hasLocalizedTwin is true on a reader page', () => {
    expect(hasLocalizedTwin('/book/foo-bar/page/abc123')).toBe(true);
    expect(hasLocalizedTwin('/es/book/foo-bar/page/abc123')).toBe(true);
  });

  it('localeHref keeps the reader on the same page instead of bouncing home', () => {
    expect(localeHref('es', '/book/foo-bar/page/abc123')).toBe('/es/book/foo-bar/page/abc123');
    expect(localeHref('en', '/es/book/foo-bar/page/abc123')).toBe('/book/foo-bar/page/abc123');
  });

  it('does not match adjacent, non-twinned book routes (prefix match would be wrong)', () => {
    expect(hasLocalizedTwin('/book/foo-bar')).toBe(false);
    expect(hasLocalizedTwin('/book/foo-bar/overview')).toBe(false);
    expect(hasLocalizedTwin('/book/foo-bar/page/abc123/preview')).toBe(false);
    expect(localeHref('es', '/book/foo-bar/overview')).toBe('/es');
  });

  it('localePath prefixes a reader href but leaves a twin-less one untouched', () => {
    expect(localePath('/book/foo-bar/page/next-page', 'es')).toBe('/es/book/foo-bar/page/next-page');
    expect(localePath('/book/foo-bar/overview', 'es')).toBe('/book/foo-bar/overview');
    expect(localePath('/book/foo-bar/page/next-page', 'en')).toBe('/book/foo-bar/page/next-page');
    // Already-prefixed and root pass through / normalize as documented.
    expect(localePath('/es/book/foo-bar/page/next-page', 'es')).toBe('/es/book/foo-bar/page/next-page');
    expect(localePath('/', 'es')).toBe('/es');
  });
});

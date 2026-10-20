import { describe, it, expect } from 'vitest';
import { canonicalPath, carriedLocale, carryLocale, localeHref, localeFromPathname, localePath, hasLocalizedTwin, withEnglishFallback, LOCALIZED_PATHS } from '@/lib/i18n';
import { readsOriginal, type Locale } from '@/lib/locale-path';

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

describe('the prerendered homepage reports /index (#7025)', () => {
  it('canonicalPath reads /index as the homepage', () => {
    expect(canonicalPath('/index')).toBe('/');
    expect(canonicalPath('/zh/index')).toBe('/');
  });
  it('the language menu on / goes to each locale homepage, not /index?lang=', () => {
    for (const l of ['es', 'la', 'nl', 'zh'] as const) expect(localeHref(l, '/index')).toBe(`/${l}`);
    expect(localeHref('en', '/index')).toBe('/');
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

  it('ES stays on a page with no twin and carries ?lang=es (#6938)', () => {
    // Deep pages (no /es twin) keep the reader where they are, chrome in the
    // chosen language, rather than dumping them on /es or a 404.
    expect(localeHref('es', '/gallery')).toBe('/gallery?lang=es');
    expect(localeHref('es', '/bookshelf')).toBe('/bookshelf?lang=es'); // prefix match is segment-wise, not string-wise
    // Book SUB-routes without a twin must not be claimed by the /book family:
    // /es/book/x/overview is served by nothing (#4082).
    expect(localeHref('es', '/book/foo/overview')).toBe('/book/foo/overview?lang=es');
    expect(localeHref('la', '/es/collections/alchemy')).toBe('/collections/alchemy?lang=la');
  });

  it('EN drops a carried language', () => {
    expect(localeHref('en', '/gallery')).toBe('/gallery');
  });
});

describe('carriedLocale / carryLocale (#6938)', () => {
  it('reads only supported prefixed locales from ?lang=', () => {
    expect(carriedLocale('?lang=la')).toBe('la');
    expect(carriedLocale('lang=zh&q=x')).toBe('zh');
    expect(carriedLocale('?lang=en')).toBeNull();
    expect(carriedLocale('?lang=fr')).toBeNull();
    expect(carriedLocale('')).toBeNull();
  });

  it('prefixes a link whose page has a twin, and drops any stale ?lang', () => {
    expect(carryLocale('/', 'la')).toBe('/la');
    expect(carryLocale('/book/x', 'la')).toBe('/la/book/x');
    expect(carryLocale('/book/x/page/y?lang=la#n', 'la')).toBe('/la/book/x/page/y#n');
    expect(carryLocale('/collections/alchemy?sort=a', 'es')).toBe('/es/collections/alchemy?sort=a');
  });

  it('carries ?lang= on a link whose page has no twin, keeping its query and hash', () => {
    expect(carryLocale('/gallery', 'la')).toBe('/gallery?lang=la');
    expect(carryLocale('/collections/alchemy', 'la')).toBe('/collections/alchemy?lang=la');
    expect(carryLocale('/catalog?page=2#top', 'nl')).toBe('/catalog?page=2&lang=nl#top');
  });

  it('leaves alone what is not an English page link', () => {
    expect(carryLocale('/gallery', 'en')).toBe('/gallery');
    expect(carryLocale('/es/book/x', 'la')).toBe('/es/book/x'); // a language chosen on purpose
    expect(carryLocale('/api/books/x', 'la')).toBe('/api/books/x');
    expect(carryLocale('/feed.xml', 'la')).toBe('/feed.xml');
    expect(carryLocale('https://example.org/x', 'la')).toBe('https://example.org/x');
    expect(carryLocale('//cdn.example.org/x', 'la')).toBe('//cdn.example.org/x');
  });

  it('round-trips a localized twin path', () => {
    // Simulate the funnel PR registering /support as localized.
    // `/support` has since become a real member of the set, so restore the set
    // to how it was found: deleting unconditionally removed a live twin from
    // every test that ran after this one.
    const had = LOCALIZED_PATHS.es.has('/support');
    LOCALIZED_PATHS.es.add('/support');
    try {
      expect(localeHref('es', '/support')).toBe('/es/support');
      expect(localeHref('es', '/es/support')).toBe('/es/support');
      expect(localeHref('en', '/es/support')).toBe('/support');
    } finally {
      if (!had) LOCALIZED_PATHS.es.delete('/support');
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

// Latin (#6254) is the second prefixed locale, and the first whose set of twin
// routes differs from Spanish: the homepage, the book page and the reader, and
// nothing else. The registry is per locale for exactly that reason — these pin
// that a Latin link never borrows a Spanish-only twin.
describe('the Latin locale has its own, smaller set of twins', () => {
  it('reads /la as Latin and strips it', () => {
    expect(localeFromPathname('/la')).toBe('la');
    expect(localeFromPathname('/la/book/x')).toBe('la');
    expect(localeFromPathname('/latin-alchemy')).toBe('en'); // segment-wise, not a string prefix
    expect(canonicalPath('/la')).toBe('/');
    expect(canonicalPath('/la/book/x/page/y')).toBe('/book/x/page/y');
  });

  it('keeps /la on the homepage, the book page and the reader', () => {
    expect(localePath('/', 'la')).toBe('/la');
    expect(localePath('/book/x', 'la')).toBe('/la/book/x');
    expect(localePath('/book/x/page/y', 'la')).toBe('/la/book/x/page/y');
    expect(localePath('/book/x/page-number/12', 'la')).toBe('/la/book/x/page-number/12');
  });

  it('leaves a path with a Spanish twin but no Latin one untouched', () => {
    // Positive control first: the same paths DO prefix for Spanish, so an
    // unprefixed result below is the Latin registry answering, not a broken helper.
    for (const p of ['/support', '/search', '/librarian', '/auth/signin', '/collections', '/collections/alchemy']) {
      expect(localePath(p, 'es')).toBe(`/es${p}`);
      expect(localePath(p, 'la')).toBe(p);
      expect(hasLocalizedTwin(p, 'la')).toBe(false);
    }
  });

  it('switches language to the twin, or to that locale\'s front page', () => {
    expect(localeHref('la', '/book/x')).toBe('/la/book/x');
    expect(localeHref('la', '/es/book/x')).toBe('/la/book/x');
    expect(localeHref('es', '/la/book/x')).toBe('/es/book/x');
    expect(localeHref('en', '/la/book/x/page/y')).toBe('/book/x/page/y');
    expect(localeHref('la', '/support')).toBe('/support?lang=la'); // no twin: stay, carry the language (#6938)
  });

  it('hasLocalizedTwin with no locale means a twin in ANY locale', () => {
    expect(hasLocalizedTwin('/support')).toBe(true); // Spanish only
    expect(hasLocalizedTwin('/gallery')).toBe(false);
  });

  it('withEnglishFallback fills only the locales a surface has no copy for', () => {
    const d = withEnglishFallback({ en: 'Search', es: 'Buscar' });
    expect(d).toEqual({ en: 'Search', es: 'Buscar', la: 'Search', nl: 'Search', zh: 'Search' });
  });
});

describe('the Dutch and Chinese sites are original-text sites like Latin (#6382)', () => {
  it('keeps the homepage, book page and reader on /nl and /zh, and nothing else', () => {
    for (const l of ['nl', 'zh'] as const) {
      expect(localeHref(l, '/')).toBe(`/${l}`);
      expect(localeHref(l, '/book/x')).toBe(`/${l}/book/x`);
      expect(localeHref(l, '/book/x/page/p1')).toBe(`/${l}/book/x/page/p1`);
      expect(localeHref(l, '/support')).toBe(`/support?lang=${l}`);
      expect(localePath('/collections/alchemy', l)).toBe('/collections/alchemy');
      expect(localeFromPathname(`/${l}/book/x`)).toBe(l);
      expect(canonicalPath(`/${l}/book/x`)).toBe('/book/x');
    }
  });

  it('reads the original on la, nl and zh, and not on en or es', () => {
    expect(['en', 'es', 'la', 'nl', 'zh'].filter((l) => readsOriginal(l as Locale))).toEqual(['la', 'nl', 'zh']);
  });
});

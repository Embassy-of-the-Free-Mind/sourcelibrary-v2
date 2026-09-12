import { describe, it, expect } from 'vitest';
import { legacyLangRedirect, READING_LANGUAGE_PARAM } from '@/lib/reading-language';
import { hasLocalizedTwin } from '@/lib/locale-path';

/**
 * Reading language is the URL prefix (#4112). The module that used to hold a
 * cross-URL localStorage preference now does exactly one thing: migrate the
 * legacy `?lang=es` links minted before `/es/…` existed.
 *
 * The guard these cover is the one the old bug needed and did not have — that
 * an English URL stays English. A test that only asserts "/es renders Spanish"
 * would have passed throughout the entire life of the bug.
 */
describe('legacyLangRedirect', () => {
  it('sends a legacy ?lang=es book link to its /es twin', () => {
    expect(legacyLangRedirect('/book/x/page/y', '?lang=es', hasLocalizedTwin))
      .toBe('/es/book/x/page/y');
    expect(legacyLangRedirect('/book/x', '?lang=es', hasLocalizedTwin))
      .toBe('/es/book/x');
  });

  it('follows the registry when a path GAINS a twin — /search did in #4180', () => {
    // Not a restatement of the case above: it pins that this migration reads
    // the registry rather than a hard-coded list of families, so the day a
    // route gets an /es twin its legacy ?lang=es links start resolving to it.
    expect(legacyLangRedirect('/search', '?lang=es', hasLocalizedTwin))
      .toBe('/es/search');
    expect(legacyLangRedirect('/search', '?lang=es&q=alquimia', hasLocalizedTwin))
      .toBe('/es/search?q=alquimia');
  });

  it('preserves other query params across the migration, dropping only lang', () => {
    expect(legacyLangRedirect('/book/x/page/y', '?lang=es&v=1.2', hasLocalizedTwin))
      .toBe('/es/book/x/page/y?v=1.2');
  });

  it('leaves a plain English URL alone — this is the bug that was fixed', () => {
    expect(legacyLangRedirect('/book/x/page/y', '', hasLocalizedTwin)).toBeNull();
    expect(legacyLangRedirect('/book/x/page/y', '?v=1.2', hasLocalizedTwin)).toBeNull();
  });

  it('does not redirect a page with no Spanish twin', () => {
    // `/book/<id>/overview` has no /es route; sending a reader there is a 404.
    expect(legacyLangRedirect('/book/x/overview', '?lang=es', hasLocalizedTwin)).toBeNull();
    // `/gallery` likewise — measured 2026-08-21: /gallery 200, /es/gallery 404.
    // This slot used to hold `/search`, which gained a twin in #4180; when an
    // exemplar stops being an example, replace it rather than delete the case.
    expect(legacyLangRedirect('/gallery', '?lang=es', hasLocalizedTwin)).toBeNull();
  });

  it('is a no-op on an already-Spanish URL, so it cannot loop', () => {
    expect(legacyLangRedirect('/es/book/x/page/y', '?lang=es', hasLocalizedTwin)).toBeNull();
    expect(legacyLangRedirect('/es', '?lang=es', hasLocalizedTwin)).toBeNull();
  });

  it('ignores a lang value that is not a supported prefixed locale', () => {
    expect(legacyLangRedirect('/book/x', '?lang=fr', hasLocalizedTwin)).toBeNull();
    expect(legacyLangRedirect('/book/x', '?lang=en', hasLocalizedTwin)).toBeNull();
  });

  it('keeps the param name the legacy links actually used', () => {
    expect(READING_LANGUAGE_PARAM).toBe('lang');
  });
});

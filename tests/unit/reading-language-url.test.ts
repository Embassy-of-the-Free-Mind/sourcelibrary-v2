import { describe, it, expect } from 'vitest';
import { legacyLangRedirect, READING_LANGUAGE_PARAM } from '@/lib/reading-language';
import type { PrefixedLocale } from '@/lib/locale-path';

/**
 * Reading language is in the URL (#4112): the prefix, or a carried `?lang=`
 * that localizes chrome only (#6938). `legacyLangRedirect` moves an English
 * book URL carrying `?lang=xx` to the `/xx` edition — only when the book has
 * one, as answered by the server.
 *
 * The guard these cover is the one the old bug needed and did not have — that
 * an English URL stays English. A test that only asserts "/es renders Spanish"
 * would have passed throughout the entire life of the bug.
 */
const has = (...editions: PrefixedLocale[]) => (lang: PrefixedLocale) => editions.includes(lang);

describe('legacyLangRedirect', () => {
  it('sends ?lang=xx to the /xx edition when the book has it', () => {
    expect(legacyLangRedirect('/book/x', '?lang=es', has('es'))).toBe('/es/book/x');
    expect(legacyLangRedirect('/book/x', '?lang=la', has('la'))).toBe('/la/book/x');
  });

  it('stays put when the book has no such edition — the /xx route would 307 straight back', () => {
    // /la/book/x redirects a non-Latin book to /book/x?lang=la; migrating that
    // again is an infinite bounce.
    expect(legacyLangRedirect('/book/x', '?lang=la', has('es'))).toBeNull();
    expect(legacyLangRedirect('/book/x', '?lang=es', has())).toBeNull();
  });

  it('preserves other query params across the migration, dropping only lang', () => {
    expect(legacyLangRedirect('/book/x', '?lang=es&v=1.2', has('es'))).toBe('/es/book/x?v=1.2');
  });

  it('leaves a plain English URL alone (#4112)', () => {
    expect(legacyLangRedirect('/book/x', '', has('es'))).toBeNull();
    expect(legacyLangRedirect('/book/x', '?v=1.2', has('es'))).toBeNull();
  });

  it('is a no-op on an already-localized URL, so it cannot loop', () => {
    expect(legacyLangRedirect('/es/book/x', '?lang=es', has('es'))).toBeNull();
    expect(legacyLangRedirect('/la/book/x', '?lang=es', has('es'))).toBeNull();
  });

  it('ignores a lang value that is not a supported prefixed locale', () => {
    expect(legacyLangRedirect('/book/x', '?lang=fr', has('es'))).toBeNull();
    expect(legacyLangRedirect('/book/x', '?lang=en', has('es'))).toBeNull();
  });

  it('keeps the param name the legacy links actually used', () => {
    expect(READING_LANGUAGE_PARAM).toBe('lang');
  });
});

/**
 * The hero's "Start reading" link (#76) goes where the featured band's lead
 * book goes, on every homepage locale, and every locale has the words for it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/image', () => ({ default: () => null }));

import { featuredBookHref } from '@/components/prototype/EditorialSpread';
import { HOME_STRINGS } from '@/lib/home-i18n';

const book = { id: 'b1', slug: 'turba-philosophorum', title: 'Turba', language: 'Latin' };

describe('featuredBookHref', () => {
  it('English links the plain book page', () => {
    expect(featuredBookHref(book, 'en')).toBe('/book/turba-philosophorum');
  });

  it('Spanish keeps the locale prefix (every book has an /es page)', () => {
    expect(featuredBookHref(book, 'es')).toBe('/es/book/turba-philosophorum');
  });

  it('Dutch sends a book with no Dutch edition straight to English, not via a 307', () => {
    expect(featuredBookHref(book, 'nl')).toBe('/book/turba-philosophorum?lang=nl');
  });
});

describe('startReading copy', () => {
  it.each(Object.entries(HOME_STRINGS))('%s has a non-empty startReading string', (_lang, t) => {
    expect(t.startReading.trim().length).toBeGreaterThan(0);
  });

  it('Spanish reads "Empezar a leer"', () => {
    expect(HOME_STRINGS.es.startReading).toBe('Empezar a leer');
  });
});

import { describe, it, expect } from 'vitest';
import { validateR2Key, assertBookScopedKey, isBookScopedUrl } from '@/lib/r2-key';
// The scripts-side twin — parity is the point of this file.
// @ts-expect-error — plain .mjs module, no types
import * as twin from '../../scripts/lib/r2-key.mjs';

const BOOK = '69d004bee2fdebf52dc4c849';

describe('validateR2Key', () => {
  it('accepts well-formed book-scoped keys', () => {
    expect(() => validateR2Key(`archived/${BOOK}/31.jpg`)).not.toThrow();
    expect(() => validateR2Key(`pages/${BOOK}/0031.jpg`)).not.toThrow();
    expect(() => validateR2Key(`pages/${BOOK}/0031-thumb.jpg`)).not.toThrow();
    expect(() => validateR2Key(`gallery/some-collection/img-1.jpg`)).not.toThrow();
  });

  // The regression that caused #3362: a projection dropped `book_id`, so
  // `${page.book_id}` interpolated to the string "undefined" and every book
  // wrote to the same object.
  it('rejects the exact key shape that shipped the #3362 incident', () => {
    expect(() => validateR2Key('archived/undefined/31.jpg')).toThrow(/invalid segment/);
    expect(() => validateR2Key('pages/undefined/0031.jpg')).toThrow(/invalid segment/);
    expect(() => validateR2Key('pages/undefined/0031-thumb.jpg')).toThrow(/invalid segment/);
  });

  it('rejects other failed interpolations', () => {
    expect(() => validateR2Key('archived/null/31.jpg')).toThrow(/invalid segment/);
    expect(() => validateR2Key(`archived/${BOOK}/NaN.jpg`)).not.toThrow(); // NaN in filename is not a segment
    expect(() => validateR2Key('archived/NaN/31.jpg')).toThrow(/invalid segment/);
    expect(() => validateR2Key(`archived//31.jpg`)).toThrow(/invalid segment/);
    expect(() => validateR2Key(`/archived/${BOOK}/31.jpg`)).toThrow(/invalid segment/);
    expect(() => validateR2Key('')).toThrow(/non-empty string/);
  });

  it('does not reject ids that merely contain the substring "undefined"', () => {
    // Guard against an over-broad regex: only whole segments are invalid.
    expect(() => validateR2Key('archived/undefinedbook123/31.jpg')).not.toThrow();
    expect(() => validateR2Key(`pages/${BOOK}/undefined-notes.jpg`)).not.toThrow();
  });
});

describe('assertBookScopedKey', () => {
  it('accepts a key carrying its own book id', () => {
    expect(() => assertBookScopedKey(`archived/${BOOK}/31.jpg`, BOOK)).not.toThrow();
  });

  it('rejects a well-formed key belonging to a DIFFERENT book', () => {
    // validateR2Key alone cannot catch this — the key looks perfect.
    expect(() => assertBookScopedKey(`archived/69b220f356715b0e32473bd0/31.jpg`, BOOK))
      .toThrow(/not scoped to its book/);
  });

  it('rejects a missing book id', () => {
    expect(() => assertBookScopedKey(`archived/${BOOK}/31.jpg`, '')).toThrow(/bookId is missing/);
  });
});

describe('isBookScopedUrl (read-side audit helper)', () => {
  const base = 'https://images.sourcelibrary.org';

  it('passes correct stored URLs', () => {
    expect(isBookScopedUrl(`${base}/archived/${BOOK}/31.jpg`, BOOK)).toBe(true);
    expect(isBookScopedUrl(`${base}/pages/${BOOK}/0031.jpg`, BOOK)).toBe(true);
  });

  it('flags the shared undefined key', () => {
    expect(isBookScopedUrl(`${base}/archived/undefined/31.jpg`, BOOK)).toBe(false);
    expect(isBookScopedUrl(`${base}/pages/undefined/0031.jpg`, BOOK)).toBe(false);
  });

  it('flags another book\'s key', () => {
    expect(isBookScopedUrl(`${base}/archived/69b220f356715b0e32473bd0/31.jpg`, BOOK)).toBe(false);
  });

  it('ignores URLs it has no opinion about', () => {
    // External sources (IA, IIIF) are not book-scoped and must not be flagged.
    expect(isBookScopedUrl('https://archive.org/download/foo/page/n30/full/pct:50/0/default.jpg', BOOK)).toBe(true);
    expect(isBookScopedUrl(null, BOOK)).toBe(true);
    expect(isBookScopedUrl('failed:HTTP 404', BOOK)).toBe(true);
  });
});

describe('.ts / .mjs twin parity', () => {
  const keys = [
    `archived/${BOOK}/31.jpg`,
    'archived/undefined/31.jpg',
    'archived/null/31.jpg',
    'archived//31.jpg',
    'archived/undefinedbook123/31.jpg',
    `pages/${BOOK}/0031-thumb.jpg`,
  ];

  it('validateR2Key agrees on every case', () => {
    for (const k of keys) {
      const a = (() => { try { validateR2Key(k); return 'ok'; } catch { return 'throw'; } })();
      const b = (() => { try { twin.validateR2Key(k); return 'ok'; } catch { return 'throw'; } })();
      expect(`${k}:${a}`).toBe(`${k}:${b}`);
    }
  });

  it('isBookScopedUrl agrees on every case', () => {
    for (const k of keys) {
      const url = `https://images.sourcelibrary.org/${k}`;
      expect(isBookScopedUrl(url, BOOK)).toBe(twin.isBookScopedUrl(url, BOOK));
    }
  });
});

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

  // The write guard used `key.split('/').includes(bookId)`, a bare-segment match
  // that rejected two conventions the corpus actually uses — including one that
  // isBookScopedUrl's own comment documents as valid. The two sides of the guard
  // must agree, or a key can pass the audit and be refused at upload.
  it('accepts every book-scoped convention the read-side twin accepts', () => {
    for (const key of [
      `archived/${BOOK}/31.jpg`,        // id as its own segment
      `archived/${BOOK}-0031.jpg`,      // id + hyphen, documented in isBookScopedUrl
      `pages/${BOOK}/0031-thumb.jpg`,
      `book-thumbnails/${BOOK}.jpg`,    // id as filename stem (~4,634 live objects)
    ]) {
      expect(() => assertBookScopedKey(key, BOOK), key).not.toThrow();
      expect(isBookScopedUrl(`https://images.sourcelibrary.org/${key}`, BOOK), key).toBe(true);
      expect(() => twin.assertBookScopedKey(key, BOOK), `twin: ${key}`).not.toThrow();
    }
  });

  it('still rejects a near-miss that only CONTAINS the id without a delimiter', () => {
    // `<id>extra` is a different object, not this book's.
    expect(() => assertBookScopedKey(`archived/${BOOK}extra/31.jpg`, BOOK))
      .toThrow(/not scoped to its book/);
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

  // The corpus has several key conventions across eras. A hyphen-delimited id is
  // just as book-scoped as a slash-delimited one — measured at ~194 per 120k pages
  // sampled, so treating it as a violation would drown the real signal in noise.
  it('accepts the legacy hyphen-delimited convention', () => {
    expect(isBookScopedUrl(`${base}/archived/${BOOK}-0104.jpg`, BOOK)).toBe(true);
    expect(isBookScopedUrl(`${base}/pages/${BOOK}_0104.jpg`, BOOK)).toBe(true);
  });

  it('still flags a hyphen-delimited key belonging to another book', () => {
    expect(isBookScopedUrl(`${base}/archived/69b220f356715b0e32473bd0-0104.jpg`, BOOK)).toBe(false);
  });

  it('flags the shared key under any prefix', () => {
    expect(isBookScopedUrl(`${base}/thumbnails/undefined/144.jpg`, BOOK)).toBe(false);
  });

  // Book ids are sometimes UUIDs, which contain hyphens. An earlier version of this
  // helper split the URL on "-" to find the id, which made every UUID-keyed page
  // (split-page books) report as a violation.
  it('handles UUID book ids, which contain hyphens', () => {
    const uuid = '023f2b73-5a9f-4ada-92c2-258a408d89c2';
    expect(isBookScopedUrl(`${base}/pages/${uuid}/sp9wzb-0208.jpg`, uuid)).toBe(true);
    expect(isBookScopedUrl(`${base}/pages/${uuid}/sp9wzb-0208-thumb.jpg`, uuid)).toBe(true);
    expect(isBookScopedUrl(`${base}/archived/${uuid}-0104.jpg`, uuid)).toBe(true);
    expect(isBookScopedUrl(`${base}/pages/d850a255-4633-43d5-8383-7c67a7e55144/x.jpg`, uuid)).toBe(false);
  });

  it('does not match an id that is only a prefix of a longer id', () => {
    expect(isBookScopedUrl(`${base}/archived/${BOOK}deadbeef/31.jpg`, BOOK)).toBe(false);
  });

  it('flags the shared undefined key', () => {
    expect(isBookScopedUrl(`${base}/archived/undefined/31.jpg`, BOOK)).toBe(false);
    expect(isBookScopedUrl(`${base}/pages/undefined/0031.jpg`, BOOK)).toBe(false);
  });

  it('flags another book\'s key', () => {
    expect(isBookScopedUrl(`${base}/archived/69b220f356715b0e32473bd0/31.jpg`, BOOK)).toBe(false);
  });

  // #4376: `cropped/` and `uploads/` are book-scoped conventions too, and until
  // this helper judged them, a cover reading `cropped/<another book's id>/…`
  // passed the standing audit while a visible book showed the wrong title page.
  it('judges the cropped/ and uploads/ prefixes', () => {
    const other = '69a02781bd4078a454714f6f';
    expect(isBookScopedUrl(`${base}/cropped/${BOOK}/69a02a0c75873c3b8b8a8e6e.jpg`, BOOK)).toBe(true);
    expect(isBookScopedUrl(`${base}/uploads/${BOOK}/0179-original.jpg`, BOOK)).toBe(true);
    expect(isBookScopedUrl(`${base}/cropped/${other}/69a02a0c75873c3b8b8a8e6e.jpg`, BOOK)).toBe(false);
    expect(isBookScopedUrl(`${base}/uploads/${other}/0179-original.jpg`, BOOK)).toBe(false);
    expect(isBookScopedUrl(`${base}/cropped/undefined/31.jpg`, BOOK)).toBe(false);
    // The exact pair from #4376 — the shipped cover and its repair.
    const f6d = '69a02781bd4078a454714f6d';
    expect(isBookScopedUrl(`${base}/cropped/${other}/69a02a0c75873c3b8b8a8e6e.jpg`, f6d)).toBe(false);
    expect(isBookScopedUrl(`${base}/cropped/${f6d}/6975a093efc24c700962bbc7.jpg`, f6d)).toBe(true);
  });

  it('still has no opinion on prefixes that are not book-scoped by design', () => {
    // Galleries, artwork and manuscripts are keyed by their own ids, not a book's.
    expect(isBookScopedUrl(`${base}/gallery/some-collection/img-1.jpg`, BOOK)).toBe(true);
    expect(isBookScopedUrl(`${base}/artwork/6970abc.../plate-3.jpg`, BOOK)).toBe(true);
    expect(isBookScopedUrl(`${base}/manuscripts/xyz/1.jpg`, BOOK)).toBe(true);
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
    `cropped/${BOOK}/69a02a0c75873c3b8b8a8e6e.jpg`,
    'cropped/69a02781bd4078a454714f6f/69a02a0c75873c3b8b8a8e6e.jpg',
    `uploads/${BOOK}/0179-original.jpg`,
    'gallery/some-collection/img-1.jpg',
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

import { describe, it, expect } from 'vitest';
import { encodeShortlink, decodeShortlink, getShortUrl } from '@/lib/shortlinks';

// Issue #3940: UUID-keyed books (71 visible ones, including Pico's Opera Omnia
// and Weyer's De praestigiis daemonum) got no /q/ shortlink at all — the
// encoder packed exactly 12 bytes of ObjectId, and getShortUrl fell through to
// the long /book/<uuid>/page/<pageid> form. Shortlinks are what researchers
// cite, so those books were awkward to cite.
//
// The `u` + 25-char scheme must satisfy two things at once: round-trip UUIDs,
// and never disturb an already-published ObjectId code.

const UUIDS = [
  'bb7bfc2d-1234-4abc-89de-0123456789ab',
  'adad5f6d-0000-0000-0000-000000000000',
  '023f2b73-5a9f-4ada-92c2-258a408d89c2', // real: Barlaam and Josaphat
  '0b93ce97-9021-4eb7-9613-41b4ce1193b9', // real: Theatrum Chemicum vol. III
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '00000000-0000-0000-0000-000000000001', // leading zero bytes — the padding case
];

const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('UUID shortlink codes (#3940)', () => {
  it('round-trips every UUID / page combination', () => {
    for (const bookId of UUIDS) {
      for (const pageNumber of [1, 2, 145, 999, 65535]) {
        const code = encodeShortlink(bookId, pageNumber);
        expect(decodeShortlink(code)).toEqual({ bookId, pageNumber });
      }
    }
  });

  it('emits a fixed 26-char `u`-prefixed code, so the decoder can tell the schemes apart by shape', () => {
    for (const bookId of UUIDS) {
      const code = encodeShortlink(bookId, 1);
      expect(code).toHaveLength(26);
      expect(code.startsWith('u')).toBe(true);
    }
    // A leading-zero UUID is the one that would encode short without padding
    // and get decoded as a 14-byte ObjectId code.
    expect(encodeShortlink('00000000-0000-0000-0000-000000000001', 1)).toHaveLength(26);
  });

  it('never produces a code an ObjectId code could collide with', () => {
    // 14 bytes < 62^19, so ObjectId codes top out at 19 chars.
    for (const pageNumber of [1, 42, 65535]) {
      expect(encodeShortlink(OBJECT_ID, pageNumber).length).toBeLessThanOrEqual(19);
    }
    expect(encodeShortlink('ffffffffffffffffffffffff', 65535).length).toBeLessThanOrEqual(19);
  });

  it('leaves published ObjectId codes decoding exactly as before', () => {
    // Codes hardcoded in /about and the blog posts — these are live citations.
    expect(decodeShortlink('BhIfljO2ApigrcHcTeD')).toEqual({
      bookId: '69b21d42ddb4fa7c305b4693',
      pageNumber: 145,
    });
    expect(encodeShortlink('69b21d42ddb4fa7c305b4693', 145)).toBe('BhIfljO2ApigrcHcTeD');
  });

  it('normalises uppercase input on both id formats', () => {
    expect(encodeShortlink('BB7BFC2D-1234-4ABC-89DE-0123456789AB', 3)).toBe(
      encodeShortlink('bb7bfc2d-1234-4abc-89de-0123456789ab', 3)
    );
    expect(encodeShortlink(OBJECT_ID.toUpperCase(), 3)).toBe(encodeShortlink(OBJECT_ID, 3));
  });

  it('rejects ids neither scheme can encode, and unencodable page numbers', () => {
    expect(() => encodeShortlink('not-an-id', 1)).toThrow();
    expect(() => encodeShortlink('bb7bfc2d1234-4abc-89de-0123456789ab', 1)).toThrow();
    expect(() => encodeShortlink(UUIDS[0], 0)).toThrow();
    expect(() => encodeShortlink(UUIDS[0], 65536)).toThrow();
    expect(() => encodeShortlink(UUIDS[0], 1.5)).toThrow();
  });
});

describe('getShortUrl (#3940)', () => {
  it('now returns a /q/ shortlink for UUID books instead of the long form', () => {
    const url = getShortUrl(UUIDS[0], 5, '69d397024e8896250fd674bf');
    expect(url).toBe(`https://sourcelibrary.org/q/${encodeShortlink(UUIDS[0], 5)}`);
  });

  it('still shortlinks ObjectId books and honours a tenant base URL', () => {
    expect(getShortUrl(OBJECT_ID, 5, undefined, 'https://bph.sourcelibrary.org/')).toBe(
      `https://bph.sourcelibrary.org/q/${encodeShortlink(OBJECT_ID, 5)}`
    );
  });

  it('falls back to the long URL only for ids or page numbers no scheme covers', () => {
    expect(getShortUrl('legacy-slug-id', 5, 'pageid')).toBe(
      'https://sourcelibrary.org/book/legacy-slug-id/page/pageid'
    );
    expect(getShortUrl('legacy-slug-id', 5)).toBe(
      'https://sourcelibrary.org/book/legacy-slug-id#page-5'
    );
    // Out-of-range page: must fall back rather than throw at the call site.
    expect(getShortUrl(UUIDS[0], 70000, 'pageid')).toBe(
      `https://sourcelibrary.org/book/${UUIDS[0]}/page/pageid`
    );
  });
});

/**
 * The public decoder (#8150 slice 1): verified marks show their note,
 * unverified marks never echo their text, clean text reports nothing.
 */
import { describe, it, expect } from 'vitest';
import { imprimatur, verifyProvenance } from '@/lib/steganographia';
import { decodePastedText, bookIdFromColophon } from '@/lib/mark-decoder';

const KEY = 'test-provenance-secret-key';
const verify = (t: string) => verifyProvenance(t, KEY);
const SAMPLE =
  'Mercury rises from the earth. The philosophers call it the prime matter. ' +
  'It is volatile and fixed at once! What then is the stone? Consider the work of the sun and moon.';
const NOTE = 'Source Library · sourcelibrary.org/book/69779625b58638948b30281e · CC BY-SA 4.0';

describe('decodePastedText', () => {
  it('reports no mark on clean text', () => {
    expect(decodePastedText(SAMPLE, verify)).toEqual({ status: 'none', zeroWidth: 0, editionId: null, message: null, bookId: null, signedReference: false });
  });

  it('verifies a genuine mark and returns its note and book', () => {
    const r = decodePastedText(imprimatur(SAMPLE, '69779625', KEY, { message: NOTE }), verify);
    expect(r.status).toBe('authentic');
    expect(r.editionId).toBe('69779625');
    expect(r.message).toBe(NOTE);
    expect(r.bookId).toBe('69779625b58638948b30281e');
    expect(r.zeroWidth).toBeGreaterThan(100);
  });

  it('verifies a light id-only mark with no note', () => {
    const r = decodePastedText(imprimatur(SAMPLE, '69779625', KEY), verify);
    expect(r).toMatchObject({ status: 'authentic', editionId: '69779625', message: null, bookId: null });
  });

  it('never echoes the text of a mark that does not verify', () => {
    const forged = imprimatur(SAMPLE, '69779625', 'someone-elses-key', { message: 'Words we never wrote' });
    const r = decodePastedText(forged, verify);
    expect(r.status).toBe('unverified');
    expect(r.message).toBeNull();
    expect(r.editionId).toBeNull();
    expect(JSON.stringify(r)).not.toContain('never wrote');
  });

  it('treats stray zero-width characters as no mark', () => {
    const r = decodePastedText('A word​with a stray space.', verify);
    expect(r.status).toBe('none');
    expect(r.zeroWidth).toBe(1);
  });

  it('reports unconfigured when the server has no key', () => {
    expect(decodePastedText(imprimatur(SAMPLE, '69779625', KEY), () => null).status).toBe('unconfigured');
  });
});

describe('bookIdFromColophon', () => {
  it('reads the book address from both colophon forms', () => {
    expect(bookIdFromColophon(NOTE)).toBe('69779625b58638948b30281e');
    expect(bookIdFromColophon('You found a hidden mark. Read the original at sourcelibrary.org/book/abc123. CC BY-SA 4.0.')).toBe('abc123');
    expect(bookIdFromColophon(null)).toBeNull();
    expect(bookIdFromColophon('no address here')).toBeNull();
  });
});

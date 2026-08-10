import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { djb2Hash, isRomanizationCurrent, romanizedForQuote } from '@/lib/romanization';

/**
 * The romanized layer of a quote (#3828).
 *
 * A Greek page quoted as three layers — original, romanization, translation —
 * only works if the middle layer is a romanization of the SAME words as the
 * top one. `pages.transliteration.source_ocr_hash` is what makes that
 * checkable, and it is written by two different hash functions across the
 * writers (djb2 in the transliterate routes / orchestrator / batch script,
 * md5 in scripts/workers/transliterate-greek.mjs), so the reader has to
 * recognize both shapes and fail open on anything else.
 */
describe('romanizedForQuote', () => {
  const OCR = 'Ἐν ἀρχῇ ἦν ὁ λόγος';
  const ROMAN = 'En archē ēn ho logos';

  const page = (t: Record<string, unknown> | undefined, ocr = OCR) =>
    ({ ocr: { data: ocr }, transliteration: t }) as Parameters<typeof romanizedForQuote>[0];

  it('serves a romanization whose djb2 hash matches the current OCR', () => {
    expect(romanizedForQuote(page({ data: ROMAN, source_ocr_hash: djb2Hash(OCR) }))).toBe(ROMAN);
  });

  it('serves a romanization whose md5 hash matches (transliterate-greek.mjs writer)', () => {
    const md5 = createHash('md5').update(OCR).digest('hex');
    expect(romanizedForQuote(page({ data: ROMAN, source_ocr_hash: md5 }))).toBe(ROMAN);
  });

  it('omits a romanization that is stale against re-OCR\'d text', () => {
    // The page was re-OCR'd after transliteration: the stored romanization
    // spells words no longer printed on the page we are about to serve.
    const stale = { data: ROMAN, source_ocr_hash: djb2Hash('completely different text') };
    expect(romanizedForQuote(page(stale))).toBeUndefined();
  });

  it('fails open when no hash was stored', () => {
    expect(romanizedForQuote(page({ data: ROMAN }))).toBe(ROMAN);
  });

  it('returns undefined when absent or blank', () => {
    expect(romanizedForQuote(page(undefined))).toBeUndefined();
    expect(romanizedForQuote(page({ data: '' }))).toBeUndefined();
    expect(romanizedForQuote(page({ data: '   \n ' }))).toBeUndefined();
  });

  it('strips editorial wrappers — a romanized <meta> block is still not source text', () => {
    // The romanization is produced from raw ocr.data, envelope and all, so the
    // OCR page-metadata envelope can arrive romanized. Serving it would quote
    // words that are not on the page (the #2232 misquote class).
    const withEnvelope = `<language>Greek</language>\n<scan-quality>good</scan-quality>\n${ROMAN}`;
    expect(romanizedForQuote(page({ data: withEnvelope }))).toBe(ROMAN);
  });

  it('treats an unrecognized hash shape as unverifiable, not stale', () => {
    expect(isRomanizationCurrent('sha256:whatever-this-is', OCR)).toBe(true);
  });

  it('djb2Hash stays byte-identical to the writers\' copies', () => {
    // Same algorithm as scripts/workers/pipeline-orchestrator.mjs,
    // scripts/batch/batch-transliterate.mjs and the transliterate routes.
    const reference = (str: string) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return hash.toString(16);
    };
    for (const s of [OCR, ROMAN, '', 'a', 'ζ'.repeat(500)]) {
      expect(djb2Hash(s)).toBe(reference(s));
    }
  });
});

/**
 * The on-demand modernization lane (#4958).
 *
 * Modernization used to arrive two ways: this route, which a reader triggers, and
 * Phase 4, which generated an English "modernization" into `translation.data` for every
 * English book at any date. Making the reader-triggered lane the primary one means it
 * now carries protections it never needed as a side path — and this pins them:
 *
 *  - It must not spend on a page with nothing to modernize. That is Derek's rule for
 *    this feature: if the text is already modern English, the output should be the same
 *    text, so the honest thing is not to call the model at all.
 *  - It must pick the right source. A translated book modernizes its translation; an
 *    English edition has no translation and modernizes its transcription.
 *  - The two sources must not share a cache key, or re-running OCR would silently serve
 *    a modernization built from the translation, and vice versa.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveModernizationSource,
  readCachedModernization,
  wouldBeNoOp,
  isEnglishEdition,
  hashString,
} from '@/lib/modernize-page';

const archaic = 'Of the moſt excellent and vertuous vſe of this Arte, ' + 'and thereof much more to be ſaid '.repeat(3);
const modern = 'It is of interest to remark that this scheme was adopted as a means of ritual practice. ' + 'The argument continues at some length in the following chapter. '.repeat(3);

describe('isEnglishEdition', () => {
  it.each(['English', 'english', 'eng', 'en'])('accepts %s', (l) => expect(isEnglishEdition(l)).toBe(true));
  it.each(['Latin', 'Chinese', '', null, undefined])('rejects %s', (l) => expect(isEnglishEdition(l)).toBe(false));
});

describe('resolveModernizationSource', () => {
  it('modernizes the translation when there is one', () => {
    const r = resolveModernizationSource({ translation: { data: 'a translation' }, ocr: { data: 'the scan' } }, { language: 'Latin' });
    expect(r).toEqual({ text: 'a translation', source: 'translation' });
  });

  it('modernizes the transcription for an English edition with no translation', () => {
    const r = resolveModernizationSource({ ocr: { data: archaic } }, { language: 'English' });
    expect(r).toEqual({ text: archaic, source: 'ocr' });
  });

  it('prefers an existing translation even on an English book', () => {
    // English books whose `translation.data` is a modernization the pipeline wrote
    // before #4958 must keep rendering exactly as they do now, not switch source.
    const r = resolveModernizationSource(
      { translation: { data: 'the pipeline modernization' }, ocr: { data: archaic } },
      { language: 'English' },
    );
    expect(r?.source).toBe('translation');
  });

  it('refuses a non-English book with no translation', () => {
    expect(resolveModernizationSource({ ocr: { data: 'lateinischer Text' } }, { language: 'German' })).toBeNull();
  });

  it('refuses a page with no text at all', () => {
    expect(resolveModernizationSource({}, { language: 'English' })).toBeNull();
  });
});

describe('wouldBeNoOp', () => {
  it('refuses to spend on transcription that is already modern', () => {
    expect(wouldBeNoOp(modern, 'ocr')).toBe(true);
  });

  it('allows genuinely archaic transcription through', () => {
    expect(wouldBeNoOp(archaic, 'ocr')).toBe(false);
  });

  it('never blocks the translation lane — smoothing a stiff translation is not about orthography', () => {
    expect(wouldBeNoOp(modern, 'translation')).toBe(false);
  });
});

describe('readCachedModernization', () => {
  const hash = hashString(archaic);

  it('serves a cache whose source hash matches', () => {
    const page = { modernized: { data: 'modern text', source_ocr_hash: hash } };
    expect(readCachedModernization(page, hash, 'ocr')).toBe('modern text');
  });

  it('misses when the source changed underneath it', () => {
    const page = { modernized: { data: 'modern text', source_ocr_hash: 'stale' } };
    expect(readCachedModernization(page, hash, 'ocr')).toBeNull();
  });

  it('does not cross the two sources', () => {
    // A modernization built from the translation must never be served as though it came
    // from the transcription — different text, different provenance.
    const page = { modernized: { data: 'from the translation', source_translation_hash: hash } };
    expect(readCachedModernization(page, hash, 'ocr')).toBeNull();
    expect(readCachedModernization(page, hash, 'translation')).toBe('from the translation');
  });

  it('misses when there is no modernization at all', () => {
    expect(readCachedModernization({}, hash, 'ocr')).toBeNull();
  });
});

/**
 * Positive controls for the batch-continuity A/B (PREREGISTRATION-translation-batch-continuity.md).
 *
 * The experiment's risk is a clean-looking null from an inert probe. So each
 * instrument is shown a case where it MUST fire and one where it must not:
 * the H1 terminology scorer, the seam filter that keeps the draw mid-flow, and
 * the prompt builder that is the only thing the three arms differ by.
 */
import { describe, it, expect } from 'vitest';
import {
  committedTerms, terminologyConsistency, assessSeam, blockPrompt, parseBlock,
} from '../../scripts/eval/translation-batch-continuity-ab.mjs';

const PREV = [
  'The work begins with the first matter <term>materia prima</term> <gloss>first matter</gloss>, which <term>Hermes</term> calls the stone.',
  'Then follows <term>calcinatio</term> <gloss>calcination/burning to ash</gloss> of the body.',
];
const NEXT_OCR = 'Materia prima iterum solvitur, et calcinatio repetitur donec Hermes taceat. Nihil de sublimatione.';

describe('H1 terminology consistency', () => {
  const terms = committedTerms(PREV);

  it('keeps only terms whose source form recurs across the boundary', () => {
    expect(terms.map((t) => t.key).sort()).toEqual(['calcinatio', 'hermes', 'materia prima']);
    const r = terminologyConsistency(terms, 'Nihil nisi sublimatio.', 'Nothing but sublimation.');
    expect(r.eligible).toBe(0);
    expect(r.rate).toBeNull(); // no eligible term is NOT a 0% — the boundary is excluded, not failed
  });

  it('scores a continuation that keeps the renderings as consistent', () => {
    const r = terminologyConsistency(terms, NEXT_OCR, 'The first matter is dissolved again, and the calcination repeated until Hermes falls silent.');
    expect(r).toMatchObject({ eligible: 3, consistent: 3, rate: 1 });
  });

  it('FIRES on a continuation that re-renders the same terms differently', () => {
    const r = terminologyConsistency(terms, NEXT_OCR, 'The primal stuff is dissolved again, and the roasting repeated until Mercurius Trismegistus falls silent.');
    expect(r).toMatchObject({ eligible: 3, consistent: 0, rate: 0 });
  });

  it('accepts any one of the alternatives a gloss offered', () => {
    const r = terminologyConsistency(terms, 'calcinatio', 'the burning to ash');
    expect(r).toMatchObject({ eligible: 1, consistent: 1 });
  });
});

describe('seam filter', () => {
  const prose = (tail: string) => ({ page_type: 'text', ocr: { data: `<page-num>12</page-num>${'Lorem ipsum dolor sit amet consectetur. '.repeat(12)}${tail}` } });

  it('passes a seam that ends mid-sentence and flags it', () => {
    expect(assessSeam(prose('et sic de singulis quae'), prose('sequuntur in ordine.'))).toMatchObject({ ok: true, midSentence: true });
  });
  it('passes a sentence-final seam inside running text, not flagged mid-sentence', () => {
    expect(assessSeam(prose('et sic finitur sententia.'), prose('Alia res est.'))).toMatchObject({ ok: true, midSentence: false });
  });
  it('rejects a section terminator', () => {
    expect(assessSeam(prose('Laus Deo. FINIS.'), prose('Alia res est.')).ok).toBe(false);
  });
  it('rejects a block that opens on a heading', () => {
    expect(assessSeam(prose('quae'), { page_type: 'text', ocr: { data: `CAPUT IV. De sale\n${'Lorem ipsum dolor sit amet. '.repeat(20)}` } }).ok).toBe(false);
  });
  it('rejects a plate and a near-empty page', () => {
    expect(assessSeam(prose('quae'), { ...prose('x'), page_type: 'illustration' }).ok).toBe(false);
    expect(assessSeam(prose('quae'), { page_type: 'text', ocr: { data: '<page-num>13</page-num> Fig. 3' } }).ok).toBe(false);
  });
});

describe('the arms differ by the seed and by nothing else', () => {
  const prompts = { translation: { text: 'Translate from {source_language}.', ref: { version: 13 } }, english: { text: 'Modernize.', ref: { version: 1 } } };
  const book = { title: 'De lapide', language: 'Latin', published: '1612' };
  const pages = [{ page_number: 9, ocr: 'Materia prima.' }, { page_number: 10, ocr: 'Calcinatio.' }];
  const a = blockPrompt(prompts, book, pages, { kind: 'translation', text: 'PRIOR-ENGLISH' }).prompt;
  const b = blockPrompt(prompts, book, pages, null).prompt;
  const c = blockPrompt(prompts, book, pages, { kind: 'source', text: 'PRIOR-LATIN' }).prompt;

  it('A carries production\'s seed wording, B none, C the source', () => {
    expect(a).toContain('**Previous page translation for continuity:**\nPRIOR-ENGLISH...');
    expect(b).not.toContain('for continuity');
    expect(c).toContain('PRIOR-LATIN');
    expect(c).not.toContain('PRIOR-ENGLISH');
  });
  it('removing the seed paragraph from A yields B exactly', () => {
    expect(a.replace('\n\n**Previous page translation for continuity:**\nPRIOR-ENGLISH...', '')).toBe(b);
  });
  it('parses a block response and falls back to position when the model renumbers', () => {
    const big = [{ page_number: 491, ocr: 'x'.repeat(50) }, { page_number: 492, ocr: 'y'.repeat(50) }];
    const out = parseBlock('<translation page="1">one</translation><translation page="2">two</translation>', big);
    expect([...out.entries()]).toEqual([[491, 'one'], [492, 'two']]);
  });
});

describe('seedSlice (--tail, #4968)', () => {
  it('head mode is production-before-#4970 byte for byte; tail mode is the end, editorial blocks off, marked in front', async () => {
    const { seedSlice } = await import('../../scripts/eval/translation-batch-continuity-ab.mjs');
    const text = 'START ' + 'x'.repeat(2500) + ' It is graver...<summary>s</summary>';
    expect(seedSlice(text, false)).toBe(text.slice(0, 2000) + '...');
    const tail = seedSlice(text, true);
    expect(tail.startsWith('...')).toBe(true);
    expect(tail.endsWith('It is graver...')).toBe(true);
    expect(tail).not.toContain('START');
    expect(tail).not.toContain('<summary>');
  });
});

describe('seedHybrid (--hybrid)', () => {
  it('equals production head mode on a short page; on a long page keeps head, tail and the summary block', async () => {
    const { seedHybrid } = await import('../../scripts/eval/translation-batch-continuity-ab.mjs');
    const short = 'Short page. It is graver...\n<summary>s</summary>';
    expect(seedHybrid(short)).toBe('Short page. It is graver...\n<summary>s</summary>...');
    const long = 'HEAD-CONVENTIONS ' + 'x'.repeat(2500) + ' It is graver...\n<summary>About it.</summary>\n<keywords>k</keywords>';
    const h = seedHybrid(long);
    expect(h.startsWith('HEAD-CONVENTIONS')).toBe(true);
    expect(h).toContain('[…]');
    expect(h).toContain('It is graver...');
    expect(h).toContain('<summary>About it.</summary>');
    expect(h.endsWith('...')).toBe(true);
    expect(h.length).toBeLessThan(2200);
  });
});

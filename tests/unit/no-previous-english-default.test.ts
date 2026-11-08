// #8399: no translation prompt carries the previous page's English unless TRANSLATE_PREVIOUS_ENGLISH=1.
// The model wrote that English out again as the page in front of it (#5026, #5274: 16,589 page pairs on the
// 2026-11-07 mirror). The neighbouring SOURCE still goes in. A test that pins the old context opts in itself.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTranslationPrompt, buildBlockTranslationPrompt, continuityContext } from '../../scripts/lib/translate-core.mjs';

const PREV = 'Suzanne having returned a few days later to learn from her cousin how she felt about her affairs, she makes her give an exact account of everything that passed between them in the garden that evening.';
const OCR = 'Fanchon. Ma cousine, je vous attendois avec impatience, car il me tardoit de vous raconter tout ce qui m’est arrivé depuis notre derniere conversation, et vous allez bien rire de mes avantures.';
const prompts = { translation: { text: 'Translate from {source_language} to {target_language}.', ref: { id: 't', name: 'Standard', version: 13, content_hash: 'h' } }, english: { text: 'Modernize.', ref: { id: 'e', name: 'English', version: 2, content_hash: 'h' } } } as any;
const book = { id: 'b', title: 'L’escole des filles', language: 'French' } as any;

describe('previous-page English is off by default (#8399)', () => {
  const saved = process.env.TRANSLATE_PREVIOUS_ENGLISH;
  beforeEach(() => { delete process.env.TRANSLATE_PREVIOUS_ENGLISH; });
  afterEach(() => { if (saved === undefined) delete process.env.TRANSLATE_PREVIOUS_ENGLISH; else process.env.TRANSLATE_PREVIOUS_ENGLISH = saved; });

  it('continuityContext returns nothing', () => {
    expect(continuityContext(PREV)).toBe('');
  });

  it('a single-page prompt does not contain the previous English', () => {
    const { prompt } = buildTranslationPrompt({ prompts, book, ocrText: OCR, previousTranslation: PREV });
    expect(prompt).not.toContain('Suzanne having returned');
    expect(prompt).toContain('Ma cousine');
  });

  it('a block prompt does not contain the previous English', () => {
    const pages = [{ page_number: 6, ocr: OCR }, { page_number: 7, ocr: OCR.replace('Fanchon', 'Suzanne') }];
    const { prompt } = buildBlockTranslationPrompt({ prompts, book, pages, previousTranslation: PREV });
    expect(prompt).not.toContain('Suzanne having returned');
  });

  it('TRANSLATE_PREVIOUS_ENGLISH=1 restores it', () => {
    process.env.TRANSLATE_PREVIOUS_ENGLISH = '1';
    expect(continuityContext(PREV)).toContain('Suzanne having returned');
  });
});

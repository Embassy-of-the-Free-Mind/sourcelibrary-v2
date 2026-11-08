import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isCollapsed, isRecited, sourceWeight, assessTranslationHealth } from '../../scripts/lib/translate-core.mjs';

// These tests pin the previous-page English context, which is opt-in since #8399.
const PREV_EN = process.env.TRANSLATE_PREVIOUS_ENGLISH;
beforeAll(() => { process.env.TRANSLATE_PREVIOUS_ENGLISH = '1'; });
afterAll(() => { if (PREV_EN === undefined) delete process.env.TRANSLATE_PREVIOUS_ENGLISH; else process.env.TRANSLATE_PREVIOUS_ENGLISH = PREV_EN; });


/**
 * The picture detector's `<detected-images>` JSON is not source text (#5274).
 *
 * Reconstructed from two pages of the #5274 context-bleed repair (2026-11-04): a marbled endpaper whose OCR is a
 * <meta> line and a detector block, and a botanical plate whose stored English was its neighbour's chapter.
 */
const DETECTOR = `<detected-images>
[{"description": "A full-page decorative marbled pattern known as a 'snail' or 'curl' pattern, featuring swirls of orange, yellow, and gray on a cream background.", "type": "decorative", "bbox": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}, "gallery_quality": 0.8, "museum_rationale": "This is a high-quality example of traditional bookbinding marbling, showcasing the craftsmanship involved in 18th and 19th-century book production."}]
</detected-images>`;

describe('detected-images block is not source', () => {
  it('a one-note English on a marbled endpaper is not a collapse', () => {
    const ocr = `<lang>None</lang>\n<meta>This image contains a decorative marbled paper endpaper with no text to transcribe.</meta>\n${DETECTOR}`;
    const en = `<note>A full-page decorative marbled pattern in orange, yellow and gray.</note>\n<summary>A marbled endpaper.</summary>`;
    expect(isCollapsed(ocr, en)).toBe(false);
    expect(assessTranslationHealth(ocr, en).reason).not.toBe('collapsed');
  });

  it('a plate whose English is a neighbour chapter is recited, however large the detector block', () => {
    const ocr = `Tab. LXXII.\n${DETECTOR.repeat(3)}`;
    const en = 'The seventy-ninth chapter. This tree grows on the shores of Amboina and is called by the natives. '.repeat(12);
    expect(sourceWeight(ocr)).toBeLessThan(40);
    expect(isRecited(ocr, en)).toBe(true);
  });

  it('a real text page with a detector block is untouched', () => {
    const body = 'Quod si quis dicat naturam nihil agere frustra, respondemus. '.repeat(20);
    const en = 'If anyone says that nature does nothing in vain, we reply. '.repeat(20);
    expect(isCollapsed(`${body}\n${DETECTOR}`, en)).toBe(false);
    expect(isRecited(`${body}\n${DETECTOR}`, en)).toBe(false);
  });
});

describe('a nearly empty leaf gets no previous-page English (#5274)', async () => {
  const { buildTranslationPrompt } = await import('../../scripts/lib/translate-core.mjs');
  const prompts = { translation: { text: 'Translate from {source_language} to {target_language}.', ref: { id: 't', name: 'Standard', version: 13, content_hash: 'h' } }, english: { text: 'Modernize.', ref: { id: 'e', name: 'English', version: 2, content_hash: 'h' } } };
  const book = { title: 'Herbarium Amboinense', language: 'Latin' };
  const prev = 'CHAPTER LXXIX. The Sagu tree grows on the shores of Amboina, and the natives call it. '.repeat(10);
  it('a plate caption: no continuity block', () => {
    const r = buildTranslationPrompt({ prompts, book, ocrText: `Tab. LXXII.\n${DETECTOR}`, previousTranslation: prev });
    expect(r.prompt).not.toContain('Sagu tree');
    expect(r.context_dropped).toBe(true);
  });
  it('a text page: the continuity block stays', () => {
    const r = buildTranslationPrompt({ prompts, book, ocrText: 'Quod si quis dicat naturam nihil agere frustra, respondemus. '.repeat(10), previousTranslation: prev });
    expect(r.prompt).toContain('Sagu tree');
    expect(r.context_dropped).toBe(false);
  });
});

describe('the app lane (src/lib/ai.ts) keeps the same nearly-empty line', async () => {
  const { isNearlyEmptySource } = await import('../../src/lib/ai');
  const { sourceWeight, RECITED_SOURCE_MAX, buildBlockTranslationPrompt } = await import('../../scripts/lib/translate-core.mjs');
  const cases = [
    `Tab. LXXII.\n${DETECTOR}`, '', '<meta>blank</meta>', '圖'.repeat(18), '圖'.repeat(19), 'a'.repeat(299), 'a'.repeat(300),
    `->**TITLE**<-\n${'&nbsp;'.repeat(50)}\n${'.'.repeat(80)}`, 'Quod si quis dicat naturam nihil agere frustra. '.repeat(8),
  ];
  it.each(cases.map((c, i) => [i, c]))('case %i agrees with sourceWeight', (_i, c) => {
    expect(isNearlyEmptySource(c)).toBe(sourceWeight(c) < RECITED_SOURCE_MAX);
  });
  it('a one-page block call on a plate gets no previous English', () => {
    const prompts = { translation: { text: 'Translate from {source_language} to {target_language}.', ref: { id: 't', name: 'Standard', version: 13, content_hash: 'h' } }, english: { text: 'Modernize.', ref: { id: 'e', name: 'English', version: 2, content_hash: 'h' } } };
    const r = buildBlockTranslationPrompt({ prompts, book: { title: 'T', language: 'Latin' }, pages: [{ page_number: 5, ocr: `Tab. LXXII.\n${DETECTOR}` }], previousTranslation: 'The Sagu tree grows on Amboina. '.repeat(20) });
    expect(r.prompt).not.toContain('Sagu tree');
  });
});

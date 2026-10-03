/**
 * Folio markers in continuous English (#5678): scripts/lib/folio-markers.mjs and the flag in the
 * block lane (translate-core buildBlockTranslationPrompt `folioMarkers`, translate-batch-seam
 * TRANSLATE_FOLIO_MARKERS).
 *
 * What must hold:
 *   - flag OFF: the block prompt and the block parse are byte-identical to before (production);
 *   - flag ON: the prompt asks for one continuous text with a <pb n="N"/> per page, and the parse
 *     gives each page its own span;
 *   - the parser splits a continuous text into page spans plus the carried head and tail, and a
 *     missing or duplicated marker never hands a page its neighbour's words.
 */
import { describe, it, expect, afterEach } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseFolioMarkedText, trailingFragment, leadingFragment, endsSentence } from '../../scripts/lib/folio-markers.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { buildBlockTranslationPrompt, LEAF_BREAK_ONLY, FOLIO_MARKER_RULE } from '../../scripts/lib/translate-core.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { blockPrompt, parseBlockResponse, folioMarkersEnabled } from '../../scripts/lib/translate-batch-seam.mjs';

const prompts = {
  translation: { text: 'Translate {source_language} to {target_language}.', ref: { id: 'p', name: 'Standard', version: 13 } },
  english: { text: 'Modernize.', ref: { id: 'e', name: 'English', version: 1 } },
};
const book = { title: 'Derge Tengyur, vol. 96', language: 'Tibetan', year: 1982 };
const src = 'ཀ་ཁ་ག་ང་། '.repeat(30);
const pages = [34, 35, 36].map((n) => ({ page_number: n, ocr: { data: `${src}${n}` } }));

describe('flag off: production unchanged', () => {
  const saved = process.env.TRANSLATE_FOLIO_MARKERS;
  afterEach(() => { if (saved === undefined) delete process.env.TRANSLATE_FOLIO_MARKERS; else process.env.TRANSLATE_FOLIO_MARKERS = saved; });

  it('the flag reads only TRANSLATE_FOLIO_MARKERS=1', () => {
    expect(folioMarkersEnabled({})).toBe(false);
    expect(folioMarkersEnabled({ TRANSLATE_FOLIO_MARKERS: 'true' })).toBe(false);
    expect(folioMarkersEnabled({ TRANSLATE_FOLIO_MARKERS: '1' })).toBe(true);
  });

  it('the block prompt is the per-page prompt, byte for byte', () => {
    delete process.env.TRANSLATE_FOLIO_MARKERS;
    const before = buildBlockTranslationPrompt({ prompts, book, pages, pageBreak: LEAF_BREAK_ONLY }).prompt;
    expect(blockPrompt({ prompts, book, pages }).prompt).toBe(before);
    expect(buildBlockTranslationPrompt({ prompts, book, pages, pageBreak: LEAF_BREAK_ONLY, folioMarkers: false }).prompt).toBe(before);
    expect(before).toContain('Translate each one separately. Wrap each translation in XML tags with the page number:');
    expect(before).toContain('<translation page="35">...translated text...</translation>');
    expect(before).not.toContain('<pb');
  });

  it('the parse is the per-page parse', () => {
    delete process.env.TRANSLATE_FOLIO_MARKERS;
    const long = 'word '.repeat(40).trim();
    const resp = pages.map((p) => `<translation page="${p.page_number}">${long} ${p.page_number}.</translation>`).join('\n');
    const out = parseBlockResponse(resp, pages);
    expect([...out.keys()]).toEqual([34, 35, 36]);
    expect(out.get(35)).toBe(`${long} 35.`);
  });
});

describe('flag on', () => {
  it('asks for one continuous text with a marker per page', () => {
    const { prompt } = blockPrompt({ prompts, book, pages, folioMarkers: true });
    expect(prompt).toContain(FOLIO_MARKER_RULE);
    expect(prompt).toContain('<pb n="34"/>...translated text of page 34... <pb n="35"/>');
    expect(prompt).not.toContain('Translate each one separately');
    // the source pages are still labelled one by one
    expect(prompt).toContain('--- Page 35 ---');
  });

  it('a single page is never asked for markers', () => {
    const one = [pages[0]];
    expect(blockPrompt({ prompts, book, pages: one, folioMarkers: true }).prompt).toBe(blockPrompt({ prompts, book, pages: one, folioMarkers: false }).prompt);
  });

  it('parses each page to its own span, and leaves a page with no marker undrafted', () => {
    const resp = '<translation><pb n="34"/>The self is not the aggregates, <pb n="35"/>nor other than them. <pb n="36"/>Thus it is taught.</translation><summary>s</summary>';
    const out = parseBlockResponse(resp, pages, { folioMarkers: true });
    expect(out.get(34)).toBe('The self is not the aggregates,');
    expect(out.get(35)).toBe('nor other than them.');
    expect(out.get(36)).toBe('Thus it is taught.');
    const gap = parseBlockResponse('<translation><pb n="34"/>A, b. <pb n="36"/>C.</translation>', pages, { folioMarkers: true });
    expect(gap.has(35)).toBe(false);
    expect(gap.get(34)).toBe('A, b.');
  });
});

describe('parseFolioMarkedText', () => {
  const text = `<translation>
<pb n="34"/>If the self were the aggregates, it would arise and perish. If it were other than the aggregates, it would lack their marks. The appropriator is not the <pb n="35"/>appropriated; how then could it be the self? <note>MMK 27</note> Apart from the appropriated there is no self.
<pb n="36"/>So it has been shown.
</translation>
<summary>The self and the aggregates.</summary>
<keywords>self, aggregates</keywords>`;

  it('splits into page spans and strips the editorial blocks', () => {
    const r = parseFolioMarkedText(text, [34, 35, 36]);
    expect(r.missing).toEqual([]);
    expect(r.duplicated).toEqual([]);
    expect(r.outOfOrder).toBe(false);
    expect(r.leading).toBe('');
    expect(r.continuous).not.toContain('<summary>');
    expect(r.pages.map((p: { span: string }) => p.span)).toEqual([
      'If the self were the aggregates, it would arise and perish. If it were other than the aggregates, it would lack their marks. The appropriator is not the',
      'appropriated; how then could it be the self? <note>MMK 27</note> Apart from the appropriated there is no self.',
      'So it has been shown.',
    ]);
  });

  it('carries the head from the page before and the tail onto the page after, only across a mid-sentence turn', () => {
    const [p34, p35, p36] = parseFolioMarkedText(text, [34, 35, 36]).pages;
    expect(p34.head).toBe('');
    expect(p34.tail).toBe('appropriated; how then could it be the self?');
    expect(p35.head).toBe('The appropriator is not the');
    expect(p35.tail).toBe('');          // 35 ends on a full stop
    expect(p36.head).toBe('');
  });

  it('reports marker positions as offsets in the marker-free text', () => {
    const r = parseFolioMarkedText('<pb n="1"/>abcd <pb n="2"/>efgh', [1, 2]);
    expect(r.pages[0].marker_offset).toBe(0);
    expect(r.pages[1].marker_offset).toBe(5);
    expect(r.pages[1].marker_fraction).toBeCloseTo(5 / 9);
  });

  it('flags missing, duplicated, unexpected and out-of-order markers instead of guessing', () => {
    const r = parseFolioMarkedText('<pb n="2"/>B. <pb n="1"/>A. <pb n="2"/>B again. <pb n="9"/>Z.', [1, 2, 3]);
    expect(r.missing).toEqual([3]);
    expect(r.duplicated).toEqual([2]);
    expect(r.unexpected).toEqual([9]);
    expect(r.outOfOrder).toBe(true);
    expect(r.pages[2].span).toBe('');
    expect(r.pages[2].marker_fraction).toBeNull();
  });

  it('sentence helpers', () => {
    expect(endsSentence('He went home.')).toBe(true);
    expect(endsSentence('He went <note>x</note>')).toBe(false);
    expect(trailingFragment('One. Two, and')).toBe('Two, and');
    expect(trailingFragment('One. Two.')).toBe('');
    expect(leadingFragment('three. Four.')).toBe('three.');
    expect(leadingFragment('no end here')).toBe('no end here');
  });
});

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
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseFolioMarkedText, trailingFragment, leadingFragment, endsSentence } from '../../scripts/lib/folio-markers.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { buildBlockTranslationPrompt, LEAF_BREAK_ONLY, FOLIO_MARKER_RULE } from '../../scripts/lib/translate-core.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { blockPrompt, parseBlockResponse, folioMarkersEnabled } from '../../scripts/lib/translate-batch-seam.mjs';

const ROOT = path.resolve(__dirname, '../..');

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
    // 35 unmarked: 34's span ran on over 35's English, so neither is drafted; 36 is
    const gap = parseBlockResponse('<translation><pb n="34"/>A, b. <pb n="36"/>C.</translation>', pages, { folioMarkers: true });
    expect(gap.has(35)).toBe(false);
    expect(gap.has(34)).toBe(false);
    expect(gap.get(36)).toBe('C.');
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

  it('rejects a block with more markers than pages, and still reports what the numbers said', () => {
    const r = parseFolioMarkedText('<pb n="2"/>B. <pb n="1"/>A. <pb n="2"/>B again. <pb n="9"/>Z.', [1, 2, 3]);
    expect(r.reading).toBe('rejected');
    expect(r.rejected).toMatch(/4 marker\(s\) for 3 page/);
    expect(r.missing).toEqual([1, 2, 3]);
    expect(r.duplicated).toEqual([2]);
    expect(r.unexpected).toEqual([9]);
    expect(r.outOfOrder).toBe(true);
    expect(r.pages.every((p: { span: string; marker_fraction: number | null }) => p.span === '' && p.marker_fraction === null)).toBe(true);
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

describe('positional reading (#5678 seam A/B, PR #5701): marker ORDER, not the n value', () => {
  it('reads a marker numbered by the printed page (<page-num>) as the k-th page start', () => {
    const r = parseFolioMarkedText('<translation><pb n="97"/>He came to the city, <pb n="98"/>and there he stayed.</translation>', [21, 22]);
    expect(r.reading).toBe('renumbered');
    expect(r.unexpected).toEqual([97, 98]);
    expect(r.missing).toEqual([]);
    expect(r.pages.map((p: { span: string }) => p.span)).toEqual(['He came to the city,', 'and there he stayed.']);
    expect(r.pages[0].head).toBe('');
    expect(r.pages[1].head).toBe('He came to the city,');
  });

  it('reads a missing opening marker as the first page starting at offset 0', () => {
    const r = parseFolioMarkedText('<translation>He came to the city, <pb n="10"/>and there he stayed.</translation>', [9, 10]);
    expect(r.reading).toBe('opener-missing');
    expect(r.missing).toEqual([]);
    expect(r.pages[0]).toMatchObject({ span: 'He came to the city,', marker_offset: 0, marker_fraction: 0 });
    expect(r.pages[1].span).toBe('and there he stayed.');
    expect(r.pages[1].marker_offset).toBe('He came to the city, '.length);
  });

  it('the opener-missing reading ignores the one marker\'s number too', () => {
    const r = parseFolioMarkedText('He came to the city, <pb n="17"/>and there he stayed.', [18, 19]);
    expect(r.reading).toBe('opener-missing');
    expect(r.pages.map((p: { span: string }) => p.span)).toEqual(['He came to the city,', 'and there he stayed.']);
  });

  it('text before a full set of markers joins the first page instead of being dropped', () => {
    const r = parseFolioMarkedText('into the lower parts of the earth. <pb n="17"/>Corollaries. <pb n="18"/>Fourth.', [17, 18]);
    expect(r.reading).toBe('renumbered');
    expect(r.pages[0].span).toBe('into the lower parts of the earth. Corollaries.');
    expect(r.pages[0].marker_offset).toBe(0);
  });

  it('a lead of tags only is not text', () => {
    const r = parseFolioMarkedText('<translation><translation><pb n="5"/>A. <pb n="6"/>B.</translation>', [5, 6]);
    expect(r.reading).toBe('literal');
  });

  it('a page the sequence numbers name as unmarked is left empty (Tengyur vol 96 p123)', () => {
    const r = parseFolioMarkedText('<pb n="121"/>A. <pb n="122"/>B, and C. <pb n="124"/>D.', [121, 122, 123, 124]);
    expect(r.reading).toBe('partial');
    expect(r.missing).toEqual([123]);
    expect(r.overrun).toEqual([122]);   // 122's span holds 123's English too
    expect(r.pages.map((p: { span: string }) => p.span)).toEqual(['A.', 'B, and C.', '', 'D.']);
  });

  it('rejects too few markers when nothing says which turn is unmarked', () => {
    for (const text of ['<pb n="21"/>All of it.', '<pb n="97"/>A. <pb n="98"/>B.', 'No markers at all.']) {
      const r = parseFolioMarkedText(text, text.includes('97') ? [20, 21, 22] : [21, 22]);
      expect(r.reading === 'rejected' || r.reading === 'partial').toBe(true);
      expect(r.pages.some((p: { span: string }) => p.span === '')).toBe(true);
    }
    expect(parseFolioMarkedText('<pb n="97"/>A. <pb n="98"/>B.', [20, 21, 22]).reading).toBe('rejected');
    expect(parseFolioMarkedText('No markers at all.', [21, 22]).reading).toBe('rejected');
  });

  it('the block lane takes renumbered and opener-missing pages, and none from a rejected block', () => {
    const two = [{ page_number: 21, ocr: { data: 'x' } }, { page_number: 22, ocr: { data: 'y' } }];
    const ren = parseBlockResponse('<translation><pb n="97"/>He came, <pb n="98"/>and stayed.</translation>', two, { folioMarkers: true });
    expect([...ren.entries()]).toEqual([[21, 'He came,'], [22, 'and stayed.']]);
    const open = parseBlockResponse('<translation>He came, <pb n="22"/>and stayed.</translation>', two, { folioMarkers: true });
    expect([...open.entries()]).toEqual([[21, 'He came,'], [22, 'and stayed.']]);
    expect(parseBlockResponse('<pb n="1"/>a <pb n="2"/>b <pb n="3"/>c', two, { folioMarkers: true }).size).toBe(0);
  });
});

describe('fixtures: every seam-ab block the literal parse failed (scripts/eval/results/seam-ab-5678)', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/folio-markers/seam-ab-5678-positional.json'), 'utf8'));
  const raw = new Map(fs.readFileSync(path.join(ROOT, 'scripts/eval/results/seam-ab-5678/outputs.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((o) => [`${o.unit}|${o.arm}`, o.raw]));
  const sha = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);

  it('holds the 23 mis-numbered, 11 opener-missing and 1 unmarked blocks', () => {
    const n = (s: string) => fx.blocks.filter((b: { shape: string }) => b.shape === s).length;
    expect([n('mis-numbered'), n('opener-missing'), n('unmarked')]).toEqual([23, 11, 1]);
  });

  for (const b of fx.blocks) {
    it(`${b.arm} ${b.unit} (${b.shape}, markers ${b.markers.join(',')}) parses to the judged spans`, () => {
      const r = parseFolioMarkedText(raw.get(`${b.unit}|${b.arm}`), b.pages);
      if (b.shape === 'unmarked') {
        // a turn with no marker: one page empty, the page before it flagged as holding both
        expect(r.missing).toEqual([b.pages[1]]);
        expect(r.overrun).toEqual([b.pages[0]]);
        return;
      }
      expect(r.reading).toBe(b.shape === 'mis-numbered' ? 'renumbered' : 'opener-missing');
      expect(r.pages.map((p: { span: string }) => ({ sha256_16: sha(p.span), length: p.span.length })))
        .toEqual(b.expected.map((e: { sha256_16: string; length: number }) => ({ sha256_16: e.sha256_16, length: e.length })));
    });
  }
});

describe('fixtures: the Tengyur preview blocks (#5682) parse to the spans they were published with', () => {
  const dir = path.join(ROOT, 'scripts/eval/results/folio-markers-5678/blocks');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    it(f, () => {
      const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const r = parseFolioMarkedText(b.response, b.pages);
      expect(r.pages.map((p: { span: string }) => p.span)).toEqual(b.parsed.pages.map((p: { span: string }) => p.span));
      expect(r.missing).toEqual(b.parsed.missing);
    });
  }
});


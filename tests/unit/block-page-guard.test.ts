/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * Wrong-leaf pages at write time, one page at a time (#5021, scripts/lib/block-page-guard.mjs): the anchor, the
 * per-call absorption check and the single-page number vote, which every multi-page lane runs before it writes.
 *
 * Fixture: tests/fixtures/block-page-guard-5021.json (scripts/audit/block-page-guard-fixture-5021.mjs). Each page is
 * its first and last 60 OCR characters, its numbers and its length, never its whole text.
 *   controls  the four by-eye shifts (Karl, Corpus Medicorum, Postel, Śakuntalā), English as it stood before
 *             containment (--as-of);
 *   clean     20 windows of 4 pages per script family, each page's English written by a call of its own.
 * The "clean" windows are clean by write time, not read by eye. In this draw the guard refuses one page, read
 * against its source (2026-11-03): 6990630b p.510 (Zohar), whose English is its own leaf's: a false refusal, pinned.
 * An earlier draw (another seed; the experiment record) refused 11 of 560, of which 4 were real wrong-leaf pages
 * (69b62fb0 pp.407-409, 69b00f46 p.391). A false refusal costs one single-page call, never a wrong text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  stripAnchor, takeAnchors, anchorVerdicts, anchorFold, blockAbsorptions, blockNumberVotes, blockPageRefusals,
  ocrBlockRefusals, printedPageNumber, lengthRatioK, anchorRule,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/block-page-guard.mjs';
import {
  dropDriftedPages,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/block-drift.mjs';
import {
  parseBlockTranslations,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';

const F = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/block-page-guard-5021.json'), 'utf8'));
const pad = (x: any) => (x ? x[0] + ' ' + '~'.repeat(Math.max(0, x[1] - x[0].length - 1)) : '');
const page = (p: any) => ({ page_number: p.page_number, page_type: p.page_type, ocr: { data: pad(p.src) } });
/** The first and last 12 characters of a fixture page's text, as a model that copies them exactly would write them. */
const anchorOf = (p: any) => {
  const f = anchorFold(p.src[0]);
  return { first: f.slice(0, 12), last: f.slice(-12) };
};

describe('anchors', () => {
  it('come off a section, with the line they stood on', () => {
    const r = stripAnchor('<anchor-first>Quod si</anchor-first><anchor-last>finis est.</anchor-last>\n<meta>x</meta>\nBut if');
    expect(r.anchor).toEqual({ first: 'Quod si', last: 'finis est.' });
    expect(r.text).toBe('<meta>x</meta>\nBut if');
    const m = new Map([[3, '<anchor-first>a b c d e</anchor-first>\nText']]);
    expect(takeAnchors(m).get(3)).toEqual({ first: 'a b c d e', last: null });
    expect(m.get(3)).toBe('Text');
  });
  it('are taken off by the worker parser before the tags are sanitised (else the anchor is unwrapped into the English)', () => {
    const pages = [1, 2].map((n) => ({ page_number: n, ocr: { data: `Quidam liber pagina ${n} incipit hic et finitur ibi.` } }));
    const reply = pages.map((p) => `<translation page="${p.page_number}"><anchor-first>Quidamliberp</anchor-first><anchor-last>etfiniturib</anchor-last>\nA book, page ${p.page_number}, begins here and ends there.</translation>`).join('\n');
    const parsed = parseBlockTranslations(reply, pages);
    expect(parsed.translations.get(1)).not.toMatch(/Quidam|anchor/);
    expect(parsed.anchors.get(2).first).toBe('Quidamliberp');
  });
  it('the prompt rule names both tags', () => {
    expect(anchorRule([12, 13])).toMatch(/<anchor-first>FIRST<\/anchor-first><anchor-last>LAST<\/anchor-last>/);
  });
  it('fold drops metadata, marks, punctuation and spaces', () => {
    expect(anchorFold('<scan-quality>good</scan-quality>Ἐν ἀρχῇ, ἦν ὁ λόγος')).toBe('εναρχηηνολογος');
    expect(anchorFold('<language>Latin</language>x', { meta: true })).toBe('latinx');
  });
  const pages = ['Alpha beta gamma delta epsilon zeta eta theta.', 'Iota kappa lambda mu nu xi omicron pi rho.', 'Sigma tau upsilon phi chi psi omega finis.']
    .map((t, i) => ({ page_number: 10 + i, ocr: { data: t } }));
  const a = (t: string) => ({ first: t.replace(/\s/g, '').slice(0, 12), last: t.replace(/\s/g, '').slice(-12) });
  it('own, next, none, missing', () => {
    const own = new Map(pages.map((p) => [p.page_number, a(p.ocr.data)]));
    expect(anchorVerdicts(pages, own).map((v: any) => v.verdict)).toEqual(['own', 'own', 'own']);
    const slid = new Map([[10, a(pages[1].ocr.data)], [11, a(pages[2].ocr.data)], [12, { first: 'Zzzzzzzzzzz', last: 'Qqqqqqqqqq' }]]);
    expect(anchorVerdicts(pages, slid).map((v: any) => v.verdict)).toEqual(['next', 'next', 'none']);
    expect(anchorVerdicts(pages, new Map([[10, { first: '', last: '' }]]))[0].verdict).toBe('missing');
  });
  it('an empty anchor on a page with no text passes', () => {
    const blank = [{ page_number: 1, ocr: { data: '<image-desc>A decorative border.</image-desc>' } }, { page_number: 2, ocr: { data: 'Real text on this page here.' } }];
    expect(anchorVerdicts(blank, new Map([[1, { first: '', last: '' }], [2, a(blank[1].ocr.data)]])).map((v: any) => v.verdict)).toEqual(['own', 'own']);
  });
  it('an anchor copied from an illegible page\'s metadata matches that page', () => {
    const ill = [1, 2].map((n) => ({ page_number: n, ocr: { data: `<scan-quality>poor</scan-quality><language>Latin</language><script>handwritten</script>\nThe image is dark ${n === 1 ? 'everywhere' : 'at the foot'}.` } }));
    expect(anchorVerdicts(ill, new Map(ill.map((p) => [p.page_number, { first: 'poorLatinhan', last: n2(p.page_number) }]))).map((v: any) => v.verdict)).toEqual(['own', 'own']);
    function n2(n: number) { return n === 1 ? 'everywhere.' : 'atthefoot.'; }
  });
});

describe('the four by-eye controls (English as it stood before containment)', () => {
  // Alignments of `size` pages that hold a shifted page, and how many the guard catches on a shifted page.
  const run = (c: any, size: number, anchors = false) => {
    const k = lengthRatioK(c.pages.filter((p: any) => p.en).map((p: any) => ({ src: pad(p.src), en: pad(p.en), type: p.page_type })), { min: 5 });
    let caught = 0, al = 0;
    for (let s = 0; s + size <= c.pages.length; s++) {
      const w = c.pages.slice(s, s + size);
      if (!w.some((p: any) => c.shifted.includes(p.page_number))) continue;
      al++;
      const tr = new Map(w.filter((p: any) => p.en).map((p: any) => [p.page_number, pad(p.en)]));
      // With anchors: a model that copies each page's anchor from the leaf it actually translated (the next one).
      const an = anchors ? new Map(w.map((p: any) => { const src = c.shifted.includes(p.page_number) ? c.pages[c.pages.indexOf(p) + 1] || p : p; return [p.page_number, anchorOf(src)]; })) : null;
      const r = blockPageRefusals(w.map(page), tr, { anchors: an, prevOcr: c.pages[s - 1] ? pad(c.pages[s - 1].src) : null, nextOcr: c.pages[s + size] ? pad(c.pages[s + size].src) : null, k });
      if (r.some((x: any) => c.shifted.includes(x.page_number))) caught++;
    }
    return { caught, al };
  };
  it('Karl and Śakuntalā: every 4- and 8-page alignment is caught by numbers and lengths alone', () => {
    for (const k of ['karl', 'sakuntala']) for (const size of [4, 8]) { const r = run(F.controls[k], size); expect(r.caught, `${k} @${size}`).toBe(r.al); }
  });
  it('Corpus Medicorum and Postel: caught in most 8-page alignments without anchors', () => {
    expect(run(F.controls['corpus-medicorum'], 8).caught).toBe(2);
    expect(run(F.controls.postel, 8).caught).toBeGreaterThanOrEqual(3);
  });
  it('with anchors that follow the text, every alignment of every control is caught, at 2, 4 and 8 pages', () => {
    for (const k of Object.keys(F.controls)) for (const size of [2, 4, 8]) { const r = run(F.controls[k], size, true); expect(r.caught, `${k} @${size}`).toBe(r.al); }
  });
});

describe('caseless scripts: a synthetic one-leaf slide in Chinese and in Tibetan', () => {
  for (const fam of ['han', 'tibetan']) {
    const w = F.clean[fam][0];
    const pages = w.pages.map(page);
    const en = w.pages.map((p: any) => pad(p.en));
    const ns = w.pages.map((p: any) => p.page_number);
    it(`${fam}: no number votes on the window (the gap the anchor fills)`, () => {
      expect(blockNumberVotes(pages, new Map(ns.map((n: number, i: number) => [n, en[i]])))).toEqual([]);
    });
    it(`${fam}: anchors copied from the leaf translated — pages 1-3 refused as next`, () => {
      const tr = new Map(ns.map((n: number, i: number) => [n, i === 3 ? '<note>continues</note>' : en[i + 1]]));
      const an = new Map(ns.map((n: number, i: number) => [n, anchorOf(w.pages[Math.min(i + 1, 3)])]));
      const r = blockPageRefusals(pages, tr, { anchors: an });
      expect(r.filter((x: any) => x.reason === 'anchor-next').map((x: any) => x.page_number)).toEqual(ns.slice(0, 3));
    });
    it(`${fam}: anchors right but page 1 holds two leaves — the absorption refuses it and the rest of the call`, () => {
      const tr = new Map(ns.map((n: number, i: number) => [n, i === 0 ? en[0] + '\n' + en[1] : i === 3 ? '<note>continues</note>' : en[i + 1]]));
      const an = new Map(ns.map((n: number, i: number) => [n, anchorOf(w.pages[i])]));
      const r = blockPageRefusals(pages, tr, { anchors: an });
      expect(r.map((x: any) => x.page_number)).toEqual(ns);
      expect(r[0].reason).toBe('absorbed');
    });
  }
});

describe('clean windows: 20 per script family', () => {
  const FOUND_REAL = new Set<string>();
  const KNOWN_FALSE = new Set(['6990630be7b7642c081de08b:510']);
  const refusedWith = (anchors: boolean) => {
    const out: string[] = [];
    for (const wins of Object.values(F.clean) as any[]) for (const w of wins) {
      const tr = new Map(w.pages.map((p: any) => [p.page_number, pad(p.en)]));
      const an = anchors ? new Map(w.pages.map((p: any) => [p.page_number, anchorOf(p)])) : null;
      for (const r of blockPageRefusals(w.pages.map(page), tr, { anchors: an, prevOcr: w.prevSrc ? pad(w.prevSrc) : null, nextOcr: w.nextSrc ? pad(w.nextSrc) : null })) out.push(`${w.book_id}:${r.page_number}`);
    }
    return out;
  };
  it('refuses only the pinned pages, with or without (correct) anchors', () => {
    for (const anchors of [false, true]) expect(new Set(refusedWith(anchors))).toEqual(new Set([...FOUND_REAL, ...KNOWN_FALSE]));
  });
  it('the false refusals stay under 1.5% of 560 clean pages', () => {
    expect(refusedWith(true).filter((k) => !FOUND_REAL.has(k)).length / 560).toBeLessThan(0.015);
  });
  it('none in Tibetan, Arabic or Devanagari', () => {
    for (const fam of ['tibetan', 'arabic', 'devanagari']) {
      for (const w of F.clean[fam]) expect(blockPageRefusals(w.pages.map(page), new Map(w.pages.map((p: any) => [p.page_number, pad(p.en)])))).toEqual([]);
    }
  });
});

describe('absorption, number vote and the drift hook', () => {
  const src = (n: number) => `Leaf ${n} `.padEnd(1200, 'abc ');
  const pages = [1, 2, 3, 4].map((n) => ({ page_number: n, ocr: { data: src(n) } }));
  it('a page that holds two leaves, and a page whose English is gone', () => {
    const tr = new Map([[1, 'e'.repeat(1300)], [2, 'e'.repeat(2600)], [3, 'e'.repeat(60)], [4, 'e'.repeat(1300)]]);
    expect(blockAbsorptions(pages, tr).map((a: any) => [a.page_number, a.kind])).toEqual([[2, 'absorbs'], [3, 'swallowed']]);
  });
  it('dropDriftedPages reports each refused page as a boundary of itself, so callers read it alone', () => {
    const tr = new Map([[1, 'e'.repeat(1300)], [2, 'e'.repeat(2600)], [3, 'e'.repeat(60)], [4, 'e'.repeat(1300)]]);
    const { translations, drifted } = dropDriftedPages(pages, tr);
    expect(drifted.map((d: any) => [d.prev, d.next, d.kind])).toEqual([[2, 2, 'absorbed'], [3, 3, 'absorbed'], [4, 4, 'absorbed']]);
    expect([...translations.keys()]).toEqual([1]);
  });
  it('a single small shared number does not refuse; two do', () => {
    const p = [{ page_number: 7, ocr: { data: 'text\nverse ॥10॥ and more' } }, { page_number: 8, ocr: { data: 'text\nverse ॥11॥ and more' } }, { page_number: 9, ocr: { data: 'text\nverse ॥12॥ 47 and more' } }];
    expect(blockNumberVotes(p, new Map([[7, 'text\nverse 10'], [8, 'text\nverse 12']]))).toEqual([]);
    expect(blockNumberVotes(p, new Map([[7, 'text\nverse 10'], [8, 'text\nverse 12 and 47']])).map((v: any) => [v.page_number, v.dir])).toEqual([[8, 'next']]);
  });
});

describe('multi-image OCR', () => {
  it('reads a printed page number', () => {
    expect(printedPageNumber('<page-num>२३</page-num>\ntext')).toBe(23);
    expect(printedPageNumber('no tag')).toBeNull();
  });
  it('two reads of one call that print the same page number are both refused', () => {
    const pages = [1, 2, 3].map((n) => ({ id: `p${n}`, page_number: n }));
    const r = ocrBlockRefusals(pages, ['<page-num>14</page-num>\nA', '<page-num>15</page-num>\nB', '<page-num>15</page-num>\nC']);
    expect(r.map((x: any) => x.page_number)).toEqual([2, 3]);
  });
  it('a read that holds its own and the next leaf against the stored text is refused', () => {
    const stored = new Map([['a', 'x'.repeat(1500)], ['b', 'y'.repeat(1500)], ['c', 'z'.repeat(1500)]]);
    const pages = [['a', 1], ['b', 2], ['c', 3]].map(([id, n]) => ({ id, page_number: n }));
    const r = ocrBlockRefusals(pages, ['x'.repeat(1500), 'y'.repeat(3000), 'q'.repeat(1500)], { stored });
    expect(r.map((x: any) => [x.page_number, x.reason])).toEqual([[2, 'ocr-absorbed']]);
  });
  it('a clean block passes', () => {
    const stored = new Map([['a', 'x'.repeat(1500)], ['b', 'y'.repeat(1400)]]);
    const pages = [['a', 1], ['b', 2]].map(([id, n]) => ({ id, page_number: n }));
    expect(ocrBlockRefusals(pages, ['<page-num>3</page-num>\n' + 'x'.repeat(1480), '<page-num>4</page-num>\n' + 'y'.repeat(1420)], { stored })).toEqual([]);
  });
});

describe('structured output (Derek 2026-11-03: one object per page, refused on count or id mismatch)', () => {
  it('a schema-bound worker reply becomes the tag text the parser reads, anchors included', async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain-JS module, no declarations
    const { structuredReplyToTags, BLOCK_RESPONSE_SCHEMA } = await import('../../scripts/lib/block-page-guard.mjs');
    const reply = JSON.stringify([{ page: 4, anchor_first: 'Inprincipio', anchor_last: 'eratverbum', translation: 'In the beginning.' }, { page: 5, anchor_first: 'Etverbum', anchor_last: 'apudDeum', translation: 'And the word </translation> was.' }]);
    const tags = structuredReplyToTags(reply, [4, 5]);
    const parsed = parseBlockTranslations(tags, [4, 5].map((n) => ({ page_number: n, ocr: { data: 'x' } })));
    expect(parsed.translations.get(4)).toBe('In the beginning.');
    expect(parsed.translations.get(5)).toBe('And the word  was.');
    expect(parsed.anchors.get(5)).toEqual({ first: 'Etverbum', last: 'apudDeum' });
    expect(BLOCK_RESPONSE_SCHEMA.items.required).toEqual(['page', 'anchor_first', 'anchor_last', 'translation']);
  });
  it('refuses a count mismatch, a renumbered or reordered page, an empty translation, and non-JSON', async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain-JS module, no declarations
    const { structuredReplyToTags } = await import('../../scripts/lib/block-page-guard.mjs');
    const o = (page: number, translation = 'T') => ({ page, anchor_first: 'a', anchor_last: 'b', translation });
    expect(structuredReplyToTags(JSON.stringify([o(4)]), [4, 5])).toBeNull();
    expect(structuredReplyToTags(JSON.stringify([o(5), o(4)]), [4, 5])).toBeNull();
    expect(structuredReplyToTags(JSON.stringify([o(1), o(2)]), [4, 5])).toBeNull();
    expect(structuredReplyToTags(JSON.stringify([o(4), o(5, ' ')]), [4, 5])).toBeNull();
    expect(structuredReplyToTags('<translation page="4">x</translation>', [4])).toBeNull();
  });
  it('the agy JSON block (claude-translate --reply=json) is split the same strict way', async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain-JS module, no declarations
    const { splitJsonReply } = await import('../../scripts/batch/claude-translate.mjs');
    const ok = splitJsonReply('```json\n' + JSON.stringify([{ page: 9, anchor_first: 'abc', anchor_last: 'xyz', translation: 'Nine.' }, { page: 10, anchor_first: 'def', anchor_last: 'uvw', translation: 'Ten.' }]) + '\n```', [9, 10]);
    expect(ok.texts.get(10)).toBe('Ten.');
    expect(ok.anchors.get(9)).toEqual({ first: 'abc', last: 'xyz' });
    expect(splitJsonReply(JSON.stringify([{ page: 10, translation: 'Ten.' }, { page: 9, translation: 'Nine.' }]), [9, 10])).toBeNull();
    expect(splitJsonReply('[{"page": 9', [9])).toBeNull();
  });
});

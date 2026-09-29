/**
 * Leaf seams (#5260): two leaves photographed on one frame, read per leaf, served as one page.
 *
 * The fixture is the real seam of Thadrak Kanjur 'Bum Nya (book 69e7ab555f1a22ab19a96c7a) page
 * 283 — the page whose translation the 2026-09-29 pilot found bridging the seam ("While
 * practicing the perfection of meditative concentration…", an item with no counterpart in the
 * source). Leaf 1 ends mid-formula on «བསམ་གཏན་གྱི་ཕ་རོལ་ཏ…» (the perfection of concentration) and
 * leaf 2 opens on the yig-mgo head mark ༄༅། — the start of another folio. The lines are cut to
 * their first 110 characters; the per-leaf ledger row says 7 + 7 lines.
 *
 * Every piece has a NEGATIVE CONTROL: the same input with the marker removed must behave as
 * production did before the marker existed — the prompt byte-identical, the guard silent — so a
 * test here is red when the marker stops carrying weight.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { LEAF_BREAK, countLeafBreaks, splitLeafUnits, leafSeamsPreserved, leafUnitsHealth, dropLeafSeamBreaches, leafBreakNote, insertLeafBreaks, foreignTags } from '../../scripts/lib/leaf-break.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { buildTranslationPrompt, buildBlockTranslationPrompt, resolvePageBreakForPage, assessTranslationHealth, PAGE_BREAK_SCOPED, LEAF_BREAK_ONLY, PAGE_BREAK_RULE, LEAF_BREAK_RULE } from '../../scripts/lib/translate-core.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { blockPrompt, parseBlockResponse } from '../../scripts/lib/translate-batch-seam.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { stripEditorialWrappers as stripMjs } from '../../scripts/lib/strip-editorial-wrappers.mjs';
import { stripEditorialWrappers as stripTs } from '@/lib/strip-editorial-wrappers';
import { prepareNotesMarkdown, NOTES_ALLOWED_ELEMENTS } from '@/components/reader/NotesRenderer';
import { validateTranslation } from '@/lib/validateTranslation';
import { markdownToHtml } from '@/lib/export-markdown-html';

// p.283, leaf 1's last line and leaf 2's first line (each cut to 110 chars).
const L7 = 'བདག་ནི་བརྩོན་འགྲུས་ཀྱི་ཕ་རོལ་དུ་ཕྱིན་པ་ལ་སྤྱོད་དོ་ཞེས་བྱ་པར་རྣམ་པར་རྟོག་པར་མྱི་འགྱུ་བ་དང་། བསམ་གཏན་གྱི་ཕ་རོལ་ཏ';
const L8 = '༄༅། །སྤྱོད་དོ་ཞེས་བྱ་བར་རྣམ་པར་རྟོག་པར་མྱི་འགྱུར་བ་དང་། ཐོག་མ་དང་ཐ་མ་མྱེད་པ་སྟོང་པ་ཉིད་ལ་སྤྱོད་པའི་ཚེ ། བདག་ནི';
// Filler lines stand in for the other twelve; the ledger says 7 + 7.
const leaf1 = ['ཉིད་ཀྱི་རང་བཞིན་ཡོངས་སུ་བསྔོ་བར་མྱི་ནུས་སོ། །', 'སེམས་དཔའ་སེམས་དཔའ་ཆེན་པོས་གཞན་ཞིག།', 'ཡང་དག་པར་དགའ་བར་བྱ་ན།', 'ཡང་དག་པར་དགའ་བ་བསྐྱེད་པར་བྱའོ། །', 'འགྱུར་བ་དང་། ཚུལ་ཁྲིམས་ཀྱི།', 'བདག་ནི་ཚུལ་ཁྲིམས་ཀྱི་ཕ་རོལ་ཏུ་པྱིན་པ་ལ་སྤྱོད་དོ།', L7];
const leaf2 = [L8, 'བདག་ནི་བསམ་གཏན་གྱི་ཕ་རོལ་ཏུ་ཕྱིན་པ་ལ་སྤྱོད་དོ།', 'ཞེས་བྱ་བར་རྣམ་པར་རྟོག་པར་མྱི་འགྱུར་བ་དང་།', 'ཤེས་རབ་ཀྱི་ཕ་རོལ་ཏུ་ཕྱིན་པ་ལ་སྤྱོད་པའི་ཚེ།', 'བདག་ནི་ཤེས་རབ་ཀྱི་ཕ་རོལ་ཏུ་ཕྱིན་པ་ལ་སྤྱོད་དོ།', 'ཞེས་བྱ་བར་རྣམ་པར་རྟོག་པར་མྱི་འགྱུར་བ་དང་།', 'ཀཽ་ཤི་ཀ་གཞན་ཡང་བྱང་ཆུབ་སེམས་དཔའ།'];
const RAW = [...leaf1, ...leaf2].join('\n');                 // the raw per-leaf read, 14 lines
const PLAIN = RAW;                                            // served text before the backfill
const MARKED = [...leaf1, LEAF_BREAK, ...leaf2].join('\n');   // served text after it

const book = { id: '69e7ab555f1a22ab19a96c7a', language: 'Tibetan', title: 'Thadrak Kanjur, ’Bum Nya', published: '1700' };
const prompts = {
  translation: { text: 'Translate this {source_language} text into {target_language}.', ref: { id: 't1', name: 'translation', version: 13, content_hash: 'abc' } },
  english: { text: 'Modernize this text.', ref: { id: 'e1', name: 'english_modernization', version: 3, content_hash: 'def' } },
};

// A translation that keeps the seam, and the pilot's shape: one block bridging it.
const TR_LEAF1 = 'They are unable to dedicate the nature of omniscience itself. Kaushika, furthermore, if a bodhisattva great being were to perfectly show another the unexcelled awakening, he should not conceive: I am practising the perfection of diligence; and the perfection of concentration';
const TR_LEAF2 = 'I practise, one should not conceive; and when practising the emptiness that has neither beginning nor end, one should not conceive: I am practising the perfection of wisdom. Kaushika, furthermore, a bodhisattva';
const TR_KEPT = `${TR_LEAF1}\n${LEAF_BREAK}\n${TR_LEAF2}`;
const TR_BRIDGED = `${TR_LEAF1} — while practising the perfection of meditative concentration, one should not conceive: I am practising it; ${TR_LEAF2}`;

describe('the marker', () => {
  it('is counted and split, tolerating the spaced and unslashed forms a model writes', () => {
    expect(countLeafBreaks(MARKED)).toBe(1);
    expect(countLeafBreaks(PLAIN)).toBe(0);
    expect(countLeafBreaks('a\n<leaf-break />\nb\n<leaf-break>\nc')).toBe(2);
    expect(splitLeafUnits(MARKED)).toEqual([leaf1.join('\n'), leaf2.join('\n')]);
    expect(splitLeafUnits(PLAIN)).toEqual([PLAIN]);
  });

  it('leafSeamsPreserved: the same count passes; a bridged, a dropped and an invented seam each fail', () => {
    expect(leafSeamsPreserved(MARKED, TR_KEPT)).toEqual({ ok: true, ocr: 1, tr: 1 });
    expect(leafSeamsPreserved(MARKED, TR_BRIDGED)).toEqual({ ok: false, ocr: 1, tr: 0 });
    expect(leafSeamsPreserved(MARKED, `${TR_LEAF1}\n${LEAF_BREAK}\n${LEAF_BREAK}\n${TR_LEAF2}`).ok).toBe(false);
    expect(leafSeamsPreserved(PLAIN, TR_BRIDGED).ok).toBe(true);
  });

  it('negative control: without the marker in the source nothing can notice the bridge', () => {
    // The pilot's defect exactly: a fluent translation that runs the two leaves together. With
    // the marker gone from the source there is no seam to check against — the guard is silent.
    expect(leafSeamsPreserved(PLAIN, TR_BRIDGED).ok).toBe(true);
    expect(assessTranslationHealth(PLAIN, TR_BRIDGED, { lang: 'Tibetan' })).toEqual({ healthy: true, reason: null });
    // …and with the marker present the same translation is refused.
    expect(assessTranslationHealth(MARKED, TR_BRIDGED, { lang: 'Tibetan' })).toEqual({ healthy: false, reason: 'leaf-seam' });
    expect(assessTranslationHealth(MARKED, TR_KEPT, { lang: 'Tibetan' })).toEqual({ healthy: true, reason: null });
  });

  it('foreignTags: the marker is the only tag this lane may write', () => {
    expect(foreignTags(MARKED)).toEqual([]);
    expect(foreignTags(`${MARKED}\n<note>x</note>`)).toEqual(['<note>', '</note>']);
  });
});

describe('insertLeafBreaks — the seam from the ledger onto the served text', () => {
  it('places the marker after leaf 1 when the served text is the raw read (p.283: 7 + 7 lines)', () => {
    const r = insertLeafBreaks({ served: PLAIN, raw: RAW, leafLines: [7, 7] });
    expect(r.seams).toEqual([7]);
    expect(r.text).toBe(MARKED);
    expect(r.text.split('\n')[7]).toBe(LEAF_BREAK);
  });

  it('follows a stripped line: a filler line the acceptance rule removed from leaf 1 moves the seam up', () => {
    // leaf_v4 strips a non-Tibetan line ("empty page") from the raw read; the served text lacks it.
    const rawWithFiller = [...leaf1.slice(0, 3), 'empty page', ...leaf1.slice(3), ...leaf2].join('\n');
    const r = insertLeafBreaks({ served: PLAIN, raw: rawWithFiller, leafLines: [8, 7] });
    expect(r.seams).toEqual([7]);
    expect(r.text).toBe(MARKED);
  });

  it('three leaves get two markers', () => {
    const r = insertLeafBreaks({ served: PLAIN, raw: RAW, leafLines: [4, 3, 7] });
    expect(r.seams).toEqual([4, 7]);
    expect(countLeafBreaks(r.text)).toBe(2);
  });

  it('refuses when the ledger does not describe the read, when a served line is not in the raw read, and when a leaf is empty', () => {
    expect(insertLeafBreaks({ served: PLAIN, raw: RAW, leafLines: [7, 8] }).reason).toBe('ledger-mismatch');
    expect(insertLeafBreaks({ served: `${PLAIN}\nཤིན་ཏུ་གསར་པ།`, raw: RAW, leafLines: [7, 7] }).reason).toBe('unalignable');
    // Every line of leaf 2 stripped: the marker would close the page, which marks nothing.
    expect(insertLeafBreaks({ served: leaf1.join('\n'), raw: RAW, leafLines: [7, 7] }).reason).toBe('leaf-empty');
    expect(insertLeafBreaks({ served: PLAIN, raw: RAW, leafLines: [14] }).reason).toBe('single-leaf');
    expect(insertLeafBreaks({ served: MARKED, raw: RAW, leafLines: [7, 7] }).reason).toBe('already-marked');
  });
});

describe('the translator is told (translate-core, under PAGE_BREAK_SCOPED)', () => {
  it('a page with a seam fires: the leaf note and the leaf rule, and NOT the catchword rule', () => {
    const r = resolvePageBreakForPage({ ocrText: MARKED, pageBreak: PAGE_BREAK_SCOPED });
    expect(r.fired).toBe(true);
    expect(r.deviceFired).toBe(false);
    expect(r.meta.leafSeams).toBe(1);
    expect(r.notes).toEqual([leafBreakNote(1)]);
    const { prompt, pageBreak } = buildTranslationPrompt({ prompts, book, ocrText: MARKED, pageBreak: PAGE_BREAK_SCOPED });
    expect(prompt).toContain(LEAF_BREAK_RULE);
    expect(prompt).not.toContain(PAGE_BREAK_RULE);
    expect(prompt).toContain(`**At the page break:** ${leafBreakNote(1)}`);
    expect(prompt).toContain(MARKED);
    expect(pageBreak.applied).toBe(true);
  });

  it('negative control: the same page without the marker is byte-identical to production', () => {
    const production = buildTranslationPrompt({ prompts, book, ocrText: PLAIN }).prompt;
    const scoped = buildTranslationPrompt({ prompts, book, ocrText: PLAIN, pageBreak: PAGE_BREAK_SCOPED }).prompt;
    expect(scoped).toBe(production);
    expect(scoped).not.toContain('leaf');
  });

  it('negative control: with leafBreaks switched off the marker is sent as production sends it and nothing is said', () => {
    const off = buildTranslationPrompt({ prompts, book, ocrText: MARKED, pageBreak: { ...PAGE_BREAK_SCOPED, leafBreaks: false } }).prompt;
    expect(off).toBe(buildTranslationPrompt({ prompts, book, ocrText: MARKED }).prompt);
  });

  it('the note counts the seams: two markers, three leaves, "exactly 2 times"', () => {
    expect(leafBreakNote(2)).toContain('3 separate leaves');
    expect(leafBreakNote(2)).toContain('exactly 2 times');
    expect(leafBreakNote(1)).toContain('exactly 1 time.');
  });

  it('block prompt: the note sits under the page that has the seam, the leaf rule appears once, the other page is untouched', () => {
    const pages = [{ page_number: 282, ocr: { data: PLAIN } }, { page_number: 283, ocr: { data: MARKED } }];
    const { prompt, pageBreak } = buildBlockTranslationPrompt({ prompts, book, pages, pageBreak: PAGE_BREAK_SCOPED });
    expect(prompt.split(LEAF_BREAK_RULE).length - 1).toBe(1);
    expect(prompt).not.toContain(PAGE_BREAK_RULE);
    expect(prompt).toContain(`--- Page 283 ---\n${MARKED}\n**At the page break:** ${leafBreakNote(1)}`);
    expect(prompt).toContain(`--- Page 282 ---\n${PLAIN}\n\n--- Page 283 ---`);
    expect(pageBreak.pages.map((p: any) => p.leafSeams)).toEqual([0, 1]);
    // Negative control: two plain pages under the option are byte-identical to production.
    const plain = [{ page_number: 282, ocr: { data: PLAIN } }, { page_number: 283, ocr: { data: PLAIN } }];
    expect(buildBlockTranslationPrompt({ prompts, book, pages: plain, pageBreak: PAGE_BREAK_SCOPED }).prompt)
      .toBe(buildBlockTranslationPrompt({ prompts, book, pages: plain }).prompt);
  });
});

describe('the Batch API lane (translate-batch-seam) — LEAF_BREAK_ONLY', () => {
  // A Latin seam with a split word: under the leaf-only option no device is resolved.
  const LATIN_N = 'sondern ist beständig geblieben bey der Evangelischen Augspur-';
  const LATIN_X = 'gischen Confession/ darunter er zu Görlitz communiciret.';
  const latin = { id: 'b2', language: 'German', title: 'Apologia', published: '1675' };

  it('a leaf page in a block gets the note and the rule; a device page does not get the #5103 edits', () => {
    const pages = [{ page_number: 16, ocr: { data: LATIN_N } }, { page_number: 17, ocr: { data: LATIN_X } }, { page_number: 18, ocr: { data: MARKED } }];
    const { prompt } = blockPrompt({ prompts, book: latin, pages });
    expect(prompt).toContain(LEAF_BREAK_RULE);
    expect(prompt).toContain(leafBreakNote(1));
    expect(prompt).toContain('Augspur-');           // the split word is left as production sends it
    expect(prompt).not.toContain(PAGE_BREAK_RULE);
    expect(prompt).not.toContain('Augspurgischen');
  });

  it('negative control: a block with no seam is byte-identical to translate-core\'s plain block prompt', () => {
    const pages = [{ page_number: 16, ocr: { data: LATIN_N } }, { page_number: 17, ocr: { data: LATIN_X } }];
    expect(blockPrompt({ prompts, book: latin, pages }).prompt).toBe(buildBlockTranslationPrompt({ prompts, book: latin, pages }).prompt);
    const one = [{ page_number: 16, ocr: { data: LATIN_N } }];
    expect(blockPrompt({ prompts, book: latin, pages: one }).prompt).toBe(buildTranslationPrompt({ prompts, book: latin, ocrText: LATIN_N }).prompt);
    expect(LEAF_BREAK_ONLY.splitWords).toBe(false);
  });

  it('parseBlockResponse drops a page whose translation bridged its seam, and reports it as a drift', () => {
    // Page 282's translation shares no run with 283's, so the #5021 duplicate check stays quiet
    // and only the seam check speaks.
    const TR_282 = 'Kaushika, the merit of a son or daughter of good family who writes out this perfection of wisdom and gives it to another to read cannot be measured by the merit of filling the whole world with the seven precious substances and offering it to the stream-enterers, the once-returners, the never-returners and the worthy ones.';
    const pages = [{ page_number: 282, id: 'a', ocr: { data: `${PLAIN}\n${PLAIN}` } }, { page_number: 283, id: 'b', ocr: { data: `${MARKED}\n${MARKED}` } }];
    const response = `<translation page="282">${TR_282}</translation>\n<translation page="283">${TR_BRIDGED} ${TR_BRIDGED}</translation>`;
    const drifts: any[] = [];
    const out = parseBlockResponse(response, pages, { onDrift: (d: any[]) => drifts.push(...d) });
    expect(out.has(282)).toBe(true);
    expect(out.has(283)).toBe(false);
    expect(drifts).toEqual([{ prev: 283, next: 283, kind: 'leaf-seam', fragment: '2 seam(s) in source, 0 in translation' }]);
    // Negative control: the same response with the seam kept on 283 is written whole.
    const kept = `<translation page="282">${TR_282}</translation>\n<translation page="283">${TR_KEPT}\n${TR_KEPT}</translation>`;
    expect(parseBlockResponse(kept, pages).has(283)).toBe(true);
  });
});

describe('the #5176 guards run per leaf', () => {
  // Two Latin leaves, each long enough to be judged (≥ 120 folded chars). The translation of
  // leaf 1 is real; the "translation" of leaf 2 is the source handed back — half the page.
  const LAT1 = 'Cum enim passim tam vigili Episcoporum constantia quam severa Regis jussione ad subscriptionem urgerentur, plurimorum rigida moralis labem passa est, et multi ex illis qui antea constantissimi videbantur ad novas opiniones defecerunt.';
  const LAT2 = 'Placuerunt haec coetui, sed non Noaillio; qui, cum nihil impetrare posset, facta secessione cum novem aliis episcopis a congressibus abstinuit, et litteras ad regem scripsit quibus suam sententiam prolixe defendebat.';
  const EN1 = 'For when they were everywhere pressed to subscribe, as much by the vigilant constancy of the bishops as by the king\'s severe command, the rigid morality of very many suffered a fall, and many of those who before had seemed most constant defected to the new opinions.';
  const OCR_LAT = `${LAT1}\n${LEAF_BREAK}\n${LAT2}`;

  it('echo: the second leaf handed back verbatim is caught per leaf, and missed by the whole-page tier', () => {
    const tr = `${EN1}\n${LEAF_BREAK}\n${LAT2}`;
    expect(leafUnitsHealth(OCR_LAT, tr, { lang: 'Latin' })).toMatchObject({ healthy: false, reason: 'echo', unit: 1 });
    expect(assessTranslationHealth(OCR_LAT, tr, { lang: 'Latin' })).toEqual({ healthy: false, reason: 'echo' });
    // Negative control: markers removed from both — the shared run is under half the page, the
    // whole-page tier passes it, and there is no leaf tier to run.
    const plainOcr = `${LAT1}\n${LAT2}`, plainTr = `${EN1}\n${LAT2}`;
    expect(assessTranslationHealth(plainOcr, plainTr, { lang: 'Latin' })).toEqual({ healthy: true, reason: null });
  });

  it('a page whose leaves are each translated passes, and a source without a seam is not judged here', () => {
    const EN2 = 'These things pleased the assembly, but not Noailles, who, when he could obtain nothing, made a secession with nine other bishops, kept away from the meetings, and wrote letters to the king in which he defended his opinion at length.';
    expect(leafUnitsHealth(OCR_LAT, `${EN1}\n${LEAF_BREAK}\n${EN2}`, { lang: 'Latin' })).toEqual({ healthy: true, reason: null, unit: null });
    expect(leafUnitsHealth(`${LAT1}\n${LAT2}`, `${EN1}\n${EN2}`, { lang: 'Latin' })).toEqual({ healthy: true, reason: null, unit: null });
  });

  it('dropLeafSeamBreaches removes only the pages whose seams did not come back', () => {
    const pages = [{ page_number: 1, ocr: { data: MARKED } }, { page_number: 2, ocr: { data: PLAIN } }, { page_number: 3, ocr: { data: MARKED } }];
    const map = new Map([[1, TR_BRIDGED], [2, TR_BRIDGED], [3, TR_KEPT]]);
    const { breached } = dropLeafSeamBreaches(pages, map);
    expect(breached).toEqual([{ page: 1, ok: false, ocr: 1, tr: 0 }]);
    expect([...map.keys()]).toEqual([2, 3]);
  });
});

describe('the reader and the text surfaces', () => {
  it('NotesRenderer renders the seam as its own block, on the transcription and the translation alike', () => {
    for (const text of [MARKED, TR_KEPT]) {
      const { processedText } = prepareNotesMarkdown(text, { showNotes: true });
      expect(processedText).toContain('\n\n<div class="leaf-break"></div>\n\n');
      expect(processedText).not.toMatch(/<leaf-break/);
    }
    expect(NOTES_ALLOWED_ELEMENTS).toContain('div');
    // Notes off must not lose the seam either.
    expect(prepareNotesMarkdown(TR_KEPT, { showNotes: false }).processedText).toContain('<div class="leaf-break"></div>');
  });

  it('the strippers turn the seam into a paragraph break, never a literal tag, on both twins', () => {
    for (const strip of [stripTs, stripMjs]) {
      const out = strip(MARKED);
      expect(out).not.toMatch(/<leaf-break/);
      expect(out).toContain(`${L7}\n\n${L8}`);
    }
    expect(stripTs(MARKED)).toBe(stripMjs(MARKED));
  });

  it('the HTML export keeps the seam visible as a rule; the validator knows the marker and flags an unknown one', () => {
    const html = markdownToHtml(TR_KEPT);
    expect(html).toContain('<hr class="leaf-break" title="next folio"/>');
    expect(html).not.toMatch(/leaf-break\s*\//);
    expect(validateTranslation(TR_KEPT).issues.filter((i) => i.type === 'unknown_xml_tag' || i.type === 'unclosed_xml')).toEqual([]);
    expect(validateTranslation('a <foo/> b').issues.some((i) => i.type === 'unknown_xml_tag' && /foo/.test(i.message))).toBe(true);
  });
});

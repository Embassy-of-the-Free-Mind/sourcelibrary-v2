/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * Page-integrity detectors (scripts/lib/page-integrity.mjs): catchword continuity, printed
 * page-number sequence, duplicate scans, truncated and echoed translations.
 *
 * Every fixture is a real page from the local mirror or the #4681 batch run, chosen during the
 * 2026-09-24 hand-read: the positive controls the walk must light up, and — for each detector —
 * the false-positive SHAPES the hand-read found, pinned as negatives so a loosening is noticed.
 * The synthetic page-number sequences carry printed values copied from real books.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  catchwordBoundary, parseCatchword, pageNumberBreaks, parsePageNum, duplicateScan,
  truncationRatio, echoedSource, sourceLanguageCount, tokenMatches, readingLength, ocrReasoningLeak,
  parseVocab, vocabAbsent, repeatedBlocks, LOOP_MAX_TTR, LOOP_MIN_COPIES, REPEAT_MIN_CHARS,
  metaPayload, continuityMeta,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/page-integrity.mjs';

import {
  extremeForLanguage, TRUNC_NORM_FLAG,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/audit/page-integrity.mjs';

const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/page-integrity', name), 'utf8'));
const CW = fx('catchwords.json').cases as any[];
const PN = fx('page-numbers.json').cases as any[];
const DUP = fx('duplicate-scans.json').cases as any[];
const TR = fx('translations.json');
const MP = fx('meta-payload.json').cases as any[];

describe('catchword continuity', () => {
  it('reads the catchword out of <meta>, and refuses a CJK fore-edge title', () => {
    expect(parseCatchword('<meta>catchword: QUEM; red library stamp</meta>')).toMatchObject({ judged: true, tokens: ['quem'] });
    expect(parseCatchword('<meta>catchword: Deli-</meta>')).toMatchObject({ judged: true, partial: true });
    expect(parseCatchword('<meta>catchword: 書藝四</meta>')).toEqual({ judged: false, why: 'cjk-fore-edge' });
    expect(parseCatchword('<meta>none</meta>')).toBeNull();
  });
  it('matches through long-s and one misread Fraktur letter, not through a different word', () => {
    expect(tokenMatches('fic', 'sic')).toBe(true);
    expect(tokenMatches('scin', 'sein')).toBe(true);
    expect(tokenMatches('testan', 'testantur')).toBe(true);
    expect(tokenMatches('nam', 'nimm')).toBe(false);
  });
  it('has positives, negatives and an unjudged case (the fixture is not vacuous)', () => {
    expect(CW.filter(c => c.expect.ok === true).length).toBeGreaterThanOrEqual(1);
    expect(CW.filter(c => c.expect.ok === false).length).toBeGreaterThanOrEqual(1);
    expect(CW.filter(c => c.expect.judged === false).length).toBeGreaterThanOrEqual(1);
  });
  for (const c of CW) {
    it(c.name, () => {
      expect(catchwordBoundary(c.pages, c.i)).toMatchObject(c.expect);
    });
  }
});

describe('printed page-number sequence', () => {
  it('parses arabic, roman, folio sides, spreads and native digits', () => {
    expect(parsePageNum('<page-num>189</page-num>')).toMatchObject({ kind: 'arabic', value: 189 });
    expect(parsePageNum('<page-num>xxvi</page-num>')).toMatchObject({ kind: 'roman', value: 26 });
    expect(parsePageNum('<page-num>12v</page-num>')).toMatchObject({ kind: 'folio', value: 25 });
    expect(parsePageNum('<page-num>13, 14</page-num>')).toMatchObject({ kind: 'arabic', value: 13, span: 2 });
    expect(parsePageNum('<page-num>२२</page-num>')).toMatchObject({ kind: 'arabic', value: 22 });
    expect(parsePageNum('no tag')).toBeNull();
  });
  for (const c of PN) {
    it(c.name, () => {
      const r = pageNumberBreaks(c.pages);
      if (c.includes) {
        for (const e of c.expect) expect(r.breaks).toContainEqual(expect.objectContaining(e));
        expect(r.breaks.filter((b: any) => b.shape === 'misnumbered' && b.fromValue === 139)).toEqual([]);
      } else {
        expect(r.breaks.length).toBe(c.expect.length);
        c.expect.forEach((e: any, k: number) => expect(r.breaks[k]).toMatchObject(e));
      }
      if (c.outliers != null) expect(r.outliers.length).toBe(c.outliers);
      if (c.irregular) expect(Object.values(r.kinds).some((k: any) => k.why === 'irregular')).toBe(true);
    });
  }
});

describe('duplicate scans', () => {
  for (const c of DUP) {
    it(`${c.expect ? 'flags' : 'passes'} ${c.name}`, () => {
      const d = duplicateScan(c.a.ocr, c.b.ocr);
      expect(d.judged).toBe(true);
      expect(d.dup).toBe(c.expect);
    });
  }
  it('refuses to judge a short page', () => {
    expect(duplicateScan('<page-type>text</page-type>\nshort', 'short')).toEqual({ judged: false, why: 'short' });
  });
});

describe('truncated translations', () => {
  const FLAG = 0.5;
  for (const c of TR.truncation) {
    it(`${c.expect} — ${c.name}`, () => {
      const t = truncationRatio(c.page);
      if (c.expect === 'unjudged') { expect(t).toEqual({ judged: false, why: c.why }); return; }
      expect(t.judged).toBe(true);
      const norm = t.ratio / TR.median[c.lang];
      expect(norm < FLAG).toBe(c.expect === 'flag');
    });
  }
  it('measures reading length, not markup: entities, LaTeX commands and [unclear] count for nothing', () => {
    expect(readingLength('&lambda;&omicron;&gamma;')).toBe(3);
    expect(readingLength('$\\overline{\\pi\\delta}$')).toBe(0);
    expect(readingLength('[unclear] [unclear] Bocasse')).toBe(7);
    expect(readingLength('| | | 12 |')).toBe(2);
  });
  it('recognises leaked model reasoning, and not ordinary text', () => {
    expect(ocrReasoningLeak('thought The user wants a transcription of a historical manuscript page')).toBe(true);
    expect(ocrReasoningLeak('<language>Latin</language>\nQuemadmodum in Palatio rotundo')).toBe(false);
    // the hand-read's false shape: English prose whose first line starts with the word
    expect(ocrReasoningLeak('thought by examination of the structure of a proposition.')).toBe(false);
    expect(ocrReasoningLeak('164  ST. AMBROSE.\nthought that he was restored to us')).toBe(false);
  });
  it('counts the languages the OCR tag names, ignoring parentheticals', () => {
    expect(sourceLanguageCount('<language>Greek, Latin</language>')).toBe(2);
    expect(sourceLanguageCount('<language>Latin (with Greek)</language>')).toBe(1);
  });
});

describe('truncation needs an extreme ratio where a language varies widely', () => {
  const R = TR.languageRule;
  for (const c of R.cases) {
    it(`${c.expect} — ${c.name}`, () => {
      const ratio = c.ratio ?? truncationRatio(c.page).ratio;
      const med = R.detail[c.lang].median;
      const flagged = ratio / med < TRUNC_NORM_FLAG && extremeForLanguage(ratio, c.lang, R.detail);
      expect(flagged).toBe(c.expect === 'flag');
    });
  }
});

describe('echoed source', () => {
  it('has positives and negatives', () => {
    expect(TR.echo.filter((c: any) => c.expect).length).toBeGreaterThanOrEqual(2);
    expect(TR.echo.filter((c: any) => !c.expect).length).toBeGreaterThanOrEqual(4);
  });
  for (const c of TR.echo) {
    it(`${c.expect ? 'flags' : 'passes'} ${c.name}`, () => {
      const e = echoedSource({ ocr: c.page.ocr, tr: c.page.tr, lang: c.lang });
      expect(e.judged).toBe(true);
      expect(e.echo).toBe(c.expect);
      if (c.wholePage != null) expect(e.wholePage).toBe(c.wholePage);
    });
  }
  it('never judges an English source (a modernisation shares text by design)', () => {
    expect(echoedSource({ ocr: 'x', tr: 'y', lang: 'english' })).toEqual({ judged: false, why: 'english-source' });
  });
});

// ── page-error taxonomy quick wins (2026-09-25): O5, O4, T3, T9 ──────────────────────────
// Every fixture in quick-wins.json is a real mirror page; a positive control that had to be
// DERIVED (the stored page is complete) says so in the test and is built from the real page.
const QW = fx('quick-wins.json').cases as Record<string, any>;

describe('O5 · <vocab> words absent from the body (#5136)', () => {
  it('parses the vocab tag and drops parenthetical glosses', () => {
    expect(parseVocab('<vocab>三昧 (Samadhi), 法華經 (Lotus Sutra); Roma, palea</vocab>')).toEqual(['三昧', '法華經', 'Roma', 'palea']);
    expect(parseVocab('no tag here')).toEqual([]);
  });
  it('passes the stored Varro p.149 — every term is in the body (Vmbria~Umbria, fœnificiæ folded)', () => {
    const v = vocabAbsent(QW['varro-p149-complete']);
    expect(v).toMatchObject({ judged: true, terms: 12, absent: [], flag: false });
  });
  it('flags the Varro page once the lines holding Roma, palea and Bagienis are removed (the #5136 example, derived)', () => {
    const page = QW['varro-p149-complete'];
    // delete the clause (up to the surrounding full stops) that holds each of the three words
    let ocr = page.ocr, deleted = '';
    for (const w of ['Roma', 'palea', 'Bagienis']) ocr = ocr.replace(new RegExp(`[^.<>]*\\b${w}\\b[^.<>]*`), (m: string) => { deleted += ' ' + m; return ''; });
    const v = vocabAbsent({ ...page, ocr });
    expect(v.judged).toBe(true);
    expect(v.absent).toEqual(expect.arrayContaining(['Roma', 'palea', 'Bagienis']));
    for (const t of v.absent) expect(deleted).toContain(t); // nothing outside the deleted clauses is reported
    expect(v.flag).toBe(true);
  });
  it('treats an inflected form as present: Astrologiae ~ Astrologia, Aristotelis ~ Aristoteles, zodiaci ~ zodiacus', () => {
    const v = vocabAbsent(QW['agrippa-p233-buried-meta']);
    expect(v.judged).toBe(true);
    expect(v.absentExact).toEqual(expect.arrayContaining(['Astrologia', 'Aristoteles', 'zodiacus']));
    expect(v.absent).toEqual([]);
  });
  it('does not count a Greek letter, a transliteration in another script, or a multi-word label as a dropped word', () => {
    const page = QW['prayer-p333-short-meta'];
    const ocr = page.ocr.replace(/<vocab>[\s\S]*?<\/vocab>/, '<vocab>α, Peah, Ruach, textual criticism, מחזור, ראש השנה</vocab>');
    const long = { ...page, ocr: ocr + '\n' + page.ocr.split('\n').slice(3, 20).join('\n').repeat(3) }; // over the 300-char floor
    const v = vocabAbsent(long);
    expect(v.judged).toBe(true);
    // α is a sigil; Peah, Ruach and "textual criticism" are Latin script on a Hebrew page
    expect(v.shapes).toMatchObject({ short: 1, otherScript: 3, keyword: 0 });
    expect(v.absent).toEqual(['מחזור']);   // ראש השנה is on the page; מחזור (the model's genre label) is not
    // on a Latin-script page a multi-word label whose words are all absent is a keyword, not a dropped word
    const varro = QW['varro-p149-complete'];
    const v2 = vocabAbsent({ ...varro, ocr: varro.ocr.replace('<vocab>', '<vocab>textual criticism, ') });
    expect(v2.shapes).toMatchObject({ keyword: 1 });
    expect(v2.absent).toEqual([]);
  });
  it('is unjudgeable on a non-prose page, a short source, or a page with under three terms', () => {
    expect(vocabAbsent({ ...QW['varro-p149-complete'], type: 'index' })).toEqual({ judged: false, why: 'non-prose' });
    expect(vocabAbsent({ ocr: '<vocab>a, b, c</vocab>\nshort body', type: 'text' })).toEqual({ judged: false, why: 'short-source' });
    expect(vocabAbsent({ ocr: '<vocab>Roma</vocab>\n' + 'x '.repeat(400), type: 'text' })).toEqual({ judged: false, why: 'few-terms' });
  });
});

describe('O4 · a block repeated inside one page (#5135)', () => {
  it('flags a Hebrew paragraph transcribed twice (147 tokens, 2 copies, normal vocabulary)', () => {
    const r = repeatedBlocks(QW['tikun-p131-block-twice'].ocr);
    expect(r).toMatchObject({ judged: true, kind: 'block', flag: true, copies: 2 });
    expect(r.longest).toBeGreaterThanOrEqual(100);
    expect(r.ttr).toBeGreaterThan(LOOP_MAX_TTR);
  });
  it('flags a 382-token Latin passage set twice on one page', () => {
    const r = repeatedBlocks(QW['latin-p255-passage-twice'].ocr);
    expect(r).toMatchObject({ judged: true, kind: 'block', flag: true, copies: 2 });
    expect(r.longest).toBeGreaterThanOrEqual(300);
  });
  it('classifies the KNOWN token loop as loop, not block: a 4-token phrase 112 times', () => {
    const r = repeatedBlocks(QW['tikun-p35-loop'].ocr);
    expect(r).toMatchObject({ judged: true, kind: 'loop', flag: false, period: 4 });
    expect(r.share).toBeGreaterThan(0.9);
  });
  it('does not judge Tibetan: sūtra refrains repeat by design (70% of the first walk\'s flags, #5275)', () => {
    expect(repeatedBlocks(QW['nyang-p110-tibetan-loop'].ocr)).toEqual({ judged: false, why: 'refrain-script' });
  });
  it('reads an unsegmented script by characters: a Han passage set twice is a block, copied 12 times is degeneration', () => {
    const block = '學而時習之不亦說乎有朋自遠方來不亦樂乎人不知而不慍不亦君子乎其為人也孝弟而好犯上者鮮矣不好犯上而好作亂者未之有也';
    const other = '道千乘之國敬事而信節用而愛人使民以時弟子入則孝出則弟謹而信汎愛眾而親仁行有餘力則以學文';
    const twice = repeatedBlocks(block + other + block);
    expect(twice).toMatchObject({ judged: true, unsegmented: true, K: REPEAT_MIN_CHARS, kind: 'block', flag: true, copies: 2 });
    const many = repeatedBlocks(other + block.repeat(LOOP_MIN_COPIES + 2));
    expect(many).toMatchObject({ judged: true, kind: 'loop', flag: false });
  });
  it('keeps vowel signs when comparing Devanagari words (कमल and कामला fold to the same letters)', () => {
    const dn = (n: number) => String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[+d]);
    const a = Array.from({ length: 30 }, (_, i) => (i % 2 ? 'कमल' : 'जल') + dn(i)).join(' ');
    const b = a.replace(/कमल/g, 'कामला').replace(/जल/g, 'जाली');
    expect(repeatedBlocks(a + ' ' + b)).toMatchObject({ judged: true, flag: false, longest: 0 });
  });
  it('passes ordinary prose and a table whose only repeats are pipes and rules', () => {
    expect(repeatedBlocks(QW['kircher-p317-notes'].ocr)).toMatchObject({ judged: true, kind: 'none', flag: false, longest: 0 });
    const table = '| a | b |\n|---|---|\n' + Array.from({ length: 60 }, (_, i) => `| item${i} | ${i * 7} |`).join('\n');
    expect(repeatedBlocks(table)).toMatchObject({ judged: true, flag: false });
  });
  it('is unjudgeable under two shingles of text', () => {
    expect(repeatedBlocks('only a few words here')).toEqual({ judged: false, why: 'short' });
  });
});

describe('text hidden in the continuity <meta>', () => {
  it('has hidden, whole-page and copied cases', () => {
    expect(MP.filter((c) => c.expect.shape === 'hidden-text').length).toBeGreaterThanOrEqual(3);
    expect(MP.some((c) => c.expect.wholePage)).toBe(true);
    expect(MP.some((c) => c.expect.shape === 'copied')).toBe(true);
  });
  for (const c of MP) {
    it(`${c.expect.shape}${c.expect.wholePage ? ' (whole page)' : ''} — ${c.name}`, () => {
      const r = metaPayload({ tr: c.tr, prevTr: c.prevTr });
      expect(r.judged).toBe(true);
      expect(r.shape).toBe(c.expect.shape);
      expect(r.wholePage).toBe(c.expect.wholePage);
    });
  }
  it('reads the bare marker and a sentence ABOUT the previous page as nothing hidden', () => {
    expect(continuityMeta('<meta>continues from previous page</meta> x')?.form).toBe('bare');
    expect(continuityMeta("<meta>continues from previous page's discussion of Saul.</meta> y")?.form).toBe('descriptive');
    expect(continuityMeta('<meta>This page follows the title page.</meta> z')).toBeNull();
  });
  it('does not judge a payload with no previous translation to compare', () => {
    const r = metaPayload({ tr: '<meta>continues from previous page: and so the work of the furnace went on through the night</meta> Then', prevTr: null });
    expect(r).toMatchObject({ judged: false, why: 'no-previous-translation' });
  });
});

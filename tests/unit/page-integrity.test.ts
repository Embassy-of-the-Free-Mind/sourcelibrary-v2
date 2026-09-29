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
  parseVocab, vocabAbsent, repeatedBlocks, hiddenTranslation, unwrapHiddenTranslation, sentenceCount, sentenceDeficit,
  translationProse, LOOP_MAX_TTR, LOOP_MIN_COPIES, REPEAT_MIN_CHARS, HIDDEN_BURIED_BODY_SHARE, SENT_DEFICIT_FLAG,
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
  it('reads an unsegmented script by characters and calls a block copied 213 times degeneration', () => {
    const r = repeatedBlocks(QW['nyang-p110-tibetan-loop'].ocr);
    expect(r).toMatchObject({ judged: true, unsegmented: true, K: REPEAT_MIN_CHARS, kind: 'loop', flag: false });
    expect(r.copies).toBeGreaterThanOrEqual(LOOP_MIN_COPIES);
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

describe('T3 · translation hidden in a <meta>/<note> wrapper (#5148)', () => {
  it('the Agrippa p.233 example: the whole translation inside one labelled <meta>, body 0 — hidden AND buried', () => {
    const h = hiddenTranslation(QW['agrippa-p233-buried-meta']);
    expect(h).toMatchObject({ judged: true, wrapper: 'meta', hidden: true, buried: true, labelled: true, body: 0 });
    expect(h.wrapperLen).toBeGreaterThan(2000);
  });
  it('a long <note> BESIDE a real body is hidden by the loose rule but not buried', () => {
    const h = hiddenTranslation(QW['note-beside-body']);
    expect(h).toMatchObject({ judged: true, wrapper: 'note', hidden: true, buried: false });
    expect(h.body).toBeGreaterThan(HIDDEN_BURIED_BODY_SHARE * h.wrapperLen);
  });
  it('a <note> with no body at all is buried (unlabelled)', () => {
    expect(hiddenTranslation(QW['buried-note'])).toMatchObject({ judged: true, wrapper: 'note', hidden: true, buried: true, labelled: false, body: 0 });
  });
  it('passes a short continuity <meta> beside the body, and two short <note>s', () => {
    expect(hiddenTranslation(QW['prayer-p333-short-meta'])).toMatchObject({ judged: true, hidden: false, buried: false, labelled: true });
    expect(hiddenTranslation(QW['kircher-p317-notes'])).toMatchObject({ judged: true, hidden: false });
  });
  it('never judges a plate, a short source, or a wrapper that DESCRIBES the page', () => {
    const a = QW['agrippa-p233-buried-meta'];
    expect(hiddenTranslation({ ...a, type: 'illustration' })).toEqual({ judged: false, why: 'non-prose' });
    expect(hiddenTranslation({ ...a, ocr: '<page-type>text</page-type>\nshort' })).toEqual({ judged: false, why: 'short-source' });
    const described = { ...a, tr: '<note>This page shows a woodcut of the zodiac with twelve signs around a central sun; ' + 'the engraving is finely hatched and the border carries acanthus leaves. '.repeat(4) + '</note>' };
    expect(hiddenTranslation(described)).toMatchObject({ judged: true, hidden: false, described: true });
  });
  it('unwrapHiddenTranslation opens ONLY the buried tier, drops the label, keeps the text byte-for-byte', () => {
    const a = QW['agrippa-p233-buried-meta'];
    const u = unwrapHiddenTranslation(a);
    expect(u.unwrapped).toBe(true);
    expect(u.text.startsWith('<header>Book Two</header>\n\n...as having power over the things within it')).toBe(true);
    expect(u.text).not.toMatch(/<meta>/i);
    expect(u.text).not.toMatch(/continues from previous page/i);
    expect(u.text).toContain('<term>Ptolemy</term>');
    // idempotent, and the re-read page has a body
    expect(unwrapHiddenTranslation({ ...a, tr: u.text })).toMatchObject({ unwrapped: false, why: 'not-hidden' });
    expect(hiddenTranslation({ ...a, tr: u.text }).body).toBeGreaterThan(2000);
    // not buried → untouched
    const n = QW['note-beside-body'];
    expect(unwrapHiddenTranslation(n)).toMatchObject({ unwrapped: false, why: 'hidden-not-buried', text: n.tr });
    // no source → untouched (the rule cannot tell a hidden translation from a long honest note)
    expect(unwrapHiddenTranslation({ tr: a.tr, type: 'text' })).toMatchObject({ unwrapped: false, why: 'no-source', text: a.tr });
  });
  it('a "$" in the buried text survives the unwrap (function replacer)', () => {
    const a = QW['agrippa-p233-buried-meta'];
    const tr = a.tr.replace('as having power', () => 'as having $& power');
    expect(unwrapHiddenTranslation({ ...a, tr }).text).toContain('as having $& power');
  });
});

describe('T9 · fewer sentences in the translation than in the source (#5151)', () => {
  it('counts sentences past abbreviations, initials and numbers', () => {
    expect(sentenceCount('Vidi hominem. Cap. 3. dicit S. Paulus quod vera sit. Nonne? Ita.')).toBe(4);
    expect(sentenceCount('He came. She went! Did they? Yes.')).toBe(4);
    expect(sentenceCount('天地玄黄。宇宙洪荒。日月盈昃！')).toBe(3);
    expect(sentenceCount('Τί ἐστιν; Οὐκ οἶδα. Ἴσως·')).toBe(3);
  });
  it('returns null for a script whose marks it cannot read (Tibetan shad is a clause mark)', () => {
    expect(sentenceCount('བདག་གི་རྒྱུད་ལ། བྱིན་གྱིས།')).toBeNull();
  });
  it('passes a complete Latin page (Kircher p.317: 20 source sentences, 23 translated)', () => {
    const s = sentenceDeficit(QW['kircher-p317-notes']);
    expect(s).toMatchObject({ judged: true, flag: false });
    expect(s.ratio).toBeGreaterThan(1);
  });
  it('flags the same page once 40% of its translated sentences are deleted (derived)', () => {
    const k = QW['kircher-p317-notes'];
    const body = translationProse(k.tr);
    const sentences = body.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((_: string, i: number) => i % 5 >= 3).join(' '); // keep 2 of every 5
    const s = sentenceDeficit({ ...k, tr: kept });
    expect(s.judged).toBe(true);
    expect(s.ratio).toBeLessThanOrEqual(SENT_DEFICIT_FLAG);
    expect(s.flag).toBe(true);
  });
  it('is unjudgeable on an unpointed Hebrew prayer page (no sentence marks), a plate, or a bilingual source', () => {
    expect(sentenceDeficit(QW['prayer-p333-short-meta'])).toEqual({ judged: false, why: 'few-sentences' });
    expect(sentenceDeficit({ ...QW['kircher-p317-notes'], type: 'plate' })).toEqual({ judged: false, why: 'non-prose' });
    const k = QW['kircher-p317-notes'];
    expect(sentenceDeficit({ ...k, ocr: '<language>Greek, Latin</language>\n' + k.ocr })).toEqual({ judged: false, why: 'multilingual-source' });
  });
});

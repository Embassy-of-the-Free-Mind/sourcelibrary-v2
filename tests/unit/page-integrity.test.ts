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
  parseVocab, vocabAbsent, repeatedBlocks, duplicateSlots, LOOP_MAX_TTR, LOOP_MIN_COPIES, REPEAT_MIN_CHARS,
  metaPayload, continuityMeta,
  translationReasoningLeak, translationPipelineTalk, TRANSLATION_LEAK_PREFILTER,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/page-integrity.mjs';

import {
  extremeForLanguage, TRUNC_NORM_FLAG, overlongTranslation, scanBook as scanBookForOverlong,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/audit/page-integrity.mjs';

const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/page-integrity', name), 'utf8'));
const CW = fx('catchwords.json').cases as any[];
const PN = fx('page-numbers.json').cases as any[];
const DUP = fx('duplicate-scans.json').cases as any[];
const TR = fx('translations.json');
const MP = fx('meta-payload.json').cases as any[];
const DS = fx('duplicate-slots.json').cases as Record<string, any>;

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

describe('a block reused in a second slot (#3591)', () => {
  it('flags Kitab al-Bulhan p.41: the <margin> is the body paragraph word for word', () => {
    // repeatedBlocks is blind to it: sourceProse strips <margin> before it looks
    expect(repeatedBlocks(DS['bulhan-p41-margin-copies-body'].ocr)).toMatchObject({ flag: false });
    const r = duplicateSlots(DS['bulhan-p41-margin-copies-body'].ocr);
    expect(r).toMatchObject({ judged: true, flag: true, repeatedHeads: [] });
    expect(r.copiedSlots).toHaveLength(1);
    expect(r.copiedSlots[0]).toMatchObject({ tag: 'margin' });
    expect(r.copiedSlots[0].share).toBeGreaterThan(0.9);
  });
  it('flags p.159: two headings transcribed identically while its own image-descs say one dot, then two', () => {
    const r = duplicateSlots(DS['bulhan-p159-heading-twice'].ocr);
    expect(r).toMatchObject({ judged: true, flag: true, copiedSlots: [] });
    expect(r.repeatedHeads).toEqual([{ text: 'قارعت الاثنين قارعت خمسة انا', count: 2, descsDiffer: true }]);
  });
  it('does not flag p.60 (one heading, no slot), nor headings that recur by design', () => {
    expect(duplicateSlots(DS['bulhan-p60-torn-grid'].ocr)).toMatchObject({ flag: false });
    // "A L I U D." twice: a letter-spaced label is ONE word, under HEADING_MIN_UNITS
    expect(duplicateSlots(DS['aliud-p17-spaced-label-twice'].ocr)).toEqual({ judged: false, why: 'no-slots' });
    // "Deinde cum dicit." — a commentary formula, three words
    expect(duplicateSlots(DS['commentary-p47-formula-heading'].ocr)).toEqual({ judged: false, why: 'no-slots' });
  });
  it('flags a <note> copied from an earlier slot, and passes a short marginal citation', () => {
    const para = 'Nihil est in intellectu quod non prius fuerit in sensu, ut dicunt philosophi omnes qui de anima scripserunt';
    expect(duplicateSlots(`<margin>${para}</margin>\n\nAliud corpus paginae.\n\n<note>${para}</note>`).copiedSlots).toMatchObject([{ tag: 'note', share: 1 }]);
    expect(duplicateSlots('<margin>Matth. ult.</margin>\n\nEuntes docete omnes gentes. Matth. ult.')).toEqual({ judged: false, why: 'no-slots' });
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

// Fixtures are phrases from real pages in the 2026-10-06 corpus walk (#6056): the positives are the model's
// scratchpad stored as the English; the negatives are book text the first, wider net caught.
describe('translationReasoningLeak', () => {
  const POSITIVE = [
    '    *   *Wait, the prompt says:* "Style: warm museum label - explain rather than assume knowledge."\n    *   I will add a note',
    'The user provided a Latin text and asked for an English translation, preserving the formatting',
    '*   *Self-Correction during drafting:* The first sentence in the OCR is a fragment',
    '* The prompt mentions red staining on the left edge. I\'ll include that in the `<meta>` tag.',
    '*(Self-Correction during drafting)*: The input says "D. JOH. TAULERI".',
    '*Formatting check:*\n- Header: # THE FIRST ALCIBIADES.',
    '*   **Target Language:** Accessible English',
    'shall be changed to <term>ais</term>. <note>Wait, the text says "changed to bhir"</note> Example:',
    'I should translate it but keep it in the `<margin>` tag as requested.',
    '*Wait, the Greek in line 12:* nothing healthy',
    'Please note: The provided text is in Latin, not Greek. I will translate the Latin text into English, preserving the formatting and paragraph breaks as requested.',
  ];
  const NEGATIVE = [
    'by which they lie in* > *wait to deceive: and delighting to be deceived',
    'you still would not have fulfilled my instructions for a Hearer.',
    'He says: Wait, I will tell you what praying is, and that one may not pray without faith.',
    'through the prompt instruction of theologians. But to him who has bestowed his labor',
    'For the present, I will translate his words thus: *Aristotle and his followers',
    'A Revised Translation, with an Introduction, by C. BIGG, D.D.',
    'in my opinion, this is the final decision: that the world stands in a place',
    'require no self-correction</note>. There are three types of these.',
    '<note>Pavāraṇā (self-correction) is the ceremony held at the end of the rainy season retreat</note>',
    '*   **Refinement/Struggle (Mocui):** A complex term suggesting that success is achieved only after effort.',
    '**We shall check:** <note>original: "ἐρύξομεν"</note> We shall hold back or hinder.',
    'such details will be settled in a friendly spirit once you provide the further information you promised.',
    '**SALV.** *Wait, I pray you, Signor Sagredo, for just now a way occurs to me',
    '**Wait:** that Virgil should wait for him because inferior reason',
    'then I will treat the **Archeal ideas** <note>The *Archeus* is the internal "master workman"</note>',
    'I will transcribe the words of Aristotle himself from the book I mentioned: <term>The study of truth',
    '<note>The OCR reads "māhī prāpta", but the commentary glosses it as "do not delay".</note>',
    'Here is the translation of the verse, which the author gives in the margin, and it is not elegant.',
    // #6523 corpus walk: book text that announces a translation, which the rule must leave alone.
    'the practices of black magic.\n\nHere is the translation:\n\n> "I, Cyprian, servant of our Lord Jesus Christ',
    'Here is the translation of Huygens\'s text:\n\n"October 20, 1658, smoothed a good lens',
    'The song consists of two stanzas; here is a free translation:\n',
    'of this short epistle <note>3</note>, here is the translation:\n',
  ];
  it('flags the scratchpad phrases', () => {
    for (const t of POSITIVE) expect(translationReasoningLeak(t), t).toMatchObject({ kind: 'reasoning', readerVisible: true });
  });
  it('leaves book text alone', () => {
    for (const t of NEGATIVE) expect(translationReasoningLeak(t), t).toBeNull();
  });
  it('the wide net the walk sends to the server catches everything the rule does', () => {
    for (const t of POSITIVE) expect(TRANSLATION_LEAK_PREFILTER.test(t), t).toBe(true);
    expect(TRANSLATION_LEAK_PREFILTER.test('thought\n<meta>This page continues</meta>')).toBe(true);
  });
  it('says whether a reader sees it: a phrase only inside <meta> sits in the metadata panel', () => {
    expect(translationReasoningLeak('<meta>The user wants "warm museum label" style.</meta>\nIn the beginning')).toMatchObject({ kind: 'reasoning', readerVisible: false });
  });
  it('a chat reply to the requester is its own kind', () => {
    for (const t of [
      'Please provide the OCR transcription text you would like me to translate. The input you provided consists only of dots',
      '5. **Include the required metadata, summary, and keywords.**\n\n**Please paste the text below to begin.**',
      // #6523: the two Tengyur CLI pages, the second with the announcement partway down.
      'If you intended to provide the text directly for an immediate translation rather than creating a software project plan, here is the translation adhering strictly to all your formatting, tagging, and style rules:\n\n<meta>continues from previous page</meta>\nIf one wonders',
      'The provided text has a stamp.\n\nHere is the English translation of the provided Latin text, preserving formatting and paragraph breaks:\n\nOf the Royal Chemistry',
    ]) {
      expect(translationReasoningLeak(t), t).toMatchObject({ kind: 'assistant-reply', readerVisible: true });
      expect(TRANSLATION_LEAK_PREFILTER.test(t), t).toBe(true);
    }
  });
  it('the model naming its input is the mildest kind, and usually sits in <meta>', () => {
    expect(translationReasoningLeak('<meta>Page 405 is missing from the provided transcription.</meta>\ndominion. But the daemon')).toMatchObject({ kind: 'input-talk', readerVisible: false });
    expect(translationReasoningLeak('The provided text contains no content to modernize, as it consists only of a blank page.')).toMatchObject({ kind: 'input-talk', readerVisible: true });
  });
  it('the bare thinking-channel label at the head of a page is its own kind', () => {
    expect(translationReasoningLeak('thought\n<meta>This page continues the legal analysis</meta>')).toMatchObject({ kind: 'thought-token' });
    expect(translationReasoningLeak('164  ST. AMBROSE.\nthought\nthat he was restored to us')).toBeNull();
  });
  it('a note that cites "the OCR" is pipeline talk, not reasoning', () => {
    expect(translationPipelineTalk('<note>The OCR reads "left" again</note>')).toBe(true);
    expect(translationPipelineTalk('<note>The smaller characters in the <gloss> tags are pronunciation guides</note>')).toBe(true);
    expect(translationReasoningLeak('<note>The smaller characters in the <gloss> tags are pronunciation guides</note>')).toBeNull();
    expect(translationPipelineTalk('<meta>the watermark mentioned in the OCR has been omitted</meta> In the beginning')).toBe(false);
  });
});

describe('a stored translation the write door would refuse as a runaway (#4098)', () => {
  // shapes as measured on the issue's pages: ~3,000 characters of Latin, and what was stored against it
  const latin = Array.from({ length: 60 }, (_, i) => `Quaestio ${i} de radicibus arboris elementalis et de forma prima generali.`).join(' ');
  const english = Array.from({ length: 60 }, (_, i) => `Question ${i} of the roots of the elemental tree and of the primary general form.`).join(' ');

  it('passes an ordinary translation', () => {
    expect(overlongTranslation({ ocr: latin, tr: english })).toBeNull();
    expect(overlongTranslation({ ocr: latin, tr: '' })).toBeNull();
  });
  it('padding: a table cell filled with spaces to the output cap (Plotinus p706: 192,156 chars, 48 of them prose)', () => {
    const r = overlongTranslation({ ocr: latin, tr: `662 PLOTINI ENNEAD. VI.\n\n| [Column 1: Latin Text] ${' '.repeat(120000)}` });
    expect(r?.shape).toBe('padding');
    expect(r?.trBody).toBeLessThan(100);
  });
  it('loop: one sentence over and over (Fludd p754, x324)', () => {
    const r = overlongTranslation({ ocr: latin, tr: 'From point P., let a line be drawn perpendicular to H.L., which intersects I.E. at point P. '.repeat(324) });
    expect(r?.shape).toBe('loop');
  });
  it('overrun: prose with no repeat, far past the page', () => {
    const tr = Array.from({ length: 400 }, (_, i) => `Sentence ${i} speaks of matter ${i * 7} and of form ${i * 13} in turn.`).join(' ');
    expect(overlongTranslation({ ocr: latin, tr })?.shape).toBe('overrun');
  });
  it('scanBook counts it and writes one row per page', () => {
    const rows = [{ p: 1, ocr: latin, tr: english }, { p: 2, ocr: latin, tr: `| [Left Column] ${' '.repeat(50000)}` }];
    const { lines } = scanBookForOverlong('b', rows, { bookLang: 'Latin' });
    expect(lines.at(-1).overlong).toEqual({ judged: 2, flagged: 1, shapes: { padding: 1 } });
    expect(lines.filter((l: { kind: string }) => l.kind === 'overlong').map((l: { p: number }) => l.p)).toEqual([2]);
  });
});

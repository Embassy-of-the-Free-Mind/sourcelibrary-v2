/**
 * The free IA OCR lane's agreement score (scripts/lib/ia-ocr-agreement.mjs, #4806).
 *
 * Pins three things: that a space-less script is scored by CHARACTER (the word tokenizer found one
 * token in a Chinese page and read a one-glyph near-miss as 0.000); that a Latin-script text
 * tokenizes exactly as the pre-#4806 gate did (the per-language cutoffs are calibrated on it); and
 * that the score can say NO — two different Chinese pages must score low, or per-character matching
 * over a small inventory is manufacturing agreement (non-latin-text-operations.md).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { tokens, tokensBody, ratio, agreement } from '../../scripts/lib/ia-ocr-agreement.mjs';

// The tokenizer the gate used from #4783 until #4806, kept here as the Latin-script oracle.
const legacyTokens = (s: string) => (s || '').replace(/<[^>]+>/g, ' ').normalize('NFC').replace(/[’‘ʼ]/g, "'").toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];

// Two real reference pages (Gemini reads of 四庫全書 leaves, public domain), trimmed.
const PAGE_A = '河之南天偶大雷電有血流潤大石之中生慶都長大\n形像大帝常有黃雲蓋之 列女傳曰黃帝妃嫫母於\n四妃之班居下貌甚醜而最賢心每自退 漢武故事\n曰漢景帝夢高祖謂已曰王美人得子可名為彘 又\n曰鉤弋夫人卒既殯尸香聞十里餘因葬雲陵上哀悼\n之又疑其非常人乃發冢開視空棺無尸惟衣履存';
const PAGE_B = '姪\n潪\n鬒\n嶗\n坪\n洴\n鷓\n縈\n糾\n浤\n呟\n擎\n枰\n絣\n趟\n振\n晒\n娉\n鎖\n璲\n蔓\n蝶\n營\n金史\n卷二十三之十一目錄\n太上感應篇曰禍福無門惟人自召善惡之報如影隨形';

describe('tokens', () => {
  it('scores a space-less script one token per character', () => {
    expect(tokens('太上感應篇曰禍福無門惟人自召')).toEqual([...'太上感應篇曰禍福無門惟人自召']);
    expect(legacyTokens('太上感應篇曰禍福無門惟人自召')).toHaveLength(1); // the #4806 artifact
  });

  it('tokenizes Latin-script text exactly as the pre-#4806 gate did', () => {
    const en = "The Testimony of Christ's Second Appearing; a ‘general’ statement — 1808, Ἀριστοτέλης, Über.";
    expect(tokens(en)).toEqual(legacyTokens(en));
  });

  it('segments a mixed page run by run', () => {
    expect(tokens('Jin Shi 金史 p. 45')).toEqual(['jin', 'shi', '金', '史', 'p', '45']);
    expect(tokens('漢字abc字')).toEqual(['漢', '字', 'abc', '字']);
  });

  it('keeps a Devanagari word whole but strips Arabic and Hebrew pointing (edition-level, not text)', () => {
    expect(tokens('कि तु')).toEqual(['कि', 'तु']);
    expect(legacyTokens('कि')).toEqual(['क']); // the pre-#4806 tokenizer dropped the vowel sign
    expect(tokens('بِسْمِ اللَّهِ')).toEqual(tokens('بسم الله'));
    expect(tokens('בְּרֵאשִׁית')).toEqual(tokens('בראשית'));
    expect(tokens('ab́c')).toEqual(['ab́c']); // a Latin combining mark stays (NFC has no precomposed form)
  });

  it('folds edition glyph variants and full-width forms in space-less runs', () => {
    expect(tokens('爲靑')).toEqual(['為', '青']);
    expect(tokens('隆')).toEqual(['隆']); // CJK compatibility ideograph → unified (NFKC)
  });

  it('KNOWN BIAS: editorial block content still counts in the gate tokenizer (cutoffs are calibrated on it)', () => {
    const t = '<scan-quality>good</scan-quality>\n<image-desc type="woodcut">A page from a Chinese woodblock-printed book.</image-desc>\n<header>欽定四庫全書</header>\n<vocab>慶都, 黃帝</vocab>\n河之南';
    expect(tokens(t)).toEqual(['good', 'a', 'page', 'from', 'a', 'chinese', 'woodblock', 'printed', 'book', ...'欽定四庫全書慶都黃帝河之南']);
    // The corrected variant, for the follow-up that re-derives the cutoffs: blocks dropped, printed marks kept.
    expect(tokensBody(t)).toEqual([...'欽定四庫全書河之南']);
  });

  it('keeps the body when a centred-heading marker precedes a later tag (#4966)', () => {
    // `->TITLE<-` is how the model marks centred text. `<[^>]+>` treated the `<-` as an opening
    // tag and consumed everything up to the next real tag's `>`, deleting the page body from the
    // comparison: divineinspiratio00will p9 kept 25 of 348 tokens and scored 0.086 against IA text
    // it matches at 0.983, which REJECTED the whole book at the 0.80 gate.
    const page = '<page-type>preface</page-type>\n->THE WRITER\'S INTRODUCTION.<-\n\nthe name of this philosophy\n\n<vocab>psychic</vocab>';
    expect(tokens(page)).toEqual(['preface', 'the', "writer's", 'introduction', 'the', 'name', 'of', 'this', 'philosophy', 'psychic']);
    // A real tag is still stripped with its delimiters; only the `<-` marker is no longer a tag.
    expect(tokens('<header>abc</header>')).toEqual(['abc']);
    expect(tokens('a <b>c</b> d')).toEqual(['a', 'c', 'd']);
  });
});

describe('ratio / agreement', () => {
  it('reads a one-character near-miss as near-perfect, where the word tokenizer read 0', () => {
    const a = '太上感應篇曰禍福無門惟人自召善惡之報如影隨形', b = '太上感應篇曰禍福無門惟人自召善惡之報如影隨刑';
    expect(agreement(a, b)).toBeGreaterThan(0.95);
    expect(ratio(legacyTokens(a), legacyTokens(b))).toBe(0);
  });

  it('NEGATIVE CONTROL: two different Chinese pages score far below any cutoff', () => {
    expect(agreement(PAGE_A, PAGE_A)).toBe(1);
    expect(agreement(PAGE_A, PAGE_B)).toBeLessThan(0.35);
    expect(agreement(PAGE_B, PAGE_A)).toBeLessThan(0.35);
  });

  it('returns 0 when either side has no tokens', () => {
    expect(agreement('', PAGE_A)).toBe(0);
    expect(ratio(tokensBody('<image-desc>only a description</image-desc>'), tokens(PAGE_A))).toBe(0);
  });
});

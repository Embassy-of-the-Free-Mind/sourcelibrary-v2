// PRIOR ART: tests/unit/verify-quote.test.ts pins the four tiers of #4778; this file pins the
// fifth (`translit`) and the two Latin-side fixes that came out of hand-checking its residue
// (hyphenated line breaks, elided quotes). tests/unit/concept-aliases.test.ts pins the alias
// tiers, not romanisation. No overlap.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs with no type declarations
import { verifyQuote, quoteVerified } from '../../scripts/lib/page-terms-parse.mjs';
// @ts-expect-error — .mjs with no type declarations
import { skeletonMatch, SCRIPTS } from '../../scripts/lib/translit-skeleton.mjs';

/**
 * #4777, step two: the `script` tier was 55% of everything the old boolean called "unverified"
 * (114K notes re-tiered locally, 2026-09-13). Reducing both the romanised note and the page's
 * foreign-script text to a per-script skeleton turns half of it into a real verdict.
 *
 * Every POSITIVE below is a real (note, page) shape from that population or a pair from the
 * concept-alias table (#4695). Every NEGATIVE exists so a looser matcher goes red: the shuffled
 * control (a note against a different page of the same script) sits at 0–3.4% per script with
 * these thresholds, 5% for Tibetan, and a matcher that says yes to everything is worse than the
 * `script` verdict it replaces.
 */
describe('skeletonMatch — romanised note against a foreign-script page', () => {
  it('Greek: Latinised endings and inflection', () => {
    expect(skeletonMatch('alloprosallon', 'ὁ δὲ ἀλλοπρόσαλλος ἐστιν').matched).toBe(true);
    expect(skeletonMatch('gnothi seauton', 'τὸ γνῶθι σεαυτόν').matched).toBe(true);
    expect(skeletonMatch('leitourgia', 'ἡ λειτουργία καλεῖται').matched).toBe(true);
    expect(skeletonMatch('angelos', 'ὁ ἄγγελος εἶπεν').matched).toBe(true);   // γγ → ng
  });

  it('Devanagari: IAST, popular spelling, sandhi', () => {
    expect(skeletonMatch('Tattvajnana', 'तत्त्वज्ञानम् उच्यते').matched).toBe(true);
    expect(skeletonMatch('dikshapurvam', 'दीक्षापूर्वं महेशानि').matched).toBe(true);
    expect(skeletonMatch('nisphalam', 'कालो निष्फलम् इति').matched).toBe(true);
    expect(skeletonMatch('Ashtanga', 'अष्टाङ्ग योगः').matched).toBe(true);
    expect(skeletonMatch('saṅkrānti-avadhi', 'सौरस्तसंक्रान्त्यवधियेतोतः').matched).toBe(true); // -ty- glide
  });

  it('Tibetan: Wylie with any hyphenation or capitalisation', () => {
    expect(skeletonMatch('sangs rgyas kyi zhing', 'སངས་རྒྱས་ཀྱི་ཞིང་').matched).toBe(true);
    expect(skeletonMatch('bDud rtsi', 'བདུད་རྩི་ཡི་').matched).toBe(true);
    expect(skeletonMatch('rdzogs-chen', 'རྫོགས་ཆེན་').matched).toBe(true);
    expect(skeletonMatch('Mar-me-mdzad', 'མར་མེ་མཛད་').matched).toBe(true);
  });

  it('Arabic: article, shadda, tāʾ marbūṭa, matres lectionis', () => {
    expect(skeletonMatch('Kitab al-Silk', 'كتاب السلك ملكه العبد').matched).toBe(true);
    expect(skeletonMatch('al-hijamah', 'باب الحجامة').matched).toBe(true);
    expect(skeletonMatch('al-Mawla Muhammad', 'المولى محمد بن مراد').matched).toBe(true); // shadda
    expect(skeletonMatch('Ibn Sina', 'مروي عن ابن سينا الذي').matched).toBe(true);         // ī written ي
    expect(skeletonMatch('muraqaba', 'في المراقبة').matched).toBe(true);           // after the article
  });

  it('Hebrew: the ch/kh ambiguity resolves either way, even inside one phrase', () => {
    expect(skeletonMatch('massecheth challah', 'מסכת חלה').matched).toBe(true); // כ then ח
    expect(skeletonMatch('sefirot', 'עשר ספירות בלימה').matched).toBe(true);
    expect(skeletonMatch('hitbodedut', 'התבודדות').matched).toBe(true);
  });

  // ---- negative controls ------------------------------------------------------------------
  it('NEGATIVE: an English word noted as "original" on a Latin page with one stray Greek letter is absent', () => {
    // A quarter of the Greek- and Devanagari-page cases in the population looked like this.
    const r = skeletonMatch('blockish', 'The Preface. Thomas Scotus θεοδίδακτοι had no better successe');
    expect(r.matched).toBe(false);
    expect(r.uncovered).toBe(false);
  });

  it('NEGATIVE: a note against a different page of the same script does not match', () => {
    expect(skeletonMatch('Kitab al-Silk', 'القول على الوجه الثالث من النظر اذا كان الطالع الحمل').matched).toBe(false);
    expect(skeletonMatch('Tattvajnana', 'पश्यन्नपि न पश्येत् स शृण्वन्नपि न बुध्यति').matched).toBe(false);
    expect(skeletonMatch('alloprosallon', 'ἐν ἀρχῇ ἦν ὁ λόγος καὶ ὁ λόγος ἦν πρὸς τὸν θεόν').matched).toBe(false);
  });

  it('NEGATIVE: a skeleton must start where a page word starts', () => {
    // "ktb" is inside مكتبة (maktaba) but the word kitāb is not on this page.
    expect(skeletonMatch('kitab', 'في المكتبة الكبيرة').matched).toBe(false);
  });

  it('NEGATIVE: too few consonants is uncheckable, not a match and not an accusation', () => {
    // dhikr (d-k-r) and apatheia (p-t) sit under the four-consonant floor: `script`, never `absent`.
    for (const [q, p] of [['dhikr', 'ذكر الله'], ['apatheia', 'περὶ ἀπαθείας τοῦ νοῦ']]) {
      const r = skeletonMatch(q, p);
      expect(r.matched).toBe(false);
      expect(r.uncovered).toBe(true);
    }
  });

  it('NEGATIVE: a script this module cannot romanise is reported uncovered', () => {
    const r = skeletonMatch('nianfo', '念佛三昧');
    expect(r.matched).toBe(false);
    expect(r.uncovered).toBe(true);
  });

  it('never lets the page\'s own Latin text into the skeleton', () => {
    // The word IS on the page in Latin script — but that is the substring verifier's job, and
    // letting Latin text into a vowel-collapsed skeleton is what produced 22% false positives.
    expect(skeletonMatch('theologia', 'theologia platonica λόγος').matched).toBe(false);
  });

  it('exposes one romaniser per covered script', () => {
    expect(Object.keys(SCRIPTS).sort()).toEqual(['Arabic', 'Cyrillic', 'Devanagari', 'Greek', 'Hebrew', 'Syriac', 'Tibetan']);
  });
});

describe('verifyQuote — the translit tier and the Latin-side residue fixes (#4777)', () => {
  it('translit: a romanised note on a page in a covered script', () => {
    expect(verifyQuote('Kitab al-Silk', 'كتاب السلك ملكه العبد الفقير')).toBe('translit');
    expect(quoteVerified('translit')).toBe(true);
  });

  it('absent: a romanised note not on a page whose scripts were all checked', () => {
    expect(verifyQuote('blockish', 'The Preface. Thomas Scotus θεοδίδακτοι had no better successe')).toBe('absent');
  });

  it('script: a note against a page in a script that cannot be romanised stays uncheckable', () => {
    expect(verifyQuote('nianfo', '念佛三昧 經')).toBe('script');
    expect(quoteVerified('script')).toBeNull();
  });

  it('folded: a word hyphenated across a printed line break', () => {
    // Line-end hyphenation reaches the verifier as "infal- libilem"; a quote of the whole word
    // could never match its own page.
    expect(verifyQuote('infallibilem', 'Spem nanciscitur infal- libilem et quae nunquam vana sit')).toBe('folded');
  });

  it('elided quote: each fragment is verified and the weakest verdict wins', () => {
    expect(verifyQuote('imberbem... Cometam', 'vidit imberbem iuvenem et Cometam in caelo')).toBe('exact');
    expect(verifyQuote('imberbem... Cometam', 'vidit imberbem iuvenem tantum')).toBe('absent');
    expect(verifyQuote('imberbem … Cometam', 'vidit imberbem iuvenem et Cometam in caelo')).toBe('exact');
  });

  it('NEGATIVE CONTROL: a hyphen that is not a line break is left alone', () => {
    // "well- Known" (capital) is not joined; "Kalachakra" is not made from "Kala- chakra"'s pieces.
    expect(verifyQuote('wellknown', 'a well- Known fact')).toBe('absent');
  });
});

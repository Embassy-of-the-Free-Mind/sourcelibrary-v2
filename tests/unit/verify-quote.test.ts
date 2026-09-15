// PRIOR ART: tests/unit/page-terms-type.test.ts pins the TYPING of harvested terms and
// tests/unit/concept-aliases.test.ts pins the alias tiers; neither exercises the
// original-note quote verifier, which is what #4777 changed. No overlap.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs with no type declarations
import { verifyQuote, quoteVerified, foldForQuoteMatch, parseTranslationTerms } from '../../scripts/lib/page-terms-parse.mjs';

/**
 * #4777: the verifier used to be a plain substring match, so it reported four different
 * things as one. Measured on a 500-note random sample of the "unverified" population:
 * 50% romanisation, 20% diacritics, 6% historic orthography, 4% inflection, 20% truly absent.
 *
 * Each POSITIVE case below is a real shape from that sample. Each NEGATIVE case exists so a
 * later "improvement" that makes the matcher looser goes red instead of quietly verifying
 * everything — a verifier that says yes to everything is worse than the bug it replaced.
 */
describe('verifyQuote tiers (#4777)', () => {
  it('exact: the phrase is on the page character for character', () => {
    expect(verifyQuote('praedicatur', 'quod praedicatur de anima')).toBe('exact');
  });

  it('folded: differs only by Latin diacritics', () => {
    expect(verifyQuote('Primitiae', 'de primitiæ et de reliquis')).toBe('folded');
    expect(verifyQuote('Jesaiae 29', 'text Jesaiæ 29: vers 15 legitur')).toBe('folded');
  });

  it('folded: the long s, which is why early-modern Latin could not match its own page', () => {
    // The case that found this bug: the page prints "multis luſtris".
    expect(verifyQuote('lustris', 'qui primus Norvegiæ, multis luſtris ante Haraldum')).toBe('folded');
    expect(verifyQuote('statuitur', 'Norvegiæ ſtatuitur Monarcha')).toBe('folded');
  });

  it('stem: the note gives another inflection of a word that is on the page', () => {
    expect(verifyQuote('singularia', 'de rebus singularibus dicendum est')).toBe('stem');
  });

  it('translit: a Latin quote that romanises what the page prints in another script', () => {
    // Counting this as fabrication was half the bug (#4778 made it `script`, uncheckable);
    // the skeleton romaniser (translit-skeleton.mjs) now returns a real verdict.
    expect(verifyQuote('alloprosallon', 'ὁ δὲ ἀλλοπρόσαλλος ἐστιν')).toBe('translit');
    expect(verifyQuote('bDud rtsi', 'བདུད་རྩི་ཡི་')).toBe('translit');
    expect(quoteVerified('translit')).toBe(true);
  });

  it('script: a Latin quote against a script that cannot be romanised is UNCHECKABLE, not absent', () => {
    expect(verifyQuote('nianfo', '念佛三昧 經')).toBe('script');
    expect(quoteVerified('script')).toBeNull();
  });

  it('absent: genuinely not on the page — the honest suspect class', () => {
    expect(verifyQuote('nidore altarium', 'a wholly unrelated Latin sentence about ships')).toBe('absent');
    expect(verifyQuote('darnach richten', 'ein ganz anderer deutscher Satz hier')).toBe('absent');
  });

  // ---- negative controls: the matcher must still be able to say no --------------------------
  it('NEGATIVE CONTROL: a short prefix must not verify a longer phrase', () => {
    // "sing" appears; "singulari…" does not. A 2-3 char stem rule would wrongly pass this.
    expect(verifyQuote('singabcdef', 'we sing of arms and the man')).toBe('absent');
  });

  it('NEGATIVE CONTROL: a non-Latin quote absent from a non-Latin page is absent, not script', () => {
    // 'script' is only for a LATIN quote against a non-Latin page. A Greek quote missing from a
    // Greek page is a real miss and must be reported as one.
    expect(verifyQuote('διαθήκην περιτομῆς', 'ἄλλο τι κείμενον ἐστιν ὧδε')).toBe('absent');
  });

  it('NEGATIVE CONTROL: folding must not destroy non-Latin script', () => {
    // If Greek breathings/accents were stripped like Latin diacritics, these would collapse
    // together and the matcher would verify a phrase that is not on the page.
    expect(foldForQuoteMatch('ἡσυχία')).not.toBe(foldForQuoteMatch('ησυχια'));
    expect(foldForQuoteMatch('שָׁלוֹם')).toContain('ָ'); // Hebrew points survive
  });

  it('NEGATIVE CONTROL: empty quote or empty page never verifies', () => {
    expect(verifyQuote('', 'anything at all')).toBe('absent');
    expect(verifyQuote('something', '')).toBe('absent');
  });

  it('quoteVerified maps tiers to the back-compatible boolean, with null for unknowable', () => {
    expect(quoteVerified('exact')).toBe(true);
    expect(quoteVerified('folded')).toBe(true);
    expect(quoteVerified('stem')).toBe(true);
    expect(quoteVerified('absent')).toBe(false);
    expect(quoteVerified('script')).toBeNull();
  });
});

describe('parseTranslationTerms carries the tier (#4777)', () => {
  it('emits match alongside verified', () => {
    const tr = 'stillness <note>original: "luſtris"</note> of the north';
    const rows = parseTranslationTerms(tr, 'multis luſtris ante Haraldum', {});
    const note = rows.find((r: any) => r.kind === 'original');
    expect(note.match).toBe('exact');
    expect(note.verified).toBe(true);
  });

  it('a romanised note against a Greek page is not reported as fabricated', () => {
    const tr = 'stillness <note>original: "hesychian"</note>';
    const rows = parseTranslationTerms(tr, 'περὶ τὴν ἡσυχίαν αὐτοῦ', {});
    const note = rows.find((r: any) => r.kind === 'original');
    expect(note.match).toBe('script');
    expect(note.verified).toBeNull(); // NOT false — this is the whole point of #4777
  });
});

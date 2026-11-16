/**
 * #8632 Part 4: the free OCR↔English checks. Each case is a real specimen shape from the error zoo (quoted in the
 * detector-suite write-up), so a change that breaks one breaks a measured behaviour, not an invented one.
 */
import { describe, it, expect } from 'vitest';
import { negationCount, negationDeficit, sourceNumbers, untracedNumbers, englishOverUnclear, noteHedges, langKey } from '../../scripts/lib/ocr-english-checks.mjs';

describe('ocr-english-checks (#8632)', () => {
  it('counts Greek negations with accents and a dropped μή', () => {
    const src = "Ἐὰν δ' ὑπὲρ τὴν οὐσίαν δαπανῶν τύχῃ, ἀπαγορεύειν αὐτῷ τοῦτο μὴ ποιεῖν ἔτι";
    expect(negationCount(src, 'el')).toBe(1);
    expect(negationDeficit(src, "But if he happens to be spending someone else's property, let it be allowed", 'el').score).toBe(1);
  });
  it('counts English contractions and French ne…pas once', () => {
    expect(negationCount("He didn't come, and no one knew.", 'en')).toBe(2);
    expect(negationCount("Il ne vient pas", 'fr')).toBe(1);
  });
  it('reads Greek keraia, Chinese, Hebrew and dotted Roman numerals', () => {
    expect(sourceNumbers("τὰ δὲ στοιχεῖα η' καὶ τ'.").has(8)).toBe(true);
    expect(sourceNumbers('凡二十四篇').has(24)).toBe(true);
    expect(sourceNumbers('Anno M.D.LXXXIII').has(1583)).toBe(true);
    expect(sourceNumbers('פרק י"ב').has(12)).toBe(true);
  });
  it('flags a Gregorian year the source does not carry (the ganzhi specimen), and excuses a verse reference in a note', () => {
    const u = untracedNumbers('乙巳閏正月初五夜秉燭而書焉', 'the <term>Eul-sa</term> year <note>1765</note>');
    expect(u.inNotes).toBe(1);
    expect(untracedNumbers('יפתי יי ליפת', 'The LORD shall enlarge Japhet <note>Genesis 9:27</note>').inNotes).toBe(0);
  });
  it('does not count digits inside metadata tags', () => {
    expect(untracedNumbers('text', '<page-num>112</page-num>\nNo numbers here.').score).toBe(0);
  });
  it('englishOverUnclear: an <unclear> span with no marker in the English', () => {
    expect(englishOverUnclear('a <unclear>xx</unclear> b', 'Here are the five holy portions').score).toBe(1);
    expect(englishOverUnclear('a <unclear>xx</unclear> b', 'a [illegible] b').score).toBe(0);
  });
  it('noteHedges counts hedges inside notes only', () => {
    expect(noteHedges('likely so <note>likely a reference to a local feast day</note>').hedges).toBe(1);
  });
  it('langKey maps catalogue names', () => {
    expect(['Latin', 'Greek', 'Chinese', 'German', 'English'].map(langKey)).toEqual(['la', 'el', 'cjk', 'de', 'en']);
  });
});

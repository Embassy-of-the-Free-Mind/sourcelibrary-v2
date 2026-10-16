import { describe, it, expect } from 'vitest';
import { slotLanguage, languageInstruction } from '../../scripts/batch/claude-ocr.mjs';

// #6559: Maya dictionaries and grammars are catalogued under their front-matter language (books.language is the
// EDITION's language, language-fields.md), so the OCR prompt's language slot needs a --language override to carry
// the Maya orthography paragraph. An unknown override must refuse, not silently drop that paragraph.
describe('claude-ocr --language override', () => {
  it('uses the book language when no override is given', () => {
    expect(slotLanguage('Spanish', undefined)).toBe('Spanish');
    expect(slotLanguage('Spanish', '')).toBe('Spanish');
  });

  it('overrides the book language for the slot', () => {
    expect(slotLanguage('Spanish', 'Yucatec Maya')).toBe('Yucatec Maya');
    expect(slotLanguage('French', "K'iche' Maya")).toBe("K'iche' Maya");
    expect(slotLanguage(null, "Q'eqchi'")).toBe("Q'eqchi'");
  });

  it('refuses an override with no orthography', () => {
    expect(() => slotLanguage('Spanish', 'Yucatec')).toThrow(/no orthography/);
    expect(() => slotLanguage('Spanish', 'maya')).toThrow(/no orthography/);
  });

  it('the overridden slot carries the orthography paragraph; the book language alone does not', () => {
    expect(languageInstruction(slotLanguage('Spanish', 'Yucatec Maya'))).toMatch(/Yucatec Maya orthography \(CRITICAL\).*reversed c ɔ/s);
    expect(languageInstruction(slotLanguage('Spanish', undefined))).not.toMatch(/orthography \(CRITICAL\)/);
    expect(languageInstruction(slotLanguage('German', 'Kaqchikel'))).toMatch(/cuatrillo ꜭ/);
  });
});

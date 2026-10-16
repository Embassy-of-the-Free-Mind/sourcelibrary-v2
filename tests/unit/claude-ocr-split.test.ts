import { describe, it, expect } from 'vitest';
import { splitPages, languageInstruction, callInstruction } from '../../scripts/batch/claude-ocr.mjs';

// #6559: one Opus call reads up to 10 pages; a reply is attributed to pages ONLY by its markers, so any reply whose
// markers are not exactly p01..pNN in order is refused whole rather than mis-attributed to the wrong page.
describe('claude-ocr splitPages', () => {
  const reply = (names: string[]) => names.map((n) => `===== PAGE ${n} =====\n<page-type>text</page-type>\ntext of ${n}`).join('\n\n');

  it('splits a well-formed reply in order', () => {
    expect(splitPages(reply(['p01', 'p02', 'p03']), 3)).toEqual(['<page-type>text</page-type>\ntext of p01', '<page-type>text</page-type>\ntext of p02', '<page-type>text</page-type>\ntext of p03']);
  });

  it.each([
    ['a dropped page', ['p01', 'p03'], 3],
    ['a merged page (one marker short)', ['p01', 'p02'], 3],
    ['a repeated page', ['p01', 'p01', 'p02'], 3],
    ['reordered pages', ['p02', 'p01'], 2],
    ['an extra page', ['p01', 'p02', 'p03'], 2],
  ])('refuses %s', (_label, names, n) => {
    expect(splitPages(reply(names as string[]), n as number)).toBeNull();
  });

  it('refuses prose before the first marker', () => {
    expect(splitPages(`Here are the transcriptions.\n${reply(['p01'])}`, 1)).toBeNull();
  });

  it('the language slot names the orthography and the call instruction names every file', () => {
    expect(languageInstruction('Kaqchikel')).toMatch(/ꜭ/);
    expect(languageInstruction('Yucatec Maya')).toMatch(/ɔ/);
    expect(languageInstruction('Nahuatl')).toMatch(/Nahuatl/);
    expect(callInstruction(3)).toMatch(/p01, p02, p03 in this folder/);
  });
});

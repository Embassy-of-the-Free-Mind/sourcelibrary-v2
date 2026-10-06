import { describe, it, expect } from 'vitest';
import { separateTermDefinitions, splitTermDefinition } from '@/lib/term-definitions';
import { applyNotesOff } from '@/lib/notes-off';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';
import { markdownToHtml } from '@/lib/export-markdown-html';

/**
 * The model's definitions are commentary, not page text (#5895).
 *
 * Excerpts are from stored translations:
 *  - GEOMANCY: book 6975158aa88d83c830d99e22 p.83
 *    (https://sourcelibrary.org/book/6975158aa88d83c830d99e22?page=83)
 *  - SILVER: book 69c86fb56c6f3cc53c85713b p.15
 *    (https://sourcelibrary.org/book/69c86fb56c6f3cc53c85713b?page=15)
 */
const GEOMANCY =
  '**Geomancy** <term>Geomancy: A method of divination that interprets markings on the ground or the patterns formed by tossed handfuls of soil, rocks, or sand.</term>, an art performed through points without a natural basis;';
const HYDROMANCY =
  '**Hydromancy** <term>Hydromancy: Divination using water, such as observing ripples, colors, or reflections.</term> is an art performed through water;';
const SILVER =
  "where <term>Sulphur</term> boils mixed with perennial <term>Silver</term> <gloss>mercury or 'quicksilver'</gloss>, fleeing";

describe('separateTermDefinitions', () => {
  it('turns a definition inside <term> into a note, dropping a head that already precedes it', () => {
    expect(separateTermDefinitions(GEOMANCY)).toBe(
      '**Geomancy** <note>A method of divination that interprets markings on the ground or the patterns formed by tossed handfuls of soil, rocks, or sand.</note>, an art performed through points without a natural basis;'
    );
  });

  it('keeps the term chip when the head is not already in the sentence', () => {
    expect(separateTermDefinitions('the <term>Luna: the alchemical name for silver</term> is fixed')).toBe(
      'the <term>Luna</term> <note>the alchemical name for silver</note> is fixed'
    );
  });

  it('leaves a long term with no colon unchanged (a mantra is the text itself)', () => {
    // Constructed: a dhāraṇī as the Tibetan runs wrap it — long, no "head: definition".
    const mantra = 'he recited <term>oṃ namo bhagavate bhaiṣajyaguru vaiḍūryaprabharājāya tathāgatāya arhate samyaksaṃbuddhāya</term> three times';
    expect(separateTermDefinitions(mantra)).toBe(mantra);
  });

  it('leaves short colon titles and references alone', () => {
    for (const t of ['<term>De Vita: Liber Primus</term>', '<term>Genesis 1:3</term>', '<term>Psalm: 23</term>']) {
      expect(separateTermDefinitions(t)).toBe(t);
    }
    expect(splitTermDefinition('Luna: the alchemical name for silver')).toEqual({
      head: 'Luna',
      definition: 'the alchemical name for silver',
    });
  });

  it('splits a definition that opens in italics (random-draw miss, 2026-10-06)', () => {
    expect(separateTermDefinitions('<term>slightest negligence: *culpa levissima*, the highest legal standard of care</term>')).toBe(
      '<term>slightest negligence</term> <note>*culpa levissima*, the highest legal standard of care</note>'
    );
  });

  it('turns an "original: …" chip into a note with no term chip', () => {
    const t = 'the <term>original: 足陽明經 (zú yáng míng jīng); a major energy channel running from the face to the feet</term> runs';
    expect(separateTermDefinitions(t)).toBe(
      'the <note>original: 足陽明經 (zú yáng míng jīng); a major energy channel running from the face to the feet</note> runs'
    );
  });

  it("relabels a gloss right after a term as the model's note", () => {
    expect(separateTermDefinitions(SILVER)).toBe(
      "where <term>Sulphur</term> boils mixed with perennial <term>Silver</term> <note>mercury or 'quicksilver'</note>, fleeing"
    );
  });

  it('leaves a gloss that does not follow a term as a page mark', () => {
    const t = 'the text <gloss>id est aurum</gloss> continues';
    expect(separateTermDefinitions(t)).toBe(t);
  });

  it('is idempotent', () => {
    for (const t of [GEOMANCY, HYDROMANCY, SILVER]) {
      const once = separateTermDefinitions(t);
      expect(separateTermDefinitions(once)).toBe(once);
    }
  });
});

describe('notes off hides the model definitions (#5895)', () => {
  it('reads the Geomancy sentence without the definition or a doubled head', () => {
    expect(applyNotesOff(GEOMANCY)).toBe('**Geomancy**, an art performed through points without a natural basis;');
    expect(applyNotesOff(HYDROMANCY)).toBe('**Hydromancy** is an art performed through water;');
  });

  it('keeps the term and drops the gloss-definition', () => {
    expect(applyNotesOff(SILVER)).toBe('where Sulphur boils mixed with perennial Silver, fleeing');
  });

  it('reader pipeline: notes on shows the definition as an editorial note, notes off hides it', () => {
    const on = prepareNotesMarkdown(GEOMANCY, { showNotes: true }).processedText;
    expect(on).toContain('<note>A method of divination');
    expect(on).not.toMatch(/<term>Geomancy:/);
    const off = prepareNotesMarkdown(GEOMANCY, { showNotes: false }).processedText;
    expect(off).not.toContain('A method of divination');
    expect(off).not.toMatch(/Geomancy\**\s+Geomancy/);
  });

  it('EPUB/HTML export follows the same rule', () => {
    expect(markdownToHtml(GEOMANCY, { stripNotes: true })).not.toContain('A method of divination');
    expect(markdownToHtml(SILVER, { stripNotes: false })).not.toMatch(/gloss/i);
  });
});

describe('a head the sentence already carries is not printed twice (#5901)', () => {
  // Excerpts: 6902ed49583dd7d2641408a5 p444 (God’s field), 59e68f94-49d0-4ed7-a610-b1f53e55b2f8 p652
  // (drachms), 6952727dab34727b1f0485f2 p44 (formal number), 695234baab34727b1f044b50 p34 (Cassia).
  it.each([
    ['he stands in God’s field <term>God\'s field: a metaphor for the world or the community of believers</term> and bears',
      'he stands in God’s field <note>a metaphor for the world or the community of believers</note> and bears'],
    ['[take] 4 drachms <term>drachm: a unit of weight, approximately 3.9 grams</term> weight',
      '[take] 4 drachms <note>a unit of weight, approximately 3.9 grams</note> weight'],
    ['so that your "formal number" <term>Formal number: A number that acts as a shaping principle.</term> may agree',
      'so that your "formal number" <note>A number that acts as a shaping principle.</note> may agree'],
    ['as harmless as Cassia or Manna <term>Cassia and Manna: Natural substances used as mild laxatives.</term>. The',
      'as harmless as Cassia or Manna <note>Natural substances used as mild laxatives.</note>. The'],
    ['the **melancholic humor** <term>humor: one of the four bodily fluids</term> is',
      'the **melancholic humor** <note>one of the four bodily fluids</note> is'],
  ])('%s', (before, after) => {
    expect(separateTermDefinitions(before)).toBe(after);
  });

  it('keeps the chip when the head is a different word (the source-language term)', () => {
    expect(separateTermDefinitions('the tempering agent of **black bile** <term>atra bilis: another name for the melancholic humor</term>, the fuel'))
      .toBe('the tempering agent of **black bile** <term>atra bilis</term> <note>another name for the melancholic humor</note>, the fuel');
    expect(separateTermDefinitions('the state <term>statue: a carved figure of stone</term> stood'))
      .toBe('the state <term>statue</term> <note>a carved figure of stone</note> stood');
    expect(separateTermDefinitions('<term>Luna: the alchemical name for silver</term>')).toBe('<term>Luna</term> <note>the alchemical name for silver</note>');
  });
});

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

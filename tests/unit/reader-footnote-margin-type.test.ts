/**
 * The reader is ready for the OCR prompt's printed/handwritten split (#8567) before the prompt writes it.
 *
 * - `<margin type="printed|handwritten">` labels who wrote the note; an untyped margin (every page read so
 *   far) says only where it stands.
 * - `<footnote>` (an edition's footnote or critical apparatus) is transcription: notes off keeps its words.
 */
import { describe, it, expect } from 'vitest';
import { marginTitle, prepareNotesMarkdown } from '@/components/reader/NotesRenderer';
import { applyNotesOff } from '@/lib/notes-off';
import { stripLayoutHtml } from '@/lib/strip-editorial-wrappers';

describe('marginTitle', () => {
  it('names printed and handwritten notes and claims nothing for an untyped one', () => {
    expect(marginTitle('printed')).toMatch(/printed in this edition/);
    expect(marginTitle('handwritten')).toMatch(/Handwritten note in this copy/);
    expect(marginTitle(undefined)).toBe('Marginal note on the page');
    expect(marginTitle(undefined)).not.toMatch(/original|copy/);
  });
});

describe('<footnote> is a page mark', () => {
  const page = 'Body text of the page.\n\n<footnote type="apparatus">3 impavidum] pavidum V</footnote>';

  it('notes off keeps the footnote text and drops only the tag', () => {
    const out = applyNotesOff(page);
    expect(out).toMatch(/impavidum\] pavidum V/);
    expect(out).not.toMatch(/<footnote/);
  });

  it('notes on keeps the tag for the reader to style', () => {
    const { processedText } = prepareNotesMarkdown(page, { showNotes: true });
    expect(processedText).toMatch(/<footnote type="apparatus">/);
  });

  it('the layout-HTML stripper leaves a footnote alone', () => {
    expect(stripLayoutHtml(page)).toBe(page);
  });

  it('a typed margin survives notes off as text', () => {
    expect(applyNotesOff('<margin type="printed">De passionibus</margin>\n\nBody.')).toMatch(/De passionibus/);
  });
});

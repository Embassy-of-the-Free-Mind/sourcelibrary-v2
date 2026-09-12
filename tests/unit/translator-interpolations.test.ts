import { describe, it, expect } from 'vitest';
import { prepareNotesMarkdown, NOTES_ALLOWED_ELEMENTS } from '@/components/reader/NotesRenderer';

/**
 * Single-bracket runs in a translation are the translator's own voice —
 * supplied words ("he [Hermes] said") and stage directions ("[The remainder
 * of the page is blank]"). Reported on Fludd's Utriusque cosmi historia
 * (#4385): they rendered as body text and "look like actual text".
 *
 * With notes ON they are wrapped in <interp> (brackets kept — the scholarly
 * convention IS the brackets) so the renderer can mute them. With notes OFF
 * they are dropped along with the rest of the editorial voice — except
 * lacuna marks like […], which report missing text, not commentary.
 */
describe('translator interpolations (single brackets)', () => {
  it('wraps a bracketed run in <interp> with notes on', () => {
    const { processedText } = prepareNotesMarkdown(
      'And he [that is, Mercury] spoke to the assembly.',
      { showNotes: true },
    );
    expect(processedText).toContain('<interp>[that is, Mercury]</interp>');
  });

  it('drops the bracketed run with notes off, keeping surrounding text', () => {
    const { processedText } = prepareNotesMarkdown(
      'And he [that is, Mercury] spoke to the assembly.',
      { showNotes: false },
    );
    expect(processedText).not.toContain('Mercury');
    expect(processedText).toContain('And he');
    expect(processedText).toContain('spoke to the assembly');
  });

  it('never touches markdown links', () => {
    const src = 'See [the appendix](https://example.org/appendix) for more.';
    for (const showNotes of [true, false]) {
      const { processedText } = prepareNotesMarkdown(src, { showNotes });
      expect(processedText).toContain('[the appendix](https://example.org/appendix)');
      expect(processedText).not.toContain('<interp>');
    }
  });

  it('keeps lacuna marks under both settings', () => {
    const on = prepareNotesMarkdown('The text breaks off […] and resumes.', { showNotes: true });
    const off = prepareNotesMarkdown('The text breaks off […] and resumes.', { showNotes: false });
    // Notes on may style it, but the mark itself must survive both ways.
    expect(on.processedText).toContain('[…]');
    expect(off.processedText).toContain('[…]');
  });

  it('leaves double-bracket editorial tags to their own pipeline', () => {
    const { processedText } = prepareNotesMarkdown(
      'Body text. [[note: an AI note]] More body.',
      { showNotes: true },
    );
    expect(processedText).toContain('<note>');
    expect(processedText).not.toContain('<interp><note>');
  });

  it('emits no tag the renderer would silently strip', () => {
    // `unwrapDisallowed` drops any element not on NOTES_ALLOWED_ELEMENTS while
    // keeping its children — the styling vanishes with no error. This is how
    // <interp> first shipped invisible: the preprocessor emitted it, the
    // allowlist didn't know it. Feed every bracket syntax through and assert
    // each emitted tag is on the list.
    const src = [
      'Plain [interpolation] here.',
      '[[note: a note]] [[term: lapis]] [[margin: marginal]] [[gloss: gloss]]',
      '[[insert: inserted]] [[unclear: smudged]] [[image: a woodcut]]',
    ].join('\n\n');
    const { processedText } = prepareNotesMarkdown(src, { showNotes: true });
    const emitted = [...processedText.matchAll(/<([a-z][a-z0-9-]*)[\s>]/gi)].map(m => m[1].toLowerCase());
    for (const tag of new Set(emitted)) {
      expect(NOTES_ALLOWED_ELEMENTS, `tag <${tag}> is emitted but not allowlisted`).toContain(tag);
    }
    expect(emitted).toContain('interp');
  });

  it('does not match across lines or nested brackets', () => {
    const src = 'A [broken\nrun] and a [nested [pair]] stay put.';
    const { processedText } = prepareNotesMarkdown(src, { showNotes: true });
    expect(processedText).toContain('[broken\nrun]');
    // Nested brackets defeat the conservative matcher entirely — the whole
    // malformed run passes through untouched rather than half-wrapped.
    expect(processedText).toContain('[nested [pair]]');
    expect(processedText).not.toContain('<interp>');
  });
});

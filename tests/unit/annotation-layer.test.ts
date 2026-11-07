import { describe, it, expect } from 'vitest';
import { splitAnnotations, renderInline, renderMarkup, resolveAnchor } from '../../scripts/lib/annotation-layer.mjs';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

const reader = (t: string, showNotes: boolean) => prepareNotesMarkdown(t, { showNotes }).processedText;
const squash = (t: string) => t.replace(/\s+/g, ' ').trim();

// Shapes the stored corpus carries (#3825 vocabulary, #5895 definitions, #5644 unclosed tags).
const FIXTURES: Record<string, string> = {
  inline: 'Geomancy <note>divination by figures cast in earth</note>, an art of the Arabs, is taught here.',
  term_gloss: 'The <term>prima materia</term> <gloss>first matter</gloss> must be purified before the work.',
  marks: 'He wrote <margin>Hermes</margin> that the <insert>stone</insert> is <unclear>one</unclear> thing, a <gloss>lapis</gloss> word.',
  page_level: '<meta>continues from previous page</meta>\nand so the fire is kept low.\n\n<summary>On the fire.</summary>\n<keywords>fire, athanor</keywords>',
  image_paragraph: 'The first chapter ends here.\n\n<image-desc>A woodcut of a pelican feeding her young.</image-desc>\n\nThe second chapter begins.',
  original_note: 'On Fate and Fortune <note>original: "De Fato, & Fortuna"</note>; and another On Law.',
  glossary_line: 'The bite of the serpent heals.\n\n<term>bite</term> <note>original: "morsus"</note>',
  multi: 'Salt <note>here the salt of the wise</note> and sulphur <note>the soul</note> and mercury.\n\n<vocab>sal, sulphur</vocab>',
  nested: 'Text <note>outer <note>inner</note> outer</note> more text.',
};

describe('splitAnnotations', () => {
  it('gives back the stored markup byte for byte (renderInline)', () => {
    for (const m of Object.values(FIXTURES)) expect(renderInline(splitAnnotations(m))).toBe(m);
  });

  it('leaves no tag of the vocabulary in the text', () => {
    for (const m of Object.values(FIXTURES)) {
      expect(splitAnnotations(m).text).not.toMatch(/<\/?(note|gloss|margin|insert|unclear|term|summary|keywords|meta|vocab|image-desc)\b/i);
    }
  });

  it('text is what today\'s reader shows with notes off', () => {
    for (const [name, m] of Object.entries(FIXTURES)) {
      expect(squash(reader(splitAnnotations(m).text, false)), name).toBe(squash(reader(m, false)));
    }
  });

  it('text + annotations alone re-render to today\'s reader output, notes on and off', () => {
    for (const [name, m] of Object.entries(FIXTURES)) {
      const s = splitAnnotations(m);
      const { markup, orphans } = renderMarkup(s.text, s.annotations);
      expect(orphans, name).toEqual([]);
      expect(squash(reader(markup, true)), name).toBe(squash(reader(m, true)));
      expect(squash(reader(markup, false)), name).toBe(squash(reader(m, false)));
    }
  });

  it('types and anchors commentary, marks and page-level blocks', () => {
    const s = splitAnnotations(FIXTURES.term_gloss);
    expect(s.text).toBe('The prima materia must be purified before the work.');
    const def = s.annotations.find((a: any) => a.type === 'definition');
    expect(def.body).toBe('first matter');
    expect(def.anchor.exact).toBe('prima materia');
    expect(s.text.slice(def.anchor.start, def.anchor.end)).toBe('prima materia');

    const p = splitAnnotations(FIXTURES.page_level);
    expect(p.text).toBe('and so the fire is kept low.');
    expect(p.annotations.map((a: any) => [a.type, a.scope, a.anchor])).toEqual([['meta', 'page', null], ['summary', 'page', null], ['keywords', 'page', null]]);

    const o = splitAnnotations(FIXTURES.original_note);
    expect(o.annotations[0].type).toBe('original');
    expect(o.annotations[0].anchor.exact).toBe('Fate and Fortune');

    const img = splitAnnotations(FIXTURES.image_paragraph);
    expect(img.annotations[0].type).toBe('image');
    expect(img.annotations[0].anchor.exact).toBe('');
    expect(img.text).toBe('The first chapter ends here.\n\nThe second chapter begins.');

    const g = splitAnnotations(FIXTURES.glossary_line);
    expect(g.text).toBe('The bite of the serpent heals.');
    expect(g.annotations[0]).toMatchObject({ type: 'definition', glossary: true, term: 'bite' });
    expect(g.annotations[0].anchor.exact).toBe('bite');
  });

  it('keeps a printed mark\'s words in the text and spans them', () => {
    const s = splitAnnotations(FIXTURES.marks);
    expect(s.text).toBe('He wrote Hermes that the stone is one thing, a lapis word.');
    const margin = s.annotations.find((a: any) => a.type === 'margin');
    expect(margin).toMatchObject({ kind: 'mark', body: null });
    expect(margin.anchor.exact).toBe('Hermes');
  });

  it('an unclosed tag keeps the text after it, flagged, never swallowed', () => {
    const m = 'The first sentence <note>a note that never closes\n\nThe second paragraph is the book\'s own text.';
    const s = splitAnnotations(m);
    expect(s.text).toBe('The first sentence a note that never closes\n\nThe second paragraph is the book\'s own text.');
    const a = s.annotations[0];
    expect(a).toMatchObject({ type: 'note', malformed: 'unclosed', body: null });
    expect(s.text.slice(a.suspect.start, a.suspect.end)).toBe('a note that never closes');
    expect(renderInline(s)).toBe(m);

    const tail = splitAnnotations('Body text.\n\n<summary>A summary cut off by truncation');
    expect(tail.text).toContain('Body text.');
    expect(tail.text).toContain('A summary cut off by truncation');
    expect(tail.annotations[0]).toMatchObject({ type: 'summary', malformed: 'unclosed' });
  });

  it('flags a stray close tag and drops only the tag', () => {
    const s = splitAnnotations('A stray </note> close.');
    expect(s.text).toBe('A stray  close.');
    expect(s.annotations[0]).toMatchObject({ malformed: 'stray-close' });
  });

  it('a nested note stays one annotation with its inner markup in the body', () => {
    const s = splitAnnotations(FIXTURES.nested);
    expect(s.text).toBe('Text more text.');
    expect(s.annotations).toHaveLength(1);
    expect(s.annotations[0].body).toBe('outer <note>inner</note> outer');
  });

  it('is a no-op on plain text and on empty input', () => {
    expect(splitAnnotations('Just the book.')).toMatchObject({ text: 'Just the book.', annotations: [] });
    expect(splitAnnotations('')).toMatchObject({ text: '', annotations: [] });
  });
});

describe('resolveAnchor', () => {
  const page = 'Take the salt of the wise and dissolve it. Then take the salt of the wise again, and sulphur <note>the soul</note>, and mercury.';
  const s = splitAnnotations(page);
  const note = s.annotations[0];

  it('resolves by offset on the unchanged text', () => {
    expect(resolveAnchor(s.text, note.anchor)).toMatchObject({ how: 'offset', start: note.anchor.start });
  });

  it('re-resolves by quote after an unrelated edit moves it', () => {
    const edited = 'Preface: ' + s.text.replace('dissolve it', 'dissolve it slowly in rain water');
    const r = resolveAnchor(edited, note.anchor);
    expect(r).toMatchObject({ how: 'quote' });
    expect(edited.slice(r!.start, r!.end)).toBe(note.anchor.exact);
    expect(edited.slice(r!.end)).toMatch(/^, and mercury/);
  });

  it('re-resolves by fuzzy match after a case or punctuation edit', () => {
    const edited = s.text.replace('again, and sulphur', 'again, and Sulphur');
    const r = resolveAnchor(edited, note.anchor);
    expect(r).toMatchObject({ how: 'fuzzy' });
    expect(edited.slice(r!.start, r!.end)).toBe('again, and Sulphur');
  });

  it('orphans an anchor whose phrase is deleted, never resolves it elsewhere', () => {
    const edited = s.text.replace(' again, and sulphur', '');
    expect(resolveAnchor(edited, note.anchor)).toBeNull();
  });

  it('orphans a repeated phrase whose context is gone rather than guess between copies', () => {
    const anchor = { exact: 'the salt of the wise', prefix: 'XXXX', suffix: 'YYYY', start: 999 };
    expect(resolveAnchor(s.text, anchor)).toBeNull();
  });

  it('picks the right copy of a repeated phrase by its context', () => {
    const idx = s.text.lastIndexOf('the salt of the wise');
    const anchor = { exact: 'the salt of the wise', prefix: s.text.slice(idx - 32, idx), suffix: s.text.slice(idx + 20, idx + 52), start: 0 };
    expect(resolveAnchor(s.text, anchor)).toMatchObject({ start: idx, how: 'quote' });
  });

  it('a point anchor (a note in its own paragraph) re-resolves by its context, and orphans when it is gone', () => {
    const img = splitAnnotations(FIXTURES.image_paragraph);
    const a = img.annotations[0].anchor;
    const moved = 'A new opening line.\n\n' + img.text;
    const r = resolveAnchor(moved, a);
    expect(r).toMatchObject({ how: 'quote' });
    expect(moved.slice(r!.start)).toMatch(/^The second chapter/);
    expect(resolveAnchor('Entirely different words on this page.', a)).toBeNull();
  });

  it('a point anchor found after a whitespace-only edit lands where its suffix begins, not before the full stop', () => {
    // #5942 Part A by-eye read: the folded match put the point after "Three", before ".\n\n".
    const before = 'On the virtues of the sensitive soul. Chapter Three.\n\n';
    const anchor = { exact: '', prefix: before.slice(-32), suffix: ' The being of an animal subject ', start: before.length };
    const edited = 'Prologue.\n\nOn the virtues of the sensitive soul. Chapter Three.\n\nThe being of an animal subject is more perfect.';
    const r = resolveAnchor(edited, anchor);
    expect(r).toMatchObject({ how: 'fuzzy' });
    expect(edited.slice(r!.start)).toMatch(/^The being/);
    // At the start of the page it stays at the start, or is orphaned.
    expect(resolveAnchor('**At Vespers.**\n\nO God, come to my aid.', { exact: '', prefix: '', suffix: '**At Vespers.**\n\n O God, come to', start: 0 })).toMatchObject({ start: 0 });
    expect(resolveAnchor('[illegible — the text on all three strips is faded', { exact: '', prefix: '', suffix: '[The text on all three strips is', start: 0 })).toBeNull();
  });

  it('page-scope annotations have no anchor and resolve to null', () => {
    expect(resolveAnchor('anything', null)).toBeNull();
  });
});

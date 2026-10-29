import { describe, it, expect } from 'vitest';
import { splitAnnotations, renderInline, renderMarkup, notesOffText } from '../../scripts/lib/annotation-layer.mjs';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

// #5942 legacy syntaxes (annotation-layer/3). The oracle is the reader itself: prepareNotesMarkdown is the function
// NotesRenderer renders, so "the parser's text with notes off" must hold exactly the words the reader shows with
// notes off. Before /3 every [[label: …]] but notes/meta/summary/keywords stayed in `text` as book words.
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const words = (s: string) => (s.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, ' ').match(WORD) || []).sort();
const readerOff = (m: string) => {
  const r = prepareNotesMarkdown(m, { showNotes: false });
  return r.isDescriptionOnly ? '' : r.processedText;
};

const FIXTURES: Record<string, [string, string[]]> = {
  // id: [stored markup, annotation types expected]
  notes: ['Take the salt [[notes: the philosophers\' salt]] and dissolve it in water.', ['note']],
  note_singular: ['Take the salt [[note: the salt of the wise]] and dissolve it in water.', ['note']],
  meta: ['[[meta: continues from previous page]]\n\nand so the fire is kept low all night long.', ['meta']],
  page_number: ['[[page number: 42]]\n\nChapter Six. Of the fire of the wise.', ['pagedata']],
  vocabulary: ['The fire is kept low all night long.\n\n[[vocabulary: sal, sulphur, mercurius]]', ['vocab']],
  image: ['Chapter one ends here.\n\n[[image: A woodcut of a dragon eating its tail]]\n\nChapter two begins.', ['image']],
  header: ['[[header: OF THE FIRE]]\nThe fire is kept low all night long.', ['pagedata']],
  markup: ['[[markup: centered heading]]\nThe fire is kept low all night long.', ['pagedata']],
  page_type: ['[[page type: text]]\nThe fire is kept low all night long.', ['pagedata']],
  warning: ['[[warning: faded ink at the foot]]\nThe fire is kept low all night long.', ['warning']],
  language: ['[[language: Latin]]\nThe fire is kept low all night long.', ['pagedata']],
  folio_signature: ['[[folio: 12r]] [[signature: B2]]\nThe fire is kept low all night long.', ['pagedata', 'pagedata']],
  abbrev: ['The fire is kept low.\n[[abbrev: Dns → Dominus]]', ['abbrev']],
  summary_keywords: ['The fire is kept low.\n\n[[summary: On the fire.]]\n[[keywords: fire, athanor]]', ['summary', 'keywords']],
  margin: ['He wrote [[margin: Hermes]] that the stone is one thing.', ['margin']],
  gloss_insert_unclear: ['The [[gloss: lapis]] is [[insert: truly]] one [[unclear: thing]] only.', ['gloss', 'insert', 'unclear']],
  term: ['Then the [[term: prima materia]] must be purified before the work.', ['term']],
  term_arrow: ['Then the [[term: materia prima → first matter]] must be purified.', ['term']],
  nested_page_in_mark: ['He wrote [[margin: see [[page number: 3]] here]] that the stone is one.', ['margin', 'pagedata']],
  bracketed_image: ['The first chapter ends here.\n\n[Engraving of a man\'s head in profile, facing left.]\n\nThe second chapter begins.', ['image']],
  interp: ['And he [Hermes] said that [that is, Mercury] is one; the rest […] is lost.', ['interp', 'interp']],
  note_in_brackets: ['The stone is one [Note: the author means the red stone] and no more.', ['interp']],
  placeholder: ['[Blank page]', ['interp']],
  summary_line: ['The fire is kept low all night long.\n\nSummary: On keeping the fire.', ['summary']],
  preamble: ['Here is the translation of the page:\n\nThe fire is kept low all night long.', ['preamble']],
  preamble_paragraph: ['Sure, here is the transcription of the image provided.\n\nThe fire is kept low all night long.', ['preamble']],
  fence: ['```markdown\nThe fire is kept low all night long.\n```', ['pagedata', 'pagedata']],
  mixed_with_xml: ['[[page number: 7]]\n\nThe <term>athanor</term> <note>a furnace</note> burns [that is, slowly].\n\n<summary>On the furnace.</summary>', ['pagedata', 'term', 'definition', 'interp', 'summary']],
};

describe('annotation-layer/3: legacy syntaxes', () => {
  for (const [id, [m, types]] of Object.entries(FIXTURES)) {
    it(`${id}: text with notes off holds exactly the reader's notes-off words`, () => {
      const split = splitAnnotations(m);
      expect(words(notesOffText(split))).toEqual(words(readerOff(m)));
    });
    it(`${id}: round trip byte for byte, the expected annotations, no [[label: left`, () => {
      const split = splitAnnotations(m);
      expect(renderInline(split)).toBe(m);
      expect(split.annotations.map((a: any) => a.type).sort()).toEqual([...types].sort());
      expect(split.text).not.toMatch(/\[\[[a-z][a-z ]*:/i);
      expect(renderMarkup(split.text, split.annotations).orphans).toHaveLength(0);
    });
  }

  // Where the reader itself is wrong, the parser does not follow it; each is a listed difference (#5942).
  it('listed: a "**Technical Vocabulary**" section leaves whole; the reader keeps "**Technical" as book text', () => {
    const m = 'The fire is kept low all night long.\n\n**Technical Vocabulary**\n<term>athanor</term>: the furnace of the wise';
    const split = splitAnnotations(m);
    expect(renderInline(split)).toBe(m);
    expect(split.annotations.map((a: any) => a.type)).toEqual(['vocab']);
    expect(words(readerOff(m))).toEqual(words(notesOffText(split) + ' Technical'));
  });

  it('listed: invented labels no reader rule reads leave the text too; the reader shows them as book words', () => {
    const m = '[[original page: 68]] The fire is kept low [[heading: Of Fire]] and [[crossed out: not]] high.\n[[catchword: Of]] [[sig: B2]]';
    const split = splitAnnotations(m);
    expect(renderInline(split)).toBe(m);
    expect(split.text).not.toMatch(/\[\[/);
    expect(split.annotations.map((a: any) => a.type).sort()).toEqual(['crossed-out', 'heading', 'pagedata', 'pagedata', 'pagedata']);
    expect(words(notesOffText(split))).toEqual(words('The fire is kept low Of Fire and not high.'));
    expect(words(readerOff(m))).toContain('original');
  });

  it('an interpolation keeps its words and brackets in text, under a mark span', () => {
    const m = 'And he [Hermes] said so.';
    const { text, annotations } = splitAnnotations(m);
    expect(text).toBe(m);
    expect(annotations).toEqual([expect.objectContaining({ type: 'interp', kind: 'mark', anchor: expect.objectContaining({ exact: '[Hermes]', start: 7, end: 15 }) })]);
    expect(notesOffText({ text, annotations })).toBe('And he  said so.');
  });

  it('brackets the source prints (the OCR has them) are flagged printed and survive notes-off', () => {
    const m = 'As the poet says [Σ 392], the sea [that is, the Aegean] was calm.';
    const split = splitAnnotations(m, { ocr: 'ut ait poeta [Σ 392], mare tranquillum erat.' });
    expect(split.annotations.map((a: any) => [a.anchor.exact, !!a.printed])).toEqual([['[Σ 392]', true], ['[that is, the Aegean]', false]]);
    expect(notesOffText(split)).toBe('As the poet says [Σ 392], the sea  was calm.');
    // Without the OCR, every interpolation is the translator's, as in the reader.
    expect(splitAnnotations(m).annotations.some((a: any) => a.printed)).toBe(false);
  });

  it('a lacuna mark stays in text and is no annotation', () => {
    const m = 'The rest […] is lost, and [...] more.';
    expect(splitAnnotations(m)).toMatchObject({ text: m, annotations: [] });
  });

  it('a bracketed image paragraph is an image annotation; a stage direction is an interpolation', () => {
    const img = splitAnnotations('Text.\n\n[Woodcut of a pelican feeding her young.]\n\nMore text.');
    expect(img.annotations).toEqual([expect.objectContaining({ type: 'image', kind: 'commentary', body: 'Woodcut of a pelican feeding her young.' })]);
    expect(img.text).toBe('Text.\n\nMore text.');
    const dir = splitAnnotations('Text.\n\n[The remainder of the page is blank.]\n\nMore text.');
    expect(dir.annotations.map((a: any) => a.type)).toEqual(['interp']);
  });

  it('a book heading the reader drops ("## INDEX 421", "GENERAL VOCABULARY") stays in text', () => {
    for (const m of ['## INDEX 421\n\nAbbot, 12, 14.', 'GENERAL VOCABULARY\n\nNA, adv. Near, by, yet.']) {
      expect(splitAnnotations(m).text).toBe(m);
    }
  });

  it('pages with none of the legacy syntaxes come out as before', () => {
    const m = 'Geomancy <note>divination by figures</note>, an art of the Arabs.\n\n<summary>On geomancy.</summary>';
    const s = splitAnnotations(m);
    expect(s.text).toBe('Geomancy, an art of the Arabs.');
    expect(s.annotations.map((a: any) => a.type)).toEqual(['note', 'summary']);
  });
});

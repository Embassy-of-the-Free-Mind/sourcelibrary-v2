import { describe, it, expect } from 'vitest';
import { parseTranslationLayers, renderTranslationLayers } from '@/lib/translation-layers';
import { applyNotesOff } from '@/lib/notes-off';
import { separateTermDefinitions } from '@/lib/term-definitions';
import { normalizeAnnotationSpans } from '@/lib/normalize-annotation-spans';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

const canonical = (t: string) => separateTermDefinitions(normalizeAnnotationSpans(t));
const reader = (t: string, showNotes: boolean) => prepareNotesMarkdown(t, { showNotes }).processedText;

/**
 * The two promises of the split: notes on rebuilds the page, notes off is what the reader shows today.
 * Notes off is compared without trailing whitespace: today's reader leaves a newline behind where a
 * closing glossary line was removed, and the stored text does not.
 */
function expectRoundTrip(markup: string, { legacy = false } = {}) {
  const layers = parseTranslationLayers(markup, { promptVersion: 13 });
  expect(layers.exact).toBe(true);
  if (!legacy) expect(renderTranslationLayers(layers, { notes: true })).toBe(canonical(markup));
  expect(reader(renderTranslationLayers(layers, { notes: true }), true)).toBe(reader(markup, true));
  // The reader deletes a legacy [[notes: …]] without closing the gap it leaves; the stored text closes it.
  const today = legacy ? reader(markup, false).replace(/ {2,}/g, ' ') : reader(markup, false);
  expect(reader(renderTranslationLayers(layers, { notes: false }), false).trimEnd()).toBe(today.trimEnd());
  return layers;
}

describe('parseTranslationLayers', () => {
  it('lifts an inline note out and leaves the sentence as notes-off writes it', () => {
    const layers = expectRoundTrip('He wrote On the World <note>original: "De Seculo"</note>, and another book.');
    expect(layers.text).toBe('He wrote On the World, and another book.');
    expect(layers.annotations).toHaveLength(1);
    expect(layers.annotations[0]).toMatchObject({ type: 'original', body: 'original: "De Seculo"', source: 'inline-v13' });
    expect(layers.annotations[0].anchor).toMatchObject({ phrase: 'On the World', offset: 9, occurrences: 1 });
  });

  it('anchors a definition to its term and keeps the term chip in the text', () => {
    const layers = expectRoundTrip('The <term>prima materia</term> <gloss>first matter</gloss> must be purified.');
    expect(layers.text).toBe('The <term>prima materia</term> must be purified.');
    expect(layers.annotations[0]).toMatchObject({ type: 'gloss-model', body: 'first matter' });
    expect(layers.annotations[0].anchor).toMatchObject({ phrase: 'prima materia', offset: 10, occurrences: 1 });
  });

  it('types a definition written inside the chip, and one written as a note after it', () => {
    const inside = expectRoundTrip('<term>Geomancy: A method of divination that interprets markings on the ground</term> is old.');
    expect(inside.text).toBe('<term>Geomancy</term> is old.');
    expect(inside.annotations[0]).toMatchObject({ type: 'definition', body: 'A method of divination that interprets markings on the ground' });
    expect(inside.annotations[0].anchor.phrase).toBe('Geomancy');

    const after = expectRoundTrip('The ten <term>sefirot</term> <note>divine emanations</note> correspond to the paths.');
    expect(after.annotations[0]).toMatchObject({ type: 'definition', body: 'divine emanations' });
  });

  it('leaves page marks in the text: a printed gloss, a margin, an insertion, an unclear reading', () => {
    const page = 'In the beginning <gloss>that is, in wisdom</gloss> God made <margin>Gen. 1</margin> the <insert>whole</insert> <unclear>earth</unclear>.';
    const layers = expectRoundTrip(page);
    expect(layers.text).toBe(page);
    expect(layers.annotations).toEqual([]);
  });

  it('types an image description and lets a paragraph note stand alone', () => {
    const layers = expectRoundTrip('First paragraph.\n\n<image-desc>A woodcut of a pelican.</image-desc>\n\n<note>This passage answers Galen.</note>\n\nLast paragraph.');
    expect(layers.text).toBe('First paragraph.\n\nLast paragraph.');
    expect(layers.annotations.map(a => a.type)).toEqual(['image', 'note']);
    expect(layers.annotations[0].anchor).toMatchObject({ phrase: null, occurrences: 0 });
  });

  it('removes a trailing glossary line whole, as notes-off does, and anchors each entry to its word in the text', () => {
    const page = 'The dog gave a bite to the hare.\n\n- <term>bite</term> <note>original: "morsus."</note>; <term>hare</term> <note>a long-eared animal</note>\n';
    const layers = expectRoundTrip(page);
    expect(layers.text).not.toMatch(/<term>|morsus/);
    expect(layers.annotations.map(a => [a.type, a.anchor.phrase, a.anchor.occurrences])).toEqual([
      ['original', 'bite', 1],
      ['definition', 'hare', 1],
    ]);
    expect(layers.text.slice(layers.annotations[0].anchor.offset!, layers.annotations[0].anchor.offset! + 4)).toBe('bite');
  });

  it('keeps the model\'s summary, keywords and meta out of the text', () => {
    const layers = expectRoundTrip('<meta>continues from previous page</meta>\nand so it ends.\n\n<summary>The chapter ends.</summary>\n<keywords>ending, chapter</keywords>');
    expect(layers.text.trim()).toBe('and so it ends.');
    expect(layers.pageLevel.map(b => [b.kind, b.body])).toEqual([
      ['meta', 'continues from previous page'],
      ['summary', 'The chapter ends.'],
      ['keywords', 'ending, chapter'],
    ]);
  });

  it('reports how many times an anchor phrase occurs, so the offset can tell them apart', () => {
    const layers = expectRoundTrip('The <term>opus</term> begins. The <term>opus</term> <note>the Great Work</note> ends.');
    expect(layers.annotations[0].anchor).toMatchObject({ phrase: 'opus', occurrences: 2 });
    expect(layers.annotations[0].anchor.offset).toBe(layers.text.lastIndexOf('opus'));
  });

  it('handles legacy [[notes: …]] and a multi-paragraph note', () => {
    const old = expectRoundTrip('Text here [[notes: an old-style note]] goes on.', { legacy: true });
    expect(old.annotations[0]).toMatchObject({ type: 'note', body: 'an old-style note' });
    const layers = expectRoundTrip('Body.\n\n<note>First paragraph of a note.\n\nSecond paragraph.</note>\n\nMore body.');
    expect(layers.annotations).toHaveLength(2);
    expect(layers.text).toBe('Body.\n\nMore body.');
  });

  it('gives text that the notes-off transform leaves alone apart from unwrapping chips', () => {
    const page = 'A <term>calcination</term> <gloss>heating to powder</gloss> of <margin>lib. 2</margin> gold <note>a note</note>.';
    const { text } = parseTranslationLayers(page);
    expect(applyNotesOff(text)).toBe(applyNotesOff(page));
  });

  it('is a no-op on a page with no commentary, and on empty input', () => {
    const plain = 'Just the **book**.\n\nTwo paragraphs.';
    expect(parseTranslationLayers(plain)).toMatchObject({ text: plain, annotations: [], pageLevel: [], exact: true });
    expect(parseTranslationLayers('')).toMatchObject({ text: '', annotations: [], exact: true });
  });
});

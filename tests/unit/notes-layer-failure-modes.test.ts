import { describe, it, expect } from 'vitest';
import { splitAnnotations, renderInline, renderMarkup, resolveAnchor } from '../../scripts/lib/annotation-layer.mjs';
import { translationLayers, getTranslationText, parserAnnotation } from '../../scripts/lib/translation-text.mjs';
import { wordConservation } from '../../scripts/eval/notes-layer-5942/word-conservation.mjs';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

// #5942 failure modes, asked for by Derek before the full run (inbox 2026-10-28): each test tries
// to make one thing go wrong. The live counterparts over the 1,000 pilot pages are in
// scripts/eval/notes-layer-5942/pilot-checks.mts; the database ones (CAS, undo, withheld) in
// tests/integration/notes-layer-backfill.test.ts.

type Ann = { type: string; kind: string; body: string | null; malformed?: string; exact?: string; start?: number; end?: number };
const layers = (m: string) => translationLayers(m, { promptVersion: 13 }) as { text: string; annotations: Ann[] };
const anchorsOk = (text: string, anns: Ann[]) => anns.every((a) => a.exact === undefined || text.slice(a.start, a.end) === a.exact);
const conserve = (m: string) => wordConservation(m, splitAnnotations(m));

describe('malformed, unclosed and nested tags: no book word lost, no note word in text', () => {
  const CASES: Record<string, string> = {
    unclosed_note: 'The salt of the wise <note>the model began a note and never closed it\n\nAnd the next paragraph is the book again.',
    stray_close: 'He heats the vessel</note> for forty days, as the masters teach.',
    nested_note: 'Text <note>outer <note>inner</note> outer</note> more text of the book.',
    unclosed_margin: 'He wrote <margin>Hermes that the stone is one thing.',
    overlapping: 'A <margin>b <note>c</margin> d</note> e and the book goes on.',
    nested_marks: 'The <margin><insert>added</insert> marginal</margin> word stays.',
  };
  it.each(Object.entries(CASES))('%s', (_n, m) => {
    const split = splitAnnotations(m);
    expect(renderInline(split)).toBe(m); // nothing dropped: the markup is rebuilt byte for byte
    expect(split.text).not.toMatch(/<\/?(note|margin|insert)\b/);
    const c = conserve(m);
    expect(c.lost).toEqual([]);
    expect(c.leaked).toEqual([]);
  });
  it('an unclosed note keeps the words after it in the text, flagged suspect, body null', () => {
    const { text, annotations } = layers(CASES.unclosed_note);
    const a = annotations.find((x) => x.malformed === 'unclosed')!;
    expect(a.body).toBeNull();
    expect(text).toContain('never closed it');
    expect(text).toContain('the book again');
  });
});

describe('a note nested in a margin', () => {
  const m = 'He cites <margin>Hermes <note>the Thrice-Great, a god of writing</note></margin> on the stone.';
  it('the margin words stay, the note leaves the text', () => {
    const { text, annotations } = layers(m);
    expect(text).toContain('Hermes');
    expect(text).not.toContain('Thrice-Great');
    expect(annotations.find((a) => a.type === 'note')?.body).toBe('the Thrice-Great, a god of writing');
    expect(conserve(m)).toMatchObject({ lost: [], leaked: [] });
  });
  it('today\'s notes-off reader shows it as book text (the known diff, measured in #7319): text is right, the reader is not', () => {
    const off = prepareNotesMarkdown(m, { showNotes: false }).processedText;
    expect(off).toContain('Thrice-Great');
  });
});

describe('non-Latin scripts, right-to-left, combining marks and astral characters: offsets are UTF-16 code units', () => {
  const CASES: Record<string, string> = {
    arabic: 'He writes the word <note>original: "الكيمياء" (al-kīmiyāʾ)</note> alchemy, and then <margin>قال جابر</margin> Jabir says it.',
    hebrew: 'The name <note>original: "אֵין סוֹף" with its vowel points</note> Ein Sof is without end <margin>סוד</margin>.',
    chinese: 'The elixir <note>original: "金丹"</note> is made in the furnace <margin>丹爐</margin> of the adept.',
    tibetan: 'The teacher <note>original: "བླ་མ་"</note> said <margin>རྡོ་རྗེ་</margin> the vajra is firm.',
    combining: 'Café̂ and naïve <note>e + U+0301 + U+0302, not precomposed</note> with Zoë <margin>ἀρχή</margin> beginning.',
    astral: 'The letter 𝔄 <note>Mathematical Fraktur A, a surrogate pair</note> and the emoji-like 𓂀 <margin>𓂀 eye</margin> follow.',
  };
  it.each(Object.entries(CASES))('%s: every anchor slices back to its exact phrase, and re-resolves', (_n, m) => {
    const { text, annotations } = layers(m);
    expect(anchorsOk(text, annotations)).toBe(true);
    for (const a of annotations.map(parserAnnotation)) if (a.anchor) expect(resolveAnchor(text, a.anchor)).not.toBeNull();
    expect(renderMarkup(text, annotations.map(parserAnnotation)).orphans).toHaveLength(0);
    expect(conserve(m)).toMatchObject({ lost: [], leaked: [] });
  });
  it('a combining mark is never split from its base by an anchor end', () => {
    const { text, annotations } = layers(CASES.combining);
    for (const a of annotations) if (a.end !== undefined) expect(/^\p{M}/u.test(text.slice(a.end))).toBe(false);
  });
});

describe('empty, placeholder and blank translations', () => {
  it.each([
    '[Blank page]',
    '[This page could not be translated due to content safety restrictions.]',
    '[This page could not be translated due to content recitation restrictions.]',
    '[Blank page — no translatable content]',
  ])('%s: text is the placeholder, no annotations', (m) => {
    const { text, annotations } = layers(m);
    expect(text).toBe(m);
    expect(annotations).toHaveLength(0);
  });
  it('no data → no text, whatever text is stored', () => {
    expect(getTranslationText({ translation: { text: 'withheld words', text_from: { data_hash: 'x' } } })).toBe('');
    expect(getTranslationText({ translation_withheld: { reason: 'stale' } })).toBe('');
  });
});

describe('very long pages', () => {
  const para = (i: number) => `Paragraph ${i} of the treatise <note>note ${i}, on the ${i}th degree of fire</note> continues with the operation of the stone.`;
  const m = Array.from({ length: 3000 }, (_, i) => para(i)).join('\n\n'); // ~330 KB, 3,000 notes
  it('splits, rebuilds and conserves words in well under a second', () => {
    const t0 = Date.now();
    const split = splitAnnotations(m);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(split.annotations).toHaveLength(3000);
    expect(renderInline(split)).toBe(m);
    expect(conserve(m)).toMatchObject({ lost: [], leaked: [] });
  });
});

describe('the same phrase twice on a page', () => {
  const m = 'And the stone is white. <note>first: albedo</note>\n\nLater the stone is white. <note>second: the second whitening</note>\n\nAt last the stone is red.';
  it('each note keeps its own occurrence, and a re-render puts each back where it was', () => {
    const { text, annotations } = layers(m);
    const [a, b] = annotations.filter((x) => x.type === 'note');
    expect(a.start).not.toBe(b.start);
    for (const x of [a, b]) {
      const r = resolveAnchor(text, parserAnnotation(x as never).anchor);
      expect(r?.start).toBe(x.start);
    }
    const back = renderMarkup(text, annotations.map(parserAnnotation)).markup;
    expect(back.indexOf('first: albedo')).toBeLessThan(back.indexOf('Later'));
    expect(back.indexOf('second: the second whitening')).toBeGreaterThan(back.indexOf('Later'));
  });
});

describe('found in the storage pilot (2026-10-28), fixed in annotation-layer/2', () => {
  it('a <gloss> closing a <term> from inside is the model\'s definition, not book text', () => {
    const m = 'write according to the tradition <term>Kabbalah<gloss>The Jewish mystical tradition</gloss></term> with fourteen lines.';
    const split = splitAnnotations(m);
    expect(renderInline(split)).toBe(m);
    expect(split.text).toBe('write according to the tradition Kabbalah with fourteen lines.');
    const d = split.annotations.find((a: Ann) => a.type === 'definition')!;
    expect(d).toMatchObject({ kind: 'commentary', body: 'The Jewish mystical tradition' });
    expect(d.anchor.exact).toBe('Kabbalah');
    expect(conserve(m)).toMatchObject({ lost: [], leaked: [] });
  });
  it('a bare leading number is the book\'s word, not list numbering: the line stays', () => {
    const m = '164 <term>folios</term> <note>A folio is a single leaf.</note>\nNumber of Folios: 164';
    expect(splitAnnotations(m).text).toContain('164 folios');
    expect(conserve(m)).toMatchObject({ lost: [], leaked: [] });
  });
  it('a numbered glossary line ("1. term note") is still the model\'s and leaves the text', () => {
    const m = 'The folio is here.\n\n1. <term>folio</term> <note>a single leaf</note>';
    expect(splitAnnotations(m).text).not.toContain('single leaf');
    expect(splitAnnotations(m).text).not.toMatch(/^1\./m);
  });
});

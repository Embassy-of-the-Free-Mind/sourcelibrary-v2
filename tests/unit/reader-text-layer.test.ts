import { describe, it, expect, vi } from 'vitest';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';
import { translationLayers, layerMarkup } from '../../scripts/lib/translation-text.mjs';
import { layerMarkup as layerMarkupTs } from '@/lib/translation-text';
import { loadReaderTextLayers, applyReaderTextLayer, takeReaderTextLayers } from '@/lib/reader-text-layer';
import { contentHash } from '@/lib/write-provenance';

// #7965 step 1: the reader renders translation.text + the newest current page_annotations doc, composed by
// layerMarkup, through NotesRenderer. Each rule below was found on the 400-page gate (scripts/eval/notes-reader-7965).

const layers = (data: string) => translationLayers(data, { promptVersion: 13 });
const compose = (data: string) => { const l = layers(data); return layerMarkup(l.text, l.annotations); };
const shown = (markup: string, showNotes: boolean) => prepareNotesMarkdown(markup, { showNotes }).processedText.replace(/\s+/g, ' ').trim();

describe('layerMarkup (#7965)', () => {
  it('is the same function on both sides', () => {
    expect(layerMarkupTs).toBe(layerMarkup);
  });

  it('renders a plain inline page as today does, notes on and off', () => {
    const data = 'Geomancy <note>divination by figures cast in earth</note>, an art of the Arabs, is <margin>Hermes</margin> taught here.\n\n<summary>On geomancy.</summary>';
    const m = compose(data)!;
    expect(m).toBe(data);
    for (const on of [true, false]) expect(shown(m, on)).toBe(shown(data, on));
  });

  it('never puts a note inside a mark: the mark is split round it, so notes-off hides the note', () => {
    const data = '<insert>First: **Ak Buddha** <note>Known as the Immovable One</note>, body white.</insert>\n\nNext.';
    const m = compose(data)!;
    expect(m).not.toMatch(/<insert>[^<]*<note>/);
    expect(shown(m, false)).not.toContain('Immovable');
    expect(shown(m, true)).toContain('<note>Known as the Immovable One</note>');
    // Today's renderer flattens the nested note into the book's words, notes off.
    expect(shown(data, false)).toContain('Immovable');
  });

  it('keeps the spaces at a split outside the tags', () => {
    const m = compose('<margin>called *alcyonium* <note>a sponge</note> namely a body</margin>')!;
    expect(m).toMatch(/<margin>called \*alcyonium\*<\/margin> <note>a sponge<\/note> <margin>namely a body<\/margin>/);
    expect(shown(m, false)).toMatch(/alcyonium\S* namely/);
  });

  it('leaves out an unclosed tag and a stray close tag (malformed), keeping the words', () => {
    const data = 'He went <margin>z <gloss>interlinear: z</gloss> and out.</gloss> Michmash <note>an ancient town</note>. More.';
    const m = compose(data)!;
    expect(m).not.toContain('<margin>');
    expect(shown(m, false)).not.toContain('ancient town');
    expect(shown(m, false)).toContain('Michmash');
  });

  it('leaves out an empty mark, whose rebuilt close would sort before its open', () => {
    const data = '<margin></margin>\nconcerning justice\n\nCompanions of the Pylagori <note>representatives to the Amphictyonic League</note>. Sober.';
    const m = compose(data)!;
    expect(m).not.toMatch(/<\/margin><margin>/);
    expect(shown(m, false)).not.toContain('Amphictyonic');
  });

  it('puts a term definition after the space the model left, so bold still closes', () => {
    const data = '7.  \n**<term>Iyatē</term> <gloss>he goes</gloss>** VIII. 7, 13.';
    expect(compose(data)).toBe(data);
  });

  it('gives a note between a space and a word the space after it back', () => {
    const m = compose('the Arabic <note>original: أَوْسَنَّا</note> âwaṣannâ is the word')!;
    expect(m).toContain('</note> âwaṣannâ');
  });

  it('gives the notes a page ends on their own paragraph again', () => {
    const data = 'this same straight line LA,\n\n<note>1) See pp. 331-337.</note>\n<note>2) Namely 170° of longitude.</note>';
    const m = compose(data)!;
    expect(m).toMatch(/LA,\n\n<note>1\) See/);
    expect(shown(m, false)).toBe(shown(data, false));
  });

  it('nests two marks that end at the same place (the split piece of a margin and a term inside it)', () => {
    const m = compose('<margin>so that, just as\n<term>Qamets Bo\'q</term> <note>A note on vowels</note>\njust as\n</margin>\n\nNext.')!;
    expect(m).toContain("<term>Qamets Bo'q</term></margin>");
    expect(m).not.toContain('</margin></term>');
    expect(compose('Text.\n\n<margin><unclear>19</unclear></margin>\n### On the next')).toContain('<margin><unclear>19</unclear></margin>');
  });

  it('returns null when an anchor does not resolve (the caller serves today\'s path)', () => {
    const l = layers('Geomancy is <note>divination by figures</note> taught here by the Arabs.');
    const bad = l.annotations.map((a: any) => (a.exact ? { ...a, exact: 'nowhere on this page', start: 9999 } : a));
    expect(layerMarkup(l.text, bad)).toBeNull();
  });
});

// A stub of the one Mongo call the loader makes.
function stubDb(docs: object[], { fail = false } = {}) {
  const calls: object[] = [];
  const db = {
    collection: () => ({
      find: (filter: object) => {
        calls.push(filter);
        return { sort: () => ({ maxTimeMS: () => ({ toArray: async () => { if (fail) throw new Error('boom'); return docs; } }) }) };
      },
    }),
  };
  return { db, calls };
}
const DATA = 'Geomancy <note>divination by figures cast in earth</note>, an art of the Arabs, is <margin>Hermes</margin> taught here.';
const page = (id: string, data = DATA, current = true) => {
  const l = layers(data);
  return { id, book_id: 'b1', translation: { data, prompt_version: '13', text: l.text, text_from: current ? l.text_from : { ...l.text_from, data_hash: 'stale' } } };
};
const doc = (page_id: string, data: string, extra: object = {}) => {
  const l = layers(data);
  return { page_id, data_hash: l.data_hash, source: 'inline-v13', run_id: 'r1', annotations: l.annotations, ...extra };
};

describe('loadReaderTextLayers / applyReaderTextLayer (#7965)', () => {
  it('reads the newest doc of the current text, of any source; serves it in place of data, with layer named', async () => {
    const p = page('p1');
    const l = layers(DATA);
    const a = l.annotations.find((x: any) => x.type === 'note')!;
    const newest = { ...doc('p1', DATA), source: 'notes-step/v1', run_id: 'r2', annotations: [{ ...a, body: 'from the notes step' }] };
    const { db, calls } = stubDb([newest, doc('p1', DATA)]); // sorted newest first, as the query asks
    const map = await loadReaderTextLayers(db as never, [p]);
    expect(calls).toHaveLength(1);
    const served = applyReaderTextLayer(p, map) as any;
    expect(served.translation.data).toContain('<note>from the notes step</note>');
    expect(served.translation.layer).toEqual({ source: 'notes-step/v1', run_id: 'r2' });
  });

  it('ignores a doc of another text, and makes no query for a page whose text is not current', async () => {
    const { db, calls } = stubDb([doc('p1', DATA.replace('Arabs', 'Persians'))]);
    const map = await loadReaderTextLayers(db as never, [page('p1')]);
    expect(map.size).toBe(0);
    const s2 = stubDb([doc('p2', DATA)]);
    expect((await loadReaderTextLayers(s2.db as never, [page('p2', DATA, false), null])).size).toBe(0);
    expect(s2.calls).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it('serves today\'s path when the read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = stubDb([], { fail: true });
    expect((await loadReaderTextLayers(db as never, [page('p1')])).size).toBe(0);
    warn.mockRestore();
  });

  it('leaves a page alone once its data no longer hashes to the layer (withheld, gated, an English original)', async () => {
    const { db } = stubDb([doc('p1', DATA)]);
    const p = page('p1');
    const map = await loadReaderTextLayers(db as never, [p]);
    expect(map.get('p1')!.data_hash).toBe(contentHash(DATA));
    const gated = { ...p, translation: undefined };
    expect(applyReaderTextLayer(gated, map)).toBe(gated);
    const swapped = { ...p, translation: { ...p.translation, data: 'the leaf itself' } };
    expect(applyReaderTextLayer(swapped, map)).toBe(swapped);
    const other = { ...p, id: 'p9' };
    expect(applyReaderTextLayer(other, map)).toBe(other);
  });

  it('takeReaderTextLayers strips translation.text / text_from from every page it returns', async () => {
    const { db } = stubDb([doc('p1', DATA)]);
    const { pages, layers: map } = await takeReaderTextLayers(db as never, [page('p1'), page('p2')]);
    for (const p of pages as any[]) {
      expect(p.translation.text).toBeUndefined();
      expect(p.translation.text_from).toBeUndefined();
    }
    const served = applyReaderTextLayer(pages[0], map) as any;
    expect(served.translation.layer).toBeTruthy();
    expect(JSON.stringify(served)).not.toContain('text_from');
  });
});

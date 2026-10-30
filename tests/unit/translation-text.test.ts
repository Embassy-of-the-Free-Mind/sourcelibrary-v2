import { describe, it, expect } from 'vitest';
import { splitAnnotations, renderMarkup } from '../../scripts/lib/annotation-layer.mjs';
import {
  getTranslationText as getMjs,
  translationTextIsCurrent as currentMjs,
  translationLayers,
  parserAnnotation,
  inlineSource,
  annotationsDoc,
  PARSER_VERSION,
} from '../../scripts/lib/translation-text.mjs';
import { contentHash as hashMjs } from '../../scripts/lib/write-provenance.mjs';
import { getTranslationText as getTs, translationTextIsCurrent as currentTs } from '@/lib/translation-text';
import { contentHash as hashTs } from '@/lib/write-provenance';

// The read-side rule of #5942: translation.text is served only when text_from.data_hash is the
// hash of the translation.data beside it. Every other state parses data live.
const DATA = '<meta>continues</meta>\nGeomancy <note>divination by figures cast in earth</note>, an art of the Arabs, is <margin>Hermes</margin> taught here.\n\n<summary>On geomancy.</summary>';
const stored = (data: string) => {
  const l = translationLayers(data, { promptVersion: 13 });
  return { translation: { data, text: l.text, text_from: l.text_from } };
};

describe.each([
  ['scripts/lib (mjs)', getMjs, currentMjs],
  ['src/lib (ts)', getTs, currentTs],
])('getTranslationText — %s', (_n, get, current) => {
  it('serves the stored text when its hash matches the current data', () => {
    const page = stored(DATA);
    // Prove it is the stored field that is read, not a re-parse: a marker only the field holds.
    page.translation.text = page.translation.text + ' [stored]';
    expect(current(page.translation)).toBe(true);
    expect(get(page)).toMatch(/\[stored\]$/);
  });

  it('falls back to a live parse when data was rewritten and text was not (a writer that forgot)', () => {
    const page = stored(DATA);
    page.translation.data = DATA.replace('Arabs', 'Persians');
    expect(current(page.translation)).toBe(false);
    expect(get(page)).toBe(splitAnnotations(page.translation.data).text);
    expect(get(page)).toContain('Persians');
  });

  it('falls back when there is no text_from, or no text', () => {
    const page = stored(DATA);
    expect(get({ translation: { data: DATA, text: 'stale words' } })).toBe(splitAnnotations(DATA).text);
    expect(get({ translation: { data: DATA, text_from: page.translation.text_from } })).toBe(splitAnnotations(DATA).text);
  });

  it('returns empty for a page with no translation', () => {
    expect(get(null)).toBe('');
    expect(get({})).toBe('');
    expect(get({ translation: { data: '' } })).toBe('');
  });
});

describe('translationLayers', () => {
  it('stores the parser text, the data hash and the parser version', () => {
    const l = translationLayers(DATA, { promptVersion: 13 });
    expect(l.text).toBe(splitAnnotations(DATA).text);
    expect(l.text).not.toMatch(/<\/?(note|margin|meta|summary)\b/);
    expect(l.text_from).toEqual({ source: 'parser', parser_version: PARSER_VERSION, data_hash: hashMjs(DATA), annotations: l.annotations.length });
    expect(l.source).toBe('inline-v13');
  });

  it('the ts and mjs hashes are the same value (text_from written by one is read by the other)', () => {
    for (const s of [DATA, '', 'Grüße — 道 ἀρχή']) expect(hashTs(s)).toBe(hashMjs(s));
  });

  it('stored annotations rebuild the same markup as the parser\'s own', () => {
    const split = splitAnnotations(DATA, { source: 'inline-v13' });
    const l = translationLayers(DATA, { promptVersion: 13 });
    const fromStore = renderMarkup(l.text, l.annotations.map(parserAnnotation));
    const fromParser = renderMarkup(split.text, split.annotations);
    expect(fromStore.markup).toBe(fromParser.markup);
    expect(fromStore.orphans).toHaveLength(0);
  });

  it('flattens each anchor into exact/prefix/suffix/start/end', () => {
    const l = translationLayers(DATA, { promptVersion: 13 });
    const note = l.annotations.find((a: { type: string }) => a.type === 'note');
    expect(note).toMatchObject({ body: 'divination by figures cast in earth', kind: 'commentary' });
    expect(typeof note.exact).toBe('string');
    expect(l.text.slice(note.start, note.end)).toBe(note.exact);
  });

  it('labels the source by prompt version, and writes no doc for a page without annotations', () => {
    expect(inlineSource(undefined)).toBe('inline-vunknown');
    expect(inlineSource('v12')).toBe('inline-v12');
    const plain = translationLayers('Just the words of the book.', { promptVersion: 13 });
    expect(plain.text_from.annotations).toBe(0);
    expect(annotationsDoc({ page_id: 'p', book_id: 'b', layers: plain })).toBeNull();
    const doc = annotationsDoc({ page_id: 'p', book_id: 'b', layers: translationLayers(DATA, { promptVersion: 13 }) });
    expect(doc).toMatchObject({ page_id: 'p', book_id: 'b', source: 'inline-v13', anchor_kind: 'inferred', data_hash: hashMjs(DATA) });
  });
});

describe('writePageText stores the layer on a translation (both twins)', async () => {
  const mjs = await import('../../scripts/lib/page-text-writer.mjs');
  const ts = await import('@/lib/page-text-writer');
  it.each([['mjs', mjs.nextFieldValue], ['ts', ts.nextFieldValue]])('%s: text + text_from beside data, current by the accessor', (_n, nfv) => {
    const now = new Date();
    const v = nfv({ data: DATA, prompt_version: '13', text: 'stale words', text_from: { source: 'parser', data_hash: 'old' } }, now, false, 'translation') as Record<string, any>;
    expect(v.text).toBe(splitAnnotations(DATA).text);
    expect(v.text_from.data_hash).toBe(hashMjs(DATA));
    expect(getMjs({ translation: v })).toBe(v.text);
    // OCR is not touched, and a verbatim restore writes what it is given.
    expect(nfv({ data: DATA }, now, false, 'ocr')).not.toHaveProperty('text');
    expect((nfv({ data: DATA, text: 'stale words' }, now, true, 'translation') as Record<string, any>).text).toBe('stale words');
  });
});

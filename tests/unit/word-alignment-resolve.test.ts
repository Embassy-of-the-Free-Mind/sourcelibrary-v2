import { describe, it, expect } from 'vitest';
import { normalizeForSearch, normalizeNeedle, locateSpan } from '@/lib/align-text';
import { resolveAlignmentPairs, resolveRomanSpans, type AlignmentPair } from '@/lib/word-alignment';

// Trace mode (#3091) stores span strings + offsets resolved against the
// wrapper-stripped page text. Every stored pair must be locatable text —
// hallucinated or mangled model quotes are dropped, repeated phrases bind to
// successive occurrences, and whitespace/case differences never break a match.

describe('normalizeForSearch', () => {
  it('collapses whitespace runs and maps back to raw offsets', () => {
    const raw = 'PLATO  igitur,\n\nut ab eorum';
    const n = normalizeForSearch(raw);
    expect(n.norm).toBe('plato igitur, ut ab eorum');
    // 'ut' begins at norm index 14 → raw offset of 'u'
    const utNorm = n.norm.indexOf('ut ab');
    expect(raw.slice(n.rawIdx[utNorm], n.rawIdx[utNorm] + 2)).toBe('ut');
  });

  it('never changes length on case folding of special chars', () => {
    const raw = 'İstanbul VOLUPTAS';
    const n = normalizeForSearch(raw);
    expect(n.rawIdx.length).toBe(n.norm.length);
  });

  // The symmetric folds below were each measured breaking real pairs on a
  // real page (Drebbel, Tractatus duo): before them, 10 of 19 model pairs
  // failed to resolve; after, 19 of 19.
  it('folds long ſ, ligatures, and accents', () => {
    const n = normalizeForSearch('reſurrectiõem, Animæ, cùm cœleſti');
    expect(n.norm).toBe('resurrectionem, animae, cum coelesti');
  });

  it('expands tilde-vowel abbreviations symmetrically', () => {
    const hay = normalizeForSearch('nõ ſecus ac cœlum');
    expect(locateSpan(hay, 'non secus ac coelum')).not.toBeNull();
    expect(locateSpan(hay, 'nõ ſecus ac cœlum')).not.toBeNull();
  });

  it('joins end-of-line hyphenations but keeps spaced dashes', () => {
    const hay = normalizeForSearch('reſurrectio-\nnem atque — vitam - I mean');
    expect(hay.norm).toContain('resurrectionem');
    expect(locateSpan(hay, 'reſurrectionem atque')).not.toBeNull();
    // The spaced hyphen in "vitam - I" is a real dash, not a line break.
    expect(hay.norm).toContain('vitam - i');
  });
});

describe('locateSpan', () => {
  const hay = normalizeForSearch('the spirit moves; the spirit rests; the spirit sleeps');

  it('finds successive occurrences with a moving cursor', () => {
    const first = locateSpan(hay, 'the spirit');
    expect(first).not.toBeNull();
    const second = locateSpan(hay, 'the spirit', first!.normStart + 1);
    expect(second!.start).toBeGreaterThan(first!.start);
  });

  it('falls back to a global search when the cursor overshoots', () => {
    const hit = locateSpan(hay, 'the spirit moves', 40);
    expect(hit).not.toBeNull();
    expect(hit!.start).toBe(0);
  });

  it('matches across case and whitespace differences', () => {
    const h = normalizeForSearch('MENTI laeticiam &\ngaudium attribuit');
    expect(locateSpan(h, 'menti laeticiam & gaudium')).not.toBeNull();
  });

  it('returns null for absent spans', () => {
    expect(locateSpan(hay, 'voluptatem')).toBeNull();
  });

  it('retries with f→s for long-ſ misreads', () => {
    const h = normalizeForSearch('Spiritûs militatem aduerſus Corpus');
    const hit = locateSpan(h, 'militatem aduerfus Corpus');
    expect(hit).not.toBeNull();
  });

  // The reader's trace layer asks "is this normalized click offset inside the
  // span?" It must use normEnd. A raw length is not a normalized length: folds
  // grow (æ→ae) and shrink (dehyphenation, diacritic stripping) the string.
  describe('normEnd is a normalized offset, not a raw length', () => {
    it('reports normEnd larger than the raw span when folding expands', () => {
      const h = normalizeForSearch('cœleſti Animæ gaudium');
      const hit = locateSpan(h, 'Animæ')!;
      expect(h.norm.slice(hit.normStart, hit.normEnd)).toBe('animae');
      // raw 'Animæ' is 5 chars; normalized 'animae' is 6.
      expect(hit.end - hit.start).toBe(5);
      expect(hit.normEnd - hit.normStart).toBe(6);
    });

    it('reports normEnd smaller than the raw span when dehyphenation shrinks', () => {
      const h = normalizeForSearch('reſurrectio-\nnem atque');
      const hit = locateSpan(h, 'reſurrectionem')!;
      expect(h.norm.slice(hit.normStart, hit.normEnd)).toBe('resurrectionem');
      expect(hit.normEnd - hit.normStart).toBe(14);
      // The raw slice still spans the hyphen and the newline.
      expect(hit.end - hit.start).toBe(16);
    });

    it('always delimits the matched text in the normalized string', () => {
      const h = normalizeForSearch('MENTI laeticiam &\ngaudium attribuit');
      const hit = locateSpan(h, 'laeticiam & gaudium')!;
      expect(h.norm.slice(hit.normStart, hit.normEnd)).toBe('laeticiam & gaudium');
    });
  });
});

describe('normalizeNeedle', () => {
  it('collapses internal whitespace and trims', () => {
    expect(normalizeNeedle('  menti\n laeticiam ')).toBe('menti laeticiam');
  });
});

describe('resolveAlignmentPairs', () => {
  const source =
    'PLATO igitur, cum animum in duas partes distribuisset, ' +
    'menti laeticiam & gaudium attribuit, sensibus voluptatem.';
  const translation =
    'Plato, therefore, when he had divided the soul into two parts, ' +
    'attributed gladness and joy to the mind, pleasure to the senses.';

  it('resolves verbatim spans to raw slices with offsets', () => {
    const pairs = resolveAlignmentPairs(
      [
        { src: 'PLATO igitur', en: 'Plato, therefore' },
        { src: 'sensibus voluptatem', en: 'pleasure to the senses' },
      ],
      source,
      translation,
    );
    expect(pairs).toHaveLength(2);
    expect(pairs[0].s).toBe('PLATO igitur');
    expect(source.slice(pairs[1].so, pairs[1].so + pairs[1].s.length)).toBe(pairs[1].s);
    expect(translation.slice(pairs[1].to, pairs[1].to + pairs[1].t.length)).toBe(pairs[1].t);
  });

  it('drops pairs whose spans cannot be found on either side', () => {
    const pairs = resolveAlignmentPairs(
      [
        { src: 'not in the source at all', en: 'Plato, therefore' },
        { src: 'PLATO igitur', en: 'not in the translation' },
        { src: 'menti', en: 'to the mind' },
      ],
      source,
      translation,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].s).toBe('menti');
  });

  it('binds repeated phrases to successive occurrences', () => {
    const src = 'aqua vitae prima. aqua vitae secunda.';
    const tr = 'the first water of life. the second water of life.';
    const pairs = resolveAlignmentPairs(
      [
        { src: 'aqua vitae', en: 'water of life' },
        { src: 'aqua vitae', en: 'water of life' },
      ],
      src,
      tr,
    );
    expect(pairs).toHaveLength(2);
    expect(pairs[1].so).toBeGreaterThan(pairs[0].so);
    expect(pairs[1].to).toBeGreaterThan(pairs[0].to);
  });

  it('survives model quotes with mangled whitespace', () => {
    const pairs = resolveAlignmentPairs(
      [{ src: 'menti  laeticiam &\ngaudium', en: 'gladness  and joy' }],
      source,
      translation,
    );
    expect(pairs).toHaveLength(1);
    // Stored span is the RAW slice from the text, not the model's string.
    expect(pairs[0].s).toBe('menti laeticiam & gaudium');
    expect(pairs[0].t).toBe('gladness and joy');
  });
});

// The romanized pane joins trace via a second, additive pass: source spans in,
// verified spans of the transliteration out. A pair that fails verification
// keeps working for OCR↔translation and simply gains no romanized highlight.
describe('resolveRomanSpans', () => {
  // Greek source, its romanization, and pairs as the aligner would store them.
  const translit = 'ta men homos polees te kai allydis alloi iontes ouranoi helkontai';
  const pairs: AlignmentPair[] = [
    { s: 'τὰ μὲν ὁμῶς', t: 'these alike', so: 0, to: 0 },
    { s: 'πολέες τε', t: 'many and', so: 12, to: 12 },
    { s: 'οὐρανῷ ἕλκονται', t: 'are drawn through heaven', so: 30, to: 30 },
  ];

  it('attaches verified spans and leaves the base pair intact', () => {
    const out = resolveRomanSpans(pairs, [
      { i: 0, rom: 'ta men homos' },
      { i: 2, rom: 'ouranoi helkontai' },
    ], translit);
    expect(out[0].r).toBe('ta men homos');
    expect(translit.slice(out[0].ro!, out[0].ro! + out[0].r!.length)).toBe(out[0].r);
    expect(out[1].r).toBeUndefined();          // no span offered → untouched
    expect(out[2].r).toBe('ouranoi helkontai');
    // Base fields survive untouched.
    expect(out.map((p) => p.s)).toEqual(pairs.map((p) => p.s));
    expect(out.map((p) => p.t)).toEqual(pairs.map((p) => p.t));
  });

  it('drops a hallucinated span rather than highlighting the wrong words', () => {
    const out = resolveRomanSpans(pairs, [{ i: 1, rom: 'this text is nowhere on the page' }], translit);
    expect(out[1].r).toBeUndefined();
  });

  it('drops a span that runs backwards through the romanization', () => {
    // The romanization has the same words in the same order as the source, so a
    // later pair whose span sits EARLIER in the text is a mis-quote. locateSpan
    // would happily find it via its global fallback; the guard must not.
    const out = resolveRomanSpans(pairs, [
      { i: 1, rom: 'ouranoi helkontai' },  // pair 1 grabs pair 2's words (offset 48)
      { i: 2, rom: 'ta men' },             // pair 2 then resolves back at offset 0
    ], translit);
    expect(out[1].r).toBe('ouranoi helkontai');
    expect(out[2].r).toBeUndefined();
  });

  it('ignores entries whose index is out of range or empty', () => {
    const out = resolveRomanSpans(pairs, [{ i: 99, rom: 'ta men' }, { i: 0, rom: '' }], translit);
    expect(out.every((p) => p.r === undefined)).toBe(true);
  });

  it('is a no-op when the model returns nothing', () => {
    expect(resolveRomanSpans(pairs, [], translit)).toEqual(pairs);
  });
});

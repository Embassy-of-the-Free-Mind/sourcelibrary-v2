import { describe, it, expect } from 'vitest';
import { normalizeForSearch, normalizeNeedle, locateSpan } from '@/lib/align-text';
import { resolveAlignmentPairs } from '@/lib/word-alignment';

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

import { describe, it, expect } from 'vitest';
import { candidateFromInput, ourBookRef, rankingTokens, titleCoverage, summarize } from '@/lib/holdings-check';
import { sourceFingerprints } from '@/lib/dedup';

describe('ourBookRef', () => {
  it('reads our book links, with or without a locale prefix', () => {
    expect(ourBookRef('https://sourcelibrary.org/book/69db8a35f4c595498deb9614')).toBe('69db8a35f4c595498deb9614');
    expect(ourBookRef('https://sourcelibrary.org/es/book/some-slug?page=3')).toBe('some-slug');
    expect(ourBookRef('https://archive.org/details/ARes18421')).toBeNull();
  });
});

describe('candidateFromInput', () => {
  it('derives the same fingerprints the gate uses from a pasted URL', () => {
    const fps = sourceFingerprints(candidateFromInput({ url: 'https://archive.org/details/ARes18421' }));
    expect(fps).toContain('ia:ARes18421');
  });

  it('treats e-rara manifest API versions as one object (#5811)', () => {
    const a = sourceFingerprints(candidateFromInput({ url: 'https://www.e-rara.ch/i3f/v20/891546/manifest' }));
    const b = sourceFingerprints(candidateFromInput({ url: 'https://www.e-rara.ch/i3f/v21/891546/manifest' }));
    expect(a).toContain('e-rara:891546');
    expect(b).toContain('e-rara:891546');
  });

  it('routes bare identifiers by shape', () => {
    expect(candidateFromInput({ identifier: 'bsb10012345' }).mdz_id).toBe('bsb10012345');
    expect(candidateFromInput({ identifier: 'ark:/12148/bpt6k123456' }).gallica_ark).toBe('ark:/12148/bpt6k123456');
    expect(candidateFromInput({ identifier: 'ARes18421' }).ia_identifier).toBe('ARes18421');
  });
});

describe('near-title ranking', () => {
  it('folds early-modern ß / sz / ss spellings of one word together', () => {
    // As typed vs as catalogued — Atlas folds ß→ss but leaves sz (#6019, Becher).
    expect([...rankingTokens('Närrische Weißheit')]).toEqual([...rankingTokens('Närrische Weiszheit')]);
    expect(titleCoverage('Närrische Weißheit', 'Närrische Weiszheit Und Weise Narrheit: Oder Ein Hundert').coverage).toBe(1);
  });

  it('does not count a long catalogue subtitle against the match', () => {
    const r = titleCoverage('Musurgia universalis', 'Musurgia universalis sive ars magna consoni et dissoni in X libros digesta');
    expect(r.coverage).toBe(1);
    expect(r.hits).toBe(2);
  });

  it('one shared common word is a weak match', () => {
    expect(titleCoverage('Närrische Weißheit', 'Der Weisheit Morgenröthe').hits).toBe(1);
  });
});

describe('summarize', () => {
  it('says new when nothing matched', () => {
    expect(summarize('new', [])).toMatch(/^New/);
  });
});

import { describe, it, expect } from 'vitest';
import { candidateFromInput, ourBookRef, rankingTokens, titleCoverage, summarize, sameAuthorAnyScript, nameTokens } from '@/lib/holdings-check';
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

describe('names and titles outside the Latin script (#8084)', () => {
  it('keeps Han, Greek and Arabic name words', () => {
    expect(nameTokens('李時珍')).toEqual(['李時珍']);
    expect(nameTokens('Ali ibn Nasr al-Katib (علي بن نصر الكاتب)')).toContain('الكاتب');
  });

  it('matches a Han author inside a catalogue form, and not a different name', () => {
    expect(sameAuthorAnyScript('李時珍', '(明)李時珍撰')).toBe(true);
    expect(sameAuthorAnyScript('司馬遷', '司馬遷 (Sima Qian)')).toBe(true);
    expect(sameAuthorAnyScript('司馬遷', '司馬貞')).toBe(false);
  });

  it('still matches Latin surnames, and an Arabic particle is not a name', () => {
    expect(sameAuthorAnyScript('Sima Qian', '司馬遷 (Sima Qian)')).toBe(true);
    expect(sameAuthorAnyScript('محمد بن موسى', 'علي بن نصر الكاتب')).toBe(false);
  });

  it('counts a Han title contained in a longer catalogue title', () => {
    expect(titleCoverage('本草綱目', '本草綱目·卷上之中').coverage).toBe(1);
    expect(titleCoverage('本草綱目', '普濟方').coverage).toBe(0);
  });
});

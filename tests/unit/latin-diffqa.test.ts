import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper
import { fold, diffWords, classifyHunk, alignToFresh, voteHunk, revertWordHunks, wordTokens } from '../../scripts/lib/latin-diffqa.mjs';

type H = { a: number[]; b: number[] };
const spans = (draft: string, next: string) => {
  const d = diffWords(draft, next);
  return d.hunks.map((h: H) => {
    const a = h.a.map((i) => d.A[i].tok), b = h.b.map((j) => d.B[j].tok);
    return { a: a.join(' '), b: b.join(' '), cls: classifyHunk(a, b) };
  });
};

describe('latin diff-QA: fold and tokens (#7591)', () => {
  it('folds the printer\'s interchangeable letters, case and edge punctuation', () => {
    expect(fold('Aſhmole,')).toBe('ashmole');
    expect(fold('Hiſtoriæ')).toBe('historiae');
    expect(fold('VNIVERSITATIS.')).toBe(fold('universitatis'));
    expect(fold('Jeſu')).toBe('iesu');
    expect(fold('<header>ASHMOLEANI.</header>')).toBe('ashmoleani');
  });
  it('drops tokens that are only punctuation', () => {
    expect(wordTokens('— Staffordſhire, &c. Ibid.').map((t: { key: string }) => t.key)).toEqual(['staffordshire', 'c', 'ibid']);
  });
});

describe('latin diff-QA: classifier', () => {
  it('a text differing only in long s, u/v, i/j, æ, case and punctuation has no hunk at all', () => {
    expect(spans('Jesu Christ, avec Historiae Universitatis.', 'Ieſu Chriſt avec Hiſtoriæ VNIVERSITATIS')).toEqual([]);
  });
  it('f↔ſ (the long-s misread) is LOW, f↔s is not', () => {
    expect(spans('Notes out of Froifard and', 'Notes out of Froiſard and')[0].cls).toEqual(['LOW', 'long-s']);
    expect(spans('the fame day', 'the ſame day')[0].cls).toEqual(['LOW', 'long-s']);
    expect(spans('the fame day', 'the same day')[0].cls[0]).toBe('RISKY');
  });
  it('a hyphenation join or a split word is LOW', () => {
    expect(spans('de Hiſto-\nriæ Angliae', 'de Hiſtoriæ Angliae')[0].cls).toEqual(['LOW', 'join-split']);
    expect(spans('in to the', 'into the')[0].cls).toEqual(['LOW', 'join-split']);
  });
  it('numbers, roman numerals, names and negations are RISKY', () => {
    expect(spans('Ashmole, 1137. f.', 'Ashmole, 1173. f.')[0].cls).toEqual(['RISKY', 'number']);
    expect(spans('temp. Ed. II. 1147', 'temp. Ed. III. 1147')[0].cls[1]).toBe('roman');
    expect(spans('fol. iij. verso', 'fol. iiij. verso')[0].cls).toEqual(['RISKY', 'roman']);
    expect(spans('wife to Samson Leonard', 'wife to Simon Leonard')[0].cls).toEqual(['RISKY', 'capital']);
    expect(spans('quod non est verum', 'quod est verum')[0].cls).toEqual(['RISKY', 'negation']);
    expect(spans('liber de anima', 'liber de animo')[0].cls).toEqual(['RISKY', 'substitution']);
  });
  it('a line\'s worth added or dropped is RISKY', () => {
    expect(spans('a b\nc', 'a b\nunus duo tres quatuor quinque sex septem\nc')[0].cls).toEqual(['RISKY', 'line-size']);
  });
});

describe('latin diff-QA: revert', () => {
  const back = (draft: string, next: string, ks: number[]) => revertWordHunks(draft, next, diffWords(draft, next), new Set(ks));
  it('puts a substituted span back with the draft\'s own text', () => {
    expect(back('Ashmole, 1137. f. and', 'Aſhmole, 1173. f. and', [0])).toBe('Aſhmole, 1137. f. and');
  });
  it('removes an added word with its space and restores a dropped one', () => {
    expect(back('quod non est verum', 'quod est verum', [0])).toBe('quod non est verum');
    expect(back('Henrici 1141. Hiſt', 'Henrici 1141. 5. 1139. Hiſt', [0])).toBe('Henrici 1141. Hiſt');
  });
  it('restores a dropped line with its newline', () => {
    expect(back('7358. A Collection\n7359. Armes and\n7360. Seals', '7358. A Collection\n7360. Seals', [0])).toBe('7358. A Collection\n7359. Armes and\n7360. Seals');
  });
  it('reverts only the listed hunks and keeps the rest of the correction', () => {
    const draft = 'Fenys wife to Samfon of 1147. p. 57.';
    const next = 'Fenys wife to Samſon of 1174. p. 75.';
    const d = diffWords(draft, next);
    expect(d.hunks.length).toBe(3);
    expect(revertWordHunks(draft, next, d, new Set([1]))).toBe('Fenys wife to Samſon of 1147. p. 75.');
  });
  it('round trip: reverting every hunk gives back the draft\'s words', () => {
    const draft = 'Liber primus de anima\n7356. The Ordonances 865. p. 253.\nnon est';
    const next = 'Liber ſecundus de animo\n7356. The Ordinances of 856. p. 253.\nest';
    const d = diffWords(draft, next);
    const out = revertWordHunks(draft, next, d, new Set(d.hunks.map((_: H, k: number) => k)));
    expect(diffWords(draft, out).hunks).toEqual([]);
  });
});

describe('latin diff-QA: vote with an independent read', () => {
  const vote = (draft: string, next: string, fresh: string) => {
    const d = diffWords(draft, next), F = wordTokens(fresh), bf = alignToFresh(d.B, F);
    return d.hunks.map((h: H) => voteHunk(d, h, F, bf));
  };
  it('accepts a correction the fresh read agrees with, reverts one it does not', () => {
    expect(vote('Ashmole, 1173. f. Ibid', 'Ashmole, 1137. f. Ibid', 'Aſhmole, 1137. F. Ibid.')).toEqual(['correction']);
    expect(vote('Ashmole, 1137. f. Ibid', 'Ashmole, 1173. f. Ibid', 'Aſhmole, 1137. F. Ibid.')).toEqual(['draft']);
  });
  it('splits when all three disagree, and votes on added and dropped words', () => {
    expect(vote('Ashmole, 1137. f. Ibid', 'Ashmole, 1173. f. Ibid', 'Aſhmole, 1731. F. Ibid.')).toEqual(['split']);
    expect(vote('Henrici 1141. 5. 1139. Hiſt de', 'Henrici 1141. Hiſt de', 'Henrici Spelmanni 1141. Hiſt de')).toEqual(['correction']);
    const long = 'alpha beta gamma delta epsilon zeta eta theta';
    expect(vote(`${long} 1137 ${long}`, `${long} 1173 ${long}`, 'nothing of the kind here')).toEqual(['no-anchor']);
    expect(vote('Spelmanni 1141. 5. 1139. Hiſt de', 'Spelmanni 1141. Hiſt de', 'Spelmanni 1141. Hiſt de')).toEqual(['correction']);
    expect(vote('quod non est verum', 'quod est verum', 'quod non eſt verum')).toEqual(['draft']);
  });
});

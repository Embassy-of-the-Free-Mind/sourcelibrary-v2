import { describe, it, expect } from 'vitest';
import { normalizeHeader, deriveContainedWorks } from '@/lib/contains-works';

// Every header string below was captured from production OCR on 2026-08-07.
describe('normalizeHeader', () => {
  it('collapses letter-spacing, and strips a numeral that follows a word', () => {
    for (const form of ['ΠΟΛΙΤΙΚΩΝ', 'Π Ο Λ Ι Τ Ι Κ Ω Ν', 'ΠΟΛΙΤΙΚΩΝ Γ']) {
      expect(normalizeHeader(form), form).toBe('ΠΟΛΙΤΙΚΩΝ');
    }
  });

  // Letter-spaced capitals must NOT eat themselves. Every letter in
  // "Π Ο Λ Ι Τ Ι Κ Ω Ν" looks like a trailing numeral, and a loop without the
  // preceded-by-a-word guard strips right-to-left down to "Π".
  it('does not mistake letter-spacing for a run of numerals', () => {
    expect(normalizeHeader('Π Ο Λ Ι Τ Ι Κ Ω Ν')).not.toBe('Π');
  });

  // What normalisation genuinely CANNOT resolve, and shouldn't pretend to:
  // once the spacing is collapsed, a fused numeral is indistinguishable from
  // the word's own final letter — ΠΟΛΙΤΙΚΩΝ really does end in Ν, which is also
  // the numeral 50. deriveContainedWorks merges these by prefix instead, where
  // both candidates are visible at once.
  it('leaves a fused numeral for the grouping stage to resolve', () => {
    expect(normalizeHeader('Π Ο Λ Ι Τ Ι Κ Ω Ν Δ')).toBe('ΠΟΛΙΤΙΚΩΝΔ');
  });

  it('strips a Greek numeral carrying the keraia, and the article before it', () => {
    expect(normalizeHeader('ἨΘΙΚΩ͂Ν ΜΕΓΆΛΩΝ ΤῸ Α΄')).toBe(normalizeHeader('ἨΘΙΚΩ͂Ν ΜΕΓΆΛΩΝ'));
    expect(normalizeHeader('ΠΟΛΙΤΙΚΩ͂Ν ΤῸ Η΄')).toBe(normalizeHeader('ΠΟΛΙΤΙΚΩ͂Ν'));
  });

  it('strips a stigma-bearing numeral', () => {
    expect(normalizeHeader('ΠΡΟΒΛΗΜΑΤΩΝ ΚϚ')).toBe('ΠΡΟΒΛΗΜΑΤΩΝ');
  });

  // #4393: OECT I and II bound in one record. The volume numeral is the
  // evidence; stripping it made both volumes one head.
  it('keeps a volume numeral', () => {
    expect(normalizeHeader('WELD-BLUNDELL COLLECTION VOL. II')).toBe('WELD-BLUNDELL COLLECTION VOL II');
    expect(normalizeHeader('WELD-BLUNDELL COLLECTION VOL. II')).not.toBe(normalizeHeader('WELD-BLUNDELL COLLECTION VOL. I'));
    expect(normalizeHeader('OEUVRES TOME III')).toBe('OEUVRES TOME III');
  });

  it('leaves an ordinary title alone', () => {
    expect(normalizeHeader('ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ')).toBe('ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ');
  });
});

/** Build [page, header] pairs the way the real extraction does. */
const run = (header: string, from: number, to: number): Array<[number, string]> =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, header] as [number, string]);

describe('deriveContainedWorks', () => {
  // Reduced from the genuine Bekker volume, where the reporter established the
  // contents by reading the scans.
  const bekker: Array<[number, string]> = [
    ...run('ΤΩΝ ΜΕΤΑ ΤΑ ΦΥΣΙΚΑ', 197, 309),
    ...run('ΗΘΙΚΩΝ ΝΙΚΟΜΑΧΕΙΩΝ', 310, 397),
    ...run('Π Ο Λ Ι Τ Ι Κ Ω Ν', 473, 520),
    ...run('ΠΟΛΙΤΙΚΩΝ Δ', 521, 558),
    ...run('ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ', 664, 678),
  ];

  it('finds the works and their page spans', () => {
    const works = deriveContainedWorks(bekker, { author: 'Aristotle' });
    const headers = works.map((w) => w.header);
    expect(headers).toContain('ΤΩΝ ΜΕΤΑ ΤΑ ΦΥΣΙΚΑ');
    expect(headers).toContain('ΗΘΙΚΩΝ ΝΙΚΟΜΑΧΕΙΩΝ');
    // THE finding: the reporter concluded the Poetics was absent from the
    // corpus because three titles claimed it and none delivered. It is here.
    const poetics = works.find((w) => w.header === 'ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ');
    expect(poetics).toBeTruthy();
    expect(poetics!.first_page).toBe(664);
    expect(poetics!.last_page).toBe(678);
  });

  it('reports the two Politics spellings as ONE work', () => {
    const works = deriveContainedWorks(bekker, { author: 'Aristotle' });
    const politics = works.filter((w) => w.header === 'ΠΟΛΙΤΙΚΩΝ');
    expect(politics).toHaveLength(1);
    expect(politics[0].page_count).toBe(86);
  });

  // The Aldine heads 159 pages with the author's name in the Greek genitive,
  // while books.author says "Aristotle". A Latin-only comparison reports the
  // author as a work spanning most of the volume.
  it('rejects the author name in its Greek form, not just the Latin', () => {
    const pages = [...run('ἈΡΙΣΤΟΤΈΛΟΥΣ', 36, 200), ...run('ΠΟΛΙΤΙΚΩ͂Ν', 199, 300)];
    const works = deriveContainedWorks(pages, { author: 'Aristotle' });
    expect(works.map((w) => w.header)).not.toContain('ἈΡΙΣΤΟΤΈΛΟΥΣ');
    expect(works.length).toBe(1);
  });

  it('drops structural divisions that are not works', () => {
    const pages = [...run('INTRODUCTION', 10, 60), ...run('ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ', 664, 678)];
    expect(deriveContainedWorks(pages).map((w) => w.header)).toEqual(['ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ']);
  });

  // "ΕΙΣ" — the opening preposition of every commentary title — heads 123 pages
  // of the Scholia volume where the OCR truncated the head, and names nothing.
  it('drops a bare truncated preposition', () => {
    const pages = [...run('ΕΙΣ', 151, 529), ...run('ΕΙΣ ΤΑΣ ΚΑΤΗΓΟΡΙΑΣ', 10, 99)];
    expect(deriveContainedWorks(pages).map((w) => w.header)).toEqual(['ΕΙΣ ΤΑΣ ΚΑΤΗΓΟΡΙΑΣ']);
  });

  it('ignores a head appearing on too few pages to be a work', () => {
    expect(deriveContainedWorks(run('ΠΕΡΙ ΤΙΝΟΣ', 10, 13))).toEqual([]);
  });

  it('ignores a head scattered too thinly to be a block', () => {
    // Six mentions spread over 400 pages is a cross-reference, not a section.
    const scattered: Array<[number, string]> = [10, 80, 150, 220, 300, 380, 400, 410].map((p) => [p, 'ΠΕΡΙ ΨΥΧΗΣ']);
    expect(deriveContainedWorks(scattered)).toEqual([]);
  });

  it('returns spans in reading order', () => {
    const works = deriveContainedWorks(bekker, { author: 'Aristotle' });
    const firsts = works.map((w) => w.first_page);
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
  });

  // Captured from 6992543c59cdabeb78f1d0cd (#4393): Vol. I heads its versos
  // without a number, Vol. II with one. Two volumes, not one.
  it('reports two volumes of one series as two spans', () => {
    const oect: Array<[number, string]> = [
      ...run('WELD-BLUNDELL COLLECTION.', 12, 66).filter(([p]) => p % 2 === 0),
      ...run('WELD-BLUNDELL COLLECTION VOL. II', 164, 200).filter(([p]) => p % 2 === 0),
    ];
    const works = deriveContainedWorks(oect, { author: 'Stephen Langdon' });
    expect(works.map((w) => [w.header, w.first_page, w.last_page])).toEqual([
      ['WELD-BLUNDELL COLLECTION', 12, 66],
      ['WELD-BLUNDELL COLLECTION VOL II', 164, 200],
    ]);
  });

  it('survives empty and malformed input', () => {
    expect(deriveContainedWorks([])).toEqual([]);
    expect(deriveContainedWorks([[1, ''], [2, '   '], [3, '...']])).toEqual([]);
  });
});

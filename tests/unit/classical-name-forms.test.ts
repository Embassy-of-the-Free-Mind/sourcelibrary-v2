import { describe, it, expect } from 'vitest';
import { CLASSICAL_NAME_FORMS, nameFormsFor, isGreekScript } from '@/lib/classical-name-forms';

describe('CLASSICAL_NAME_FORMS data integrity', () => {
  // The whole point is to put Greek script where there is none. A Latin form
  // slipping in would be inert — it would duplicate `author`, which is already
  // indexed, and quietly make the coverage number look better than it is.
  it('every form is actually Greek script', () => {
    const latin: string[] = [];
    for (const [key, forms] of Object.entries(CLASSICAL_NAME_FORMS)) {
      for (const f of forms) if (!isGreekScript(f)) latin.push(`${key}: ${f}`);
    }
    expect(latin).toEqual([]);
  });

  it('no author has duplicate forms', () => {
    for (const [key, forms] of Object.entries(CLASSICAL_NAME_FORMS)) {
      expect(new Set(forms).size, `${key} has repeats`).toBe(forms.length);
    }
  });

  it('keys are Latin-script, since they match against books.author', () => {
    for (const key of Object.keys(CLASSICAL_NAME_FORMS)) {
      expect(isGreekScript(key), `${key} should be the Latin form`).toBe(false);
    }
  });

  it('covers the authors this library is deepest in', () => {
    // Measured holdings: Galen 105 books, Proclus 65, Iamblichus 45, Porphyry 28,
    // Plotinus 20. Perseus has one work for most of these — if we drop them the
    // feature misses precisely the corpus that justifies it.
    for (const a of ['Galen', 'Proclus', 'Iamblichus', 'Porphyry', 'Plotinus', 'Aristotle', 'Plato']) {
      expect(CLASSICAL_NAME_FORMS[a], `${a} missing`).toBeTruthy();
    }
  });
});

describe('nameFormsFor', () => {
  it('matches a plain author string', () => {
    expect(nameFormsFor('Plato')).toContain('Πλάτων');
  });

  // books.author is free text carrying editorial roles and multiple people.
  it('matches inside a compound author string', () => {
    expect(nameFormsFor('Plato; tr. Thomas Taylor & Floyer Sydenham')).toContain('Πλάτων');
    const both = nameFormsFor('Galen; Hippocrates');
    expect(both).toContain('Γαληνός');
    expect(both).toContain('Ἱπποκράτης');
  });

  // A reader hunting the Secretum Secretorum types Ἀριστοτέλης, whatever the
  // catalogue says about authorship. Reachability is not an attribution claim.
  it('still reaches a pseudo- attribution', () => {
    expect(nameFormsFor('Pseudo-Aristotle')).toContain('Ἀριστοτέλης');
  });

  it('returns nothing for an unknown or empty author', () => {
    expect(nameFormsFor('Johann Grasshoff')).toEqual([]);
    expect(nameFormsFor('')).toEqual([]);
    expect(nameFormsFor(null)).toEqual([]);
    expect(nameFormsFor(undefined)).toEqual([]);
  });

  it('deduplicates when two keys hit the same author string', () => {
    const forms = nameFormsFor('Aristotle; Pseudo-Aristotle');
    expect(new Set(forms).size).toBe(forms.length);
  });
});

describe('isGreekScript', () => {
  it('accepts monotonic, polytonic and uppercase', () => {
    for (const s of ['Πλάτων', 'πλατων', 'ΠΛΑΤΩΝ', 'Ἀριστοτέλης', 'ἀρετή']) {
      expect(isGreekScript(s), s).toBe(true);
    }
  });

  it('rejects Latin, including accented Latin', () => {
    for (const s of ['Plato', 'Aristoteles', 'Académie', 'Ḫammu-rābi', '']) {
      expect(isGreekScript(s), s).toBe(false);
    }
  });
});

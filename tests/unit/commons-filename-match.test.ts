/**
 * Commons filename ↔ work overlap (#4411). Fixtures are the pairings diagnosed by eye in #4405.
 *
 * Pins what the detector CAN and CANNOT see, so nobody later reads a pass as a match:
 *   - the wrong files with no shared word flag (Cézanne on Merikare, Sinuhe plate on the Peasant);
 *   - a keyword-matched wrong file passes ("By Nile and Tigris" on the Hymn to the Nile);
 *   - a true witness named by shelfmark flags ("Papyrus Sallier II" for the same Hymn).
 */
import { describe, expect, it } from 'vitest';
import { commonsFilename, commonsOverlap, tokenize } from '../../scripts/lib/commons-filename-match.mjs';

describe('commonsFilename', () => {
  it('reads originals, thumbs, File: pages and Special:FilePath', () => {
    expect(commonsFilename('https://upload.wikimedia.org/wikipedia/commons/a/ab/Paul_C%C3%A9zanne_-_The_Bay_of_Marseilles.jpg'))
      .toBe('Paul Cézanne - The Bay of Marseilles');
    expect(commonsFilename('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Moeller-Sinuhe-01.jpg/800px-Moeller-Sinuhe-01.jpg'))
      .toBe('Moeller-Sinuhe-01');
    expect(commonsFilename('https://commons.wikimedia.org/wiki/File:Papyrus_Sallier_II.jpg')).toBe('Papyrus Sallier II');
    expect(commonsFilename('https://commons.wikimedia.org/wiki/Special:FilePath/Papyrus_Sallier_II.jpg')).toBe('Papyrus Sallier II');
  });
  it('returns null for anything that is not a Commons file', () => {
    expect(commonsFilename('https://images.sourcelibrary.org/pages/abc/0001.jpg')).toBeNull();
    expect(commonsFilename('https://commons.wikimedia.org/wiki/Category:Papyri')).toBeNull();
    expect(commonsFilename('not a url')).toBeNull();
  });
});

describe('tokenize', () => {
  it('folds diacritics and drops object words and stopwords', () => {
    expect(tokenize('Planche 17 Monuments Funéraires (1872)')).toEqual(['monuments', 'funeraires']);
    expect(tokenize('Papyrus scroll')).toEqual([]);
  });
});

const book = (title: string, author?: string) => ({ title, author });

describe('commonsOverlap — #4405 pairings', () => {
  it('flags the wrong files that share no word with the work', () => {
    expect(commonsOverlap(book('The Instruction for Merikare', 'Saqqara (papyrus scroll)'),
      ['Paul Cézanne - The Bay of Marseilles']).verdict).toBe('zero-overlap');
    expect(commonsOverlap(book('The Eloquent Peasant', 'westliches Ufer (papyrus scroll)'),
      ['Moeller-Sinuhe-01']).verdict).toBe('zero-overlap');
    expect(commonsOverlap(book('The Instruction of Ani', '(unbestimmt) (papyrus scroll)'),
      ['Planche 17 Monuments Funéraires (1872)']).verdict).toBe('zero-overlap');
    expect(commonsOverlap(book('The Shipwrecked Sailor', '(unbestimmt) (papyrus scroll)'),
      ['Four Beauties', 'Guan Yu']).verdict).toBe('zero-overlap');
  });

  it('passes a correctly named witness, matching across inflection', () => {
    const r = commonsOverlap(book('The Story of Sinuhe'), ['Moeller-Sinuhe-01']);
    expect(r.verdict).toBe('overlap');
    expect(r.files[0].shared).toEqual(['sinuhe']);
    expect(commonsOverlap(book('Instruction for Merikara'), ['Merikare papyrus']).verdict).toBe('overlap');
  });

  it('cannot see a keyword-matched wrong file (known blind spot)', () => {
    expect(commonsOverlap(book('The Great Hymn to the Nile'), ['By Nile and Tigris']).verdict).toBe('overlap');
  });

  it('flags a true witness named only by shelfmark (known false positive)', () => {
    expect(commonsOverlap(book('The Great Hymn to the Nile'), ['Papyrus Sallier II']).verdict).toBe('zero-overlap');
  });

  it('names the odd file out on a mixed book', () => {
    const r = commonsOverlap(book('The Story of Sinuhe'), ['Moeller-Sinuhe-01', 'Paul Cézanne - The Bay of Marseilles']);
    expect(r.verdict).toBe('overlap');
    expect(r.zero_overlap_files).toEqual(['Paul Cézanne - The Bay of Marseilles']);
  });

  it('refuses to judge across a script boundary or with no usable tokens', () => {
    expect(commonsOverlap(book('Ἑρμοῦ τοῦ Τρισμεγίστου Ποιμάνδρης'), ['Paul Cézanne']).verdict).toBe('unjudgeable');
    expect(commonsOverlap(book('The Eloquent Peasant'), ['IMG 0042']).verdict).toBe('unjudgeable');
  });
});

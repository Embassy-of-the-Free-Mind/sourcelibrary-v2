/**
 * "Did you mean?" in the BPH catalogue. The first two cases are the searches a
 * reader reported: both found nothing while the right spelling finds dozens.
 */
import { describe, it, expect } from 'vitest';
import {
  BPH_VOCABULARY_COLUMNS,
  buildBphVocabulary,
  suggestBphQueries,
  vocabularyFromWords,
  vocabularyToWords,
} from '../../src/lib/bph-catalog-suggest';

const vocabulary = buildBphVocabulary([
  { title: 'Bhagavad Gita', author: 'Anonymous', place: 'Amsterdam' },
  { title: 'Bhagavad-Gita. Der Gesang des Erhabenen', keywords: 'Hinduism' },
  { title: 'Aurea carmina', author: 'Pythagoras' },
  { title: 'Die Lehre des Pythagoras', author: 'Pythagoras' },
  { title: 'PYTHAGORAS' },
  { title: 'Ψυχολογία', author: 'Müller' },
]);

describe('suggestBphQueries', () => {
  it('corrects a misspelt name to the spelling the catalogue prints', () => {
    expect(suggestBphQueries('pyttatgoras', vocabulary)[0]).toBe('Pythagoras');
  });

  it('corrects the misspelt word and keeps the known word as typed', () => {
    expect(suggestBphQueries('bhagvad gita', vocabulary)[0]).toBe('Bhagavad gita');
  });

  it('offers nothing when every word is already in the catalogue', () => {
    expect(suggestBphQueries('Bhagavad Gita', vocabulary)).toEqual([]);
  });

  it('offers nothing when no word is close', () => {
    expect(suggestBphQueries('xylophone', vocabulary)).toEqual([]);
  });

  it('leaves numbers and short words alone', () => {
    expect(suggestBphQueries('1545', vocabulary)).toEqual([]);
    expect(suggestBphQueries('gta', vocabulary)).toEqual([]);
  });

  it('compares without diacritics, so a plain spelling finds nothing to correct', () => {
    expect(suggestBphQueries('muller', vocabulary)).toEqual([]);
  });

  it('corrects non-Latin words too', () => {
    expect(suggestBphQueries('Ψυχολογίαα', vocabulary)[0]).toBe('Ψυχολογία');
  });

  // Each of these was offered by a looser rule against real logged searches.
  it('does not turn a different word into a catalogue word', () => {
    const v = buildBphVocabulary([
      { title: 'Empires Primo Gregorio Xenophon', author: 'Code' },
    ]);
    for (const typed of ['vampires', 'grimo', 'grimorio', 'xylophone', 'coxe']) {
      expect(suggestBphQueries(typed, v)).toEqual([]);
    }
  });
});

describe('buildBphVocabulary', () => {
  it('keeps the most common printed form and counts every occurrence', () => {
    expect(vocabulary.get('pythagoras')).toEqual({ display: 'Pythagoras', count: 4 });
  });

  it('survives the compact form used by the shared cache', () => {
    expect(vocabularyFromWords(vocabularyToWords(vocabulary))).toEqual(vocabulary);
  });

  it('reads only the public columns, so a staff note can never be suggested', () => {
    const v = buildBphVocabulary([
      { title: 'Aurea', internal_remarks: 'Confidential', price: 'Expensive', exhibition_history: 'Secretive' },
    ]);
    expect([...v.keys()]).toEqual(['aurea']);
    for (const column of ['internal_remarks', 'price', 'exhibition_history', 'acquisition_source']) {
      expect(BPH_VOCABULARY_COLUMNS as readonly string[]).not.toContain(column);
    }
  });
});

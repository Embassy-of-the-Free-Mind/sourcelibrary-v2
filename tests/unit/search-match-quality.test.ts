import { describe, it, expect } from 'vitest';
import { assessMatchQuality } from '@/lib/search/match-quality';

// The honest-failure flag (#4281). Search lanes merge by rank, so a set of
// stray token matches renders exactly like a real answer — "Rainer Maria
// Rilke" returned a person named Rainer, Hölderlin essays and palaeography
// handbooks with full confidence. This helper is the API's one chance to say
// "nothing here matches all of that". The abstention cases are load-bearing:
// per non-latin-text-operations.md, a query the tokenizer cannot split into
// two comparable tokens is UNJUDGEABLE and must return null, never 'weak'.

describe('assessMatchQuality', () => {
  it('strong when one result covers every query token', () => {
    expect(assessMatchQuality('Rainer Maria Rilke', [
      'A person named Rainer observed something',
      'Beschrijving van Barabudur — preface quoting Rainer Maria Rilke, The Book of Hours',
    ])).toBe('strong');
  });

  it('weak when every result covers only part of the query', () => {
    expect(assessMatchQuality('Rainer Maria Rilke', [
      'A person named Rainer observed something',
      'On Friedrich Hölderlin and His Fate',
      'Maria addressed in a litany',
    ])).toBe('weak');
  });

  it('coverage may be split across fields joined into one haystack, not across results', () => {
    // Two results each holding one token is still weak.
    expect(assessMatchQuality('harmonia mundi', ['harmonia alone', 'mundi alone'])).toBe('weak');
    expect(assessMatchQuality('harmonia mundi', ['Harmonia Mundi libri quinque'])).toBe('strong');
  });

  it('folds case and diacritics on both sides', () => {
    expect(assessMatchQuality('rilke cafe', ['CAFÉ — RÍLKE'])).toBe('strong');
    expect(assessMatchQuality('café rílke', ['cafe rilke'])).toBe('strong');
  });

  it('elides in-word marks so short transliterations survive tokenization', () => {
    // ʻayn/apostrophe inside a name must not split it into sub-floor fragments.
    expect(assessMatchQuality("Sa'di poems", ['the poems of Saʻdī'])).toBe('strong');
  });

  it('abstains (null) on single-token queries — presence IS coverage there', () => {
    expect(assessMatchQuality('Rilke', ['unrelated text'])).toBeNull();
  });

  it('abstains (null) on a contiguous CJK query — one token regardless of words', () => {
    expect(assessMatchQuality('樂律全書', ['unrelated text'])).toBeNull();
  });

  it('judges mixed CJK + Latin queries that do yield two tokens', () => {
    expect(assessMatchQuality('樂律全書 music', ['樂律全書 complete works on music'])).toBe('strong');
    expect(assessMatchQuality('樂律全書 music', ['a treatise on music'])).toBe('weak');
  });

  it('abstains (null) when there are no results — that is the empty state, not a weak one', () => {
    expect(assessMatchQuality('Rainer Maria Rilke', [])).toBeNull();
  });

  it('ignores empty haystack strings rather than crashing or matching', () => {
    expect(assessMatchQuality('two words', ['', 'two of the words here'])).toBe('strong');
  });
});

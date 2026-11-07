import { describe, it, expect } from 'vitest';
import { assessMatchQuality, coversEveryToken, namedAuthorGallery, termIsNamedPerson, wordStartHits } from '@/lib/search/match-quality';

describe('wordStartHits (#8309)', () => {
  it('tells a title word from a word inside a longer word', () => {
    expect(wordStartHits('Getica', 'Iordanis Romana et Getica')).toBe(1);
    expect(wordStartHits('Getica', 'Disputatio exegetica in cap. I. et II.')).toBe(0);
    expect(wordStartHits('Getica', 'Petri Aerodii Epistola Apologetica')).toBe(0);
    expect(wordStartHits('optic', 'Coptic Gospels')).toBe(0);
  });

  it('gives an inflected form the same credit as the form typed', () => {
    // A whole-word test put De magia disputatio above Porta for "Magia".
    expect(wordStartHits('Magia', 'Magiae naturalis libri XX')).toBe(wordStartHits('Magia', 'De magia disputatio'));
  });

  it('counts each word of the query, in the author as well as the title', () => {
    expect(wordStartHits('Romana Getica', 'Romana et Getica')).toBe(2);
    expect(wordStartHits('Romana Getica', 'Romana et exegetica')).toBe(1);
    expect(wordStartHits('Aristotle Metaphysics', 'Metaphysics and Ethics Aristotle')).toBe(2);
  });

  it('compares folded text in spaced scripts', () => {
    expect(wordStartHits('getica', 'Gética')).toBe(1);
    expect(wordStartHits('ἠθικά', 'Ἠθικὰ Νικομάχεια')).toBe(1);
    expect(wordStartHits('تاريخ', 'كتاب تاريخ الرسل')).toBe(1);
  });

  it('abstains in a script with no word boundaries, whatever the title', () => {
    expect(wordStartHits('本草綱目', '本草綱目')).toBe(0);
    expect(wordStartHits('本草綱目', '重修本草綱目序')).toBe(0);
  });

  it('abstains on short words and on empty text', () => {
    expect(wordStartHits('Yi I', 'Yi I collected works')).toBe(0);
    expect(wordStartHits('Getica', '')).toBe(0);
  });
});

describe('namedAuthorGallery', () => {
  const img = (id: string, description: string, bookTitle = '') => ({ id, description, bookTitle });
  it('drops pictures of people who only share a first name', () => {
    const rows = [img('a', 'The Annunciation to Joachim: an angel'), img('b', 'Armorial bookplate of Joachim von Bülow')];
    const kangxi = img('k', 'Portrait of the Kangxi Emperor', 'Icon Regia');
    expect(namedAuthorGallery('Joachim Bouvet', rows, [kangxi], 6).map(r => r.id)).toEqual(['k']);
  });
  it('puts a picture of the person ahead of a binding from his book', () => {
    const named = img('emblem', 'An emblem depicting Roger Bacon as a monk');
    const binding = img('arms', 'Gold-stamped coat of arms on a leather binding');
    expect(namedAuthorGallery('Roger Bacon', [named], [binding], 6).map(r => r.id)).toEqual(['emblem', 'arms']);
  });
  it('does not repeat a row and keeps to the limit', () => {
    const named = img('x', 'Portrait of Roger Bacon');
    const others = [named, img('y', 'plate'), img('z', 'plate')];
    expect(namedAuthorGallery('Roger Bacon', [named], others, 2).map(r => r.id)).toEqual(['x', 'y']);
  });
  it('judges a row on the text behind its caption', () => {
    const row = { ...img('f', 'A monk in a study'), matchText: 'Roger Bacon' };
    expect(namedAuthorGallery('Roger Bacon', [row], [], 6).map(r => r.id)).toEqual(['f']);
  });
});

describe('coversEveryToken', () => {
  it('needs every word of the name', () => {
    expect(coversEveryToken('Joachim Bouvet', 'Portrait of Joachim Bouvet in Chinese dress')).toBe(true);
    expect(coversEveryToken('Joachim Bouvet', 'The Annunciation to Joachim: an angel')).toBe(false);
  });
  it('accepts a Latin form that contains the name', () => {
    expect(coversEveryToken('Joachim Bouvet', 'Icon Regia [Joachimus Bouvetus ex Societate Jesu]')).toBe(true);
  });
  it('abstains on a one-word query', () => {
    expect(coversEveryToken('Bouvet', 'Bouvet')).toBe(false);
  });
});

describe('termIsNamedPerson', () => {
  it.each(['Joachim Bouvet', 'Bouvet', 'Father Bouvet', 'P. Bouvet', 'Bouvet, Joachim'])('keeps %s', (term) => {
    expect(termIsNamedPerson('Joachim Bouvet', term)).toBe(true);
  });
  it.each(['Joachim', 'Joachim of Fiore', 'Joachim Camerarius', 'Johann Joachim Becher', 'Lozier Bouvet', 'P. Bouvety (Dominican Monk)'])('drops %s', (term) => {
    expect(termIsNamedPerson('Joachim Bouvet', term)).toBe(false);
  });
});

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

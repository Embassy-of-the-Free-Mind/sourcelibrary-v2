import { describe, it, expect } from 'vitest';
import { canonQueryWords, foldKey } from '@/lib/search/canon-texts';

describe('canon-texts query words', () => {
  it('folds diacritics so "Nāgārjuna" and "Nagarjuna" are one word', () => {
    expect(canonQueryWords('Nāgārjuna')).toEqual(['nagarjuna']);
    expect(canonQueryWords('Nagarjuna')).toEqual(['nagarjuna']);
  });
  it('keeps a Tohoku number and drops stopwords and the collection name', () => {
    expect(canonQueryWords('Toh 3824')).toEqual(['toh', '3824']);
    expect(canonQueryWords('Candrakīrti in the Derge Tengyur')).toEqual(['candrakirti']);
  });
  it('a query of only stopwords or Tibetan script yields no words (the lane abstains)', () => {
    expect(canonQueryWords('the of')).toEqual([]);
    expect(canonQueryWords('ཀླུ་སྒྲུབ')).toEqual([]);
  });
  it('folds exactly as the writer of search_keys does (scripts/lib/tengyur-catalogue.mjs fold)', () => {
    expect(foldKey('Śāntideva')).toBe('santideva');
    expect(foldKey('Prajñā-nāma-mūlamadhyamakakārikā')).toBe('prajnanamamulamadhyamakakarika');
    expect(foldKey('Mahāyānasūtrālaṃkāra')).toBe('mahayanasutralamkara');
    expect(foldKey("klu'i rgyal mtshan")).toBe('kluirgyalmtshan');
  });
});

describe('wordPattern', () => {
  it('lets sh/s and ch/c stand for each other in both directions', async () => {
    const { wordPattern } = await import('@/lib/search/canon-texts');
    const m = (q: string, key: string) => new RegExp(`^${wordPattern(foldKey(q))}$`).test(key);
    expect(m('Shantideva', 'santideva')).toBe(true);
    expect(m('Chandrakirti', 'candrakirti')).toBe(true);
    expect(m('Santideva', 'santideva')).toBe(true);
    expect(m('ses', 'shes')).toBe(true);
    expect(m('Nagarjuna', 'santideva')).toBe(false);
  });
});

describe('queryNamesAuthor', () => {
  it('prefers the person the thesaurus calls by the bare name (Dharmakīrti I over II/III)', async () => {
    const { queryNamesAuthor, canonQueryWords } = await import('@/lib/search/canon-texts');
    const w = canonQueryWords('Dharmakirti');
    expect(queryNamesAuthor(w, [{ name: 'Dharmakīrti I', author_id: 'dharmakirti' }])).toBe(true);
    expect(queryNamesAuthor(w, [{ name: 'Dharmakīrti III', author_id: 'dharmakirti-iii' }])).toBe(false);
    expect(queryNamesAuthor(w, [{ name: 'Dharmakīrti II', author_id: 'dharmakirti-of-suvarnadvipa-gser-gling-pa' }])).toBe(false);
    expect(queryNamesAuthor(w, [{ name: 'Dharmakīrti I' }])).toBe(false);
  });
  it('accepts the reader spellings the lane already accepts', async () => {
    const { queryNamesAuthor, canonQueryWords } = await import('@/lib/search/canon-texts');
    expect(queryNamesAuthor(canonQueryWords('Chandrakirti'), [{ author_id: 'candrakirti' }])).toBe(true);
    expect(queryNamesAuthor(canonQueryWords('Shantideva'), [{ author_id: 'santideva' }])).toBe(true);
  });
});

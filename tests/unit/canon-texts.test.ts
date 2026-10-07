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

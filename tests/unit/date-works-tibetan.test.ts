/**
 * date-works.mjs, Tibetan work dates (#6721, 2026-10-16): the model READS a colophon, the code does the arithmetic and
 * checks every part of the reading against the words. What these pin: the rab byung conversion (1027 = fire-female-
 * rabbit); without a cycle number every matching year is returned, not one guessed; an element-animal reading counts
 * only if both syllables are in the quoted words (the model misread a water-snake year as fire-bird); a CE year only
 * after phyi lo / spyi lo, in Tibetan digits too (a Buddhist-era "2077" is not a CE year).
 */
import { describe, it, expect } from 'vitest';
import { rabjungYears, rabjungLabel, elementAnimalIn, statedCE, parseTibetanWorkReply } from '../../scripts/lib/date-works.mjs';

describe('rabjungYears', () => {
  it('converts a stated cycle', () => {
    expect(rabjungYears({ cycle: 1, element: 'fire', animal: 'rabbit' })).toEqual([1027]);
    expect(rabjungYears({ cycle: 16, element: 'water', animal: 'bird' })).toEqual([1933]);
    expect(rabjungYears({ cycle: 17, element: 'fire', animal: 'pig' })).toEqual([2007]);
  });
  it('returns every candidate when no cycle is stated', () => {
    expect(rabjungYears({ element: 'fire', animal: 'horse' }, 1800, 1970)).toEqual([1846, 1906, 1966]);
  });
  it('refuses an element-animal pair that never occurs (the animal fixes the parity)', () => {
    expect(rabjungYears({ element: 'wood', animal: 'nonsense' })).toEqual([]);
  });
  it('labels a year', () => {
    expect(rabjungLabel(2026)).toBe('fire-male-horse');
    expect(rabjungLabel(1943)).toBe('water-female-sheep');
  });
});

describe('the reading is checked against the words', () => {
  it('finds element and animal syllables, with case endings', () => {
    expect(elementAnimalIn('ཆུ་མོ་ཡོས་ཀྱི་སྨིན་དྲུག་ཟླ་བ', 'water', 'rabbit')).toBe(true);
    expect(elementAnimalIn('ལྕགས་ཁྱིའི་ལོ།', 'iron', 'dog')).toBe(true);
    expect(elementAnimalIn('ཤིང་ཕོ་སྤྲེའུ་ལོ', 'wood', 'monkey')).toBe(true);
  });
  it('rejects a reading whose element or animal is not there', () => {
    // the words say water-female-snake; the model said fire-bird
    expect(elementAnimalIn('རབ་བྱུང་དགུ་པའི་རྣམ་རྒྱལ་ཞེས་པ་ཆུ་མོ་སྦྲུལ་གྱི་ལོ་ལ', 'fire', 'bird')).toBe(false);
    // 'bird' (བྱ) must not match 'mouse' (བྱི), nor earth (ས) the first letter of སྦྲུལ
    expect(elementAnimalIn('ཆུ་ཕོ་བྱི་བ་ལོ', 'water', 'bird')).toBe(false);
    expect(elementAnimalIn('ཆུ་སྦྲུལ་ལོ', 'earth', 'snake')).toBe(false);
  });
  it('reads a CE year only after phyi lo / spyi lo', () => {
    expect(statedCE('ཕྱི་ལོ་ ༡༩༠༥ ལོར་བཀའ་')).toBe(1905);
    expect(statedCE('སྤྱི་ལོ་༢༠༠༢༥༥༩༡༥ཉིན་')).toBe(2002);
    expect(statedCE('སྟོན་པ་འདས་རྗེས་༢༠༧༧ ཆུ་མོ་སྦྲུལ')).toBe(null);
  });
});

describe('parseTibetanWorkReply', () => {
  it('keeps one reading per book and drops a malformed cycle/age', () => {
    const books = [{ book_id: 'a' }, { book_id: 'b' }];
    const m = parseTibetanWorkReply('{"i":1,"a_en":"Pema Lingpa","role":"terton","a_d":[1450,1521],"canon":"none","w":[1476,1521],"c":"m","age":"x"}\n{"i":2,"w":"bad"}', books);
    expect(m.size).toBe(1);
    expect(m.get(0).work).toMatchObject({ from: 1476, to: 1521, basis: 'model_knowledge' });
    expect(m.get(0).reading).toMatchObject({ role: 'terton', a_d: [1450, 1521], age: 0 });
  });
});

import { describe, it, expect } from 'vitest';
import { normalizeLatin, looseKey, cleanOcrToken } from '@/lib/lexicon/normalize';
import {
  nounForms,
  verbForms,
  adjectiveForms,
  guessThirdDeclStems,
  suffixSwapCandidates,
  irregularLemmas,
  longSVariants,
} from '@/lib/lexicon/latin-morph';

describe('normalizeLatin', () => {
  it('handles early modern orthography', () => {
    expect(normalizeLatin('cœlum')).toBe('coelum');
    expect(normalizeLatin('Cælum')).toBe('caelum');
    expect(normalizeLatin('ejus')).toBe('eius');
    // Final macron reads as a suspended nasal — the early modern default in
    // our OCR (Latinorū). The cost is dictionary-style length marks
    // ('Vīvō' → uiuom), which effectively never appear in reader queries.
    expect(normalizeLatin('Vīvō')).toBe('uiuom');
    expect(normalizeLatin('āvi')).toBe('aui');
    expect(normalizeLatin('cõmunis')).toBe('communis'); // tilde before labial → m
  });
  it('strips non-letters', () => {
    expect(normalizeLatin('anno,')).toBe('anno');
    expect(normalizeLatin('1651')).toBe('');
  });
  it('expands early modern contraction marks', () => {
    expect(normalizeLatin('Latinorū')).toBe('latinorum'); // final macron → m
    expect(normalizeLatin('conditũ')).toBe('conditum'); // final tilde → m
    expect(normalizeLatin('Sapiẽtia')).toBe('sapientia'); // mid tilde → n
    expect(normalizeLatin('cõbibo')).toBe('combibo'); // tilde before labial → m
    expect(normalizeLatin('āvi')).toBe('aui'); // mid/lone macron still just strips
  });
  it('looseKey collapses ae/oe', () => {
    expect(looseKey('caelum')).toBe('celum');
    expect(looseKey('coelum')).toBe('celum');
    expect(looseKey(normalizeLatin('cœlum'))).toBe(looseKey(normalizeLatin('cælum')));
  });
  it('cleanOcrToken strips punctuation and hyphenation', () => {
    expect(cleanOcrToken('(natura)')).toBe('natura');
    expect(cleanOcrToken('anno;')).toBe('anno');
  });
});

describe('verbForms', () => {
  it('conjugation 1 (amo)', () => {
    const f = verbForms('amo', 1, ['amau'], ['amat']);
    for (const w of ['amat', 'amamus', 'amant', 'amabat', 'amare', 'amauit', 'amatus', 'amandum', 'amans', 'amantis', 'amatur', 'amemus'])
      expect(f, w).toContain(w);
  });
  it('conjugation 2 (uideo)', () => {
    const f = verbForms('uideo', 2, ['uid'], ['uis']);
    for (const w of ['uidet', 'uident', 'uidere', 'uidit', 'uiderunt', 'uisum', 'uidens', 'uidetur', 'uideatur'])
      expect(f, w).toContain(w);
  });
  it('conjugation 3 and 3io', () => {
    const duco = verbForms('duco', 3, ['dux'], ['duct']);
    for (const w of ['ducit', 'ducunt', 'ducere', 'duxit', 'ductus', 'ducens', 'ducitur']) expect(duco, w).toContain(w);
    const capio = verbForms('capio', 3, ['cep'], ['capt']);
    for (const w of ['capit', 'capiunt', 'capere', 'cepit', 'captus', 'capiens', 'caperet']) expect(capio, w).toContain(w);
  });
  it('conjugation 4 (audio)', () => {
    const f = verbForms('audio', 4, ['audiu'], ['audit']);
    for (const w of ['audit', 'audiunt', 'audire', 'audiuit', 'auditus', 'audiens', 'auditur']) expect(f, w).toContain(w);
  });
});

describe('nounForms', () => {
  it('covers the five declensions', () => {
    expect(nounForms('natura', 1, 'ae')).toEqual(expect.arrayContaining(['naturae', 'naturam', 'naturis']));
    expect(nounForms('deus', 2, 'i')).toEqual(expect.arrayContaining(['dei', 'deorum', 'deos']));
    expect(nounForms('corpus', 3, 'oris')).toEqual(expect.arrayContaining(['corporis', 'corpora', 'corporibus']));
    expect(nounForms('spiritus', 4, 'us')).toEqual(expect.arrayContaining(['spiritum', 'spirituum', 'spiritibus']));
    expect(nounForms('res', 5, 'ei')).toEqual(expect.arrayContaining(['rei', 'rerum', 'rebus']));
  });
  it('derives 3rd-declension stems from a full genitive (rex, regis)', () => {
    expect(nounForms('rex', 3, 'regis')).toEqual(expect.arrayContaining(['regis', 'regem', 'regibus']));
  });
  it('guesses 3rd-declension stems when no genitive is given', () => {
    expect(guessThirdDeclStems('rex')).toContain('reg');
    expect(guessThirdDeclStems('urbs')).toContain('urb');
    expect(guessThirdDeclStems('corpus')).toContain('corpor');
    expect(nounForms('rex', 3, undefined)).toContain('regibus');
  });
});

describe('adjectiveForms', () => {
  it('1st/2nd declension with comparison', () => {
    const f = adjectiveForms('altus');
    for (const w of ['alta', 'altum', 'altorum', 'altior', 'altissimus', 'alte']) expect(f, w).toContain(w);
  });
  it('3rd declension', () => {
    expect(adjectiveForms('omnis')).toEqual(expect.arrayContaining(['omne', 'omnia', 'omnium', 'omnibus']));
  });
});

describe('irregularLemmas', () => {
  it('resolves high-frequency irregular forms', () => {
    expect(irregularLemmas('est')[0]).toBe('sum'); // sum outranks edo
    expect(irregularLemmas('fuit')).toContain('sum');
    expect(irregularLemmas('tulit')).toContain('fero');
    expect(irregularLemmas('quibus')).toContain('qui1');
    expect(irregularLemmas('melior')).toContain('bonus');
    expect(irregularLemmas('maxime')).toContain('magnus');
  });
  it('returns empty for regular words', () => {
    expect(irregularLemmas('natura')).toEqual([]);
  });
});

describe('suffixSwapCandidates', () => {
  it('proposes plausible headwords', () => {
    expect(suffixSwapCandidates('philosophorum')).toContain('philosophus');
    expect(suffixSwapCandidates('amauit')).toContain('amo');
    expect(suffixSwapCandidates('rationis')).toContain('ratio');
  });
  it('never proposes sub-2-char stems', () => {
    for (const c of suffixSwapCandidates('ibus')) expect(c.length).toBeGreaterThanOrEqual(2);
  });
});

describe('longSVariants', () => {
  it('generates f→s substitutions for long-s OCR errors', () => {
    expect(longSVariants('refina')).toContain('resina');
    expect(longSVariants('fpiffandi')).toContain('spissandi');
    expect(longSVariants('natura')).toEqual([]);
  });
  it('is bounded', () => {
    expect(longSVariants('ffffffff').length).toBeLessThanOrEqual(15);
  });
});

describe('syncopated perfects', () => {
  it('amasse / amarunt from an -au perfect stem', () => {
    const f = verbForms('amo', 1, ['amau'], ['amat']);
    for (const w of ['amasse', 'amarunt', 'amasti']) expect(f, w).toContain(w);
  });
  it('audisse from an -iu perfect stem', () => {
    expect(verbForms('audio', 4, ['audiu'], ['audit'])).toContain('audisse');
  });
});

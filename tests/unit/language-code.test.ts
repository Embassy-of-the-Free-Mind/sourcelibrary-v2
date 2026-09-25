import { describe, it, expect } from 'vitest';
import { languageToBcp47, titleLang } from '@/lib/language-code';

// The `lang` attribute is what a screen reader picks its voice, pronunciation
// rules and braille table from. Before #5115 only six Perso-Arabic-script
// languages ever got one; the Latin transcription pane inherited `lang="en"`
// and was spoken with English rules. These pin the map against the values
// books.language actually holds (live counts, 2026-09-25).

describe('languageToBcp47', () => {
  it('tags the bulk of the corpus', () => {
    expect(languageToBcp47('Latin')).toBe('la');
    expect(languageToBcp47('Chinese')).toBe('zh');
    expect(languageToBcp47('German')).toBe('de');
    expect(languageToBcp47('Tibetan')).toBe('bo');
    expect(languageToBcp47('Greek')).toBe('el');
    expect(languageToBcp47('Ancient Greek')).toBe('grc');
    expect(languageToBcp47('Egyptian hieroglyphs')).toBe('egy');
    expect(languageToBcp47('Syriac')).toBe('syc');
    expect(languageToBcp47('English')).toBe('en');
  });

  it('resolves a compound label to its FIRST language — one attribute per pane', () => {
    expect(languageToBcp47('Latin-German')).toBe('la');
    expect(languageToBcp47('Greek/Latin')).toBe('el');
    expect(languageToBcp47('Hebrew and Aramaic')).toBe('he');
    expect(languageToBcp47('Classical Chinese / Japanese')).toBe('lzh');
  });

  it('folds qualified names and leaked MARC codes', () => {
    expect(languageToBcp47('Medieval Latin')).toBe('la');
    expect(languageToBcp47('lat')).toBe('la');
    expect(languageToBcp47('ger')).toBe('de');
  });

  it('asserts nothing for placeholders, so the element inherits instead of lying', () => {
    for (const v of ['Multiple', 'auto-detect', 'Unknown', 'unknown', 'e', 'Ne', '', undefined, null, 'Transliteration']) {
      expect(languageToBcp47(v)).toBeUndefined();
    }
  });
});

describe('titleLang', () => {
  const book = { title: 'De anatomia triplici', language: 'Latin' };
  it('tags the ORIGINAL title only', () => {
    expect(titleLang('De anatomia triplici', book)).toBe('la');
  });
  it('never tags an English display title with the book language', () => {
    expect(titleLang('On the Triple Anatomy', book)).toBeUndefined();
  });
  it('is silent for English books (the surface language is already on an ancestor)', () => {
    expect(titleLang('Opticks', { title: 'Opticks', language: 'English' })).toBeUndefined();
  });
});

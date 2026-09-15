import { describe, it, expect } from 'vitest';
import { displayLanguage, sameLanguage } from '@/lib/language-utils';
import { normalizeLanguageToken } from '@/lib/language-normalize';

/**
 * Pins the 2026-09-10 consolidation: ONE normaliser, and the two jobs it used to conflate kept
 * apart. `displayLanguage` had its own rule — strip any leading
 * modern|ancient|old|classical|medieval|middle|early, then title-case the first character only —
 * which disagreed with `normalizeLanguageToken` on 13 of 27 probe tokens.
 *
 * It was wrong in two ways at once, and the two failures pull in opposite directions, which is why
 * neither had been noticed: it collapsed distinct languages (so a value was LESS specific than the
 * book) and mangled case on the rest (so a value matched nothing).
 *
 * Nothing had reached production — 0 mangled values in `books.language` on 2026-09-10 — because
 * `normalize-language-tags.mjs` writes through the other normaliser. This was a latent trap on the
 * IMPORT path: resolve-language.ts routes every incoming language through displayLanguage.
 */
describe('displayLanguage is normalizeLanguageToken', () => {
  it('preserves period registers that are distinct languages', () => {
    // the old rule turned each of these into its parent, losing the register
    expect(displayLanguage('Old English')).toBe('Old English');
    expect(displayLanguage('Old French')).toBe('Old French');
    expect(displayLanguage('Middle English')).toBe('Middle English');
    expect(displayLanguage('Middle High German')).toBe('Middle High German');
    expect(displayLanguage('Middle Dutch')).toBe('Middle Dutch');
    expect(displayLanguage('Classical Chinese')).toBe('Classical Chinese');
    // ...and this one became "Norse", which is not a language
    expect(displayLanguage('Old Norse')).toBe('Old Norse');
  });

  it('still collapses period variants that are the SAME language', () => {
    expect(displayLanguage('Ancient Greek')).toBe('Greek');
    expect(displayLanguage('Modern Greek')).toBe('Greek');
    expect(displayLanguage('Koine Greek')).toBe('Greek');   // was the unrecognised "Koine greek"
    expect(displayLanguage('Classical Latin')).toBe('Latin');
    expect(displayLanguage('New Latin')).toBe('Latin');     // was "New latin"
  });

  it('no longer mangles case on multi-word names', () => {
    expect(displayLanguage('Church Slavonic')).toBe('Church Slavonic');
    expect(displayLanguage('Ottoman Turkish')).toBe('Ottoman Turkish');
    expect(displayLanguage('Judeo-Arabic')).toBe('Judeo-Arabic');
  });

  it('is the same function, not merely similar', () => {
    for (const t of ['la', 'lat', 'ger', 'grc', 'rus', 'English', 'Old French', 'Koine Greek',
      'Judeo-Arabic', 'und', 'none', '', 'Unknown', null, undefined]) {
      expect(displayLanguage(t)).toBe(normalizeLanguageToken(t));
    }
  });
});

describe('sameLanguage compares by family', () => {
  it('keeps every collapse the old displayLanguage-equality gave by accident', () => {
    // An Old French edition of a French work must NOT read as a translation.
    expect(sameLanguage('Old French', 'French')).toBe(true);
    expect(sameLanguage('Middle High German', 'German')).toBe(true);
    expect(sameLanguage('Ancient Greek', 'Greek')).toBe(true);
    expect(sameLanguage('Classical Latin', 'la')).toBe(true);
    expect(sameLanguage('Old English', 'English')).toBe(true);
  });

  it('fixes a false DIFFERENCE the old version had', () => {
    // "Koine Greek" used to normalise to the unrecognised "Koine greek" and so never matched.
    expect(sameLanguage('Koine Greek', 'Greek')).toBe(true);
    expect(sameLanguage('New Latin', 'Latin')).toBe(true);
  });

  it('still separates genuinely different languages', () => {
    expect(sameLanguage('French', 'German')).toBe(false);
    expect(sameLanguage('Greek', 'Latin')).toBe(false);
    expect(sameLanguage('Hebrew', 'Arabic')).toBe(false);
  });

  it('treats a missing or placeholder token as no answer, never as a match', () => {
    expect(sameLanguage(null, 'French')).toBe(false);
    expect(sameLanguage('Unknown', 'Unknown')).toBe(false);
    expect(sameLanguage('', '')).toBe(false);
  });
});

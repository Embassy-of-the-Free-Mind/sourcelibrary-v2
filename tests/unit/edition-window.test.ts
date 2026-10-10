/**
 * Cutting a page's window out of a whole modern edition (#5488).
 *
 * Pins the 2026-10-01 Plato finding: the bigram vote locates the passage but cannot trim it, because
 * common word pairs hit all through the vote window (1,355 edition words cut for an 819-word page,
 * which scored a clean read at 57%). The fitting-alignment trim must cut close to the page.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module without type declarations
import { alignTrimWindow, cutEditionWindow, foldedWords, foldWord } from '../../scripts/eval/lib/edition-window.mjs';

const filler = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => ['et', 'in', 'est', 'non', 'ad', 'cum', 'quod', 'sed'][(i * 7 + seed) % 8] + ' verbum' + ((i * 13 + seed) % 97)).join(' ');
const passage = Array.from({ length: 120 }, (_, i) => `vox${i} et`).join(' ');

describe('cutEditionWindow', () => {
  const edition = `${filler(400, 1)} ${passage} ${filler(400, 2)}`;
  const words = foldedWords(edition, 'latin');

  it('trims to the page, not the vote window', () => {
    const probe = passage.replace(/vox17 /, 'uox17 ').replace(/vox80 /, 'vex80 '); // two OCR slips
    const cut = cutEditionWindow(words, edition, probe, 'latin');
    const cutWords = foldedWords(cut.window, 'latin').length;
    expect(cutWords).toBeGreaterThanOrEqual(240);      // the whole passage (120 × 2 words)
    expect(cutWords).toBeLessThanOrEqual(240 + 2 * 3 + 2); // plus the 3-word pad each side
    expect(cut.window).toContain('vox0 et');
    expect(cut.window).toContain('vox119 et');
  });

  it('folds with the scorer: long s, u/v, i/j, diacritics', () => {
    expect(foldWord('ſeruus', 'latin')).toBe(foldWord('servus', 'latin'));
    expect(foldWord('Ἀρετὴ', 'greek')).toBe(foldWord('αρετη', 'greek'));
  });

  it('refuses a probe too short to place', () => {
    expect(cutEditionWindow(words, edition, 'vox1 et vox2', 'latin')).toBeNull();
  });
});

// #5584: the Chinese 4-gram trim padded ±8 characters, which on a spaceless script is the next leaf's
// text, charged to every engine as deletions. The alignment trim must take it back off, keep text any
// one engine read, and treat an astral Han character (𨼆) as one letter.
describe('alignTrimWindow (Han)', () => {
  const HAN = { isLetter: (c: string) => /\p{Script=Han}/u.test(c), hypLetters: (t: string) => [...t].filter(c => /\p{Script=Han}/u.test(c)), minLetters: 40 };
  const page = '初患家貧身賤不能得藥乃養猪牧羊十數年約衣節用致貨萬金乃買藥服之常煑白石為糧因就白石山居時人號曰白石生𨼆遁仙人';
  const window = `前頁之文八字在此${page}黄山君黄山君者修`;

  it('cuts the ±8-character spill on both sides', () => {
    const t = alignTrimWindow(window, { a: page.replace('貧', '貪') }, HAN);
    expect(t.trimmed).toBe(true);
    expect(t.window).toBe(page);
  });

  it('keeps the union: text one engine read and another missed stays in', () => {
    const t = alignTrimWindow(window, { a: page.slice(10), b: page.slice(0, -10) }, HAN);
    expect(t.window).toBe(page);
  });

  it('keeps the whole window when no read aligns', () => {
    const t = alignTrimWindow(window, { a: '天地玄黄宇宙洪荒'.repeat(8) }, HAN);
    expect(t.trimmed).toBe(false);
    expect(t.window).toBe(window);
  });
});

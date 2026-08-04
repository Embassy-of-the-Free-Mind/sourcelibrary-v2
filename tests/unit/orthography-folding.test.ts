import { describe, it, expect } from 'vitest';
import { stripWrappers, foldOrthography } from '../../scripts/eval/lib/metrics.mjs';

/**
 * Both halves come from spot-checked production pairs, not invented text.
 * `eight-books-on-astronomy-maternus` p382 and p291 are the sources.
 */
describe('stripWrappers — the older [[key: value]] annotation syntax', () => {
  it('strips a bracket block whose key contains a space', () => {
    // `[[page number: 119]]` — the key is two words, so a [a-z-]+ pattern misses it.
    const out = stripWrappers('[[page number: 119]]\n\n-> LIBER PRIMVS <-\n\ndus signi');
    expect(out).not.toContain('119');
    expect(out).toContain('LIBER PRIMVS');
  });

  it('strips a multi-sentence [[meta:]] block describing the scan', () => {
    const raw = '[[language: Latin]]\n\n[[meta: Printed Latin text from a 16th-century astrological '
      + "treatise. The typeface is a humanist serif. It includes standard scribal abbreviations.]]\n\n"
      + 'dus signi ascendentis impeditus';
    const out = stripWrappers(raw);
    expect(out).not.toMatch(/typeface|humanist|scribal/);
    expect(out).toContain('dus signi ascendentis impeditus');
  });

  it('leaves real body text alone', () => {
    const body = 'horam eclypticam, quae erit in unoquoq; locorum habentium partem';
    expect(stripWrappers(body).trim()).toBe(body);
  });
});

describe('foldOrthography — convention, not reading', () => {
  it('makes an expanded and an abbreviated transcription of one line agree', () => {
    // The observed pair: prior expanded the macron, current preserved it.
    const prior = 'dus ſigni aſcendentis impeditus, tunc nihil guſtabit donec moriatur';
    const current = 'dus ſigni aſcendētis impeditus, tunc nihil guſtabit donec moriatur';
    expect(foldOrthography(prior)).toBe(foldOrthography(current));
  });

  it('folds the hyphen glyph variants that differ by prompt era', () => {
    expect(foldOrthography('fue-rint')).toBe(foldOrthography('fue=rint'));
  });

  it('folds ligature and u/v conventions', () => {
    expect(foldOrthography('naturae')).toBe(foldOrthography('naturæ'));
    expect(foldOrthography('sive')).toBe(foldOrthography('siue'));
    expect(foldOrthography('filii')).toBe(foldOrthography('filij'));
  });

  it('does NOT fold a genuine misreading', () => {
    // long-s misread as f is the classic early-modern OCR error and must survive,
    // or the folded metric would hide the one thing it is meant to expose.
    expect(foldOrthography('eſt')).not.toBe(foldOrthography('eft'));
  });

  it('does not collapse two different words', () => {
    expect(foldOrthography('mundus')).not.toBe(foldOrthography('mundum'));
  });
});

describe('foldOrthography — the nasal sentinel does not over-fold', () => {
  it('keeps a nasal that precedes a vowel', () => {
    // `unus` must not lose its n, or the fold starts merging unrelated words.
    expect(foldOrthography('unus')).toContain('n');
  });

  it('keeps mundus and mundum distinct', () => {
    expect(foldOrthography('mundus')).not.toBe(foldOrthography('mundum'));
  });

  it('folds the macron both ways it can expand', () => {
    expect(foldOrthography('eorū')).toBe(foldOrthography('eorum'));
    expect(foldOrthography('nō')).toBe(foldOrthography('non'));
  });
});

describe('folding must never reduce similarity', () => {
  it('strips wrappers BEFORE folding, or tag names get mangled', () => {
    // `<language>` under the nasal rule becomes `<laᴺguage>`, which the wrapper
    // patterns no longer match — so the block it should have removed survives.
    // Folding the raw text therefore made agreement WORSE, which a fold cannot do.
    const withTag = '<language>Latin</language>\nhoram eclypticam quae erit';
    expect(foldOrthography(withTag)).toContain('ᴺ');          // the fold does mangle it
    expect(stripWrappers(withTag)).not.toContain('<language>'); // so strip first
    expect(stripWrappers(withTag).trim()).toBe('horam eclypticam quae erit');
  });
});

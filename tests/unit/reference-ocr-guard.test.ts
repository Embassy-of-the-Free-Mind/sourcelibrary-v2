/**
 * Identity-guard behavior for reference-based OCR scoring (#3212).
 *
 * Pins the 2026-07-19 Armenian pilot finding: with a small alphabet, CHAR-level
 * free-skip subsequence matching accepts wrong texts (a modern Armenian
 * translation of the grabar Buzand scored 22-25% CER — under the 0.30 accept
 * bar), while WORD-level matching separates cleanly (right page ~0%, wrong
 * page/decoy 88%+). scoreAgainstReference must therefore guard at word level
 * for every non-CJK script.
 *
 * Fixture: raw production OCR of Buzand book 69a5ead1d507939f0352ced7 pages
 * 22-23 (grabar, 1883 edition). The decoy is the opening of the modern Eastern
 * Armenian translation of the same work, published under the identical title.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
// @ts-expect-error — plain .mjs module without type declarations
import {
  subsequenceCER,
  subsequenceWER,
  scoreAgainstReference,
  normalizeForScript,
  SCRIPT_DEFS,
} from '../../scripts/eval/lib/metrics.mjs';

const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'buzand-pages.json'), 'utf8'),
);
const p22: string = fixtures.p22;
const p23: string = fixtures.p23;

// Same work, same title — but the modern Eastern Armenian translation, not the
// grabar original our 1883 edition prints. Must be REJECTED as ground truth.
const modernDecoy =
  'Թադեոս առաքյալի քարոզությունից և նրա մարտիրոսական վախճանից մինչև Գրիգորի ' +
  'վարդապետության վերջն ու նրա վախճանը, և առաքելասպան Սանատրուկ թագավորից ' +
  'մինչև Տրդատ թագավորի ակամա հնազանդվելը կրոնին ու նրա վախճանը';

// A genuine excerpt: words 30-80 of the normalized page itself, reassembled as a
// space-joined passage (stands in for a matching reference edition).
const selfSlice = normalizeForScript(p22, 'armenian').split(' ').slice(30, 80).join(' ');

describe('word-level identity guard (alphabetic scripts)', () => {
  it('accepts a passage genuinely present on the page', () => {
    const r = subsequenceWER(selfSlice, p22, 'armenian');
    expect(r.wer).toBeLessThan(0.05);
  });

  it('rejects the same passage against the WRONG page', () => {
    const r = subsequenceWER(selfSlice, p23, 'armenian');
    expect(r.wer).toBeGreaterThan(0.7);
  });

  it('rejects a modern-translation decoy published under the same title', () => {
    for (const page of [p22, p23]) {
      const r = subsequenceWER(modernDecoy, page, 'armenian');
      expect(r.wer).toBeGreaterThan(0.7);
    }
  });

  it('documents WHY the guard is word-level: char-level accepts the decoy', () => {
    // Char-level free-skip CER on the decoy sits under the 0.30 CJK threshold —
    // this is the trap. If this assertion ever fails (char CER rises above the
    // threshold), the word-level guard is still correct, just no longer the only
    // defense; update this comment rather than weakening the guard.
    const R = [...normalizeForScript(modernDecoy, 'armenian').replace(/ /g, '')].join('');
    const O = [...normalizeForScript(p22, 'armenian').replace(/ /g, '')].join('');
    // reuse the CJK path shape: char-level subsequence via scoreAgainstReference internals
    const cerLike = subsequenceCER(R, O); // Armenian letters pass through normalizeCJK untouched
    expect(cerLike.cer).toBeLessThan(0.3); // the false accept, pinned
  });
});

describe('scoreAgainstReference (two-stage)', () => {
  it('aligned genuine passage → high char accuracy', () => {
    const r = scoreAgainstReference(selfSlice, p22, 'armenian');
    expect(r.aligned).toBe(true);
    expect(r.guard.type).toBe('word');
    expect(r.charAccuracy).toBeGreaterThan(0.95);
  });

  it('decoy → aligned:false, never contributes to accuracy', () => {
    const r = scoreAgainstReference(modernDecoy, p22, 'armenian');
    expect(r.aligned).toBe(false);
  });

  it('unknown script throws instead of silently defaulting', () => {
    expect(() => normalizeForScript('abc', 'klingon')).toThrow(/unknown script/);
  });
});

describe('normalizeForScript folding', () => {
  it('latin folds edition orthography, not OCR quality', () => {
    expect(normalizeForScript('Vſus Jámque æquè', 'latin')).toBe('usus iamque aeque');
  });
  it('hebrew strips niqqud and folds finals', () => {
    expect(normalizeForScript('שָׁלוֹם מֶלֶךְ', 'hebrew')).toBe('שלומ מלכ');
  });
  it('greek strips polytonic diacritics and folds final sigma', () => {
    expect(normalizeForScript('ἐν ἀρχῇ ἦν ὁ λόγος', 'greek')).toBe('εν αρχη ην ο λογοσ');
  });
  it('armenian folds the ew ligature', () => {
    expect(normalizeForScript('և եւ', 'armenian')).toBe('եւ եւ');
  });
  it('strips editorial wrapper content, not just tags', () => {
    const s = '<meta>This page discusses mercury.</meta> textus verus';
    expect(normalizeForScript(s, 'latin')).toBe('textus uerus');
  });
  it('every non-cjk script def has letters + fold', () => {
    for (const [name, def] of Object.entries(SCRIPT_DEFS)) {
      if (name === 'cjk') continue;
      expect((def as any).letters).toBeInstanceOf(RegExp);
      expect(typeof (def as any).fold).toBe('function');
    }
  });
});

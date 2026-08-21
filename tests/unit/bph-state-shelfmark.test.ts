/**
 * `state_shelf_mark` normalisation guards (José Bouman feedback, 2026-07-15).
 *
 *  1. PARITY — scripts/lib/bph-state-shelfmark.mjs (the sweep + CSV importers,
 *     which decide what gets STORED) and src/lib/bph-state-shelfmark.ts (the
 *     catalogue read paths, which decide what gets SHOWN) must agree, or a
 *     value the importer keeps is one the page hides, and vice versa.
 *  2. BEHAVIOR — the actual shapes present in bph_works: bare "neen", the
 *     pipe-joined multi-value cells Memorix exports, and real shelf marks that
 *     must survive untouched.
 */
import { describe, it, expect } from 'vitest';

import { normalizeStateShelfMark as mjs } from '../../scripts/lib/bph-state-shelfmark.mjs';
import { normalizeStateShelfMark as ts } from '../../src/lib/bph-state-shelfmark';

/** Every distinct shape observed in the column, plus adversarial padding. */
const FIXTURES = [
  'neen',
  'Neen',
  'NEEN',
  '  neen  ',
  'nee',
  'neen|',
  'neen|Slav',
  '|',
  '||',
  'ja',
  'Ja',
  '  JA  ',
  'ja|PH3018',
  'PHja22',
  'Jakarta',
  'PH3018',
  'PH1883-B',
  'PH3154-C',
  'zie PH3301',
  'avail.',
  '1',
  '',
  '   ',
  null,
  undefined,
];

describe('normalizeStateShelfMark parity', () => {
  it('mjs and ts agree on every fixture', () => {
    for (const f of FIXTURES) {
      expect(mjs(f), `mismatch on ${JSON.stringify(f)}`).toEqual(ts(f));
    }
  });
});

describe('normalizeStateShelfMark behavior', () => {
  it('empties the Dutch "no" answers that were imported as shelf marks', () => {
    expect(ts('neen')).toBeNull();
    expect(ts('Neen')).toBeNull();
    expect(ts('  neen  ')).toBeNull();
    expect(ts('nee')).toBeNull();
  });

  it('strips "neen" per segment in pipe-joined multi-value cells', () => {
    // Three real rows look like this — UBN 20390/18666 ("neen|") and 13579.
    expect(ts('neen|')).toBeNull();
    expect(ts('neen|Slav')).toBe('Slav');
  });

  it('empties cells that are only separators or whitespace', () => {
    expect(ts('|')).toBeNull();
    expect(ts('||')).toBeNull();
    expect(ts('   ')).toBeNull();
    expect(ts('')).toBeNull();
    expect(ts(null)).toBeNull();
  });

  it('leaves real shelf marks exactly as they are', () => {
    expect(ts('PH3018')).toBe('PH3018');
    expect(ts('PH1883-B')).toBe('PH1883-B');
    expect(ts('zie PH3301')).toBe('zie PH3301');
  });

  it('translates "ja" to "yes" rather than emptying it', () => {
    // "ja" is not a shelf mark, but it is the only record that these 31 copies
    // ARE on loan from the state collection — so it is translated, not dropped.
    // José Bouman, 2026-08-12: "This set of 31 is owned by the State, therefore
    // the 'Ja'. Better change it to 'yes'."
    expect(ts('ja')).toBe('yes');
    expect(ts('Ja')).toBe('yes');
    expect(ts('  JA  ')).toBe('yes');
  });

  it('translates "ja" per segment, and never inside a real shelf mark', () => {
    expect(ts('ja|PH3018')).toBe('yes|PH3018');
    // Substring safety: a real mark that merely contains the letters is intact.
    expect(ts('PHja22')).toBe('PHja22');
    expect(ts('Jakarta')).toBe('Jakarta');
  });
});

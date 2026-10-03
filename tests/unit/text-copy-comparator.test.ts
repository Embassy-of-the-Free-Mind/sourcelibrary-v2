/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * #5689 / #4285: the text copy comparator. Pins the method's load-bearing rules:
 * non-Latin text survives normalization (\p{L}\p{N}, never \w); OCR metadata and page
 * apparatus never vote; absence of text is `insufficient`, never `different`; the
 * thresholds; and a reverse-ordered scan of the same book still matches.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as cmp from '../../scripts/lib/text-copy-comparator.mjs';

const { normalizeText, comparePageTexts, verdictFor } = cmp as any;

// Deterministic pseudo-prose over the full alphabet: page i of a "book" shares
// almost no 4-grams with page j.
function page(seed: number, words = 80) {
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  let x = seed * 7919 + 13;
  const out: string[] = [];
  for (let w = 0; w < words; w++) {
    let word = '';
    for (let c = 0; c < 4 + (x % 5); c++) { x = (x * 1103515245 + 12345) % 2147483648; word += abc[(x >> 8) % 26]; }
    out.push(word);
  }
  return out.join(' ');
}
const book = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => page(i + offset));

describe('normalizeText', () => {
  it('keeps Greek, Hebrew and CJK letters (never \\w)', () => {
    expect(normalizeText('Ἀρχὴ, שלום; 三國演義!')).toBe('ἀρχὴ שלום 三國演義');
  });
  it('drops OCR metadata and page apparatus content-and-all, keeps inline notes', () => {
    const raw = '<language>Latin</language><page-num>58</page-num><header>LIBER I.</header>Arma <note>virumque</note> cano';
    expect(normalizeText(raw)).toBe('arma virumque cano');
  });
});

describe('verdictFor', () => {
  it('applies the #4285 thresholds and the sample floor', () => {
    expect(verdictFor(0.5, 5)).toBe('same_printing');
    expect(verdictFor(0.49, 5)).toBe('gray');
    expect(verdictFor(0.3, 5)).toBe('gray');
    expect(verdictFor(0.29, 5)).toBe('different');
    expect(verdictFor(0.9, 1)).toBe('insufficient');
    expect(verdictFor(null, 0)).toBe('insufficient');
  });
});

describe('comparePageTexts', () => {
  it('same text → same_printing, even with extra front matter inside the window', () => {
    const a = book(100);
    const b = [...book(6, 900), ...a];
    const r = comparePageTexts(a, b);
    expect(r.verdict).toBe('same_printing');
    expect(r.samples_used).toBe(5);
  });
  it('different text → different', () => {
    const r = comparePageTexts(book(100), book(100, 5000));
    expect(r.verdict).toBe('different');
  });
  it('empty OCR on one side is insufficient, never different', () => {
    const r = comparePageTexts(book(100), Array(100).fill('<page-num>3</page-num> short'));
    expect(r.verdict).toBe('insufficient');
    expect(r.score).toBeNull();
  });
  it('a reverse-ordered scan of the same book matches, and says so', () => {
    const a = book(300);
    const r = comparePageTexts(a, [...a].reverse());
    expect(r.verdict).toBe('same_printing');
    expect(r.orientation).toBe('reversed');
  });
});

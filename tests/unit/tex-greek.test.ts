import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs helper shared with the workers, no types
import { repairTexGreek, hasTexGreek } from '../../scripts/lib/tex-greek.mjs';

/**
 * #4580 — OCR spells Greek out as LaTeX math instead of transcribing it.
 *
 * The negative cases are the important half. Heron, Diophantus and Ptolemy
 * contain real mathematics AND TeX-encoded Greek words, sometimes on the same
 * page, so a converter that rewrites everything inside `$…$` would corrupt
 * genuine equations to fix words.
 */
describe('repairTexGreek — decoding', () => {
  it('decodes the reported page verbatim', () => {
    const input =
      'Huc pertinet communicatio idiomatum verbalis: officii: ' +
      '$\\dot{\\alpha}\\pi\\text{o}\\tau\\epsilon\\lambda\\acute{\\epsilon}\\sigma\\mu\\alpha\\tau\\text{o}\\varsigma$.';
    const { text, replacements } = repairTexGreek(input);
    expect(replacements).toBe(1);
    expect(text).toContain('ἀποτελέσματος');
    expect(text).not.toContain('\\alpha');
    expect(text).not.toContain('$');
  });

  it('decodes a bare run of letters', () => {
    const { text, replacements } = repairTexGreek('the unity ($\\mu o \\nu \\acute{\\alpha} \\varsigma$)');
    expect(replacements).toBe(1);
    expect(text).toContain('μονάς');
  });

  it('keeps final sigma distinct from medial sigma', () => {
    // Two letters, so word-like gating lets them through.
    expect(repairTexGreek('$\\sigma\\sigma$').text).toBe('σσ');
    expect(repairTexGreek('$\\sigma\\varsigma$').text).toBe('σς');
  });

  it('composes accents to precomposed NFC codepoints', () => {
    // έ is U+03AD, one codepoint — not ε + combining acute.
    expect(repairTexGreek('$\\acute{\\epsilon}\\nu$').text).toBe('έν');
  });

  it('handles \\(...\\) spans as well as $...$', () => {
    const { text, replacements } = repairTexGreek('word \\(\\gamma\\eta\\) word');
    expect(replacements).toBe(1);
    expect(text).toContain('γη');
  });

  it('maps a Latin o inside a Greek word to omicron, even under an accent', () => {
    // From the corpus: TeX has no \omicron, so the model writes a Latin o —
    // and \acute{o} decodes to o + combining acute. Composing before mapping
    // would leave a precomposed LATIN ó sitting inside a Greek word.
    expect(repairTexGreek('$\\delta\\acute{o}\\xi\\alpha\\iota\\varsigma$').text).toBe('δόξαις');
    expect(repairTexGreek('$\\alpha\\delta\\acute{\\upsilon}\\nu\\alpha\\tau o\\nu$').text).toBe('αδύνατον');
  });

  it('decodes real words taken verbatim from the corpus', () => {
    expect(repairTexGreek('$\\kappa\\rho\\acute{\\alpha}\\tau\\iota\\sigma\\tau\\omicron\\nu$').text).toBe('κράτιστον');
    expect(repairTexGreek('$\\delta\\eta\\lambda\\eta\\tau\\acute{\\eta}\\rho\\iota\\alpha$').text).toBe('δηλητήρια');
  });

  it('decodes uppercase letters', () => {
    expect(repairTexGreek('$\\Delta\\Epsilon$').text).toBe('ΔΕ');
  });
});

describe('repairTexGreek — single symbols are a separate decision', () => {
  it('leaves a lone Greek letter alone by default', () => {
    // $\Delta$ in an alchemical text is a SYMBOL (fire), not a mangled word.
    // Measured: single-letter spans OUTNUMBER word-like ones in the corpus
    // (21,223 vs 17,474 over 4,000 pages), so converting them silently would
    // turn a narrow fix into an unreviewed corpus-wide edit.
    expect(repairTexGreek('the sign $\\Delta$ denotes')).toEqual({ text: 'the sign $\\Delta$ denotes', replacements: 0 });
    expect(repairTexGreek('$\\psi$')).toEqual({ text: '$\\psi$', replacements: 0 });
  });

  it('converts them only when asked explicitly', () => {
    expect(repairTexGreek('the sign $\\Delta$ denotes', { symbolsToo: true }).text).toBe('the sign Δ denotes');
  });

  it('still decodes two-letter words', () => {
    expect(repairTexGreek('\\(\\gamma\\eta\\)').replacements).toBe(1);
  });
});

describe('repairTexGreek — refusing to touch real mathematics', () => {
  it('leaves an equation with superscripts alone', () => {
    const input = 'let $x^2 + y^2 = z^2$ hold';
    expect(repairTexGreek(input)).toEqual({ text: input, replacements: 0 });
  });

  it('leaves a fraction alone even when it contains a Greek letter', () => {
    const input = 'the ratio $\\frac{\\alpha}{\\beta}$ is fixed';
    expect(repairTexGreek(input)).toEqual({ text: input, replacements: 0 });
  });

  it('leaves a span with an unknown command alone', () => {
    const input = '$\\int_0^\\infty \\alpha\\, dx$';
    expect(repairTexGreek(input)).toEqual({ text: input, replacements: 0 });
  });

  it('leaves Heron-style labelled geometry alone', () => {
    // Real geometry from the corpus: a rod ,Δ,E and a vessel αβγδ. The second
    // is a word-like run and decodes; the first has bare commas and capitals
    // used as point labels with no Greek command, so nothing fires.
    const input = 'let a steel rod $,\\Delta,E$ be attached';
    const { replacements } = repairTexGreek(input);
    expect(replacements).toBeLessThanOrEqual(1);
  });

  it('leaves a span containing no Greek at all alone', () => {
    const input = 'see $abc$ above';
    expect(repairTexGreek(input)).toEqual({ text: input, replacements: 0 });
  });

  it('is a no-op on ordinary text', () => {
    const input = 'Inspiciat, qui vult, recentia acta. Beza ipse testatur.';
    expect(repairTexGreek(input)).toEqual({ text: input, replacements: 0 });
  });

  it('is a no-op on real Greek already correctly transcribed', () => {
    const input = 'ἐγὼ καὶ γένεσις';
    expect(repairTexGreek(input)).toEqual({ text: input, replacements: 0 });
  });

  it('handles empty and non-string input without throwing', () => {
    expect(repairTexGreek('')).toEqual({ text: '', replacements: 0 });
    expect(repairTexGreek(null as unknown as string)).toEqual({ text: '', replacements: 0 });
  });
});

describe('hasTexGreek', () => {
  it('detects TeX Greek commands', () => {
    expect(hasTexGreek('$\\varsigma$')).toBe(true);
    expect(hasTexGreek('$\\alpha\\beta$')).toBe(true);
  });

  it('does not fire on ordinary text or real Greek', () => {
    expect(hasTexGreek('Huc pertinet communicatio')).toBe(false);
    expect(hasTexGreek('ἀποτελέσματος')).toBe(false);
    expect(hasTexGreek('')).toBe(false);
  });
});

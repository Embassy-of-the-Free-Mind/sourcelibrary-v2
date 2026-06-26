import { describe, it, expect } from 'vitest';
import { collapseLacunaWalls, latexToReadable, cleanOcrArtifacts } from '@/lib/clean-ocr-artifacts';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

// Read-time OCR safety net (#2764): runaway dot/lacuna walls must collapse to a
// single marker and stray LaTeX must render as readable text, on the reader and
// every snippet/quote surface.

describe('collapseLacunaWalls', () => {
  it('collapses a solid wall of hundreds of dots to one marker', () => {
    const wall = '.'.repeat(500);
    const out = collapseLacunaWalls(`before ${wall} after`);
    expect(out).not.toMatch(/\.{12,}/);
    expect(out).toContain('[…]');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('collapses a spaced ". . . ." lacuna run', () => {
    const out = collapseLacunaWalls('text ' + '. '.repeat(40) + 'more');
    expect(out).toContain('[…]');
    expect(out).toContain('more');
  });

  it('collapses long dash and underscore rules', () => {
    expect(collapseLacunaWalls('a ' + '-'.repeat(30) + ' b')).toContain('[…]');
    expect(collapseLacunaWalls('a ' + '_'.repeat(30) + ' b')).toContain('[…]');
  });

  it('leaves ordinary ellipses and short rules untouched', () => {
    expect(collapseLacunaWalls('wait... really')).toBe('wait... really');
    expect(collapseLacunaWalls('a — b … c')).toBe('a — b … c');
    expect(collapseLacunaWalls('--- divider ---')).toBe('--- divider ---');
  });

  it('does not swallow a newline / merge lines', () => {
    const out = collapseLacunaWalls('line one\n' + '.'.repeat(20) + '\nline two');
    expect(out).toContain('line one');
    expect(out).toContain('line two');
    expect(out).toContain('\n');
  });
});

describe('latexToReadable', () => {
  it('converts $\\frac{a}{b}$ to a/b', () => {
    expect(latexToReadable('value $\\frac{a}{b}$ here')).toContain('a/b');
    expect(latexToReadable('value $\\frac{a}{b}$ here')).not.toContain('\\frac');
    expect(latexToReadable('value $\\frac{a}{b}$ here')).not.toContain('$');
  });

  it('handles a bare \\frac with no math delimiters', () => {
    expect(latexToReadable('\\frac{1}{2}')).toBe('1/2');
  });

  it('converts \\sqrt{x} to √(x)', () => {
    expect(latexToReadable('$\\sqrt{2}$')).toBe('√(2)');
  });

  it('maps common symbol + Greek commands to Unicode', () => {
    expect(latexToReadable('$a \\times b$')).toBe('a × b');
    expect(latexToReadable('$\\alpha + \\beta$')).toBe('α + β');
  });

  it('leaves historical currency like "$5 and $10" untouched', () => {
    expect(latexToReadable('paid $5 and $10 more')).toBe('paid $5 and $10 more');
  });

  it('is a no-op on text with no backslash or dollar', () => {
    const plain = 'just ordinary prose, nothing to do here';
    expect(latexToReadable(plain)).toBe(plain);
  });

  it('leaves unknown commands intact rather than mangling', () => {
    expect(latexToReadable('\\somethingweird')).toBe('\\somethingweird');
  });
});

describe('cleanOcrArtifacts (combined)', () => {
  it('cleans both artifacts in one pass', () => {
    const input = `The ratio $\\frac{1}{2}$ then ${'.'.repeat(40)} continues`;
    const out = cleanOcrArtifacts(input);
    expect(out).toContain('1/2');
    expect(out).toContain('[…]');
    expect(out).not.toMatch(/\.{12,}/);
  });
});

describe('stripEditorialWrappers wires the OCR cleaner (#2764)', () => {
  it('the snippet/quote path collapses dot-walls and cleans LaTeX', () => {
    const input = `Real body text. ${'.'.repeat(300)} The fraction $\\frac{a}{b}$.`;
    const out = stripEditorialWrappers(input);
    expect(out).not.toMatch(/\.{12,}/);
    expect(out).toContain('[…]');
    expect(out).toContain('a/b');
  });
});

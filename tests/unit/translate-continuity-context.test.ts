/**
 * The continuity context carries BOTH ends of the previous page (#4968).
 *
 * Three shapes were judged on the pinned 58-seam sample (PR #4912): the
 * original head-only seed could not see the seam it told the model to
 * continue; a tail-only seed saw the seam but lost the page conventions and
 * names the head carried, and lost to it 13–24; the hybrid kept both and tied.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no declarations
import { continuityContext, CONTINUITY_CONTEXT_CHARS } from '../../scripts/lib/translate-core.mjs';

const SEAM = 'Furthermore, he ought to inquire whether he sinned in a time of joy or a time of mourning. It is graver...';

describe('continuityContext', () => {
  it('carries both ends of a long page — conventions from the head, the seam from the tail', () => {
    const out = continuityContext(`RUNNING HEADER 102. ${'filler '.repeat(600)}${SEAM}`);
    expect(out).toContain('RUNNING HEADER 102.');
    expect(out).toContain(SEAM);
    expect(out).toContain('[…]');
  });

  it('elides only the middle, and stays near the window', () => {
    const out = continuityContext('A'.repeat(9000));
    // head + elision + tail, not the whole page
    expect(out.length).toBeLessThan(CONTINUITY_CONTEXT_CHARS + 200);
    expect(out).toContain('[…]');
  });

  it('passes a short page through whole, with no elision', () => {
    const out = continuityContext(`A short page. ${SEAM}`);
    expect(out).toContain('A short page.');
    expect(out).toContain(SEAM);
    expect(out).not.toContain('[…]');
  });

  it('keeps the page-closing summary and keywords — they name its people and terms — but drops the rest', () => {
    const out = continuityContext(
      `Body text. ${SEAM}\n\n<meta>About the page.</meta>\n<summary>Iamblichus on sacrifice.</summary>\n<keywords>theurgy, Porphyry</keywords>`,
    );
    expect(out).toContain('<summary>Iamblichus on sacrifice.</summary>');
    expect(out).toContain('<keywords>theurgy, Porphyry</keywords>');
    expect(out).not.toContain('About the page');
    // the seam still reads as the last thing before the blocks
    expect(out.indexOf(SEAM)).toBeLessThan(out.indexOf('<summary>'));
  });

  it('is empty when there is nothing to continue', () => {
    expect(continuityContext(undefined)).toBe('');
    expect(continuityContext('')).toBe('');
    expect(continuityContext('<meta>only metadata</meta>')).toBe('');
  });

  it('labels the English modernization variant', () => {
    expect(continuityContext('Text.', { english: true })).toContain('(modernized)');
    expect(continuityContext('Text.')).toContain('Previous page translation for continuity');
  });
});

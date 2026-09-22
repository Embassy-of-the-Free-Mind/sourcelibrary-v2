/**
 * The continuity context is the END of the previous page (#4968). From
 * 2025-12-12 to 2026-09-22 it was the start, and the sentence the model was
 * told to continue was the part it never saw.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no declarations
import { continuityContext, CONTINUITY_CONTEXT_CHARS } from '../../scripts/lib/translate-core.mjs';

describe('continuityContext', () => {
  it('carries the tail of a long page, not its head, and marks it as a tail', () => {
    const head = 'START-OF-PAGE ' + 'filler '.repeat(600);
    const seam = 'Furthermore, he ought to inquire whether he sinned in a time of joy or a time of mourning. It is graver...';
    const out = continuityContext(head + seam);
    expect(out).toContain(seam);
    expect(out).not.toContain('START-OF-PAGE');
    expect(out).toMatch(/continue from its end:\*\*\n\.\.\./);
    expect(out.split('\n').pop()!.length).toBe(3 + CONTINUITY_CONTEXT_CHARS);
  });

  it('drops the editorial blocks that close every page so they do not eat the window', () => {
    const out = continuityContext('Body text. It is graver...\n\n<summary>About the page.</summary>\n<keywords>a, b</keywords>');
    expect(out).toContain('It is graver...');
    expect(out).not.toContain('About the page');
    expect(out.endsWith('It is graver...')).toBe(true);
  });

  it('is empty when there is nothing to continue', () => {
    expect(continuityContext(undefined)).toBe('');
    expect(continuityContext('<summary>only</summary>')).toBe('');
  });

  it('labels the English modernization variant', () => {
    expect(continuityContext('Text.', { english: true })).toContain('(modernized)');
  });
});

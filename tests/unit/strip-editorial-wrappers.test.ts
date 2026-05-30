import { describe, it, expect } from 'vitest';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

describe('stripEditorialWrappers', () => {
  it('drops a <meta> block content-and-all', () => {
    // The real page-89 misquote: the <meta> note names "mercury", which is on
    // page 88, not 89. Stripping it must remove "mercury" entirely.
    const page89 = `<meta>While the previous page focused on perpetual motion wheels using mercury, this page shifts toward water-driven mechanisms.</meta>\n\n...should be held in that <term>yantra</term>. When the interior space is filled with water...`;
    const out = stripEditorialWrappers(page89);
    expect(out).not.toMatch(/mercury/i);
    expect(out).not.toMatch(/perpetual/i);
    expect(out).toContain('filled with water');
    expect(out).toContain('<term>yantra</term>'); // inline glosses survive
  });

  it('drops summary, keywords, and vocab blocks', () => {
    const t = `body text <summary>AI description of the page</summary> more body <keywords>a, b, c</keywords> end <vocab>term1, term2</vocab>`;
    const out = stripEditorialWrappers(t).replace(/\s+/g, ' ').trim();
    expect(out).toBe('body text more body end');
  });

  it('handles multiline wrapper content', () => {
    const t = `<meta>line one\nline two\nline three</meta>real body`;
    expect(stripEditorialWrappers(t)).not.toMatch(/line (one|two|three)/);
    expect(stripEditorialWrappers(t)).toContain('real body');
  });

  it('does not swallow body text between two different wrapper types', () => {
    const t = `<meta>desc</meta>KEEP THIS BODY<keywords>k</keywords>`;
    expect(stripEditorialWrappers(t)).toContain('KEEP THIS BODY');
  });

  it('removes orphan wrapper tags from malformed AI output', () => {
    const t = `body <meta>unclosed description that runs to end of page`;
    expect(stripEditorialWrappers(t)).not.toContain('<meta>');
  });

  it('is a no-op on text with no wrappers', () => {
    const t = 'plain translated body with a <term>gloss</term>';
    expect(stripEditorialWrappers(t)).toBe(t);
  });
});

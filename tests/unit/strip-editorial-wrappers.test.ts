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

  it('strips the OCR page-level metadata envelope content-and-all', () => {
    // The real value served by the live IIIF OCR annotation route before the fix.
    const ocr = `<scan-quality>good</scan-quality>\n<language>English</language>\n<script>printed</script>\n<page-type>blank</page-type>\n\nActual body line of the page.`;
    const out = stripEditorialWrappers(ocr);
    expect(out).not.toMatch(/scan-quality|page-type/);
    expect(out).not.toMatch(/\bprinted\b/); // <script>printed</script> label gone
    expect(out).not.toMatch(/\bblank\b/);   // <page-type>blank</page-type> label gone
    expect(out).toContain('Actual body line of the page.');
  });

  it('drops <columns> and <warning> metadata but keeps real page marks', () => {
    const t = `<columns>2</columns><warning>low contrast</warning><header>RUNNING HEAD</header>real body<insert>OLIN BM 175</insert>`;
    const out = stripEditorialWrappers(t);
    expect(out).not.toMatch(/low contrast/);
    expect(out).not.toContain('<columns>');
    // header/insert are real printed marks, not AI description — they survive.
    expect(out).toContain('<header>RUNNING HEAD</header>');
    expect(out).toContain('real body');
    expect(out).toContain('<insert>OLIN BM 175</insert>');
  });

  it('strips inline <language> switch markers without eating the body', () => {
    const t = `Lorem ipsum <language>Latin</language> dolor sit amet`;
    const out = stripEditorialWrappers(t).replace(/\s+/g, ' ').trim();
    expect(out).toBe('Lorem ipsum dolor sit amet');
  });

  // ── Markdown table flattening (Vasari "tavola"/index pages) ──────────────
  it('flattens an empty-header markdown table to readable lines, no pipe-soup', () => {
    // The Vasari Vol.1 1568 index, p.42 — leaked into a search snippet as
    // "# TABLE OF | | | |---|---| | Luigi Pulci s. | 493 | ...".
    const t = `# TABLE OF\n\n| | |\n|---|---|\n| Luigi Pulci s. | 493 |\n| Gaddo Gaddi p. | 13 |`;
    const out = stripEditorialWrappers(t);
    expect(out).not.toMatch(/\|/);          // no raw pipes survive
    expect(out).not.toMatch(/---/);         // no separator scaffolding
    expect(out).toContain('Luigi Pulci s.  493');
    expect(out).toContain('Gaddo Gaddi p.  13');
  });

  it('flattens aligned separator rows and multi-cell rows', () => {
    const t = `| Name | Page |\n| :--- | ---: |\n| Thomas Aquinas, saint p. | 187 |`;
    const out = stripEditorialWrappers(t).trim();
    expect(out).not.toMatch(/[|]|:---|---:/);
    expect(out).toContain('Name  Page');
    expect(out).toContain('Thomas Aquinas, saint p.  187');
  });

  it('leaves prose containing an inline pipe untouched', () => {
    const t = 'the choice of good | evil is the soul’s';
    expect(stripEditorialWrappers(t)).toBe(t);
  });
});

import { describe, it, expect } from 'vitest';
import { cleanPageText } from '../../scripts/lib/page-embedding-text.mjs';
import { stripAnnotations } from '../../src/lib/semantic-alignment';

/**
 * The page-embedding composer must never embed the AI's own voice as page
 * text. Before #3820 it stripped only meta/summary/keywords/vocab, so
 * <image-desc> plate descriptions, <warning> remarks and <scan-quality>good
 * were embedded and stored as quotable snippets — the same misquote class
 * stripEditorialWrappers exists to prevent (#2232), one layer down.
 */

const PAGE = `<lang>Latin</lang>
<page-type>text</page-type>
<page-num>46</page-num>
<header>TERTIVS.</header>
<scan-quality>good</scan-quality>
<warning>Significant bleed-through from the verso.</warning>

<image-desc size="large" type="woodcut" significance="high">A woodcut of the Vitruvian Man centered within a circle and square.</image-desc>

Real body text about the proportions of the human body. A <term>cubit</term> <note>an ancient unit of measure</note> is one-fourth.

<summary>Vitruvius details the ratios of the human body.</summary>
<keywords>proportions, geometry</keywords>`;

describe('cleanPageText (the ONE embedding composer)', () => {
  it('drops editorial wrapper CONTENT, not just tags', () => {
    const out = cleanPageText(PAGE);
    expect(out).not.toContain('woodcut');
    expect(out).not.toContain('bleed-through');
    expect(out).not.toContain('good');
    expect(out).not.toContain('details the ratios');
  });

  it('drops apparatus content (headers, printed page numbers)', () => {
    const out = cleanPageText(PAGE);
    expect(out).not.toContain('TERTIVS');
    expect(out).not.toMatch(/\b46\b/);
  });

  it('drops the <lang> alias content, not just <language>', () => {
    expect(cleanPageText(PAGE)).not.toContain('Latin');
  });

  it('keeps body text and unwraps annotation tags', () => {
    const out = cleanPageText(PAGE);
    expect(out).toContain('Real body text about the proportions');
    expect(out).toContain('cubit');
    expect(out).toContain('an ancient unit of measure');
    expect(out).not.toMatch(/<[a-z]/i);
  });

  it('caps at 8000 chars and survives junk input', () => {
    expect(cleanPageText('x'.repeat(20000)).length).toBeLessThanOrEqual(8000);
    expect(cleanPageText(null as unknown as string)).toBe('');
    expect(cleanPageText(undefined as unknown as string)).toBe('');
  });
});

describe('semantic-alignment stripAnnotations', () => {
  it('drops image-desc/scan-quality/script/columns/lang content (#3820)', () => {
    const out = stripAnnotations(PAGE);
    expect(out).not.toContain('woodcut');
    expect(out).not.toContain('good');
    expect(out).not.toContain('Latin');
    expect(out).toContain('Real body text');
  });
});

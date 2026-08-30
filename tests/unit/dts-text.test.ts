import { describe, it, expect } from 'vitest';
import { dtsPageText } from '@/lib/dts-text';

/**
 * DTS is a scholarly interchange API: what it serves will be treated as the
 * text of the witness. It must never include the AI's own voice (#3822).
 */

const OCR_PAGE = `<lang>Latin</lang>
<page-type>text</page-type>
<page-num>46</page-num>
<scan-quality>good</scan-quality>
<meta>Bleed-through from the verso is visible.</meta>

<image-desc type="woodcut">A woodcut of the Vitruvian Man in a circle and square.</image-desc>

Non minus quemadmodum schema rotundationis in corpore efficitur.

<margin>TERTIVS</margin>

| pondus | 12 |
| mensura | 4 |

<vocab>schema rotundationis, quadrata designatio</vocab>`;

describe('dtsPageText', () => {
  it('drops editorial wrapper content, keeps the witness text', () => {
    const out = dtsPageText(OCR_PAGE);
    expect(out).toContain('Non minus quemadmodum schema rotundationis');
    expect(out).not.toContain('woodcut');
    expect(out).not.toContain('Bleed-through');
    expect(out).not.toContain('good');
    expect(out).not.toContain('quadrata designatio');
    expect(out).not.toContain('Latin');
  });

  it('unwraps page marks — transcription content survives, markup does not', () => {
    const out = dtsPageText(OCR_PAGE);
    expect(out).toContain('TERTIVS');
    expect(out).not.toMatch(/<[a-z]/i);
  });

  it('keeps table structure (DTS serves the artifact, not an excerpt)', () => {
    const out = dtsPageText(OCR_PAGE);
    expect(out).toContain('| pondus | 12 |');
  });

  it('turns column breaks into paragraph breaks', () => {
    expect(dtsPageText('left column<column-break/>right column')).toBe(
      'left column\n\nright column'
    );
  });

  it('does not eat prose comparisons that look tag-adjacent', () => {
    expect(dtsPageText('where a < b and b > c holds')).toContain('a < b and b > c');
  });

  it('is safe on empty and missing input', () => {
    expect(dtsPageText('')).toBe('');
    expect(dtsPageText(undefined)).toBe('');
    expect(dtsPageText(null)).toBe('');
  });
});

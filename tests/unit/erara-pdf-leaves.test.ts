import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
// @ts-expect-error — plain .mjs worker lib, no types
import { eraraPdfLeafOffset, pdfIndexForPage, ERARA_PDF_COVER_SHEETS } from '../../scripts/workers/lib/erara-pdf-leaves.mjs';

// #5803: e-rara's PDF opens with a cover sheet that is not a leaf. Storing PDF page N as
// page N put every archived image one leaf behind its page.
describe('e-rara PDF page → leaf mapping', () => {
  it('skips the cover sheet when the PDF is cover + leaves', () => {
    const m = eraraPdfLeafOffset({ pdfPages: 233, leafCount: 232 });
    expect(m).toEqual({ offset: 1 });
    // pdftoppm output is 0-indexed here: [cover, leaf 1, leaf 2, …]
    expect(pdfIndexForPage(1, m.offset)).toBe(1);
    expect(pdfIndexForPage(232, m.offset)).toBe(232); // the last leaf, lost under the old mapping
  });

  it('never maps a page to the cover sheet', () => {
    for (let n = 1; n <= 50; n++) expect(pdfIndexForPage(n, ERARA_PDF_COVER_SHEETS)).toBeGreaterThan(0);
  });

  it('refuses a PDF whose page count does not fit, rather than guess', () => {
    for (const pdfPages of [232, 231, 234, 0]) {
      expect(eraraPdfLeafOffset({ pdfPages, leafCount: 232 })).toHaveProperty('refuse');
    }
    expect(eraraPdfLeafOffset({ pdfPages: 10, leafCount: 0 })).toHaveProperty('refuse');
    expect(eraraPdfLeafOffset({ pdfPages: NaN, leafCount: 9 })).toHaveProperty('refuse');
  });

  it('refuses to fill the gaps of a book archived under another mapping', () => {
    expect(eraraPdfLeafOffset({ pdfPages: 233, leafCount: 232, archivedOther: 40 })).toHaveProperty('refuse');
    expect(eraraPdfLeafOffset({ pdfPages: 233, leafCount: 232, archivedOther: 0 })).toEqual({ offset: 1 });
  });

  it('the archiver goes through the mapping and stamps the offset it used', () => {
    const src = readFileSync('scripts/workers/archive-erara.mjs', 'utf8');
    expect(src).toContain('pdfIndexForPage(page.page_number, mapping.offset)');
    expect(src).toContain("'archive_metadata.pdf_leaf_offset': mapping.offset");
    expect(src).not.toMatch(/srcFile:\s*pageFiles\[i\]/);
  });
});

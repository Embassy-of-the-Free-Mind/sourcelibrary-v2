/**
 * `plate_back_sequence` (#6783): a text page right after a plate, whose printed neighbours run straight across it
 * (page 50 before, page 51 after), is the plate's blank verso, so text on it is not the book's. Curtin's A Journey
 * in Southern Siberia (1909) carried invented English on all ten such leaves.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { plateBackPages, printedPageNumber } from '../../scripts/audit/detect-fabricated-ocr.mjs';

describe('plateBackPages', () => {
  it('flags the leaf between a plate and consecutive printed pages (the Curtin case)', () => {
    const rows = [
      { page: 91, type: 'text', num: 50 },
      { page: 92, type: 'illustration', num: null },
      { page: 93, type: 'text', num: 12 },   // invented: a fake page number on a blank verso
      { page: 94, type: 'text', num: 51 },
    ];
    expect([...plateBackPages(rows)]).toEqual([93]);
  });

  it('does not flag a real page after a plate (numbers leave room for it)', () => {
    const rows = [
      { page: 10, type: 'text', num: 14 },
      { page: 11, type: 'illustration', num: null },
      { page: 12, type: 'text', num: 15 },   // the printed page that follows the plate
      { page: 13, type: 'text', num: 16 },
    ];
    expect([...plateBackPages(rows)]).toEqual([]);
  });

  it('does not flag pages already typed blank, or without a plate before them', () => {
    expect([...plateBackPages([
      { page: 1, type: 'text', num: 50 }, { page: 2, type: 'illustration', num: null },
      { page: 3, type: 'blank', num: null }, { page: 4, type: 'text', num: 51 },
    ])]).toEqual([]);
    expect([...plateBackPages([
      { page: 1, type: 'text', num: 50 }, { page: 2, type: 'text', num: null }, { page: 3, type: 'text', num: 51 },
    ])]).toEqual([]);
  });

  it('reads the printed page number from the OCR tag', () => {
    expect(printedPageNumber('<page-num>51</page-num>')).toBe(51);
    expect(printedPageNumber('<page-num>xii</page-num>')).toBeNull();
    expect(printedPageNumber('')).toBeNull();
  });
});

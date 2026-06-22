import { describe, it, expect } from 'vitest';
import { buildPageGrounding, extractImageDescs, SUBSTANTIVE_CHARS } from '@/lib/page-grounding';
import {
  buildPageGrounding as buildPageGroundingJs,
  extractImageDescs as extractImageDescsJs,
} from '../../scripts/lib/page-grounding.mjs';

// The captioner used to guess an illustration's subject from the book's topic
// (wrestlers → "gymnosophists"). Grounding feeds it the page's own transcription
// with an explicit authority hierarchy so a topic prior can't override a label
// printed on the page (#2707).

const LONG = 'x '.repeat(SUBSTANTIVE_CHARS); // > substantive threshold

describe('extractImageDescs', () => {
  it('returns ALL non-trivial descriptions in order (not just the first)', () => {
    const ocr =
      '<image-desc type="illustration">Two wrestlers grappling</image-desc> body ' +
      '<image-desc type="illustration">A king observing</image-desc>';
    expect(extractImageDescs(ocr)).toEqual(['Two wrestlers grappling', 'A king observing']);
  });

  it('drops trivial markup (drop-caps, ornaments, stamps)', () => {
    const ocr =
      '<image-desc type="ornament">Ornamental initial C</image-desc>' +
      '<image-desc type="illustration">A real engraving</image-desc>' +
      '<image-desc type="stamp">Library stamp</image-desc>';
    expect(extractImageDescs(ocr)).toEqual(['A real engraving']);
  });

  it('falls back to translation when OCR has none', () => {
    expect(extractImageDescs('', '<image-desc>From translation</image-desc>')).toEqual([
      'From translation',
    ]);
  });
});

describe('buildPageGrounding authority + adaptivity', () => {
  it('puts the on-page label first and warns against topic override', () => {
    const g = buildPageGrounding({
      ocr: '<image-desc type="illustration">Two wrestlers grappling</image-desc>',
    });
    expect(g).toContain('highest authority');
    expect(g).toContain('Two wrestlers grappling');
    expect(g).toContain('NEVER override');
  });

  it('lists multiple illustrations as a numbered, ordered list', () => {
    const g = buildPageGrounding({
      ocr:
        '<image-desc type="illustration">First scene</image-desc>' +
        '<image-desc type="illustration">Second scene</image-desc>',
    });
    expect(g).toContain('match each to what you see, in order');
    expect(g).toContain('1. First scene');
    expect(g).toContain('2. Second scene');
  });

  it('uses a substantive neighbour when the page sits in running text', () => {
    const g = buildPageGrounding({
      ocr: '<image-desc type="illustration">A scene</image-desc>',
      pageNumber: 10,
      neighbors: [
        { page_number: 9, ocr: 'blank' },
        { page_number: 11, ocr: `<summary>The chapter discusses the Isthmian games.</summary> ${LONG}` },
      ],
    });
    expect(g).toContain('Nearby text (page 11');
    expect(g).toContain('Isthmian games');
  });

  it('falls back to the book summary for a plate isolated among blanks', () => {
    const g = buildPageGrounding({
      ocr: '<image-desc type="illustration">A full-page plate</image-desc>',
      pageNumber: 5,
      neighbors: [
        { page_number: 4, ocr: '' },
        { page_number: 6, ocr: '<page-type>blank</page-type>' },
      ],
      bookSummary: 'An alchemical emblem book by Michael Maier.',
    });
    expect(g).toContain('Book context (last resort only');
    expect(g).toContain('Michael Maier');
    expect(g).not.toContain('Nearby text');
  });

  it('does NOT add the book summary when a good neighbour exists', () => {
    const g = buildPageGrounding({
      ocr: '<image-desc type="illustration">A scene</image-desc>',
      pageNumber: 10,
      neighbors: [{ page_number: 11, ocr: `running narrative text ${LONG}` }],
      bookSummary: 'Should not appear.',
    });
    expect(g).toContain('Nearby text (page 11');
    expect(g).not.toContain('Should not appear');
  });

  it('returns empty string when there is nothing to ground on', () => {
    expect(buildPageGrounding({ ocr: '', translation: '' })).toBe('');
  });

  it('ignores blank/sparse neighbours (no Nearby text line)', () => {
    const g = buildPageGrounding({
      ocr: '<image-desc type="illustration">A scene</image-desc>',
      pageNumber: 10,
      neighbors: [{ page_number: 11, ocr: 'tiny' }],
    });
    expect(g).not.toContain('Nearby text');
  });
});

describe('twin parity (mjs vs ts)', () => {
  const fixtures = [
    { ocr: '<image-desc type="illustration">Two wrestlers</image-desc><image-desc>A king</image-desc>' },
    {
      ocr: '<image-desc type="illustration">A plate</image-desc>',
      pageNumber: 5,
      neighbors: [{ page_number: 6, ocr: `narrative ${LONG}` }],
      bookSummary: 'Book about X.',
    },
    { ocr: '', translation: '', bookSummary: 'fallback' },
  ];
  it('produces identical output across both twins', () => {
    for (const f of fixtures) {
      expect(buildPageGrounding(f as never)).toBe(buildPageGroundingJs(f));
      expect(extractImageDescs(f.ocr)).toEqual(extractImageDescsJs(f.ocr));
    }
  });
});

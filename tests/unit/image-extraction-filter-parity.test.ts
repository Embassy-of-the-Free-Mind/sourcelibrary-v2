/**
 * PARITY — scripts/lib/image-extraction-filter.mjs (used by the review-candidate
 * builder, which decides which pages enter the volunteer hallucination queue)
 * and src/lib/image-extraction-filter.ts (used by the app) must agree exactly.
 *
 * If they drift, the candidate pool stops matching the pages the extraction
 * worker would actually keep, and volunteers spend their time judging pages
 * that were never going to cost us a vision call.
 *
 * These assertions run BOTH implementations over the same inputs and compare
 * outputs — deleting a rule from one side turns this red. They do not grep source.
 */
import { describe, it, expect } from 'vitest';

import * as mjs from '../../scripts/lib/image-extraction-filter.mjs';
import * as ts from '../../src/lib/image-extraction-filter';

/** Pages drawn to exercise each branch: skip rules, significance gating,
 *  the <detected-images> escape hatch, multi-tag pages, and malformed markup. */
const FIXTURES: string[] = [
  '',
  'Plain page text with no markup at all.',
  '<image-desc type="stamp" significance="high">A library stamp.</image-desc>',
  '<image-desc type="decorative" significance="low">A drop cap.</image-desc>',
  // decorative + HIGH is not in the skip list — must be kept
  '<image-desc type="decorative" significance="high">An elaborate historiated initial.</image-desc>',
  '<image-desc type="engraving" significance="high" size="large">A copperplate of a furnace.</image-desc>',
  // every tag skippable → skip
  '<image-desc type="ornament" significance="low">Rule</image-desc>' +
    '<image-desc type="symbol" significance="high">Alchemical sigil</image-desc>',
  // one non-skippable tag among skippable ones → keep
  '<image-desc type="ornament" significance="low">Rule</image-desc>' +
    '<image-desc type="diagram" significance="high">A volvelle with rotating discs.</image-desc>',
  // the escape hatch wins even when every tag is skippable
  '<detected-images><image-desc type="stamp" significance="high">Stamp</image-desc></detected-images>',
  "<image-desc type=\"printer's mark\" significance=\"low\">Aldine anchor</image-desc>",
  '<image-desc type="exlibris" significance="high">Bookplate of the NYBG.</image-desc>',
  // missing attributes / malformed
  '<image-desc>No attributes at all.</image-desc>',
  '<image-desc type="stamp">No significance attribute.</image-desc>',
  '<image-desc type="engraving" significance="high">Unclosed tag',
  // multiline description with entities and nested angle brackets in prose
  '<image-desc type="map" significance="high" size="large">A chart of the\n  Aegean, marked "PRO SCIENTIA".</image-desc>',
];

describe('image-extraction-filter twins', () => {
  it('shouldSkipPageByMarkup agrees on every fixture', () => {
    for (const ocr of FIXTURES) {
      expect(mjs.shouldSkipPageByMarkup(ocr), `mismatch for: ${ocr.slice(0, 60)}`).toBe(
        ts.shouldSkipPageByMarkup(ocr),
      );
    }
  });

  it('shouldSkipPageByMarkup agrees on null and undefined', () => {
    expect(mjs.shouldSkipPageByMarkup(null)).toBe(ts.shouldSkipPageByMarkup(null));
    expect(mjs.shouldSkipPageByMarkup(undefined)).toBe(ts.shouldSkipPageByMarkup(undefined));
  });

  it('extractImageDescTags agrees on every fixture', () => {
    for (const ocr of FIXTURES) {
      expect(mjs.extractImageDescTags(ocr), `mismatch for: ${ocr.slice(0, 60)}`).toEqual(
        ts.extractImageDescTags(ocr),
      );
    }
  });

  it('rule tables and candidate page types are identical', () => {
    expect(mjs.SKIP_MARKUP_RULES).toEqual(ts.SKIP_MARKUP_RULES);
    expect(mjs.IMAGE_CANDIDATE_PAGE_TYPES).toEqual(ts.IMAGE_CANDIDATE_PAGE_TYPES);
  });

  /* Behavioral anchors — these pin the semantics the queue depends on,
     independently of parity (both sides being wrong the same way is still wrong). */
  it('keeps a page whose only tag is a real illustration', () => {
    expect(
      ts.shouldSkipPageByMarkup(
        '<image-desc type="engraving" significance="high">A furnace.</image-desc>',
      ),
    ).toBe(false);
  });

  it('skips a page whose tags are all provenance marks', () => {
    expect(
      ts.shouldSkipPageByMarkup(
        '<image-desc type="bookplate" significance="high">Bookplate.</image-desc>',
      ),
    ).toBe(true);
  });

  it('never skips a page with no markup', () => {
    expect(ts.shouldSkipPageByMarkup('ordinary page text')).toBe(false);
  });
});

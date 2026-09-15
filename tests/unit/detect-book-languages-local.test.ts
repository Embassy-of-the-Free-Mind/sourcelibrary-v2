// PRIOR ART: tests/unit/language-normalize.test.ts pins the tag vocabulary normaliser; nothing
// pins the per-page counting rule of detect-book-languages.mjs (#4117), which now exists twice —
// as an Atlas pipeline and as the mirror twin. This pins the twin to the pipeline's contract.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs with no type declarations
import { tagCountsLocal } from '../../scripts/audit/detect-book-languages.mjs';

/**
 * `tagCountsLocal` must apply the SAME exclusions as the `tagCounts` aggregation pipeline beside
 * it (#4781 added the local-mirror source). Each rule below was found by spot-checking the first
 * full Atlas run (#4117) and lives in the pipeline; a divergence here would make the two sources
 * disagree about the same book. Parity was also measured directly: 60 books, both sources,
 * identical buckets, tagged counts and top-3 shares (2026-09-13).
 */
const body = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.';

describe('tagCountsLocal — the mirror twin of the per-page language-tag rule', () => {
  it('counts pages per raw <language> tag found in the first 300 characters', () => {
    const rows = [
      { p: 1, ocr: `<language>Latin</language>\n${body}` },
      { p: 2, ocr: `<language>Latin</language>\n${body}` },
      { p: 3, ocr: `<language>Greek</language>\n${body}` },
    ];
    const counts = Object.fromEntries(tagCountsLocal(rows).map((r: any) => [r._id, r.n]));
    expect(counts).toEqual({ Latin: 2, Greek: 1 });
  });

  it('excludes soft-hidden pages (negative page numbers)', () => {
    // 706 hidden leaves across a 45-book sample moved 4 books across a band boundary (#4117).
    const rows = [
      { p: 1, ocr: `<language>Latin</language>\n${body}` },
      { p: -2, ocr: `<language>Greek</language>\n${body}` },
    ];
    expect(tagCountsLocal(rows)).toEqual([{ _id: 'Latin', n: 1 }]);
  });

  it('excludes a leaf whose text is only the metadata envelope', () => {
    // A stain still gets a language tag; with no transcription it must not vote.
    const rows = [
      { p: 1, ocr: `<language>Latin</language>\n${body}` },
      { p: 2, ocr: '<language>Greek</language><page-type>blank</page-type><scan-quality>poor</scan-quality>' },
      { p: 3, ocr: '<language>Greek</language><image-desc size="large">A woodcut of a lion, described at length by the model, which is not transcription.</image-desc>' },
    ];
    expect(tagCountsLocal(rows)).toEqual([{ _id: 'Latin', n: 1 }]);
  });

  it('counts an untagged page under null, so untagged is measurable', () => {
    const rows = [{ p: 1, ocr: body }, { p: 2, ocr: `<language>Latin</language>\n${body}` }];
    const counts = Object.fromEntries(tagCountsLocal(rows).map((r: any) => [String(r._id), r.n]));
    expect(counts).toEqual({ null: 1, Latin: 1 });
  });

  it('ignores pages with no OCR string at all', () => {
    expect(tagCountsLocal([{ p: 1, ocr: null }, { p: 2 }, { p: '3', ocr: `<language>Latin</language>\n${body}` }]))
      .toEqual([{ _id: 'Latin', n: 1 }]);
  });
});

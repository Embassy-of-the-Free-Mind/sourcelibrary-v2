import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module, no types
import { computeTextShiftMoves, SHIFT_FIELDS } from '../../scripts/lib/text-shift.mjs';

/**
 * Pins the p(N+1) -> p(N) text-shift transform used by
 * scripts/maintenance/repair-bulkjp2-text-shift.mjs (#3368).
 *
 * The transform is pure — pages in, moves out — so the repair's core logic is
 * testable without Mongo. The invariants that matter:
 *   - anything but a shift+1 verdict produces ZERO moves (fail closed);
 *   - only bulk_jp2 pages move, and only from bulk_jp2 successors;
 *   - the last page of each affected run is cleared, never left stale.
 */

type Page = {
  page_number: number;
  archive_metadata?: { source?: string };
  [k: string]: unknown;
};

const bulkPage = (n: number, fields: Record<string, unknown> = {}): Page => ({
  page_number: n,
  archive_metadata: { source: 'bulk_jp2' },
  ocr: { data: `ocr-${n}`, model: 'm', updated_at: `t${n}` },
  translation: { data: `tr-${n}` },
  page_type: `type-${n}`,
  ...fields,
});

const iiifPage = (n: number): Page => ({
  page_number: n,
  archive_metadata: { source: 'iiif' },
  ocr: { data: `ocr-${n}` },
});

describe('computeTextShiftMoves', () => {
  it('shifts every bulk_jp2 page one left and clears the last', () => {
    const pages = [bulkPage(1), bulkPage(2), bulkPage(3)];
    const moves = computeTextShiftMoves(pages, { verdict: 'shift+1' });

    expect(moves.map((m: { page_number: number }) => m.page_number)).toEqual([1, 2, 3]);

    // p1 takes p2's text, p2 takes p3's.
    expect(moves[0].src_page_number).toBe(2);
    expect(moves[0].cleared).toBe(false);
    expect(moves[0].set.ocr).toEqual({ data: 'ocr-2', model: 'm', updated_at: 't2' });
    expect(moves[1].set.ocr.data).toBe('ocr-3');

    // Last page of the run: nothing holds its text — cleared, all fields unset.
    expect(moves[2].cleared).toBe(true);
    expect(moves[2].src_page_number).toBeNull();
    expect(moves[2].set).toEqual({});
    expect(moves[2].unset).toEqual(SHIFT_FIELDS);
  });

  it('NEGATIVE CONTROL: an aligned book produces zero moves', () => {
    const pages = [bulkPage(1), bulkPage(2), bulkPage(3)];
    expect(computeTextShiftMoves(pages, { verdict: 'aligned' })).toEqual([]);
  });

  it('fails closed on ambiguous, unknown, and missing verdicts', () => {
    const pages = [bulkPage(1), bulkPage(2)];
    expect(computeTextShiftMoves(pages, { verdict: 'ambiguous' })).toEqual([]);
    expect(computeTextShiftMoves(pages, { verdict: 'unknown' })).toEqual([]);
    expect(computeTextShiftMoves(pages, {})).toEqual([]);
    expect(computeTextShiftMoves(pages)).toEqual([]);
  });

  it('a book with no bulk_jp2 pages produces zero moves even when shifted', () => {
    const pages = [iiifPage(1), iiifPage(2), iiifPage(3)];
    expect(computeTextShiftMoves(pages, { verdict: 'shift+1' })).toEqual([]);
  });

  it('never moves text across a path boundary: a non-bulk successor clears, not copies', () => {
    // Mixed-path book (the Homiliae shape): pages 1-2 bulk_jp2, 3-4 per-page
    // IIIF. Page 3's text belongs to leaf 3 — pulling it onto page 2 would
    // corrupt an aligned page's text into a shifted slot.
    const pages = [bulkPage(1), bulkPage(2), iiifPage(3), iiifPage(4)];
    const moves = computeTextShiftMoves(pages, { verdict: 'shift+1' });

    expect(moves.map((m: { page_number: number }) => m.page_number)).toEqual([1, 2]);
    expect(moves[0].src_page_number).toBe(2);
    expect(moves[1].cleared).toBe(true); // run tail — NOT fed from iiif p3
    expect(moves[1].set).toEqual({});
  });

  it('clears at a page-number gap instead of skipping leaves', () => {
    // p2 is missing: p1's true text (leaf 1) lives nowhere we can reach —
    // copying p3's text onto p1 would put it two leaves off.
    const pages = [bulkPage(1), bulkPage(3), bulkPage(4)];
    const moves = computeTextShiftMoves(pages, { verdict: 'shift+1' });

    expect(moves[0]).toMatchObject({ page_number: 1, cleared: true, src_page_number: null });
    expect(moves[1]).toMatchObject({ page_number: 3, src_page_number: 4, cleared: false });
  });

  it('is field-wise: fields the successor lacks are unset, not left stale', () => {
    const pages = [
      bulkPage(1),
      bulkPage(2, { translation: undefined, page_type: undefined }),
    ];
    const moves = computeTextShiftMoves(pages, { verdict: 'shift+1' });

    expect(moves[0].set.ocr.data).toBe('ocr-2');
    expect(moves[0].set).not.toHaveProperty('translation');
    expect(moves[0].unset).toContain('translation');
    expect(moves[0].unset).toContain('page_type');
  });

  it('sorts by page_number internally', () => {
    const pages = [bulkPage(3), bulkPage(1), bulkPage(2)];
    const moves = computeTextShiftMoves(pages, { verdict: 'shift+1' });
    expect(moves.map((m: { page_number: number }) => m.page_number)).toEqual([1, 2, 3]);
    expect(moves[0].src_page_number).toBe(2);
    expect(moves[2].cleared).toBe(true);
  });

  it('honors a custom isTarget predicate', () => {
    const pages = [iiifPage(1), iiifPage(2)];
    const moves = computeTextShiftMoves(pages, {
      verdict: 'shift+1',
      isTarget: (p: Page) => p.archive_metadata?.source === 'iiif',
    });
    expect(moves).toHaveLength(2);
    expect(moves[0].src_page_number).toBe(2);
  });
});

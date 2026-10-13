/**
 * Phase 2 work-ID dedup, pinned (#4833).
 *
 * The orchestrator skips OCR for a book when a "completed copy" of its work exists. Two ways
 * that test went wrong, both silent (the book just never gets OCR'd): a 25-page PREVIEW sibling
 * carries `complete` and read as a copy, and vol. 1 of a set blocked vol. 2 because volumes
 * share a work_id.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { isCompletedCopyOf, editionKeyVolume, hasFullText, filterCompletedCopies } from '../../scripts/workers/lib/work-copy-dedup.mjs';

const cand = { id: 'c', work_id: 'kr:KR3e0012', edition_key: '巢氏諸病源候總論卷五卷九|||v2', pages_count: 169, pages_ocr: 0 };

describe('work-copy dedup', () => {
  it('reads the volume slot of an edition_key', () => {
    expect(editionKeyVolume('a|b|1600|v2')).toBe('2');
    expect(editionKeyVolume('a|b|1600|v')).toBeNull();
    expect(editionKeyVolume(undefined)).toBeNull();
  });

  it('a 25-page preview sibling is not a completed copy', () => {
    const preview = { id: 's', work_id: cand.work_id, edition_key: '巢氏諸病源候總論卷五卷九|||v2', pages_count: 169, pages_ocr: 25 };
    expect(hasFullText(preview)).toBe(false);
    expect(isCompletedCopyOf(cand, preview)).toBe(false);
  });

  it('a full-text sibling of the same volume is a copy', () => {
    const full = { id: 's', work_id: cand.work_id, edition_key: 'other title|||v2', pages_count: 160, pages_ocr: 150 };
    expect(isCompletedCopyOf(cand, full)).toBe(true);
  });

  it('a full-text sibling of a DIFFERENT volume is not a copy', () => {
    const vol1 = { id: 's', work_id: cand.work_id, edition_key: '巢氏諸病源候總論卷一卷四|||v1', pages_count: 157, pages_ocr: 157 };
    expect(isCompletedCopyOf(cand, vol1)).toBe(false);
  });

  it('a missing volume on either side is non-distinguishing', () => {
    const noVol = { id: 's', work_id: cand.work_id, edition_key: 'x|y|1600|v', pages_count: 100, pages_ocr: 100 };
    expect(isCompletedCopyOf(cand, noVol)).toBe(true);
    expect(isCompletedCopyOf({ ...cand, edition_key: undefined }, { ...noVol, edition_key: 'x|y|1600|v3' })).toBe(true);
  });

  it('never matches itself, another work, or a book without a work_id', () => {
    const full = { id: 'c', work_id: cand.work_id, edition_key: cand.edition_key, pages_count: 169, pages_ocr: 169 };
    expect(isCompletedCopyOf(cand, full)).toBe(false);
    expect(isCompletedCopyOf(cand, { ...full, id: 's', work_id: 'other' })).toBe(false);
    expect(isCompletedCopyOf({ ...cand, work_id: undefined }, { ...full, id: 's' })).toBe(false);
  });

  it('filterCompletedCopies keeps vol. 2 when only vol. 1 is complete, skips a true copy', async () => {
    const rows = [
      { id: 'v1', work_id: 'w', edition_key: 't|||v1', pages_count: 100, pages_ocr: 100 },
      { id: 'v3copy', work_id: 'w', edition_key: 't|||v3', pages_count: 100, pages_ocr: 95 },
    ];
    const db = { collection: () => ({ find: () => ({ toArray: async () => rows }) }) };
    const c2 = { id: 'c2', work_id: 'w', edition_key: 't|||v2' };
    const c3 = { id: 'c3', work_id: 'w', edition_key: 't|||v3' };
    const none = { id: 'n' };
    const { kept, skipped } = await filterCompletedCopies(db, [c2, c3, none]);
    expect(kept.map((b: { id: string }) => b.id)).toEqual(['c2', 'n']);
    expect(skipped).toEqual([{ book: c3, copyId: 'v3copy' }]);
  });
});

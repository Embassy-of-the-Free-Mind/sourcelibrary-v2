import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs script
import { toVerdict } from '../../scripts/eval/fix-feed-8255/record.mjs';
// @ts-expect-error plain .mjs lib
import { pageFindingProblems } from '../../scripts/lib/book-checks.mjs';

// The adapter's output goes to the real validator, so a change in what book_checks accepts fails here, not in a run.
const page = (over: Record<string, unknown> = {}) => ({
  page_id: 'p1', page_number: 12, image_opened: true, right_page: 'yes', outcome: 'serious', prior: 'confirmed', confidence: 'high', note: 'n',
  errors: [{ stage: 'ocr', kind: 'confabulation', problem: 'text not on the leaf' }], ...over,
});
const packet = { ocr: 'abc', translation: 'def', ocr_truncated: false, translation_truncated: false };

describe('fix-feed-8255 record adapter', () => {
  it('a serious page becomes a fix verdict whose findings the book_checks validator accepts', () => {
    const v = toVerdict(page(), packet);
    expect(v.page_verdict).toBe('fix');
    expect(pageFindingProblems([{ page_number: 12, errors: v.errors }], [12])).toEqual([]);
    expect(v.judged).toEqual({ ocr: 'abc', translation: 'def' });
  });
  it('never records a page whose image was not opened', () => {
    expect(toVerdict(page({ image_opened: false }), packet)).toBeNull();
    expect(toVerdict(page({ image_opened: 'yes' }), packet)).toBeNull();
  });
  it('a serious page with no error and the right leaf is refused, not recorded as clean', () => {
    expect(toVerdict(page({ errors: [] }), packet)).toBeNull();
  });
  it('a minor or clean page carries no finding even when the reader listed errors', () => {
    expect(toVerdict(page({ outcome: 'minor' }), packet).errors).toEqual([]);
    expect(toVerdict(page({ outcome: 'clean' }), packet).page_verdict).toBe('show');
  });
  it('takes no hash of a text the packet cut', () => {
    expect(toVerdict(page(), { ...packet, ocr_truncated: true }).judged).toBeUndefined();
    expect(toVerdict(page(), undefined).judged).toBeUndefined();
  });
  it('another leaf is wrong_page', () => {
    expect(toVerdict(page({ right_page: 'no', errors: [] }), packet).wrong_page).toBe(true);
  });
});

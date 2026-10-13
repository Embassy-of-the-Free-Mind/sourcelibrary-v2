/**
 * Regression for #4624: `pipeline-orchestrator --phase 2 --book=<id>` always took the 25-page
 * preview path. `applyBookOverride()` replaces Pass 1's candidates after the "no OCR yet" $match,
 * so the preview ran on a book that already had OCR, and Pass 2 then skipped on that fresh batch.
 * Breasted, Ancient Records of Egypt I (398 pp.) needed ~16 invocations instead of two.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { previewIneligibleReason, partitionPreviewCandidates } from '../../scripts/workers/lib/ocr-preview-eligibility.mjs';

describe('previewIneligibleReason', () => {
  it('a book with no OCR yet takes the preview', () => {
    expect(previewIneligibleReason({ id: 'a', pages_ocr: 0 })).toBeNull();
    expect(previewIneligibleReason({ id: 'a', pages_ocr: null })).toBeNull();
    expect(previewIneligibleReason({ id: 'a' })).toBeNull();
  });

  it('a book that already has OCR goes to the full pass (the #4624 case: 43/398)', () => {
    expect(previewIneligibleReason({ id: 'b', pages_ocr: 43, pages_count: 398 })).toMatch(/43 OCR'd/);
  });

  it('a RECITATION retry goes to the full pass even with no OCR', () => {
    expect(previewIneligibleReason({ id: 'c', pages_ocr: 0, pipeline_auto: { recitation_retry: true } })).toMatch(/RECITATION/);
  });

  it('partitions candidates and keeps the reasons', () => {
    const { eligible, dropped } = partitionPreviewCandidates([{ id: 'a' }, { id: 'b', pages_ocr: 43 }]);
    expect(eligible.map(b => b.id)).toEqual(['a']);
    expect(dropped.map(d => d.book.id)).toEqual(['b']);
  });
});

describe('orchestrator wiring', () => {
  const src = readFileSync(path.join(__dirname, '../../scripts/workers/pipeline-orchestrator.mjs'), 'utf8');

  it('re-applies the preview filter AFTER the --book override in Pass 1', () => {
    const override = src.indexOf('if (SCOPE_ACTIVE) previewCandidates = await applyBookOverride(');
    const guard = src.indexOf('partitionPreviewCandidates(previewCandidates)');
    const submit = src.indexOf('const dedupedPreview = await filterDuplicateWorks(db, previewCandidates)');
    expect(override).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(override);
    expect(submit).toBeGreaterThan(guard);
  });

  it('the override re-fetch projects pages_ocr, or the guard would see every book as un-OCRd', () => {
    const line = src.split('\n').find(l => l.includes('previewCandidates = await applyBookOverride('))!;
    expect(line).toMatch(/pages_ocr: 1/);
  });
});

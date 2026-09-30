import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module, no types
import { strandedByImageRepair } from '../../scripts/lib/page-alignment.mjs';

/**
 * Pins the classifier behind scripts/audit/stranded-image-repair-text.mjs
 * (#5309). The case that matters: text OCR'd from the shifted bulk-JP2 image,
 * before the image was re-archived, is STRANDED — it now sits beside the
 * corrected scan of a different leaf. Observed on the #5309 controls
 * (e.g. Oxyrhynchus V p.240: archived 2026-04-07, OCR 2026-06-26, image
 * repaired 2026-07-29).
 */
const ARCH = '2026-04-07T02:46:52Z';
const REPAIRED = '2026-07-29T00:05:13Z';
const page = (ocrAt: string | null, extra: Record<string, unknown> = {}) => ({
  archive_metadata: { source: 'bulk_jp2', archived_at: ARCH },
  ocr: { data: 'text', updated_at: ocrAt } as Record<string, unknown>,
  ...extra,
});

describe('strandedByImageRepair', () => {
  it('OCR between archival and image repair is stranded (the #5309 case)', () => {
    expect(strandedByImageRepair(page('2026-06-26T13:32:23Z'), REPAIRED)).toBe('stranded');
  });
  it('OCR before archival read IIIF and is correct', () => {
    expect(strandedByImageRepair(page('2026-04-03T08:35:50Z'), REPAIRED)).toBe('pre_archival');
  });
  it('OCR rewritten after the repair is resolved, so the list terminates', () => {
    expect(strandedByImageRepair(page('2026-10-02T00:00:00Z'), REPAIRED)).toBe('resolved');
  });
  it('falls back to ocr.created_at', () => {
    const p = page(null);
    p.ocr.created_at = '2026-06-01T00:00:00Z';
    expect(strandedByImageRepair(p, REPAIRED)).toBe('stranded');
  });
  it('missing timestamps are unknown, never silently clean', () => {
    expect(strandedByImageRepair(page(null), REPAIRED)).toBe('unknown');
    expect(strandedByImageRepair(page('2026-06-01T00:00:00Z'), undefined)).toBe('unknown');
  });
  it('pages with no text or not archived from the zip are out of scope', () => {
    expect(strandedByImageRepair(page('2026-06-01T00:00:00Z', { ocr: { data: '' } }), REPAIRED)).toBe('no_text');
    expect(strandedByImageRepair(page('2026-06-01T00:00:00Z', { archive_metadata: { source: 'iiif' } }), REPAIRED)).toBe('not_bulk');
  });
});

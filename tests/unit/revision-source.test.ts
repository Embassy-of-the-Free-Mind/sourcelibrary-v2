/**
 * `page_revisions.source` classification (#3473).
 *
 * WHY THIS IS A BEHAVIOUR TEST, NOT A SOURCE-SHAPE TEST (see CLAUDE.md, "A test
 * that greps source is not a guard"): every case below calls the predicate and
 * asserts what it RETURNS. Changing the regex, the allowlist, or the
 * unlabelled-row policy makes cases here fail.
 *
 * What it protects: `page_revisions` is treated as a double-OCR corpus by the
 * agreement / calibration / repeat-instability stack, but a bulk sweep that
 * relocates text between page docs also writes a revision per page it touches.
 * Those pairs compare two DIFFERENT pages and read as total disagreement while
 * nothing was re-read. `shift-repair-erara-2026-07` alone is 56,413 ocr +
 * 55,272 translation rows and is 99.0% leaf-shifted, against 3.8% for
 * `batch_api`. Misclassifying it silently corrupts every metric downstream.
 */
import { describe, it, expect } from 'vitest';
import {
  isMaintenanceSource,
  rowIsMaintenance,
  READING_SOURCES,
} from '../../scripts/eval/lib/revision-source.mjs';

// Every distinct value present in production on 2026-08-01, from
// db.page_revisions.distinct('source'). If a new label appears, add it here
// with its intended classification — that is the point of the list.
const PRODUCTION_SOURCES = [
  'ai',
  'batch_api',
  'maintenance',
  'manual',
  'mineru',
  'pipeline_preview',
  'realtime_api_sequential',
  'reocr-download-failure-fix-2026-07',
  'shift-repair-erara-2026-07',
  'skip',
  'system',
  'unknown',
] as const;

const EXPECTED_MAINTENANCE = new Set([
  'maintenance',
  'reocr-download-failure-fix-2026-07',
  'shift-repair-erara-2026-07',
  'system',
]);

describe('isMaintenanceSource — production enum', () => {
  it.each(PRODUCTION_SOURCES)('classifies %s', (src) => {
    expect(isMaintenanceSource(src)).toBe(EXPECTED_MAINTENANCE.has(src));
  });

  it('classifies the two highest-volume labels in opposite directions', () => {
    // The single distinction the whole corpus rests on.
    expect(isMaintenanceSource('batch_api')).toBe(false);
    expect(isMaintenanceSource('shift-repair-erara-2026-07')).toBe(true);
  });
});

describe('isMaintenanceSource — unlabelled rows are NOT maintenance', () => {
  // Absence of a label is not evidence of a sweep. Dropping these would shrink
  // the corpus for the wrong reason; they are reported as their own stratum.
  it.each([null, undefined, '', 'unknown'])('keeps %s', (src) => {
    expect(isMaintenanceSource(src as string)).toBe(false);
  });
});

describe('isMaintenanceSource — matches by shape, so future sweeps are excluded by default', () => {
  it.each([
    'shift-repair-gallica-2027-01',
    'backfill-ocr-language-2026-09',
    'cleanup-duplicate-pages',
    'migrate-pages-v3',
    'fix-erara-covers-2026-12',
    'ocr-sweep-2027',
  ])('excludes unseen sweep label %s', (src) => {
    expect(isMaintenanceSource(src)).toBe(true);
  });

  it('does not let the shape rule swallow a pipeline source', () => {
    // Regression guard: the allowlist must be consulted BEFORE the regex, or a
    // future reading source containing e.g. "fix" would be dropped wholesale.
    for (const src of READING_SOURCES) expect(isMaintenanceSource(src)).toBe(false);
  });
});

describe('rowIsMaintenance — derives from prior_source on legacy corpus rows', () => {
  // Corpus JSONL written before 2026-08-01 has no `is_maintenance` field.
  // Reading `row.is_maintenance` alone yields undefined -> falsy -> the
  // exclusion is silently inert on exactly the files most likely to be reused.
  it('derives the flag when the field is absent', () => {
    expect(rowIsMaintenance({ prior_source: 'shift-repair-erara-2026-07' })).toBe(true);
    expect(rowIsMaintenance({ prior_source: 'batch_api' })).toBe(false);
  });

  it('prefers the stored boolean when present', () => {
    expect(rowIsMaintenance({ is_maintenance: true, prior_source: 'batch_api' })).toBe(true);
    expect(rowIsMaintenance({ is_maintenance: false, prior_source: 'shift-repair-erara-2026-07' })).toBe(false);
  });

  it('treats a row with neither field as not-maintenance', () => {
    expect(rowIsMaintenance({})).toBe(false);
    expect(rowIsMaintenance(null)).toBe(false);
  });
});

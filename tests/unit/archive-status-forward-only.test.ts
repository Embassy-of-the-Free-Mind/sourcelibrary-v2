import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the forward-only status rule in archive-iiif-local.mjs.
 *
 * The hazard: that worker advances a fully-archived book to 'archive_complete'.
 * Once --any-status lets it select books at ANY pipeline stage, an unguarded
 * write would knock a 'chapters_complete' book backwards, and the orchestrator
 * would re-run OCR + translation + chapters over the whole book — paid Gemini
 * work, at corpus scale.
 *
 * Per CLAUDE.md ("a test that greps source is not a guard") this EXERCISES the
 * decision function rather than asserting that lines of source exist. The
 * function is pure and self-contained, so it is extracted and evaluated here;
 * deleting the guard in the worker makes the extraction fail, which fails the
 * suite rather than silently passing.
 */

const WORKER = join(process.cwd(), 'scripts/workers/archive-iiif-local.mjs');

function loadGuard(): (s?: string | null) => boolean {
  const src = readFileSync(WORKER, 'utf8');

  const orderMatch = src.match(/const PIPELINE_STATUS_ORDER = \[([\s\S]*?)\];/);
  const fnMatch = src.match(/function mayAdvanceToArchiveComplete\(currentStatus\) \{[\s\S]*?\n\}/);
  if (!orderMatch || !fnMatch) {
    throw new Error('forward-only status guard missing from archive-iiif-local.mjs');
  }

  const factory = new Function(`
    const PIPELINE_STATUS_ORDER = [${orderMatch[1]}];
    const ARCHIVE_COMPLETE_IDX = PIPELINE_STATUS_ORDER.indexOf('archive_complete');
    ${fnMatch[0]}
    return mayAdvanceToArchiveComplete;
  `);
  return factory() as (s?: string | null) => boolean;
}

describe('archive-iiif-local forward-only status guard', () => {
  const mayAdvance = loadGuard();

  it('advances books at or before the archiving stage', () => {
    expect(mayAdvance(undefined)).toBe(true);   // never enrolled
    expect(mayAdvance(null)).toBe(true);
    expect(mayAdvance('queued')).toBe(true);
    expect(mayAdvance('archiving')).toBe(true);
  });

  it('is idempotent for a book already marked archive_complete', () => {
    expect(mayAdvance('archive_complete')).toBe(true);
  });

  it('REFUSES to downgrade a book that has passed archiving', () => {
    // Each of these would trigger re-running paid Gemini phases if overwritten.
    for (const s of [
      'ocr_submitted', 'ocr_complete', 'metadata_enriched',
      'translate_submitted', 'translate_complete',
      'enriching', 'enriched', 'chapters', 'chapters_complete',
      'images_submitted', 'images_complete', 'complete',
    ]) {
      expect(mayAdvance(s), `${s} must not be downgraded`).toBe(false);
    }
  });

  it('leaves terminal and holding states alone', () => {
    for (const s of ['needs_attention', 'failed', 'parked', 'loop_quarantine_hold']) {
      expect(mayAdvance(s), `${s} must not be advanced`).toBe(false);
    }
  });

  it('covers every status the corpus actually holds', () => {
    // Statuses observed in production on 2026-08-04 among books with unarchived
    // pages. A new status appearing here must be classified deliberately, not
    // silently fall through to "advance".
    const observed = [
      'chapters_complete', 'archive_complete', 'translate_complete',
      'needs_attention', 'images_complete', 'archiving', 'queued',
      'enrolled', 'complete', 'parked', 'ocr_queued',
      'loop_quarantine_hold', 'failed',
    ];
    const advanced = observed.filter(s => mayAdvance(s));
    expect(advanced.sort()).toEqual(['archive_complete', 'archiving', 'queued']);
  });
});

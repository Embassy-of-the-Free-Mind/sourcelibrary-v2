/**
 * `reset-book-ocr.mjs` must not release a pipeline hold (#4790, 2026-09-15).
 *
 * The script's last step requeues the book at `archive_complete`. On a HELD book
 * that write silently lifts the hold and returns the book to the lane the hold
 * existed to keep it out of — the same failure `batch-collector.mjs` guards with
 * NOT_HELD. There is no import seam to test against: the script is a CLI with
 * top-level `await client.connect()`, so importing it opens a Mongo connection
 * and runs a reset. Refactoring it for testability is a bigger change than the
 * fix and was deliberately kept out of that PR.
 *
 * So these assert on the SOURCE. That is a weak form of test and worth stating
 * plainly: it cannot prove the branch behaves correctly at runtime. What it does
 * pin is the two ways this regresses silently — dropping the projection (the
 * guard then reads `undefined` and passes every book through) and making the
 * status write unconditional again. Both are single-line edits that look
 * harmless in review, which is exactly what deserves a guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(__dirname, '../../scripts/maintenance/reset-book-ocr.mjs'),
  'utf8',
);

describe('reset-book-ocr respects a pipeline hold', () => {
  it('projects pipeline_auto.hold — isHeld() reads it, and an unprojected field reads as not-held', () => {
    const projection = SRC.slice(SRC.indexOf('projection:'), SRC.indexOf('projection:') + 400);
    expect(projection).toContain("'pipeline_auto.hold': 1");
  });

  it('imports the hold helper rather than re-deriving "held" from the status string', () => {
    // The status alone is not the test (pipeline-hold.mjs: an orphaned 'held'
    // status with no marker is the audit's problem, not a writer's).
    expect(SRC).toMatch(/import\s*\{[^}]*\bisHeld\b[^}]*\}\s*from\s*'\.\.\/lib\/pipeline-hold\.mjs'/);
    expect(SRC).toMatch(/const HELD = isHeld\(book\)/);
  });

  it('writes archive_complete only inside the not-held branch', () => {
    const requeue = /'pipeline_auto\.status':\s*'archive_complete'/g;
    const hits = [...SRC.matchAll(requeue)];
    expect(hits, 'exactly one status write should remain').toHaveLength(1);
    // The write must be guarded by HELD on the same line — a bare
    // `'pipeline_auto.status': 'archive_complete',` is the regression.
    const line = SRC.slice(0, hits[0].index).split('\n').length;
    const text = SRC.split('\n')[line - 1];
    expect(text).toMatch(/HELD\s*\?\s*\{\s*\}\s*:/);
  });

  it('tells the operator the book stayed held, and how to release it', () => {
    expect(SRC).toContain('--release-held');
    // ...and never advertises a flag hold-pipeline-books.mjs does not accept:
    // `--release` there is the release CONDITION when holding, not a release verb.
    expect(SRC).not.toMatch(/--release(?!-held)\b/);
  });
});

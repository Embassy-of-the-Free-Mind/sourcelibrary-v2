import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * A writer that UNSETS the old model's provenance fields (STALE_OCR_FIELDS) after snapshotting
 * `ocr` must snapshot with keepMeta, or prompt ids/hashes, token counts and flags are lost with no
 * copy (#4722, 2026-09-25: found on the Tibetan re-OCR writer and the Syriac Kraken lane).
 * Scans every tracked script that references STALE_OCR_FIELDS, so a new writer is covered too.
 */
describe('writers that unset STALE_OCR_FIELDS keep the superseded provenance', () => {
  const files = execSync('git grep -l "STALE_OCR_FIELDS" -- scripts', { encoding: 'utf8' })
    .trim().split('\n').filter((f) => f && !f.startsWith('scripts/lib/'));

  it('finds the known writers (the scan is not vacuous)', () => {
    expect(files).toEqual(expect.arrayContaining([
      'scripts/maintenance/apply-reocr-verdicts.mjs',
      'scripts/workers/syriac-kraken-lane.mjs',
    ]));
  });

  it.each(files)('%s snapshots ocr with keepMeta: true', (f) => {
    const src = fs.readFileSync(f, 'utf8');
    const calls = [...src.matchAll(/saveRevisionsBeforeOverwrite\([^;]*?'ocr'[^;]*?\)/gs)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/keepMeta:\s*true/);
  });
});

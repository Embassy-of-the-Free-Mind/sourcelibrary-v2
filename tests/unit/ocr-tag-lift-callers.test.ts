import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Every OCR writer lifts page-level tags through `liftOcrTags` (#4195 item 4).
 *
 * `<script>` was parsed by `extractScriptType` from the day the prompt asked for
 * it, but only the realtime Lambda writer lifted it to `pages.script_type`. Each
 * Batch collector called `extractPageType` + `extractColumns` and stopped, so the
 * field stayed empty for most of the corpus and nothing went red — a dropped tag
 * is missing metadata, not an error. The fix is one lifting function; this test
 * keeps writers from drifting back to choosing tags one by one.
 *
 * The probe is `extractColumns(`: it has no use other than lifting the field into
 * a write, so a file calling it directly is a writer that bypassed the helper.
 * (`extractPageType` has legitimate read-only uses, e.g. split-book's classifier.)
 */
const REPO = path.resolve(__dirname, '../..');

/** Where the parsers themselves live. */
const PARSERS = new Set(['scripts/lib/ocr-result-parse.mjs', 'src/lib/types/prompts/defaults.ts']);

function callers(): string[] {
  try {
    return execFileSync('git', ['grep', '-lF', 'extractColumns(', '--', 'scripts', 'src'], { cwd: REPO, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('OCR writers lift tags through liftOcrTags', () => {
  it('no writer calls extractColumns directly', () => {
    const offenders = callers().filter((f) =>
      !PARSERS.has(f) && !f.startsWith('scripts/eval/') && !f.includes('/_archived/'));
    expect(offenders, 'use liftOcrTags(text) so script_type and any future tag are lifted too').toEqual([]);
  });
});

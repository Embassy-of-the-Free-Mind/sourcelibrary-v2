import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every write of OCR TEXT stamps `ocr.updated_at` in the same update (#4927).
 *
 * Translation staleness is decided from two clocks: a page's English is stale
 * when `ocr.updated_at` is newer than `translation.updated_at` beyond a margin
 * (`scripts/lib/stale-translation.mjs`). There is deliberately no content hash
 * — Derek, 2026-09-18: "I just don't see a situation where the timestamp
 * wouldn't be enough… and if it doesn't leave one, that's a bigger issue". So
 * the timestamp has to be trustworthy BY CONSTRUCTION: a writer that replaces
 * `ocr.data` and leaves the clock alone would make a stale translation look
 * fresh, silently, on every surface. That is the bug to fail CI on at the write
 * boundary — the same lesson as the R2 book-scoped keys (#3362/#3365), where a
 * downstream detector that tolerated a bad writer let the identical bug ship
 * twice in one week.
 *
 * A file fails this test when one of its OCR-text writes has no
 * `ocr.updated_at` (dotted key) or `updated_at:` (inside a whole-`ocr` object)
 * within the same update statement. The statement is approximated as the lines
 * between the write and the nearest enclosing update boundary, which is why
 * this runs in JS rather than grep.
 */

const REPO = path.resolve(__dirname, '../..');

/**
 * A write of OCR TEXT, line by line — the same probe as
 * `ocr-write-paths-guarded.test.ts` (#4850): `'ocr.data': text`, or
 * `data: result.text` inside an `ocr` subdocument. Filters are the noise this
 * must exclude — `'ocr.data': null`, `{ $exists: false }`, a regex — so the
 * value has to look like a variable.
 */
const WRITE_LINE = /(?:'ocr\.data':\s*(?!null\b|undefined\b|''|\{|regexFilter)[A-Za-z(]|^\s*data:\s*(?:text|ocrText|result\.text|ocrResult\.text|v\.text|art\.atf)\b)/;

/** How far around a write line the same `$set` / object literal can plausibly extend. */
const WINDOW = 40;

/** Files that write the field but are not a change of the page's reading. */
const ALLOWED: Record<string, string> = {
  'scripts/lib/ocr-loop-guard.mjs': 'the guard itself; writes only page_revisions',
  'scripts/lib/blank-page-guard.mjs': 'the sibling guard; writes only page_revisions',
  'scripts/import/import-thirukkural.ts': 'seeds an empty ocr object at import',
  'src/lib/import-utils.ts': 'seeds an empty ocr object when a page doc is created',
  'scripts/migration/backfill-ocr-near-complete.mjs': 'backfills counters from stored text; the text does not change',
  'scripts/tmp-recitation-retry.mjs': "writes the marker '[RECITATION_BLOCKED]', not a transcription; superseded",
};

/** Files that mention the OCR text field at all — the cheap first pass. */
function candidateFiles(): string[] {
  try {
    return execFileSync('git', ['grep', '-lE', String.raw`ocr\.data|ocr: \{`, '--', 'scripts', 'src'], { cwd: REPO, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
}

/** Line numbers (0-based) in `lines` that write OCR text. */
function writeLines(lines: string[]): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (!WRITE_LINE.test(l)) return;
    if (/'ocr\.data'/.test(l)) { out.push(i); return; }
    // A bare `data: text` only counts when `ocr` is named just above it.
    if (lines.slice(Math.max(0, i - 8), i).some((prev) => /\bocr\b\s*[:=]|'ocr'/.test(prev))) out.push(i);
  });
  return out;
}

/**
 * Does the update around line `i` also stamp the clock? Looks WINDOW lines
 * either way for `'ocr.updated_at'` (dotted) or `updated_at:` (whole-object
 * form). A write that assigns the whole `ocr` object always sets `updated_at`
 * as a sibling key of `data`, which the second form catches.
 */
function stampsClock(lines: string[], i: number): boolean {
  const lo = Math.max(0, i - WINDOW);
  const hi = Math.min(lines.length, i + WINDOW);
  return lines.slice(lo, hi).some((l) => /'ocr\.updated_at'|"ocr\.updated_at"|\bupdated_at\s*:/.test(l));
}

/** [file, line] pairs (1-based line) of OCR-text writes across the repo. */
function ocrWrites(): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const f of candidateFiles()) {
    if (/(^|\/)(_archived|tests)\//.test(f) || /\/(audit|eval)\//.test(f)) continue;
    const lines = readFileSync(path.join(REPO, f), 'utf8').split('\n');
    for (const i of writeLines(lines)) out.push([f, i + 1]);
  }
  return out;
}

describe('every write of pages.ocr.data also stamps ocr.updated_at (#4927)', () => {
  it('no OCR-text write leaves the clock alone', () => {
    const unstamped: string[] = [];
    const byFile = new Map<string, string[]>();
    for (const [f, ln] of ocrWrites()) {
      if (ALLOWED[f]) continue;
      if (!byFile.has(f)) byFile.set(f, readFileSync(path.join(REPO, f), 'utf8').split('\n'));
      if (!stampsClock(byFile.get(f)!, ln - 1)) unstamped.push(`${f}:${ln}`);
    }

    expect(unstamped, [
      'These OCR-text writes do not stamp ocr.updated_at in the same update (#4927).',
      'Translation staleness is decided from that clock; a writer that changes the text without it',
      'makes a stale translation look fresh on every surface. Set ocr.updated_at (or updated_at inside',
      'the ocr object) in the same $set, or add the file to ALLOWED with the reason the reading did not change.',
    ].join(' ')).toEqual([]);
  });

  it('the probe still matches something — a check that finds nothing proves nothing', () => {
    // Without this, a rename of the field would make the test above pass vacuously.
    const writes = ocrWrites();
    const files = new Set(writes.map(([f]) => f));
    expect(files.size).toBeGreaterThan(8);
    expect(files).toContain('scripts/workers/batch-collector.mjs');
    expect(files).toContain('src/workers/write-processor-logic.ts');
  });

  it('the clock check can fail — a stampless write is caught', () => {
    // Positive control for the detector itself (a probe needs a positive control).
    const bad = ["  { $set: {", "    'ocr.data': text,", "    'ocr.model': model,", "  } }"];
    expect(writeLines(bad)).toEqual([1]);
    expect(stampsClock(bad, 1)).toBe(false);
    const good = [...bad.slice(0, 3), "    'ocr.updated_at': now,", "  } }"];
    expect(stampsClock(good, 1)).toBe(true);
    const whole = ['  ocr: {', '    data: text,', '    updated_at: new Date(),', '  },'];
    expect(writeLines(whole)).toEqual([1]);
    expect(stampsClock(whole, 1)).toBe(true);
  });
});

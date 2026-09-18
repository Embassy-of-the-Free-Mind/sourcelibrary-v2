import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every place that stores OCR TEXT must screen it first.
 *
 * This is a check rather than a sentence in a doc, because the doc version of this
 * rule already exists and was already violated: the R2 key guard was added to one
 * helper and "called done", and the identical bug shipped twice in one week
 * (#3362/#3365). The loop guard (#4850) has the same shape — a dozen files write
 * `pages.ocr.data`, several of them dormant, and a dormant writer is exactly the one
 * nobody remembers to guard when it wakes up.
 *
 * A file fails this test when it writes OCR text and imports neither loop-guard twin.
 * To make it pass, call the guard — or, if the text is not a model reading at all, add
 * the file to ALLOWED **with the reason**.
 */

const REPO = path.resolve(__dirname, '../..');

/**
 * A write of OCR TEXT, line by line: `'ocr.data': text`, or `data: result.text` inside
 * an `ocr` subdocument. Filters are the noise this must exclude — `'ocr.data': null`,
 * `{ $exists: false }`, a regex in the IIIF search route — so the value has to look
 * like a variable, and that negative lookahead is why this runs in JS, not in grep.
 */
const WRITE_LINE = /(?:'ocr\.data':\s*(?!null\b|undefined\b|''|\{|regexFilter)[A-Za-z(]|^\s*data:\s*(?:text|ocrText|result\.text|ocrResult\.text|v\.text|art\.atf)\b)/;

/** Files that write the field but not a model's reading of a page image. */
const ALLOWED: Record<string, string> = {
  'scripts/lib/ocr-loop-guard.mjs': 'the guard itself',
  'scripts/lib/blank-page-guard.mjs': 'the sibling guard; writes only page_revisions',
  'scripts/lib/syriac-kraken-lane.mjs': 'builds the $set for scripts/workers/syriac-kraken-lane.mjs, which runs loopVerdict on the text before calling it (#4883)',
  'scripts/import/ia-ocr-ingest.mjs': "Internet Archive's delivered OCR, not a model read — gated by scripts/lib/ia-ocr-gate.mjs (#4780)",
  'scripts/import/cdli-atf-source.mjs': "CDLI's published ATF transliteration; formulaic repetition is the genre (#4851)",
  'scripts/import/import-oraec.mjs': 'ORAEC corpus dump, a published edition',
  'scripts/import/oraec-paginate-translate.mjs': 'repaginates text already imported from ORAEC',
  'scripts/import/fetch-wikisource-javanese.mjs': 'Wikisource text, not a model read',
  'scripts/import/import-thirukkural.ts': 'seeds an empty ocr object at import',
  'scripts/maintenance/dehyphenate-ia-ocr.mjs': 'rewrites stored text, joining hyphenated line breaks',
  'scripts/maintenance/repair-ia-ocr-leaf-offset.mjs': 'moves stored text between pages (#3368); introduces no new text',
  'scripts/maintenance/fix-h13-stragglers.mjs': 'moves stored text; introduces no new text',
  'scripts/split-book.mjs': 'splits stored text across new page docs',
  'scripts/migration/backfill-ocr-near-complete.mjs': 'backfills counters from stored text',
  'scripts/tmp-recitation-retry.mjs': "writes the marker '[RECITATION_BLOCKED]', not a transcription",
  'src/lib/import-utils.ts': 'seeds an empty ocr object when a page doc is created',
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

/**
 * …narrowed to the files that actually WRITE OCR text into it.
 *
 * A bare `data: text` is ambiguous — the translation writers use the same shape — so
 * a match inside a subdocument only counts when `ocr` is named just above it.
 */
function writerFiles(): string[] {
  return candidateFiles().filter((f) => {
    if (/(^|\/)(_archived|tests)\//.test(f) || /\/(audit|eval)\//.test(f)) return false;
    const lines = readFileSync(path.join(REPO, f), 'utf8').split('\n');
    return lines.some((l, i) => {
      if (!WRITE_LINE.test(l)) return false;
      if (/'ocr\.data'/.test(l)) return true;
      return lines.slice(Math.max(0, i - 8), i).some((prev) => /\bocr\b\s*[:=]|'ocr'/.test(prev));
    });
  });
}

describe('every OCR write path is loop-guarded (#4850)', () => {
  it('no unguarded writer of pages.ocr.data', () => {
    const unguarded: string[] = [];
    for (const f of writerFiles()) {
      if (ALLOWED[f]) continue;
      if (!/ocr-loop-guard/.test(readFileSync(path.join(REPO, f), 'utf8'))) unguarded.push(f);
    }

    expect(unguarded, [
      'These files store OCR text without screening it for a degeneration loop (#4850).',
      'Call loopVerdict() before the write, or add the file to ALLOWED with the reason it is not a model reading.',
    ].join(' ')).toEqual([]);
  });

  it('the probe still matches something — a check that finds nothing proves nothing', () => {
    // Without this, a rename of the field would make the test above pass vacuously.
    const files = writerFiles();
    expect(files.length).toBeGreaterThan(8);
    expect(files).toContain('scripts/workers/batch-collector.mjs');
  });
});

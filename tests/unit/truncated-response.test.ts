import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isTruncatedCandidate,
  truncationFailReason,
  TRUNCATING_FINISH_REASONS,
} from '../../scripts/lib/truncated-response.mjs';
import {
  isTruncatedCandidate as isTruncatedTs,
  TRUNCATING_FINISH_REASONS as REASONS_TS,
} from '../../src/lib/truncated-response';

/**
 * A partial answer is a FAILED read, not a short one.
 *
 * Gemini returns `finishReason: 'MAX_TOKENS'` with the partial text still attached.
 * Every collector here branched on RECITATION (a refusal, no text) and on missing
 * text — a truncation is neither, so it fell through and was stored as a finished
 * page. 48 pages of Stefan's Forum of Conscience books held a 107-382 character stub
 * ending mid-word; `pages_ocr` counted them, so every completeness check passed, and
 * the translate lane then stored the model's "Please provide the Latin text…" reply
 * as the page's translation, live to readers (#4890).
 *
 * The second describe block is the part that actually guards anything. A unit test of
 * the helper stays green when someone deletes the branch at a call site, and there are
 * eleven call sites — which is precisely the failure this repo has shipped twice
 * before (the R2 key guard added to one helper and called done, #3362/#3365).
 */

const REPO = path.resolve(__dirname, '../..');

describe('isTruncatedCandidate', () => {
  it('refuses the shape that reached readers: text present, MAX_TOKENS', () => {
    expect(isTruncatedCandidate({ finishReason: 'MAX_TOKENS' })).toBe(true);
    expect(truncationFailReason({ finishReason: 'MAX_TOKENS' })).toBe('truncated:MAX_TOKENS');
  });

  it('passes a finished read — the case that must not be thrown away', () => {
    expect(isTruncatedCandidate({ finishReason: 'STOP' })).toBe(false);
  });

  it('leaves RECITATION to the refusal branch that already handles it', () => {
    // Both are failures, but they mean different things to a human reading the
    // page and they have different recoveries (#2065 escalates the model).
    expect(isTruncatedCandidate({ finishReason: 'RECITATION' })).toBe(false);
    expect(isTruncatedCandidate({ finishReason: 'SAFETY' })).toBe(false);
  });

  it('passes an UNKNOWN reason rather than discarding a good read', () => {
    // Providers add finish reasons. Refusing everything that is not STOP would
    // throw away real transcriptions the first time Google ships a new value —
    // the more expensive mistake of the two.
    expect(isTruncatedCandidate({ finishReason: 'SOME_FUTURE_REASON' })).toBe(false);
  });

  it('survives a missing or malformed candidate', () => {
    expect(isTruncatedCandidate(undefined)).toBe(false);
    expect(isTruncatedCandidate(null)).toBe(false);
    expect(isTruncatedCandidate({})).toBe(false);
    expect(isTruncatedCandidate({ finishReason: '' })).toBe(false);
    expect(isTruncatedCandidate({ finishReason: 'max_tokens' })).toBe(true); // case-insensitive
  });

  it('the .mjs and .ts twins agree — they guard the same write path', () => {
    expect([...REASONS_TS].sort()).toEqual([...TRUNCATING_FINISH_REASONS].sort());
    for (const r of ['MAX_TOKENS', 'LENGTH', 'STOP', 'RECITATION', 'WHATEVER']) {
      expect(isTruncatedTs({ finishReason: r })).toBe(isTruncatedCandidate({ finishReason: r }));
    }
  });
});

/**
 * Files that read a model candidate AND store page text. Same probe shape as
 * `ocr-write-paths-guarded.test.ts`, widened to translation writers because the
 * #4890 harm arrived on the translation side of the page.
 */
const WRITE_LINE =
  /(?:'(?:ocr|translation)\.data':\s*(?!null\b|undefined\b|''|\{|regexFilter)[A-Za-z(]|^\s*data:\s*(?:text|ocrText|result\.text|ocrResult\.text|translated|translation|v\.text)\b)/;

/** Files that write the field but never from a model response of their own. */
const ALLOWED: Record<string, string> = {
  // (none today — every candidate-reading writer consults the finish reason)
};

function candidateReaders(): string[] {
  let files: string[];
  try {
    files = execFileSync(
      'git',
      ['grep', '-lE', String.raw`candidates\?\.\[0\]|candidates\[0\]`, '--', 'scripts', 'src'],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ).split('\n').filter(Boolean);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
  return files.filter(
    (f) =>
      !/(^|\/)(_archived|tests)\//.test(f) &&
      !/\/(eval|audit)\//.test(f) &&
      /\.(mjs|ts|tsx|js)$/.test(f),
  );
}

function textWriters(): string[] {
  return candidateReaders().filter((f) => {
    const lines = readFileSync(path.join(REPO, f), 'utf8').split('\n');
    return lines.some((l, i) => {
      if (!WRITE_LINE.test(l)) return false;
      if (/'(?:ocr|translation)\.data'/.test(l)) return true;
      // A bare `data: text` is ambiguous — it only counts inside an ocr or
      // translation subdocument, named within the preceding few lines.
      return lines
        .slice(Math.max(0, i - 8), i)
        .some((prev) => /\b(?:ocr|translation)\b\s*[:=]|'(?:ocr|translation)'/.test(prev));
    });
  });
}

describe('every writer that reads a model candidate checks whether it finished (#4890)', () => {
  it('no candidate-reading text writer ignores the finish reason', () => {
    const unguarded = textWriters().filter(
      (f) => !ALLOWED[f] && !/truncated-response/.test(readFileSync(path.join(REPO, f), 'utf8')),
    );

    expect(
      unguarded,
      [
        'These files store model text without asking whether the provider finished (#4890).',
        'Call isTruncatedCandidate() on the candidate before the write, or add the file to',
        'ALLOWED with the reason its text is not a model response.',
      ].join(' '),
    ).toEqual([]);
  });

  it('the probe still matches — a check that finds nothing proves nothing', () => {
    const files = textWriters();
    expect(files.length).toBeGreaterThan(8);
    // The two lanes that actually wrote the #4890 stubs.
    expect(files).toContain('scripts/workers/batch-collector.mjs');
    expect(files).toContain('src/app/api/books/[id]/batch-ocr-async/route.ts');
  });

  it('realtime-translate.mjs is guarded even though it writes through translate-core', () => {
    // It calls Gemini directly and hands the text to a shared writer, so the probe
    // above cannot see its write. Named here so a future edit cannot quietly drop
    // the guard from the one translation lane that runs outside the batch API.
    const src = readFileSync(path.join(REPO, 'scripts/batch/realtime-translate.mjs'), 'utf8');
    expect(src).toMatch(/truncated-response/);
    expect(src).toMatch(/isTruncatedCandidate\(/);
  });
});

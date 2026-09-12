import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import {
  parseInitiatedReason,
  initiatedReasonFields,
} from '../../scripts/lib/initiated-reason.mjs';

/**
 * A hand-dispatched job that cannot say WHY it was dispatched is a job whose
 * reason has to be guessed later from what its books have in common (#4336).
 *
 * That reconstruction has been done once: 715 manually-processed books across 19
 * episodes, recoverable in 2026 only because `initiated_by` distinguished the
 * lanes. The reason itself was never recorded, so every episode's purpose was
 * inferred — and an inference that is merely plausible today is indistinguishable
 * from a fact in a year.
 *
 * So the property is asserted at the write, not documented in a comment: a script
 * that inserts a job row for a HUMAN must stamp both the lane (`initiated_by`) and
 * the offered reason (`initiated_reason`). Automated lanes are exempt by name below
 * — a cron has no human reason to record, and demanding one would make the guard a
 * list to maintain rather than a property to hold.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** Directories that hold job-dispatching scripts. */
const SCRIPT_DIRS = ['scripts/batch', 'scripts/maintenance', 'scripts/migration', 'scripts/workers', 'scripts/experiments'];

/**
 * A file "dispatches a job" if it inserts a row into the ledger a worker consumes.
 * Both collections count: `jobs` (SQS/realtime lanes) and `batch_jobs` (Gemini
 * Batch API lanes). Matching the insert call rather than the collection name is
 * deliberate — dozens of audits merely READ these collections, and a guard that
 * flagged all of them would grow an allowlist and stop meaning anything.
 */
const DISPATCHES_JOB = /collection\((['"`])(jobs|batch_jobs)\1\)\s*\.\s*insertOne/;

/**
 * Lanes with no human behind them: a cron or a queue worker fires these, so there
 * is no reason to prompt for and nobody to prompt. Exempt by name, because the
 * exemption is a claim about the lane that a reader can check.
 */
const AUTOMATED_LANES = new Set([
  'scripts/workers/pipeline-orchestrator.mjs',  // cron-driven pipeline phases
  'scripts/workers/translate-worker.mjs',       // SQS consumer, re-queues its own follow-on work
]);

/**
 * Asserts the VALUE is written, not that the helper is in scope. An earlier draft
 * matched the bare identifier and stayed green when the spread was deleted but the
 * import left behind — see invariants/tests-that-are-not-guards.md.
 */
const WRITES_REASON = /\.\.\.initiatedReasonFields\(/;
const WRITES_LANE = /initiated_by\s*:/;

function listJobDispatchers(): string[] {
  const found: string[] = [];
  for (const dir of SCRIPT_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(path.join(PROJECT_ROOT, dir), { recursive: true } as never) as string[];
    } catch {
      continue;
    }
    for (const rel of entries) {
      if (!/\.mjs$/.test(String(rel))) continue;
      const repoPath = path.posix.join(dir, String(rel).split(path.sep).join('/'));
      let src: string;
      try {
        src = readFileSync(path.join(PROJECT_ROOT, repoPath), 'utf8');
      } catch {
        continue;
      }
      if (DISPATCHES_JOB.test(src)) found.push(repoPath);
    }
  }
  return found.sort();
}

const dispatchers = listJobDispatchers();
const handRun = dispatchers.filter((f) => !AUTOMATED_LANES.has(f));
const read = (f: string) => readFileSync(path.join(PROJECT_ROOT, f), 'utf8');

describe('hand-run job dispatch records its reason (#4336)', () => {
  it('finds the job dispatchers at all (guards the guard)', () => {
    // Without this, deleting the detector's pattern would turn every assertion
    // below into a vacuous pass over an empty list.
    expect(dispatchers.length).toBeGreaterThanOrEqual(10);
    expect(dispatchers).toContain('scripts/batch/queue-translations.mjs');
    expect(dispatchers).toContain('scripts/workers/pipeline-orchestrator.mjs');
  });

  it('every automated lane named as exempt still exists', () => {
    // A stale exemption silently excuses a file that was renamed or replaced.
    for (const f of AUTOMATED_LANES) {
      expect(dispatchers, `${f} is listed as an automated lane but no longer dispatches jobs`).toContain(f);
    }
  });

  it('every hand-run dispatcher names its lane', () => {
    const missing = handRun.filter((f) => !WRITES_LANE.test(read(f)));
    expect(missing, 'hand-run dispatchers writing job rows with no initiated_by').toEqual([]);
  });

  it('every hand-run dispatcher offers --reason and writes it', () => {
    const missing = handRun.filter((f) => !WRITES_REASON.test(read(f)));
    expect(
      missing,
      'hand-run dispatchers that do not record initiated_reason — import scripts/lib/initiated-reason.mjs ' +
        'and spread ...initiatedReasonFields(REASON) into the job row',
    ).toEqual([]);
  });
});

describe('parseInitiatedReason', () => {
  it('reads the inline --reason=... form', () => {
    expect(parseInitiatedReason(['--limit=5', '--reason=reader request #123'], 'script:x'))
      .toBe('reader request #123');
  });

  it('reads the space-separated --reason ... form', () => {
    expect(parseInitiatedReason(['--reason', 'bad OCR on plates', '--dry-run'], 'script:x'))
      .toBe('bad OCR on plates');
  });

  it('keeps = signs inside the reason', () => {
    expect(parseInitiatedReason(['--reason=model=flash-lite regression'], 'script:x'))
      .toBe('model=flash-lite regression');
  });

  it('does not swallow the next flag as a reason', () => {
    // `--reason --dry-run` means the operator forgot the value. Recording
    // "--dry-run" as the reason would be worse than recording nothing.
    expect(parseInitiatedReason(['--reason', '--dry-run'], 'script:x')).toBeUndefined();
  });

  it('treats whitespace-only and absent as unrecorded', () => {
    expect(parseInitiatedReason(['--reason=   '], 'script:x')).toBeUndefined();
    expect(parseInitiatedReason(['--limit=5'], 'script:x')).toBeUndefined();
  });

  it('omits the key entirely when there is no reason, so absent stays absent', () => {
    // An empty string would make "queued without a reason" and "queued with a
    // blank reason" the same row, and only one of those is a real state.
    expect(initiatedReasonFields(undefined)).toEqual({});
    expect(initiatedReasonFields('reader request')).toEqual({ initiated_reason: 'reader request' });
  });
});

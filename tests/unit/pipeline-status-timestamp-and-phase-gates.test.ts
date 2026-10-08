import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs, no types
import { PHASE_PAUSE_KEY, isPaused } from '../../scripts/lib/pause.mjs';

/**
 * #5472 — two pipeline wiring bugs.
 *
 * (a) enrich-worker's status writers wrote pipeline_auto.updated_at, while its own
 *     orphan sweep and orchestrator Phase 8.5 select on pipeline_auto.last_updated.
 *     A book just moved to 'summarizing' kept an old last_updated and was rolled back
 *     while still being worked.
 * (b) Orchestrator Phase 1.95 (warehouse promote) was gated by shouldRun(2) and the
 *     artwork skip by shouldRun(1): pausing OCR paused promotion, and the artwork skip
 *     had no switch of its own.
 *
 * Both workers run main() on import, so the functions are extracted from source and
 * EXERCISED (see tests/unit/archive-status-forward-only.test.ts). If an extraction
 * fails, the suite fails rather than passing silently.
 */

const ENRICH = readFileSync(join(process.cwd(), 'scripts/workers/enrich-worker.mjs'), 'utf8');
const ORCH = readFileSync(join(process.cwd(), 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');

function extractFn(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`missing: ${signature}`);
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`unterminated: ${signature}`);
  return src.slice(start, end + 2);
}

/** The timestamp field a sweep's find() filters on, e.g. 'pipeline_auto.last_updated'. */
function sweepField(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`sweep anchor missing: ${anchor}`);
  const m = src.slice(at, at + 1200).match(/'(pipeline_auto\.[a-z_]+)': \{ \$lt:/);
  if (!m) throw new Error(`no $lt timestamp filter after: ${anchor}`);
  return m[1];
}

type SetDoc = Record<string, unknown>;

function loadEnrichWriters() {
  const factory = new Function(`
    const NOT_HELD = {};
    ${extractFn(ENRICH, 'async function setPipelineStatus(')}
    ${extractFn(ENRICH, 'async function markFailed(')}
    return { setPipelineStatus, markFailed };
  `);
  return factory() as {
    setPipelineStatus: (db: unknown, id: string, status: string, extra?: SetDoc) => Promise<void>;
    markFailed: (db: unknown, id: string, reason: string, retries: number) => Promise<void>;
  };
}

function fakeDb(sets: SetDoc[]) {
  return {
    collection: () => ({
      updateOne: async (_filter: unknown, update: { $set: SetDoc }) => {
        sets.push(update.$set);
        return { matchedCount: 1 };
      },
    }),
  };
}

describe('enrich-worker status writes refresh the field the stale sweeps select on (#5472a)', () => {
  const enrichSweep = sweepField(ENRICH, "'pipeline_auto.status': 'summarizing',");
  const phase85Sweep = sweepField(ORCH, '// ── Phase 8.5: Staleness detection ──');

  it('both sweeps select on the same field', () => {
    expect(enrichSweep).toBe(phase85Sweep);
  });

  it('setPipelineStatus writes a fresh value to that field', async () => {
    const sets: SetDoc[] = [];
    const before = Date.now();
    await loadEnrichWriters().setPipelineStatus(fakeDb(sets), 'b1', 'summarizing');
    const v = sets[0][enrichSweep];
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('markFailed writes a fresh value to that field', async () => {
    const sets: SetDoc[] = [];
    const before = Date.now();
    await loadEnrichWriters().markFailed(fakeDb(sets), 'b1', 'boom', 1);
    const v = sets[0][enrichSweep];
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('still writes pipeline_auto.updated_at (read by the health workers)', async () => {
    const sets: SetDoc[] = [];
    await loadEnrichWriters().setPipelineStatus(fakeDb(sets), 'b1', 'chapters');
    expect(sets[0]['pipeline_auto.updated_at']).toBeInstanceOf(Date);
  });
});

describe('orchestrator phases have their own pause switches (#5472b)', () => {
  function loadShouldRun(onlyPhase: number | null, paused: number[]) {
    // shouldRun also asks the phase's step key (#5492); give it the same control doc.
    const factory = new Function('ONLY_PHASE', 'PAUSED_PHASES', 'PHASE_PAUSE_KEY', 'isPaused', 'PAUSE_CONTROL', `
      ${extractFn(ORCH, 'function shouldRun(')}
      return shouldRun;
    `);
    const quietIsPaused = (c: unknown, k: string) => isPaused(c, k, { log: () => {} });
    return factory(onlyPhase, new Set(paused), PHASE_PAUSE_KEY, quietIsPaused, { paused_phases: paused }) as (...args: number[]) => boolean;
  }

  /** The literal shouldRun(...) arguments of the first gate after a phase header. */
  function gateArgs(header: string): number[] {
    const at = ORCH.indexOf(header);
    if (at < 0) throw new Error(`phase header missing: ${header}`);
    const m = ORCH.slice(at, at + 800).match(/if \(shouldRun\(([^)]*)\)\)/);
    if (!m) throw new Error(`no shouldRun gate after: ${header}`);
    return m[1].split(',').map(s => Number(s.trim()));
  }

  const promote = gateArgs('// ── Phase 1.95: Warehouse promotion');
  const artwork = gateArgs('Skip artworks that somehow entered the pipeline');

  it('pausing OCR (2) does not pause warehouse promotion', () => {
    expect(loadShouldRun(null, [2])(...promote)).toBe(true);
    expect(loadShouldRun(null, [1.95])(...promote)).toBe(false);
  });

  it('pausing archive check (1) does not pause the artwork skip, which has its own switch', () => {
    expect(loadShouldRun(null, [1])(...artwork)).toBe(true);
    expect(loadShouldRun(null, [artwork[0]])(...artwork)).toBe(false);
    expect(artwork[0]).not.toBe(1);
    expect(artwork[0]).not.toBe(0); // 0 is enrollment's switch
  });

  it('they still run inside the cron jobs that carry them (--phase 2 / --phase 1)', () => {
    expect(loadShouldRun(2, [])(...promote)).toBe(true);
    expect(loadShouldRun(1, [])(...artwork)).toBe(true);
    expect(loadShouldRun(3, [])(...promote)).toBe(false);
  });

  it('a single-id gate behaves as before', () => {
    expect(loadShouldRun(null, [])(3)).toBe(true);
    expect(loadShouldRun(3, [])(3)).toBe(true);
    expect(loadShouldRun(2, [])(3)).toBe(false);
    expect(loadShouldRun(null, [3])(3)).toBe(false);
  });
});

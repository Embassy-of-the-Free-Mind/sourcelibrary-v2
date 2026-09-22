/**
 * Phase 0 enrolment must not be confined by a spend envelope.
 *
 * INCIDENT (2026-09-20, #4948). Seven books imported that day never received
 * `pipeline_auto` at all. They were not stuck in a phase — no phase ever looked
 * at them. The line was in ENVELOPE MODE (global dial closed, a named scope
 * envelope open), which sets `SCOPED_MODE`, and Phase 0's candidate list was
 * filtered through `applyBookOverride()` like every paid phase. Enrolment writes
 * one Mongo field and dispatches nothing, so the filter bought no spend
 * protection; it just made the new books invisible. A human had to enrol them by
 * hand after noticing the shelf had no text days later.
 *
 * WHY IT DOESN'T SELF-HEAL. The convergence tail in the same block (#3756) is
 * deliberately NOT scope-filtered, but it only selects books OLDER than
 * `cutoff`. A freshly imported book is newer than the cutoff, so neither query
 * can see it: it waits out `ENROLL_WINDOW_DAYS` and then joins the back of an
 * oldest-first queue of thousands. The failure is silent — nothing logs it, the
 * book simply has no status — which is what made it cost days rather than
 * minutes.
 *
 * THE RULE. A scope envelope bounds SPEND. Every paid phase carries its own gate
 * (`budgetAllowsDispatchForPhase` on 1.25, 1.5, 1.6, 2, 3.7, 4, 8), and that is
 * where an envelope belongs. Gating a free phase with a spend control does not
 * save money; it strands work, and the stranding is invisible precisely because
 * the book never enters a state anything counts. A `--book` override is a
 * different thing — an operator naming one book — and must still confine.
 *
 * This asserts on source text because the property is structural: which flag
 * guards which call site. Executing the orchestrator would need Mongo, a live
 * dial and a scope envelope, and would prove less.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const ORCHESTRATOR = path.join(root, 'scripts/workers/pipeline-orchestrator.mjs');

describe('Phase 0 enrolment is outside the spend envelope', () => {
  const src = readFileSync(ORCHESTRATOR, 'utf8');

  /** The Phase 0 block: from its banner to the start of the artwork skip. */
  function phaseZeroBlock(): string {
    const start = src.indexOf("--- Phase 0: Auto-enroll ---");
    expect(start, 'Phase 0 banner not found — did the phase get renamed?').toBeGreaterThan(-1);
    const end = src.indexOf('ARTWORK_TYPES', start);
    expect(end, 'end marker not found after Phase 0').toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it('does not filter enrolment candidates by scope', () => {
    const block = phaseZeroBlock();
    // SCOPE_ACTIVE is true for a --book override OR a scope envelope. Using it
    // here is what stranded the 2026-09-20 imports.
    expect(
      block,
      'Phase 0 gates enrolment on SCOPE_ACTIVE again — a spend envelope would ' +
        'once more hide newly imported books from the pipeline (#4948).'
    ).not.toMatch(/if\s*\(\s*SCOPE_ACTIVE\s*\)/);
    expect(
      block,
      'Phase 0 references SCOPED_MODE — enrolment must not depend on envelope state.'
    ).not.toMatch(/SCOPED_MODE/);
  });

  it('still honours an explicit --book override', () => {
    const block = phaseZeroBlock();
    expect(
      block,
      'Phase 0 no longer honours BOOK_OVERRIDE — `--book=<id>` must still force ' +
        'exactly one book through enrolment.'
    ).toMatch(/if\s*\(\s*BOOK_OVERRIDE\s*\)\s*newBooks\s*=\s*await\s+applyBookOverride/);
  });

  it('keeps every paid phase gated', () => {
    // The counterpart property: this fix must not have loosened a spend gate.
    // Each paid phase still asks the dial before dispatching.
    for (const phase of [
      'Phase 1.5 (preview OCR)',
      'Phase 1.6 (metadata classification)',
      'Phase 2 (OCR submit)',
      'Phase 4 (translation dispatch)',
      'Phase 8 (image extraction)',
    ]) {
      expect(
        src,
        `${phase} lost its budgetAllowsDispatchForPhase gate — paid work must stay behind the dial.`
      ).toContain(`budgetAllowsDispatchForPhase('${phase}')`);
    }
  });
});

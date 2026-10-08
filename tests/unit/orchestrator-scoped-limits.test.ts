import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// A phase that takes `.limit(<literal>)` and only THEN confines the result to the
// selective-unpause / envelope scope (`if (SCOPE_ACTIVE) x = await applyBookOverride(...)`)
// strands every scoped book that is not inside the corpus-wide window. #2713 fixed this for
// SPLIT_LIMIT and Phase 1.97 ("phase-local consts like this one were missed") with the idiom
// `SCOPED_MODE ? 100000 : N`; #4823 found Phase 8.9 still on a bare `.limit(50)`. Measured
// 2026-10-05: 2,784 books at images_complete, and envelope books never left it because the
// global dial is spent daily, so every orchestrator run is in envelope mode.
//
// Negative control: with Phase 8.9 back on `.limit(50)` this test fails on that line.
// Phase 8.5 (staleness recovery) is deliberately unconfined and narrows only under
// `if (BOOK_OVERRIDE)`, so it is not matched.
const repoRoot = path.resolve(__dirname, '..', '..');
const src = readFileSync(path.join(repoRoot, 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');
const lines = src.split('\n');

describe('pipeline-orchestrator: no literal limit ahead of a scope filter (#4823)', () => {
  it('every `if (SCOPE_ACTIVE) … applyBookOverride(` is preceded by a scoped-aware limit', () => {
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      if (!/if \(SCOPE_ACTIVE\)\s*\w+\s*=\s*await applyBookOverride\(/.test(line)) return;
      // The candidate query this filter narrows: walk back to the previous `await db.collection(`.
      for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
        if (/\.limit\(\s*\d+\s*\)/.test(lines[j])) offenders.push(`line ${j + 1}: ${lines[j].trim()}  (filtered at line ${i + 1})`);
        if (/await db\.collection\(/.test(lines[j])) break;
      }
    });
    expect(offenders).toEqual([]);
  });

  it('Phase 8.9 uses the scoped window', () => {
    expect(src).toMatch(/const COVER_LIMIT = SCOPED_MODE \? 100000 : 50;/);
    expect(src).toMatch(/\.limit\(COVER_LIMIT\)/);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Phase 2 sorts by processing_priority (#3756), but it only OCRs books that Phase 1.97
// has deduped, and Phase 1.5 only previews books Phase 1.25 has split-checked. Those two
// gates took `.limit(N)` with no priority sort, so a priority-100 book sat 10 h with 0 OCR
// jobs behind a 2.3K backlog (#5308). Measured 2026-10-10: the unsorted 1.97 window of 50
// held only priority-23 books while 538 priority-27 books waited.
//
// Negative control: drop the `.sort(...)` from either candidate query and its test fails.
const repoRoot = path.resolve(__dirname, '..', '..');
const src = readFileSync(path.join(repoRoot, 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');

function candidateQuery(phaseHeader: string, limitName: string): string {
  const start = src.indexOf(phaseHeader);
  expect(start, `${phaseHeader} not found`).toBeGreaterThan(-1);
  const end = src.indexOf(`.limit(${limitName})`, start);
  expect(end, `.limit(${limitName}) not found after ${phaseHeader}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('pipeline-orchestrator: pre-OCR gates honour processing_priority (#5308)', () => {
  it('Phase 1.97 dedup sorts candidates by processing_priority first', () => {
    expect(candidateQuery('// ── Phase 1.97: Trailing-dupe dedup', 'DEDUP_LIMIT'))
      .toMatch(/\.sort\(\{\s*processing_priority:\s*-1/);
  });

  it('Phase 1.25 split check sorts candidates by processing_priority first', () => {
    expect(candidateQuery('// ── Phase 1.25: Split detection', 'SPLIT_LIMIT'))
      .toMatch(/\.sort\(\{\s*processing_priority:\s*-1/);
  });
});

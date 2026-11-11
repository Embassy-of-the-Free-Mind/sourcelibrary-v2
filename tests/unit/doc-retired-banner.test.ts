/**
 * Docs that teach a retired approach must say so near the top (#8283). The detector lives in
 * scripts/lib/lanes.mjs and is run over docs/skills/commands by scripts/audit/doc-staleness.mjs (advisory).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs
import { retiredPatternsIn, hasRetiredBanner } from '../../scripts/lib/lanes.mjs';

describe('retired-approach banners in docs', () => {
  it('flags a doc that teaches the Gemini Batch API as the method (positive control)', () => {
    expect(retiredPatternsIn('# Batch\n\nRun node scripts/batch-ocr-async.mjs for 50% off the Gemini Batch API.')).toContain('gemini-batch-default');
  });
  it('flags a retired cron shape from RETIRED_PATTERNS (positive control)', () => {
    expect(retiredPatternsIn('run translate-batch-worker.mjs --chained nightly')).toContain('paid-flash-lite');
  });
  it('does not flag a current doc (negative control)', () => {
    expect(retiredPatternsIn('Routes: agy, GPU>agy, Opus, GPU>Opus. See routing.md.')).toEqual([]);
  });
  it('sees a banner in the first 15 lines only', () => {
    expect(hasRetiredBanner('> **SUPERSEDED 2026-11-11** by routing.md\n\nbody')).toBe(true);
    expect(hasRetiredBanner('x\n'.repeat(20) + 'SUPERSEDED')).toBe(false);
    expect(hasRetiredBanner('# Title\n\nno banner')).toBe(false);
  });
});

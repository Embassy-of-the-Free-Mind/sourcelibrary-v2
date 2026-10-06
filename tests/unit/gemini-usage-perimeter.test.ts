/**
 * The Gemini usage perimeter has to be able to FAIL on the two shapes that
 * actually leaked spend (#4599):
 *
 *   - a call site that writes no usage row (115 baselined, new ones fail), and
 *   - a Batch API result COLLECTOR that waives metering instead of closing out the
 *     submit-time row. `scripts/batch/collect-batch-results.mjs` carried
 *     `// usage-ok:` with a comment saying the close-out happened elsewhere; it did
 *     not, and 3,072 usage rows (2026-08-01..10-04) kept their submit estimate and
 *     zero tokens. A waiver cannot be baselined away for a collector.
 *
 * `classifyFile()` is pure, so these drive it with source text, not a tree.
 */
import { describe, it, expect } from 'vitest';
import { classifyFile } from '../../scripts/audit/gemini-usage-perimeter.mjs';

const REST = "await fetch('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')";

describe('gemini-usage-perimeter classifyFile', () => {
  it('flags a raw generateContent call that logs nothing', () => {
    expect(classifyFile('scripts/x.mjs', REST)).toBe('unlogged');
  });

  it('accepts the same call when it logs', () => {
    expect(classifyFile('scripts/x.mjs', `${REST}\nawait logUsage({})`)).toBe('logged');
  });

  it('counts an SDK batch submit as a call site', () => {
    expect(classifyFile('scripts/x.mjs', 'const job = await ai.batches.create({ model })')).toBe('unlogged');
  });

  it('lets a non-collector declare an exemption', () => {
    expect(classifyFile('scripts/x.mjs', `// usage-ok: contributor key\n${REST}`)).toBe('exempt');
  });

  it('refuses a waiver on a batch result collector (the collect-batch-results shape)', () => {
    const src = [
      '// usage-ok: generates nothing; spend is closed out by completeBatchUsage() elsewhere',
      "const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';",
      'const fileName = geminiData.metadata.output.responsesFile;',
      "await db.collection('pages').bulkWrite(ops);",
    ].join('\n');
    expect(classifyFile('scripts/batch/collect.mjs', src)).toBe('collector-waived');
  });

  it('lets a library that only returns batch results declare an exemption', () => {
    const src = [
      '// usage-ok: returns results; the calling route closes out the row',
      "const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';",
      'if (jobData.metadata?.output?.responsesFile) return download();',
    ].join('\n');
    expect(classifyFile('src/lib/gemini-batch.ts', src)).toBe('exempt');
  });

  it('accepts a collector that closes out the row', () => {
    const src = [
      "const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';",
      'const fileName = geminiData.metadata.output.responsesFile;',
      'await completeBatchUsage({ batch_job_id })',
    ].join('\n');
    expect(classifyFile('scripts/batch/collect.mjs', src)).toBe('logged');
  });

  it('still fails a src/ SDK construction outside the chokepoint', () => {
    expect(classifyFile('src/lib/x.ts', 'new GoogleGenerativeAI(key)')).toBe('hard');
  });
});

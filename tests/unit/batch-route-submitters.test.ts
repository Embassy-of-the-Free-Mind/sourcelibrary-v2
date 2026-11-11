import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertBatchRouteModel, LITE_MODEL } from '../../scripts/lib/ocr-lite-gate.mjs';

/**
 * The submit scripts POST to the batch routes instead of calling Gemini, so the #7075 sweep (which looks for API
 * callers) never saw them. On 2026-11-06 they put 1,879 pages on gemini-3-flash-preview. Every script that fetches
 * a batch route must name its model through assertBatchRouteModel and say who it is through batchRouteCallerHeaders.
 */
const ROOT = path.resolve(__dirname, '../..');
const ROUTE = /batch-(ocr|translate)-async/;

function submitters(): string[] {
  return execFileSync('git', ['ls-files', 'scripts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter((f) => /\.(m?js|ts|sh)$/.test(f) && !f.startsWith('scripts/_archived/'))
    .filter((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      return src.split('\n').some((l) => !/^\s*(#|\/\/|\*)/.test(l) && ROUTE.test(l) && /(fetch\(|curl\b|const url\b)/.test(l));
    });
}

describe('scripts that submit to the batch routes', () => {
  it('finds the known submitters (positive control)', () => {
    expect(submitters()).toEqual(expect.arrayContaining(['scripts/batch/submit-batch-ocr.mjs', 'scripts/batch/submit-translations.mjs']));
  });
  for (const f of submitters()) {
    it(`${f} names its model and itself`, () => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src).toContain('assertBatchRouteModel(');
      expect(src).toContain('batchRouteCallerHeaders(');
      expect(src).not.toMatch(/model:\s*'gemini-3-flash-preview'/);
    });
  }
  it('the helper refuses Flash and a missing model, and passes Flash-Lite', () => {
    expect(() => assertBatchRouteModel('gemini-3-flash-preview', 't')).toThrow(/refusing/);
    expect(() => assertBatchRouteModel(undefined, 't')).toThrow(/no model/);
    expect(assertBatchRouteModel(LITE_MODEL, 't')).toBe(LITE_MODEL);
  });
});

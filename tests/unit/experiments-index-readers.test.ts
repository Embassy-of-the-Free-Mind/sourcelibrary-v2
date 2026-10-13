/**
 * The canon pages read experiments through the #5939 index. These pin the rule that
 * decides the "what each measured change did" chart: a superseded write-up drops its
 * row, in-use follows the write-up's status unless the row names another decision, and
 * every cited write-up is in the committed index (else the build would throw).
 */
import { describe, it, expect } from 'vitest';
import { improvementsFrom, IMPROVEMENTS, type Measured } from '@/app/research/canon-gap/improvements';
import type { ExperimentRecord } from '@/lib/experiments-index';

const rec = (file: string, status: ExperimentRecord['status']): ExperimentRecord => ({
  file, date: '2026-10-01', question: 'Q', href: `https://x/${file}`, stage: 'ocr', measure: ['accuracy'], languages: [], scripts: [],
  canons: [], n_books: 1, n_pages: 1, verdict: 'v', status, decision: null, superseded_by: null, issues: [],
});
const row = (file: string, extra: Partial<Measured> = {}): Measured => ({
  change: file, measure: 'm', before: 10, after: 5, lowerBetter: true, basis: 'b', file, inUseNote: 'in use', testedNote: 'tested', ...extra,
});

describe('improvementsFrom', () => {
  const index: Record<string, ExperimentRecord> = {
    'a.md': rec('a.md', 'adopted'), 'r.md': rec('r.md', 'rejected'), 's.md': rec('s.md', 'superseded'),
  };
  const out = improvementsFrom([row('a.md'), row('r.md'), row('s.md'), row('r.md', { change: 'via', inUseVia: { inUse: true, why: 'x' } })], (f) => index[f]);

  it('drops a superseded write-up, keeps the rest in order', () => {
    expect(out.map((r) => r.change)).toEqual(['a.md', 'r.md', 'via']);
  });
  it('in use follows the status, unless the row names the adopting decision', () => {
    expect(out.map((r) => [r.inUse, r.status])).toEqual([[true, 'in use'], [false, 'tested'], [true, 'in use']]);
  });
  it('links the source from the index', () => {
    expect(out[0].source).toBe('https://x/a.md');
  });
  it('the real chart resolves every row against the committed index', () => {
    expect(IMPROVEMENTS.length).toBeGreaterThan(0);
    expect(IMPROVEMENTS.every((r) => r.source.includes('/scripts/eval/experiments/'))).toBe(true);
  });
});

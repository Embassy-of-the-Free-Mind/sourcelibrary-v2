/**
 * The weekly experiment-log garden (#5939). Each finding kind gets a positive case and
 * the near miss that must NOT fire — a detector that files an issue every week for
 * nothing teaches everyone to ignore it.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain ESM script, no types
import { garden } from '../../scripts/audit/experiments-garden.mjs';

type E = { file: string; date: string; status: string | null; issues: number[]; canons: string[]; stage: string | null; measure: string[]; superseded_by?: string | null; decision?: string | null };
const e = (file: string, status: string | null, extra: Partial<E> = {}): E => ({
  file, date: file.slice(0, 10), status, issues: [1], canons: [], stage: 'ocr', measure: ['accuracy'], superseded_by: null, decision: null, ...extra,
});
const run = (entries: E[], more = {}) => garden({ entries, today: '2026-10-30', noteAsOf: '2026-10-20', ...more });

describe('experiments-garden', () => {
  it('lists an entry with no header', () => {
    expect(run([e('2026-10-01-a.md', null)])['no-header']).toEqual(['2026-10-01-a.md: no header']);
  });

  it('undecided past 21 days with nothing newer on its issue fires; a newer entry on the issue, or a young one, does not', () => {
    expect(run([e('2026-10-01-a.md', 'undecided')]).stale).toHaveLength(1);
    expect(run([e('2026-10-01-a.md', 'undecided'), e('2026-10-05-b.md', 'informational')]).stale).toEqual([]);
    expect(run([e('2026-10-20-a.md', 'undecided')]).stale).toEqual([]);
    expect(run([e('2026-10-01-a.md', 'undecided'), e('2026-10-05-b.md', 'informational', { issues: [2] })]).stale).toHaveLength(1);
  });

  it('a page citing a superseded entry fires; citing a live one does not', () => {
    const entries = [e('2026-10-01-old.md', 'superseded', { superseded_by: '2026-10-02-new.md' }), e('2026-10-02-new.md', 'adopted')];
    const f = run(entries, { citations: [{ file: '2026-10-01-old.md', where: 'src/x.tsx:3' }, { file: '2026-10-02-new.md', where: 'src/y.tsx:4' }] });
    expect(f.cited).toEqual(['src/x.tsx:3 cites 2026-10-01-old.md, superseded by 2026-10-02-new.md']);
  });

  it('adopted vs rejected on the same canon, stage and measure fires; a different measure or a superseded one does not', () => {
    const a = e('2026-10-01-a.md', 'adopted', { canons: ['pali'] });
    expect(run([a, e('2026-10-02-b.md', 'rejected', { canons: ['pali'] })]).conflict).toHaveLength(1);
    expect(run([a, e('2026-10-02-b.md', 'rejected', { canons: ['pali'], measure: ['judged'] })]).conflict).toEqual([]);
    expect(run([a, e('2026-10-02-b.md', 'superseded', { canons: ['pali'] })]).conflict).toEqual([]);
  });

  it('the monthly note: missing or older than 35 days fires, recent does not', () => {
    expect(run([], { noteAsOf: null }).note).toHaveLength(1);
    expect(run([], { noteAsOf: '2026-09-01' }).note).toHaveLength(1);
    expect(run([], { noteAsOf: '2026-10-20' }).note).toEqual([]);
  });
});

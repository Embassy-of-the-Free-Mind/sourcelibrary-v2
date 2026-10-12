import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module, no types
import { planLinks, MANIFEST } from '../../scripts/maintenance/link-verified-work-witnesses.mjs';

const row = {
  id: 'b1', issue: 4392, to: 'Q1',
  from: 'local:n:x:apvd', title: /expeditione ap[uv]d sinas/i, evidence: 'title page',
};
const plan = (book: { work_id?: string; title?: string } | null, size = 2) =>
  planLinks([row], new Map(book ? [['b1', book]] : []), new Map([['Q1', size]]));

describe('planLinks (#4392)', () => {
  it('links a book still on the verified old id', () => {
    const { writes, skipped } = plan({ work_id: 'local:n:x:apvd', title: 'De Christiana Expeditione Apvd Sinas' });
    expect(writes).toEqual([row]);
    expect(skipped).toEqual([]);
  });

  it('never overwrites a work_id that moved since verification', () => {
    const { writes, skipped } = plan({ work_id: 'local:a:other:thing', title: 'De Christiana Expeditione Apvd Sinas' });
    expect(writes).toEqual([]);
    expect(skipped[0].reason).toMatch(/moved since verification/);
  });

  it('is a no-op on a book already linked', () => {
    expect(plan({ work_id: 'Q1', title: 'De Christiana Expeditione apud Sinas' }).skipped[0].reason).toBe('already linked');
  });

  it('skips when the title is no longer the verified one', () => {
    expect(plan({ work_id: 'local:n:x:apvd', title: 'Portae Lucis' }).writes).toEqual([]);
  });

  it('refuses a target cluster that holds no books (that would be minting)', () => {
    expect(plan({ work_id: 'local:n:x:apvd', title: 'De Christiana Expeditione Apvd Sinas' }, 0).writes).toEqual([]);
  });

  it('skips a missing book', () => {
    expect(plan(null).skipped[0].reason).toBe('book not found');
  });

  it('manifest rows are pinned: one book each, an old id, a target, and evidence', () => {
    expect(new Set(MANIFEST.map((r: { id: string }) => r.id)).size).toBe(MANIFEST.length);
    for (const r of MANIFEST) {
      expect(r.from && r.to && r.from !== r.to).toBeTruthy();
      expect(r.evidence.length).toBeGreaterThan(20);
    }
  });
});

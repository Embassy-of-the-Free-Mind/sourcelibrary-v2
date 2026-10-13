/**
 * A translate job whose pages are all health-blocked must not report success (#5108).
 *
 * Arrian 1533 (2026-09-25): Phase 4 created a job for exactly pages 19 and 98, both stamped
 * `translation.health_blocked: collapsed`; the worker skipped both and wrote
 * `completed, {total: 2, completed: 0, failed: 0}`. The skip is now a third counter and such a
 * job ends `blocked`, naming the pages.
 */
import { describe, it, expect } from 'vitest';
import { translateJobOutcome, blockedJobFields, nameBlockedPages, healthBlockedResidue, HEALTH_BLOCKED_RESIDUE } from '../../scripts/lib/translate-job-outcome.mjs';

describe('translateJobOutcome', () => {
  it('a job of only health-blocked pages ends blocked, not completed (the Arrian job)', () => {
    expect(translateJobOutcome({ total: 2, completed: 0, failed: 0, skipped: 2 })).toEqual({ isComplete: true, status: 'blocked' });
  });
  it('skips count towards completion, so a job with refusals is not parked as partial forever', () => {
    expect(translateJobOutcome({ total: 10, completed: 8, failed: 0, skipped: 2 })).toEqual({ isComplete: true, status: 'completed' });
    expect(translateJobOutcome({ total: 10, completed: 8, failed: 0, skipped: 0 })).toEqual({ isComplete: false, status: 'processing' });
  });
  it('failures still win over skips', () => {
    expect(translateJobOutcome({ total: 3, completed: 0, failed: 1, skipped: 2 }).status).toBe('completed_with_errors');
  });
  it('an ordinary job is unchanged', () => {
    expect(translateJobOutcome({ total: 5, completed: 5 }).status).toBe('completed');
  });
});

describe('blockedJobFields / nameBlockedPages', () => {
  const blocked = [{ id: 'a', page_number: 19, reason: 'collapsed' }, { id: 'b', page_number: 98, reason: 'collapsed' }];
  it('records the count and names the pages on the job', () => {
    const f = blockedJobFields(blocked);
    expect(f['progress.skipped_health_blocked']).toBe(2);
    expect(f.health_blocked_pages).toEqual([{ page_number: 19, reason: 'collapsed' }, { page_number: 98, reason: 'collapsed' }]);
    expect(f.note).toContain('p19 (collapsed), p98 (collapsed)');
  });
  it('writes an explicit zero when nothing was skipped', () => {
    expect(blockedJobFields([])).toEqual({ 'progress.skipped_health_blocked': 0 });
  });
  it('caps a long list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), page_number: i + 1, reason: 'echo' }));
    expect(nameBlockedPages(many)).toMatch(/…and 5 more$/);
  });
});

describe('healthBlockedResidue scope', () => {
  function fakeDb() {
    const seen: Record<string, unknown>[] = [];
    const db = { collection: () => ({ find: (q: Record<string, unknown>) => { seen.push(q); return { sort: () => ({ toArray: async () => [{ id: 'p', page_number: 19, translation: { health_blocked: 'collapsed' } }] }) }; } }) };
    return { db, seen };
  }
  it("is the job's page_ids when it names them", async () => {
    const { db, seen } = fakeDb();
    const r = await healthBlockedResidue(db, { bookId: 'B', pageIds: ['p', 'q'] });
    expect(seen[0]).toMatchObject({ id: { $in: ['p', 'q'] }, ...HEALTH_BLOCKED_RESIDUE });
    expect(seen[0]).not.toHaveProperty('book_id');
    expect(r).toEqual([{ id: 'p', page_number: 19, reason: 'collapsed' }]);
  });
  it('is the whole book otherwise', async () => {
    const { db, seen } = fakeDb();
    await healthBlockedResidue(db, { bookId: 'B' });
    expect(seen[0]).toMatchObject({ book_id: 'B', page_number: { $gt: 0 } });
  });
});

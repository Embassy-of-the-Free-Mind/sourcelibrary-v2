/**
 * The write-time seam guard and the lean runner's "every join" sample (#6742, job seam-prevent).
 *  - The guard is OFF unless SEAM_GUARD is 'dry' or 'apply', never checks its own writes, and never throws into the
 *    translation write it follows (a database that fails mid-check yields a tally with `error`, not an exception).
 *  - translate-core calls it only after the page update, inside the SEAM_GUARD branch.
 *  - joinsToCheck: the join before and after the written page, only with an eligible, non-stale neighbour that was
 *    already there at the write (a replay hides neighbours written later).
 *  - perBookSample is seeded by the book's rank.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { guardMode, runSeamGuard, seamGuardAfterWrite, joinsToCheck } from '../../scripts/maintenance/seam-repair-6742/guard.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { perBookSample } from '../../scripts/maintenance/seam-repair-6742/lean.mjs';

const REPO = path.resolve(__dirname, '../..');
const page = (n: number, extra: Record<string, unknown> = {}) => ({ id: `p${n}`, book_id: 'b', page_number: n, ocr: { data: 'Lorem ipsum dolor' },
  translation: { data: 'Some English text.', source: 'ai', model: 'gemini-3.8-flash-low', updated_at: new Date('2026-10-16T01:00:00Z') }, ...extra });

describe('guardMode / runSeamGuard', () => {
  const saved = process.env.SEAM_GUARD;
  afterEach(() => { if (saved === undefined) delete process.env.SEAM_GUARD; else process.env.SEAM_GUARD = saved; });

  it('is off unless SEAM_GUARD is dry or apply', () => {
    expect(guardMode({})).toBeNull();
    expect(guardMode({ SEAM_GUARD: '1' })).toBeNull();
    expect(guardMode({ SEAM_GUARD: 'true' })).toBeNull();
    expect(guardMode({ SEAM_GUARD: 'dry' })).toBe('dry');
    expect(guardMode({ SEAM_GUARD: 'apply' })).toBe('apply');
  });

  it('does nothing when off, and never for its own writes', async () => {
    const db = { collection: () => { throw new Error('the guard must not touch the database'); } };
    delete process.env.SEAM_GUARD;
    expect(await runSeamGuard(db, { page: page(5), note: 'retranslate_stale' })).toBeNull();
    process.env.SEAM_GUARD = 'apply';
    expect(await runSeamGuard(db, { page: page(5), note: 'seam-repair-6742' })).toBeNull();
    expect(await runSeamGuard(db, { page: page(5), jobId: 'seam-repair-6742-20261016' })).toBeNull();
  });

  it('fails open: a database error comes back as a tally, not an exception', async () => {
    const db = { collection: () => { throw new Error('connection reset'); } };
    const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'seam-guard-test-'));
    const t = await seamGuardAfterWrite(db, { page: page(5), mode: 'dry', out });
    expect(t.error).toMatch(/connection reset/);
    expect(t.accepted).toBe(0);
    fs.rmSync(out, { recursive: true, force: true });
  });
});

describe('translate-core hook', () => {
  it('calls the guard only after the page update, inside the SEAM_GUARD branch', () => {
    const src = fs.readFileSync(path.join(REPO, 'scripts/lib/translate-core.mjs'), 'utf8');
    const door = src.slice(src.indexOf('export async function writePageTranslation'));
    const body = door.slice(0, door.indexOf('\n}\n'));
    const update = body.indexOf('$unset: CLEAR_STALE_UNSET'), branch = body.indexOf('if (process.env.SEAM_GUARD)'), call = body.indexOf('runSeamGuard(');
    expect(update).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(update);
    expect(call).toBeGreaterThan(branch);
    expect(src).not.toMatch(/^import[^\n]*seam-repair-6742/m);   // loaded only when on
  });
});

describe('joinsToCheck', () => {
  it('checks the join before and after a written page', () => {
    const js = joinsToCheck([page(4), page(5), page(6)], 5);
    expect(js.map(([a, b]: { page_number: number }[]) => `${a.page_number}-${b.page_number}`)).toEqual(['4-5', '5-6']);
  });

  it('skips a stale, human-edited or missing neighbour', () => {
    const js = joinsToCheck([page(4, { translation_stale: { reason: 'ocr-newer' } }), page(5), page(6, { translation: { data: 'x', source: 'manual' } })], 5);
    expect(js).toEqual([]);
    expect(joinsToCheck([page(5)], 5)).toEqual([]);
  });

  it('in a replay, skips a neighbour written after the page', () => {
    const later = page(6, { translation: { data: 'Later English.', source: 'ai', updated_at: new Date('2026-10-16T02:00:00Z') } });
    const js = joinsToCheck([page(4), page(5), later], 5, new Date('2026-10-16T01:30:00Z'));
    expect(js.map(([a, b]: { page_number: number }[]) => `${a.page_number}-${b.page_number}`)).toEqual(['4-5']);
  });
});

describe('perBookSample', () => {
  it('is seeded by rank and capped', () => {
    const ps = Array.from({ length: 100 }, (_, i) => i + 1);
    const a = perBookSample(ps, 25, 3), b = perBookSample(ps, 25, 3), c = perBookSample(ps, 25, 4);
    expect(a.size).toBe(25);
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
    expect(perBookSample([1, 2], 25, 1).size).toBe(2);
  });
});

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
import { guardMode, runSeamGuard, seamGuardAfterWrite, joinsToCheck, claudeGate, claudeCountToday, guardReport } from '../../scripts/maintenance/seam-repair-6742/guard.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { seamGuardOn } from '../../scripts/lib/translate-core.mjs';
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
    const none = '/nonexistent/seam-guard';   // not the box file: a box running the guard has one
    expect(guardMode({}, none)).toBeNull();
    expect(guardMode({ SEAM_GUARD: '1' }, none)).toBeNull();
    expect(guardMode({ SEAM_GUARD: 'true' }, none)).toBeNull();
    expect(guardMode({ SEAM_GUARD: 'dry' }, none)).toBe('dry');
    expect(guardMode({ SEAM_GUARD: 'apply' }, none)).toBe('apply');
  });

  it('does nothing when off, and never for its own writes', async () => {
    const db = { collection: () => { throw new Error('the guard must not touch the database'); } };
    process.env.SEAM_GUARD = 'off';   // off whatever the box file says
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
    const update = body.indexOf('$unset: CLEAR_STALE_UNSET'), branch = body.indexOf('if (seamGuardOn())'), call = body.indexOf('runSeamGuard(');
    expect(update).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(update);
    expect(call).toBeGreaterThan(branch);
    expect(src).not.toMatch(/^import[^\n]*seam-repair-6742/m);   // loaded only when on
  });
});

describe('the box-wide switch (#7118)', () => {
  const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'seam-guard-mode-'));
  it('reads the box file when SEAM_GUARD is unset; the env wins, and `off` turns it off', () => {
    const d = tmp(), f = path.join(d, 'seam-guard');
    expect(guardMode({}, f)).toBeNull();
    expect(seamGuardOn({}, f)).toBe(false);
    fs.writeFileSync(f, 'dry\n');
    expect(guardMode({}, f)).toBe('dry');
    expect(seamGuardOn({}, f)).toBe(true);
    expect(guardMode({ SEAM_GUARD: 'apply' }, f)).toBe('apply');
    expect(guardMode({ SEAM_GUARD: 'off' }, f)).toBeNull();
    expect(seamGuardOn({ SEAM_GUARD: 'off' }, f)).toBe(false);
    fs.writeFileSync(f, 'yes');
    expect(guardMode({}, f)).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('translate-worker calls the guard after its own writes, inside the switch', () => {
    const src = fs.readFileSync(path.join(REPO, 'scripts/workers/translate-worker.mjs'), 'utf8');
    const helper = src.slice(src.indexOf('async function seamGuardPages'));
    expect(helper.indexOf('if (!seamGuardOn()) return;')).toBeGreaterThan(0);
    expect(helper.indexOf('if (!seamGuardOn()) return;')).toBeLessThan(helper.indexOf('runSeamGuard('));
    const single = src.slice(src.indexOf('async function writePageTranslation'), src.indexOf('async function seamGuardPages'));
    expect(single.indexOf('seamGuardPages(db, [page], book)')).toBeGreaterThan(single.indexOf("updateOne({ id: page.id }, { $set: setPayload"));
    const bulk = src.slice(src.indexOf('async function bulkWritePageTranslations'));
    expect(bulk.indexOf('seamGuardPages(db, entries')).toBeGreaterThan(bulk.indexOf("bulkWrite(chunk"));
    expect(src).not.toMatch(/^import[^\n]*seam-repair-6742/m);
  });
});

describe('claudeGate', () => {
  const usage = (weekly: number) => ({ email: 'x', weekly, session: 1, checked_at: '' });
  it('refuses past the daily cap, with the meter unknown, and at the weekly ceiling', () => {
    expect(claudeGate({ count: 1500, cap: 1500, usage: usage(10), maxWeekly: 50 })).toBe('claude-daily-cap:1500');
    expect(claudeGate({ count: 0, cap: 1500, usage: null, maxWeekly: 50 })).toBe('claude-usage-unknown');
    expect(claudeGate({ count: 0, cap: 1500, usage: usage(50), maxWeekly: 50 })).toBe('claude-weekly:50%>=50%');
    expect(claudeGate({ count: 1499, cap: 1500, usage: usage(49), maxWeekly: 50 })).toBeNull();
  });
});

describe('the Sonnet fallback (#7118)', () => {
  const LAT = 'Cum autem natura rerum omnium sit admirabilis, tamen in hac parte maxime elucet, quod ea quae inter se contraria videntur ad unum finem conspirant. ';
  const EN = 'Since the nature of all things is wonderful, it shines most of all in this part, that the things which seem contrary to one another conspire to a single end. ';
  const pg = (n: number) => ({ id: `p${n}`, book_id: 'b', page_number: n, page_type: 'content', ocr: { data: LAT.repeat(4) + `Pagina ${n}.` },
    translation: { data: EN.repeat(4) + `Page ${n}.`, source: 'ai', model: 'gemini-3.1-flash-lite', updated_at: new Date('2026-10-16T01:00:00Z') } });
  const db = () => ({ collection: (name: string) => name === 'books'
    ? { findOne: async () => ({ id: 'b', language: 'Latin', pipeline_auto: {} }) }
    : { find: () => ({ toArray: async () => [pg(4), pg(5), pg(6)] }), findOne: async () => null } });
  const gemini = () => { throw new Error('agy must not be called while locked'); };
  const okUsage = () => ({ email: 'x', weekly: 20, session: 5, checked_at: '' });
  let out = '';
  afterEach(() => { if (out) fs.rmSync(out, { recursive: true, force: true }); out = ''; });

  it('sends a join agy cannot take to Sonnet, logs the proposal with its windows, writes nothing in dry mode', async () => {
    out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'seam-guard-fb-'));
    const asked: string[] = [];
    const sonnetFn = async (it: { id: string; p: number }) => { asked.push(it.id);
      const x = it.p === 4 ? { label: 'ok', severity: 'none', repair: null } : { label: 'duplication', labels: ['duplication'], severity: 'minor', repair: { tail_old: 'not in the window', tail_new: '' } };
      return { byId: new Map([[it.id, x]]), r: { secs: 1, cls: null, usage: { input: 1, output: 1, cache_read: 0, list_cost_usd: 0.01 } } }; };
    const t = await seamGuardAfterWrite(db(), { page: pg(5), mode: 'dry', out, env: {}, usageFn: okUsage, sonnetFn, geminiFn: gemini, agyOpenFn: () => false });
    expect(t.error).toBeUndefined();
    expect(asked).toHaveLength(2);
    expect(t.arms).toEqual({ sonnet: 2 });
    expect(t.claudeCalls).toBe(2);
    expect(t.labelledOk).toBe(1);
    expect(t.accepted).toBe(0);
    expect(Object.keys(t.refused)).toHaveLength(1);
    expect(claudeCountToday(out)).toBe(2);
    const props = fs.readFileSync(path.join(out, 'proposals.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(props).toHaveLength(1);
    expect(props[0].it.enTailA).toBeTruthy();
    expect(props[0].arm).toBe('sonnet');
    // the same two texts are not checked twice in one process
    const again = await seamGuardAfterWrite(db(), { page: pg(5), mode: 'dry', out, env: {}, usageFn: okUsage, sonnetFn, geminiFn: gemini, agyOpenFn: () => false });
    expect(again.joins).toBe(0);
    expect(again.alreadyChecked).toBe(2);
    expect(asked).toHaveLength(2);
    const rep = guardReport({ out });
    expect(rep.joinsChecked).toBe(2);
    expect(rep.arms).toEqual({ sonnet: 2 });
    expect(rep.writesSeen).toBe(2);
  });

  it('records a skip past the daily cap and never calls Sonnet', async () => {
    out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'seam-guard-cap-'));
    const sonnetFn = async () => { throw new Error('over the cap'); };
    const page = { ...pg(5), id: 'p5-cap' };
    const rows = [pg(4), { ...page, translation: { ...page.translation, data: page.translation.data + ' Cap.' } }, pg(6)];
    const d = { collection: (name: string) => name === 'books' ? { findOne: async () => ({ id: 'b', language: 'Latin', pipeline_auto: {} }) } : { find: () => ({ toArray: async () => rows }) } };
    const t = await seamGuardAfterWrite(d, { page: rows[1], mode: 'dry', out, env: { SEAM_GUARD_CLAUDE_DAILY: '0' }, usageFn: okUsage, sonnetFn, geminiFn: gemini, agyOpenFn: () => false });
    expect(t.error).toBeUndefined();
    expect(t.skipped).toBe('agy-locked+claude-daily-cap:0');
    expect(t.claudeCalls).toBeUndefined();
  });

  it('does not check a join with an Opus-translated page', async () => {
    out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'seam-guard-opus-'));
    const opus = (n: number) => { const p = pg(n); return { ...p, id: `o${n}`, translation: { ...p.translation, model: 'claude-opus-5-5', data: p.translation.data + ' Opus.' } }; };
    const rows = [pg(4), opus(5), pg(6)];
    const d = { collection: (name: string) => name === 'books' ? { findOne: async () => ({ id: 'b', language: 'Latin', pipeline_auto: {} }) } : { find: () => ({ toArray: async () => rows }) } };
    const t = await seamGuardAfterWrite(d, { page: rows[1], mode: 'dry', out, env: {}, usageFn: okUsage, sonnetFn: gemini, geminiFn: gemini, agyOpenFn: () => false });
    expect(t.error).toBeUndefined();
    expect(t.joins).toBe(0);
    expect(t.opusTranslation).toBe(2);
    expect(guardReport({ out }).joinSkips).toEqual({ 'opus-translation': 2 });
  });

  it('treats a spent Claude account as a skip, not a check', async () => {
    out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'seam-guard-ul-'));
    const page = { ...pg(5), id: 'p5-ul' };
    const rows = [pg(4), { ...page, translation: { ...page.translation, data: page.translation.data + ' Spent.' } }, pg(6)];
    const d = { collection: (name: string) => name === 'books' ? { findOne: async () => ({ id: 'b', language: 'Latin', pipeline_auto: {} }) } : { find: () => ({ toArray: async () => rows }) } };
    const sonnetFn = async () => ({ byId: new Map(), r: { cls: 'usage_limit', secs: 0 } });
    const t = await seamGuardAfterWrite(d, { page: rows[1], mode: 'dry', out, env: {}, usageFn: okUsage, sonnetFn, geminiFn: gemini, agyOpenFn: () => false });
    expect(t.skipped).toBe('agy-locked+claude-usage-limit');
    expect(t.refused).toEqual({});
    expect(guardReport({ out }).joinsChecked).toBe(0);
  });

  it('records a held book as a write seen, and checks nothing', async () => {
    out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'seam-guard-held-'));
    const d = { collection: (name: string) => name === 'books' ? { findOne: async () => ({ id: 'b', language: 'Latin', pipeline_auto: { hold: { reason: 'x' } } }) } : { find: () => { throw new Error('no page read for a held book'); } } };
    const t = await seamGuardAfterWrite(d, { page: pg(5), mode: 'dry', out, env: {}, usageFn: okUsage, sonnetFn: gemini, geminiFn: gemini, agyOpenFn: () => false });
    expect(t.skipped).toBe('book-held-or-missing');
    expect(t.error).toBeUndefined();
    expect(guardReport({ out }).writeSkips).toEqual({ 'book-held-or-missing': 1 });
  });

  it('falls to Sonnet when agy answers with a quota reply mid-check', async () => {
    out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'seam-guard-q-'));
    let g = 0, s = 0;
    const geminiFn = async () => { g++; return { byId: new Map(), r: { cls: 'quota', calls: 1, secs: 1 } }; };
    const sonnetFn = async (it: { id: string }) => { s++; return { byId: new Map([[it.id, { label: 'ok' }]]), r: { secs: 1, cls: null } }; };
    const page = { ...pg(5), id: 'p5-q' };
    const rows = [pg(4), { ...page, translation: { ...page.translation, data: page.translation.data + ' Quota.' } }, pg(6)];
    const d = { collection: (name: string) => name === 'books' ? { findOne: async () => ({ id: 'b', language: 'Latin', pipeline_auto: {} }) } : { find: () => ({ toArray: async () => rows }) } };
    const t = await seamGuardAfterWrite(d, { page: rows[1], mode: 'dry', out, env: {}, usageFn: okUsage, sonnetFn, geminiFn, agyOpenFn: () => true });
    expect(g).toBe(1);
    expect(s).toBe(2);
    expect(t.arms).toEqual({ sonnet: 2 });
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

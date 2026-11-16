/**
 * scripts/lib/agy-pools.mjs weeklyReserve — drain by reset (#7911): a lane spends a pool down to the declared reserve of
 * the lanes that must not starve, 0 in the last 36 h before the pool's weekly reset. The 5-hour floor that does the
 * pacing is quotaFloor's (tests/unit/cli-ocr-lane.test.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  weeklyReserve, LANE_RESERVES, RESERVE_DROP_HOURS, quotaError, noteAuthLoss, AUTH_PAGE_EVERY_MS,
  FINISH_RESERVE, FINISH_QUEUE_MAX_AGE_H, FINISH_QUEUE_PULL_EVERY_MS, FINISH_QUEUE_COLLECTION,
  writeFinishQueue, shareFinishQueue, pullFinishQueue, finishQueueOpen, finishQueueNote, forgetSharedFinishQueue,
} from '../../scripts/lib/agy-pools.mjs';
import { quotaFloor } from '../../scripts/batch/cli-ocr-lane.mjs';

const H = 3600e3;
const reset = '2026-11-05T22:00:00Z';
const at = (hoursBefore: number) => Date.parse(reset) - hoursBefore * H;
const total = Object.values(LANE_RESERVES).reduce((s, v) => s + v, 0);

describe('weeklyReserve (#7911)', () => {
  it('is the sum of the declared lane reserves for a lane with none of its own', () => {
    expect(weeklyReserve({ resetTime: reset, now: at(100) })).toBeCloseTo(total, 9);
    expect(weeklyReserve({ resetTime: reset, now: at(100), lane: 'cli-ocr' })).toBeCloseTo(total, 9);
  });
  it('leaves out the caller\'s own reserve', () => {
    for (const [lane, v] of Object.entries(LANE_RESERVES)) expect(weeklyReserve({ resetTime: reset, now: at(100), lane })).toBeCloseTo(total - v, 9);
  });
  it('does not depend on how much of the week is left, until the last 36 h', () => {
    expect(weeklyReserve({ resetTime: reset, now: at(160) })).toBe(weeklyReserve({ resetTime: reset, now: at(37) }));
  });
  it('drops to 0 in the last 36 h before the reset', () => {
    expect(RESERVE_DROP_HOURS).toBe(36);
    expect(weeklyReserve({ resetTime: reset, now: at(36) })).toBe(0);
    expect(weeklyReserve({ resetTime: reset, now: at(1) })).toBe(0);
    expect(weeklyReserve({ resetTime: reset, now: at(36.01) })).toBeGreaterThan(0);
  });
  it('keeps the reserve when the reset is unreadable', () => {
    expect(weeklyReserve({ resetTime: null, now: at(1) })).toBeCloseTo(total, 9);
    expect(weeklyReserve({ resetTime: 'soon', now: at(1) })).toBeCloseTo(total, 9);
  });
  it('takes another table', () => {
    expect(weeklyReserve({ resetTime: reset, now: at(100), reserves: { a: 0.2, b: 0.1 }, lane: 'b' })).toBeCloseTo(0.2, 9);
  });
  it('stays small: a reserve that holds most of a pool is the pace line again', () => {
    expect(total).toBeLessThan(0.25);
  });
});

describe('quotaFloor on the reserve (#7911)', () => {
  const b = (weekly: number, fiveH = 0.9) => [{ id: 'gemini-weekly', remaining_fraction: weekly, reset_time: reset }, { id: 'gemini-5h', remaining_fraction: fiveH }];
  it('the 2026-11-01 idle: main 68.6% vs a 71.1% line, james 26.1% vs 28.6% now run', () => {
    expect(quotaFloor(b(0.686), { now: at(0.711 * 168) }).ok).toBe(true);
    expect(quotaFloor(b(0.261), { now: at(0.286 * 168) }).ok).toBe(true);
  });
  it('the 5-hour floor still binds above the reserve and in the last 36 h', () => {
    expect(quotaFloor(b(0.9, 0.2), { now: at(100) }).ok).toBe(false);
    expect(quotaFloor(b(0.9, 0.2), { now: at(10) }).ok).toBe(false);
    expect(quotaFloor(b(0.9, 0.2), { now: at(10), floor5h: 0.1 }).ok).toBe(true);
  });
  it('a pilot\'s weeklyFloor still replaces the reserve', () => {
    expect(quotaFloor(b(0.3), { now: at(10), weeklyFloor: 0.4 }).ok).toBe(false);
  });
});

// ── a lost login is not an empty pool (2026-11-08: milo expired on gex45, its lanes skipped silently) ──
describe('quotaError', () => {
  it('reads the CLI\'s auth failures as auth, in both shapes it prints', () => {
    expect(quotaError('Error: authentication required. Run \'agy\' to log in, then retry.')).toBe('auth');
    expect(quotaError('{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out"}')).toBe('auth');
  });
  it('twin: another ERROR is error, a good reply is null', () => {
    expect(quotaError('{"status":"ERROR","error":"deadline exceeded"}')).toBe('error');
    expect(quotaError('{"status":"SUCCESS","command":{"data":{"groups":[]}}}')).toBeNull();
    expect(quotaError('')).toBeNull();
  });
});

describe('noteAuthLoss pages once per window per pool', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agy-auth-'));
  const t0 = Date.parse('2026-11-08T11:00:00Z');
  it('pages the first time, not again inside the window, and again after it', () => {
    const d = dir(), sent: string[] = [], send = (t: string) => { sent.push(t); };
    expect(noteAuthLoss('/root/.agy-milo', { now: t0, stampDir: d, send, host: 'gex45-1' }).paged).toBe(true);
    expect(sent[0]).toBe('agy NOT LOGGED IN: .agy-milo on gex45-1');
    expect(noteAuthLoss('/root/.agy-milo', { now: t0 + 60e3, stampDir: d, send, host: 'gex45-1' }).paged).toBe(false);
    const old = new Date(t0 - AUTH_PAGE_EVERY_MS - 1);
    fs.utimesSync(path.join(d, '.agy-milo.stamp'), old, old);
    expect(noteAuthLoss('/root/.agy-milo', { now: t0 + 60e3, stampDir: d, send, host: 'gex45-1' }).paged).toBe(true);
    expect(sent).toHaveLength(2);
  });
  it('twin: a second pool on the same box has its own window', () => {
    const d = dir(), sent: string[] = [], send = (t: string) => { sent.push(t); };
    noteAuthLoss('/root/.agy-milo', { now: t0, stampDir: d, send, host: 'h' });
    expect(noteAuthLoss(null, { now: t0, stampDir: d, send, host: 'h' }).paged).toBe(true);
    expect(sent).toEqual(['agy NOT LOGGED IN: .agy-milo on h', 'agy NOT LOGGED IN: default on h']);
  });
});

// ── the finish-first stamp is readable from every box (v3#70) ──
/**
 * The stamp that makes quality lanes keep FINISH_RESERVE (#8482) was a file on the finishing lane's own box. A quality
 * lane on another box never saw it and would have spent the pools first, with no error. The writer now also puts it in
 * Mongo ops_reports, and a reader takes, per finishing lane, the later-written of its box's file and the Mongo copy.
 * The stub below is the two Mongo calls the lib makes; no test here talks to a database.
 */
function fakeOpsReports() {
  const docs = new Map<string, Record<string, unknown>>();
  const calls = { find: 0, replaceOne: 0 };
  let down = false;
  const fail = () => { if (down) throw new Error('Server selection timed out after 60000 ms'); };
  return {
    docs, calls,
    setDown(v: boolean) { down = v; },
    collection(name: string) {
      expect(name).toBe(FINISH_QUEUE_COLLECTION);
      return {
        replaceOne: async (filter: { _id: string }, doc: Record<string, unknown>, opts: { upsert: boolean }) => {
          calls.replaceOne++; fail();
          expect(opts.upsert).toBe(true);
          docs.set(filter._id, doc);
        },
        find: (filter: { _id: { $gte: string; $lt: string } }) => ({
          toArray: async () => { calls.find++; fail(); return [...docs.entries()].filter(([id]) => id >= filter._id.$gte && id < filter._id.$lt).map(([, d]) => d); },
        }),
      };
    },
  };
}

describe('the finish-first stamp is shared between boxes (v3#70)', () => {
  const T = Date.parse('2026-11-12T20:00:00Z');
  const boxDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `finish-q-${name}-`));
  // What the lib did before v3#70: this box's file and nothing else.
  const fileAlone = (dir: string, now: number) => finishQueueOpen({ dir, now, shared: null }).open;
  beforeEach(() => forgetSharedFinishQueue());

  it('a quality lane on another box sees the finishing lane\'s stamp, and yields', async () => {
    const db = fakeOpsReports(), gex45 = boxDir('gex45'), main = boxDir('main');
    const lane = `test-finish-${process.pid}`;
    // the finishing lane runs on gex45 and stamps: its own file, then Mongo
    expect(await shareFinishQueue(db, writeFinishQueue(lane, { books: 12, pages: 897 }, { dir: gex45, now: T, host: 'gex45-1' }))).toBe(true);
    // a quality lane on main: nothing in its own folder. Before it reads Mongo it is where every box was before v3#70.
    expect(finishQueueOpen({ dir: main, now: T + H }).open).toBe(false);
    await pullFinishQueue(db, { now: T + H });
    const q = finishQueueOpen({ dir: main, now: T + H });
    expect(q.open).toBe(true);
    expect(q.lanes).toEqual([{ lane, books: 12, pages: 897, at: new Date(T).toISOString(), host: 'gex45-1', source: 'mongo' }]);
    // and the reserve follows, through the call the lanes make: weeklyReserve reads the stamps itself when not told
    expect(weeklyReserve({ resetTime: new Date(T + 200 * H).toISOString(), now: T + H, yieldToFinish: true })).toBeCloseTo(total + FINISH_RESERVE, 9);
    expect(weeklyReserve({ resetTime: new Date(T + 200 * H).toISOString(), now: T + H })).toBeCloseTo(total, 9);   // not a quality lane: no extra reserve
  });

  it('the stamp says which box wrote it and when, in the file, in Mongo and in the log line', async () => {
    const db = fakeOpsReports(), dir = boxDir('gex45');
    const stamp = writeFinishQueue('cli-translate-finish', { books: 5786, pages: 897 }, { dir, now: T, host: 'gex45-1' });
    await shareFinishQueue(db, stamp);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'cli-translate-finish.json'), 'utf8'))).toEqual({ lane: 'cli-translate-finish', books: 5786, pages: 897, at: '2026-11-12T20:00:00.000Z', host: 'gex45-1' });
    const doc = db.docs.get('finish-queue:cli-translate-finish')!;
    expect(doc).toMatchObject({ _id: 'finish-queue:cli-translate-finish', type: 'finish-queue', lane: 'cli-translate-finish', pages: 897, at: '2026-11-12T20:00:00.000Z', host: 'gex45-1' });
    expect(typeof doc.pushed_at).toBe('string');
    await pullFinishQueue(db, { now: T });
    const other = boxDir('main');
    const note = finishQueueNote(finishQueueOpen({ dir: other, now: T + 2 * H }), { now: T + 2 * H });
    expect(note).toMatch(/^finish queue OPEN/);
    expect(note).toContain('written 2026-11-12T20:00:00.000Z (2.0 h ago) on gex45-1, read from Mongo');
    // a stale foreign stamp is named too, so "why did the lane not yield?" has an answer in the log
    const late = T + (FINISH_QUEUE_MAX_AGE_H + 1) * H;
    expect(finishQueueNote(finishQueueOpen({ dir: other, now: late }), { now: late })).toMatch(/^finish queue closed .*7\.0 h ago\) on gex45-1/);
  });

  it('same window, same meaning: fresh with pages is open; an empty or 6-hour-old shared stamp is not', async () => {
    const db = fakeOpsReports(), writer = boxDir('w'), reader = boxDir('r');
    await shareFinishQueue(db, writeFinishQueue('a', { books: 1, pages: 40 }, { dir: writer, now: T, host: 'w' }));
    await pullFinishQueue(db, { now: T });
    expect(finishQueueOpen({ dir: reader, now: T + FINISH_QUEUE_MAX_AGE_H * H }).open).toBe(true);
    expect(finishQueueOpen({ dir: reader, now: T + (FINISH_QUEUE_MAX_AGE_H + 0.1) * H }).open).toBe(false);
    forgetSharedFinishQueue();
    await shareFinishQueue(db, writeFinishQueue('a', { books: 1, pages: 0 }, { dir: writer, now: T + H, host: 'w' }));
    await pullFinishQueue(db, { now: T + H });
    expect(finishQueueOpen({ dir: reader, now: T + H }).open).toBe(false);
  });

  it('per finishing lane the later-written stamp decides, whichever place it is in', async () => {
    const db = fakeOpsReports(), here = boxDir('here'), there = boxDir('there');
    // this box's file says 40 pages wait; an hour later the lane, now on another box, found its queue empty
    writeFinishQueue('cli-translate-finish', { books: 3, pages: 40 }, { dir: here, now: T, host: 'here' });
    await shareFinishQueue(db, writeFinishQueue('cli-translate-finish', { books: 0, pages: 0 }, { dir: there, now: T + H, host: 'there' }));
    await pullFinishQueue(db, { now: T + H });
    expect(fileAlone(here, T + 2 * H)).toBe(true);
    expect(finishQueueOpen({ dir: here, now: T + 2 * H }).open).toBe(false);
    expect(finishQueueOpen({ dir: here, now: T + 2 * H }).seen).toMatchObject([{ host: 'there', source: 'mongo', pages: 0 }]);
    // the other way round: an older Mongo copy does not override this box's newer file
    writeFinishQueue('cli-translate-finish', { books: 3, pages: 7 }, { dir: here, now: T + 3 * H, host: 'here' });
    expect(finishQueueOpen({ dir: here, now: T + 3 * H }).lanes).toMatchObject([{ host: 'here', source: 'file', pages: 7 }]);
    // and another lane's stamp is its own row: one open lane is enough, as with two files in one folder
    forgetSharedFinishQueue();
    await shareFinishQueue(db, writeFinishQueue('other-finish', { books: 1, pages: 5 }, { dir: there, now: T + 3 * H, host: 'there' }));
    writeFinishQueue('cli-translate-finish', { books: 0, pages: 0 }, { dir: here, now: T + 4 * H, host: 'here' });
    await pullFinishQueue(db, { now: T + 4 * H });
    expect(finishQueueOpen({ dir: here, now: T + 4 * H }).lanes.map((l: { lane: string }) => l.lane)).toEqual(['other-finish']);
  });

  it('with every lane on one box nothing changes: file and Mongo carry the same stamp, and the answer is the file\'s', async () => {
    // gex45 today: the finishing lane and the quality lanes share a box. Every combination of what a finish run can
    // stamp (queue empty, no pool open = 1, pages taken) and how long ago, read as a quality lane reads it.
    const b = (w: number) => [{ id: 'gemini-weekly', remaining_fraction: w, reset_time: new Date(T + 300 * H).toISOString() }, { id: 'gemini-5h', remaining_fraction: 0.9 }];
    const between = total + FINISH_RESERVE / 2;   // a pool a quality lane may spend only while the queue is closed
    let cases = 0, open = 0;
    for (const pages of [0, 1, 40, 3000]) {
      for (const ageH of [0, 0.5, 3, FINISH_QUEUE_MAX_AGE_H, FINISH_QUEUE_MAX_AGE_H + 0.1, 30]) {
        const db = fakeOpsReports(), dir = boxDir('gex45');
        forgetSharedFinishQueue();
        await shareFinishQueue(db, writeFinishQueue('cli-translate-finish', { books: 9, pages }, { dir, now: T, host: 'gex45-1' }));
        const now = T + ageH * H;
        const before = fileAlone(dir, now);
        await pullFinishQueue(db, { now });
        const after = finishQueueOpen({ dir, now });
        expect(after.open, `pages ${pages}, ${ageH} h`).toBe(before);
        expect(quotaFloor(b(between), { now, yieldToFinish: true, finishOpen: after.open }).ok).toBe(quotaFloor(b(between), { now, yieldToFinish: true, finishOpen: before }).ok);
        expect(quotaFloor(b(between), { now, yieldToFinish: true, finishOpen: after.open }).ok).toBe(!before);
        cases++; if (after.open) open++;
      }
    }
    expect([cases, open]).toEqual([24, 12]);   // the loop ran, and both answers occur
    // a file left by the code before v3#70 (no host) still reads the same
    const old = boxDir('old');
    fs.writeFileSync(path.join(old, 'cli-translate-finish.json'), JSON.stringify({ lane: 'cli-translate-finish', books: 5786, pages: 897, at: new Date(T).toISOString() }) + '\n');
    forgetSharedFinishQueue();
    await pullFinishQueue(fakeOpsReports(), { now: T });
    expect(finishQueueOpen({ dir: old, now: T + H }).open).toBe(true);
    expect(finishQueueOpen({ dir: old, now: T + 7 * H }).open).toBe(false);
  });

  it('a box that cannot reach Mongo reads its own file, as before, and says so once', async () => {
    const db = fakeOpsReports(), dir = boxDir('cut-off'), said: string[] = [], log = (m: string) => { said.push(m); };
    db.setDown(true);
    // the writer: the file is written, the publish fails quietly
    const stamp = writeFinishQueue('cli-translate-finish', { books: 2, pages: 40 }, { dir, now: T, host: 'cut-off' });
    expect(await shareFinishQueue(db, stamp, { log })).toBe(false);
    expect(fs.existsSync(path.join(dir, 'cli-translate-finish.json'))).toBe(true);
    // the reader: two failed reads, ten minutes apart
    expect(await pullFinishQueue(db, { now: T, log })).toBeNull();
    expect(await pullFinishQueue(db, { now: T + FINISH_QUEUE_PULL_EVERY_MS, log })).toBeNull();
    expect(finishQueueOpen({ dir, now: T + H }).open).toBe(fileAlone(dir, T + H));
    expect(finishQueueOpen({ dir, now: T + H }).lanes).toMatchObject([{ source: 'file', host: 'cut-off' }]);
    expect(finishQueueNote(finishQueueOpen({ dir, now: T + H }), { now: T + H })).toContain("this box's file only; Mongo not read");
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/Mongo.*Server selection timed out.*this box's file only/);
  });

  it('a read that fails after one that worked drops the Mongo copy: the file alone decides until Mongo answers again', async () => {
    const db = fakeOpsReports(), there = boxDir('there'), here = boxDir('here');
    await shareFinishQueue(db, writeFinishQueue('a', { books: 1, pages: 40 }, { dir: there, now: T, host: 'there' }));
    await pullFinishQueue(db, { now: T, log: () => {} });
    expect(finishQueueOpen({ dir: here, now: T }).open).toBe(true);
    db.setDown(true);
    await pullFinishQueue(db, { now: T + FINISH_QUEUE_PULL_EVERY_MS, log: () => {} });
    expect(finishQueueOpen({ dir: here, now: T + FINISH_QUEUE_PULL_EVERY_MS }).open).toBe(false);
    db.setDown(false);
    await pullFinishQueue(db, { now: T + 2 * FINISH_QUEUE_PULL_EVERY_MS, log: () => {} });
    expect(finishQueueOpen({ dir: here, now: T + 2 * FINISH_QUEUE_PULL_EVERY_MS }).open).toBe(true);
  });

  it('a run asks Mongo at most once every ten minutes, however many chunks and workers it has', async () => {
    const db = fakeOpsReports();
    expect(FINISH_QUEUE_PULL_EVERY_MS).toBe(10 * 60e3);
    await Promise.all([pullFinishQueue(db, { now: T }), pullFinishQueue(db, { now: T }), pullFinishQueue(db, { now: T + 1 })]);
    await pullFinishQueue(db, { now: T + FINISH_QUEUE_PULL_EVERY_MS - 1 });
    expect(db.calls.find).toBe(1);
    await pullFinishQueue(db, { now: T + FINISH_QUEUE_PULL_EVERY_MS });
    expect(db.calls.find).toBe(2);
  });
});

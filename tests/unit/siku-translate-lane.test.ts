/**
 * The Siku translation lane (#5600) spends a shared agy pool only above its floor, and picks only held Siku books it
 * may translate: the right holds and rungs, OCR on >= 80% of pages, none of #6871's residue or #7090's books, and no
 * dupe. A translated sibling VOLUME of the same set is not a dupe (volumes share a kr: work_id).
 * Fixtures: two real `agy -p /quota --output-format json` replies (2026-10-27): a pool with 0.64 weekly left and a
 * spent second login.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { claudeQuota, LANE_RESERVES } from '../../scripts/lib/agy-pools.mjs';
import { parseQuota, poolGate, choosePool, rankBooks, requestedBooks, isDupeSibling, tallyBar, CHAT_REPLY_RE, leafInstructions, LEAF_LINES, spotVerdict, transcriptModel, recordSpot, SPOT_METHOD } from '../../scripts/batch/siku-translate-lane.mjs';

const fx = (f: string) => fs.readFileSync(path.join(__dirname, '../fixtures/siku-lane', f), 'utf8');
const NOW = Date.parse('2026-10-27T15:00:00Z');

describe('siku lane: pool gate', () => {
  it('parses the Gemini weekly bucket of a live /quota reply', () => {
    const q = parseQuota(fx('quota-default.json'));
    expect(q.weekly).toBeCloseTo(0.638, 2);
    expect(q.weeklyReset).toBe('2026-10-30T21:59:44Z');
    expect(q.fiveHour).toBeCloseTo(0.894, 2);
    const spent = parseQuota(fx('quota-spent.json'));
    expect(spent.weekly).toBe(0);
    expect(spent.fiveHour).toBeNull();
  });
  it('reads the Claude and GPT group as its own pool, for display', () => {
    const c = parseQuota(fx('quota-default.json')).claude;
    expect(c.weekly).toBeGreaterThanOrEqual(0);
    expect(c.weekly).toBeLessThanOrEqual(1);
    expect(typeof c.weeklyReset).toBe('string');
    expect(claudeQuota('')).toBeNull();
  });
  it('a reply that is not a quota reading is null', () => {
    expect(parseQuota('')).toBeNull();
    expect(parseQuota('{"status":"ERROR"}')).toBeNull();
    expect(parseQuota('agy-guard: no --model given\n{"status":"SUCCESS","command":{"data":{"groups":[]}}}')).toBeNull();
  });
  it('opens above the other lanes\' reserve, and above empty in the last 36 h before the reset (#7911)', () => {
    const far = '2026-10-30T21:59:44Z', near = '2026-10-28T10:00:00Z';
    const others = Object.entries(LANE_RESERVES).reduce((s, [k, v]) => (k === 'siku' ? s : s + v), 0);
    expect(poolGate({ weekly: 0.2, weeklyReset: far }, { now: NOW }).open).toBe(true); // was shut under 0.35
    expect(poolGate({ weekly: others + 0.001, weeklyReset: far }, { now: NOW }).open).toBe(true);
    expect(poolGate({ weekly: others, weeklyReset: far }, { now: NOW }).open).toBe(false);
    expect(poolGate({ weekly: 0.04, weeklyReset: near }, { now: NOW }).open).toBe(true);
    expect(poolGate({ weekly: 0.002, weeklyReset: near }, { now: NOW }).open).toBe(false); // a spent pool's residue
    expect(poolGate(null).open).toBe(false);
  });
  it('uses the open pool with most weekly left, never a busy one', () => {
    const a = { home: null, busy: null, reading: parseQuota(fx('quota-default.json')) };
    const b = { home: '/root/.agy-james', busy: null, reading: { weekly: 0.9, weeklyReset: '2026-11-03T09:24:51Z' } };
    expect(choosePool([a, b], { now: NOW }).home).toBe('/root/.agy-james');
    expect(choosePool([a, { ...b, busy: 1234 }], { now: NOW }).home).toBeNull();
    expect(choosePool([a, { ...b, reading: parseQuota(fx('quota-spent.json')) }], { now: NOW }).home).toBeNull();
    expect(choosePool([{ ...a, reading: { weekly: 0.05, weeklyReset: '2026-10-30T21:59:44Z' } }], { now: NOW })).toBeNull();
  });
});

const book = (o: Record<string, unknown> = {}) => ({
  id: 'b1', title: '禮書·卷一~卷四 (vol 1)', visible: true, pages_count: 120,
  pipeline_auto: { status: 'held', hold: { reason: 'paddle-zh-5600-ocr-only' } },
  translation_state: { rung: 'transcribed', whole: 120, ocr: 118, translated: 0, translatable: 120 }, ...o,
});

describe('siku lane: book picker', () => {
  it('keeps held Siku books on the transcribed/translating rungs with OCR on >= 80%', () => {
    const rows = [
      book({ id: 'ok' }),
      book({ id: 'gpu', pipeline_auto: { status: 'held', hold: { reason: 'gpu-backlog-5660' } }, translation_state: { rung: 'translating', whole: 100, ocr: 80 } }),
      book({ id: 'otherhold', pipeline_auto: { status: 'held', hold: { reason: 'zh-guarded-6871' } } }),
      book({ id: 'released', pipeline_auto: { status: 'ocr_complete', hold: { reason: 'paddle-zh-5600-ocr-only' } } }),
      book({ id: 'readable', translation_state: { rung: 'readable', whole: 120, ocr: 120 } }),
      book({ id: 'lowocr', translation_state: { rung: 'transcribed', whole: 100, ocr: 79 } }),
      book({ id: 'excluded' }),
      book({ id: 'seal', title: '六書統·卷一 (vol 1)' }),
    ];
    const got = rankBooks(rows, { exclude: new Set(['excluded']), sealRe: /六書|說文/ }).map((b: { id: string }) => b.id);
    expect(got.sort()).toEqual(['gpu', 'ok']);
  });
  it('orders visible first, then fewest pages', () => {
    const got = rankBooks([book({ id: 'big', pages_count: 300 }), book({ id: 'hidden', visible: false, pages_count: 10 }), book({ id: 'small', pages_count: 50 })]).map((b: { id: string }) => b.id);
    expect(got).toEqual(['small', 'big', 'hidden']);
  });
  it('puts the Four Histories first, Derek\'s priority volumes first of all (#7546)', () => {
    const h = (id: string) => book({ id, visible: false, pipeline_auto: { status: 'held', hold: { reason: 'zh-histories-7546' } } });
    const got = rankBooks([book({ id: 'siku', pages_count: 10 }), h('hist'), h('6ae0bab64adf2ffb52f71058')]).map((b: { id: string }) => b.id);
    expect(got).toEqual(['6ae0bab64adf2ffb52f71058', 'hist', 'siku']);
  });
  it('a translated sibling volume of the same set is not a dupe; another edition with English is', () => {
    const me = book();
    expect(isDupeSibling(me, { title: '禮書·卷五~卷十二 (vol 2)', translation_state: { translated: 140 }, pipeline_auto: { hold: { reason: 'paddle-zh-5600-ocr-only' } } })).toBe(false);
    expect(isDupeSibling(me, { title: '禮書·卷一~卷四 (vol 1)', translation_state: { translated: 3 }, pipeline_auto: { hold: { reason: 'paddle-zh-5600-ocr-only' } } })).toBe(true);
    expect(isDupeSibling(me, { title: '禮書 (1868 woodblock)', language: 'Chinese', pages_translated: 40 })).toBe(true);
    expect(isDupeSibling(me, { title: 'Records of the Western World', language: 'English' })).toBe(true);
    expect(isDupeSibling(me, { title: '禮書 (1868 woodblock)', language: 'Chinese', pages_translated: 0 })).toBe(false);
  });
  it('flags a chat-model reply inside stored OCR (詩總聞 p.118, 2026-10-27)', () => {
    expect(CHAT_REPLY_RE.test('…詩曰…\n作为一个人工智能语言模型，我还没学习如何回答这个问题')).toBe(true);
    expect(CHAT_REPLY_RE.test('人之為道也，智能者必')).toBe(false);
  });
});

describe('siku lane: reader requests go first (#7690)', () => {
  const ids = (rows: { id: string }[]) => rows.map((b) => b.id);
  const hist = book({ id: '6ae0bab64adf2ffb52f71058', visible: false, pipeline_auto: { status: 'held', hold: { reason: 'zh-histories-7546' } } });

  it('leads the wave ahead of the priority volumes, oldest request first', () => {
    const rows = [hist, book({ id: 'small', pages_count: 10 }), book({ id: 'newer', pages_count: 200 }), book({ id: 'older', pages_count: 250 })];
    expect(ids(rankBooks(rows))).toEqual(['6ae0bab64adf2ffb52f71058', 'small', 'newer', 'older']);
    expect(ids(rankBooks(rows, { requested: new Map([['older', new Set(['p'])], ['newer', new Set(['q'])]]) }))).toEqual(['older', 'newer', '6ae0bab64adf2ffb52f71058', 'small']);
  });
  it('brings in a requested book past the rung filter only', () => {
    const readable = book({ id: 'readable', translation_state: { rung: 'readable', whole: 120, ocr: 120 } });
    expect(ids(rankBooks([readable]))).toEqual([]);
    expect(ids(rankBooks([readable], { requested: new Map([['readable', new Set(['p'])]]) }))).toEqual(['readable']);
  });
  it('never unlocks what the other filters leave out', () => {
    const rq = (id: string) => ({ requested: new Map([[id, new Set(['p'])]]) });
    expect(rankBooks([book({ id: 'lowocr', translation_state: { rung: 'transcribed', whole: 100, ocr: 79 } })], rq('lowocr'))).toEqual([]);
    expect(rankBooks([book({ id: 'otherhold', pipeline_auto: { status: 'held', hold: { reason: 'zh-guarded-6871' } } })], rq('otherhold'))).toEqual([]);
    expect(rankBooks([book({ id: 'released', pipeline_auto: { status: 'ocr_complete', hold: { reason: 'paddle-zh-5600-ocr-only' } } })], rq('released'))).toEqual([]);
    expect(rankBooks([book({ id: 'seal', title: '六書統 (vol 1)' })], { ...rq('seal'), sealRe: /六書/ })).toEqual([]);
    expect(rankBooks([book({ id: 'excluded' })], { ...rq('excluded'), exclude: new Set(['excluded']) })).toEqual([]);
  });
  it('takes only `siku` verdicts, grouping a book\'s pages under its oldest request', () => {
    const r = (verdict: string, bid: string, pid: string) => ({ verdict: { verdict }, book: { id: bid }, page: { id: pid } });
    const got = requestedBooks([r('siku', 'a', 'p1'), r('refuse', 'x', 'p9'), r('siku', 'b', 'p2'), r('siku', 'a', 'p3'), r('auto', 'y', 'p8'), { verdict: { verdict: 'refuse' } }]);
    expect([...got.keys()]).toEqual(['a', 'b']);
    expect([...got.get('a')]).toEqual(['p1', 'p3']);
  });
});

describe('siku lane: spot-check bar', () => {
  it('passes at 0 wrong-leaf, 0 invented, sense errors on <= 1 page in 3', () => {
    const v = (s = 0, o = {}) => ({ sense_errors: s, wrong_leaf: false, invented: false, ...o });
    expect(tallyBar([v(1), v(), v(), v(1), v(), v(), v(1), v(), v(), v()]).pass).toBe(true);
    expect(tallyBar([v(1), v(2), v(), v(1), v(), v(), v(1), v(), v(), v()]).pass).toBe(false);
    expect(tallyBar([v(), v(0, { invented: true }), v()]).pass).toBe(false);
    expect(tallyBar([]).pass).toBe(false);
  });
});

describe('siku lane: leaf instructions (#5600)', () => {
  it('gives every page of a book the two leaf lines the eval measured', () => {
    const m = leafInstructions(['p1', 'p2', 'p3']);
    expect(Object.keys(m)).toEqual(['p1', 'p2', 'p3']);
    for (const v of Object.values(m)) expect(v).toBe(LEAF_LINES);
    // The wording is what scripts/eval/siku-percall-5600 ran (arm C); a change is a new arm, not an edit.
    expect(LEAF_LINES.split('\n')).toHaveLength(2);
    expect(LEAF_LINES).toContain('欽定四庫全書');
    expect(LEAF_LINES).toContain('stop where the leaf stops; do not complete it.');
  });
});

describe('siku lane: the spot check is recorded (#8069)', () => {
  const v = (o = {}) => ({ page_id: 'p1', wrong_leaf: false, invented: false, invented_quote: '', sense_errors: 0, from_ocr: false, verdict: 'fine', note: 'matches', ...o });
  it('maps a verdict onto outcome and stage, with no taxonomy class', () => {
    expect(spotVerdict(v())).toMatchObject({ outcome: 'clean', page_verdict: 'show', errors: [] });
    expect(spotVerdict(v({ verdict: 'minor' }))).toMatchObject({ outcome: 'minor', page_verdict: 'show', errors: [] });
    const sense = spotVerdict(v({ verdict: 'sense-error', sense_errors: 2 }));
    expect(sense).toMatchObject({ outcome: 'serious', page_verdict: 'caveat', errors: [{ stage: 'translation', kind: 'mistranslation' }] });
    expect(sense.errors[0].class).toBeUndefined();
    expect(spotVerdict(v({ verdict: 'sense-error', sense_errors: 1, from_ocr: true })).errors[0]).toMatchObject({ stage: 'ocr', kind: 'misread' });
    expect(spotVerdict(v({ verdict: 'invented' }))).toMatchObject({ outcome: 'serious', page_verdict: 'fix' });
    expect(spotVerdict(v({ verdict: 'sense-error', sense_errors: 1, from_ocr: 'no' })).errors[0].stage).toBe('translation');
    expect(spotVerdict(v({ verdict: 'invented', invented: true, invented_quote: 'q' }))).toMatchObject({ outcome: 'serious', page_verdict: 'fix', errors: [{ kind: 'confabulation', problem: 'q' }] });
    expect(spotVerdict(v({ verdict: 'wrong-leaf', wrong_leaf: true }))).toMatchObject({ outcome: 'serious', page_verdict: 'fix', wrong_page: true, errors: [] });
    expect(spotVerdict(v({ verdict: 'omission' }))).toMatchObject({ outcome: 'serious', page_verdict: 'caveat', errors: [{ kind: 'omission' }] });
  });
  it('carries the judged text when the folder kept it', () => {
    expect(spotVerdict(v(), { ocr: 'a', english: 'b' }).judged).toEqual({ ocr: 'a', translation: 'b' });
    expect(spotVerdict(v()).judged).toBeUndefined();
  });
  it('reads the model id from a transcript', () => {
    expect(transcriptModel('{"type":"system","model":"claude-opus-5-5","x":1}')).toBe('claude-opus-5-5');
    expect(transcriptModel('nothing')).toBeNull();
  });
  it('records a folder as a random draw, write-once, without touching anything but book_checks', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spot-')), '20261030T1404');
    fs.mkdirSync(path.join(dir, 'c0'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'verdicts.json'), JSON.stringify([v()]));
    fs.writeFileSync(path.join(dir, 'c0', 'items.json'), JSON.stringify([{ page_id: 'p1', ocr: 'a', english: 'b' }, { page_id: 'p2', ocr: 'c', english: 'd' }]));
    fs.writeFileSync(path.join(dir, 'c0', 'transcript.jsonl'), '{"model":"claude-opus-5-5"}');
    const touched = new Set<string>();
    const inserted: Record<string, any>[] = [];
    const db = { collection: (c: string) => { touched.add(c); return {
      find: () => ({ toArray: async () => [{ id: 'p1', book_id: 'b1', page_number: 4, ocr: { data: 'a', model: 'm' }, translation: { data: 'b', model: 'm' } }] }),
      findOne: async () => ({ visible: true, pages_count: 9 }),
      insertOne: async (r: Record<string, any>) => { inserted.push(r); },
    }; } };
    const r = await recordSpot(db, dir, { evidence: 'scripts/eval/results/x.json', exposure: 'unrecorded' });
    expect(r).toMatchObject({ inserted: 1, failed: [] });
    expect(inserted[0]).toMatchObject({ method_id: SPOT_METHOD, run_id: 'siku-translate-5600-20261030T1404', pages_read: [4], reader: { model: 'claude-opus-5-5', image_opened: true },
      frame: { selection: 'random', pages_drawn: 2, verdicts_kept: 1 }, exposure: [{ page_number: 4, exposure: 'unrecorded' }] });
    expect(inserted[0].checked_at.toISOString()).toBe('2026-10-30T14:04:00.000Z');
    expect([...touched].sort()).toEqual(['book_checks', 'pages']);
  });
});

/**
 * The Siku translation lane (#5600) spends a shared agy pool only above its floor, and picks only held Siku books it
 * may translate: the right holds and rungs, OCR on >= 80% of pages, none of #6871's residue or #7090's books, and no
 * dupe. A translated sibling VOLUME of the same set is not a dupe (volumes share a kr: work_id).
 * Fixtures: two real `agy -p /quota --output-format json` replies (2026-10-27): a pool with 0.64 weekly left and a
 * spent second login.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseQuota, poolGate, choosePool, rankBooks, isDupeSibling, tallyBar, CHAT_REPLY_RE } from '../../scripts/batch/siku-translate-lane.mjs';

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
  it('a reply that is not a quota reading is null', () => {
    expect(parseQuota('')).toBeNull();
    expect(parseQuota('{"status":"ERROR"}')).toBeNull();
    expect(parseQuota('agy-guard: no --model given\n{"status":"SUCCESS","command":{"data":{"groups":[]}}}')).toBeNull();
  });
  it('opens above 0.35, or above 0.05 within 24 h of the reset', () => {
    const far = '2026-10-30T21:59:44Z', near = '2026-10-28T10:00:00Z';
    expect(poolGate({ weekly: 0.64, weeklyReset: far }, { now: NOW }).open).toBe(true);
    expect(poolGate({ weekly: 0.35, weeklyReset: far }, { now: NOW }).open).toBe(false);
    expect(poolGate({ weekly: 0.2, weeklyReset: far }, { now: NOW }).open).toBe(false);
    expect(poolGate({ weekly: 0.2, weeklyReset: near }, { now: NOW }).open).toBe(true);
    expect(poolGate({ weekly: 0.04, weeklyReset: near }, { now: NOW }).open).toBe(false);
    expect(poolGate(null).open).toBe(false);
  });
  it('uses the open pool with most weekly left, never a busy one', () => {
    const a = { home: null, busy: null, reading: parseQuota(fx('quota-default.json')) };
    const b = { home: '/root/.agy-james', busy: null, reading: { weekly: 0.9, weeklyReset: '2026-11-03T09:24:51Z' } };
    expect(choosePool([a, b], { now: NOW }).home).toBe('/root/.agy-james');
    expect(choosePool([a, { ...b, busy: 1234 }], { now: NOW }).home).toBeNull();
    expect(choosePool([a, { ...b, reading: parseQuota(fx('quota-spent.json')) }], { now: NOW }).home).toBeNull();
    expect(choosePool([{ ...a, reading: { weekly: 0.3, weeklyReset: '2026-10-30T21:59:44Z' } }], { now: NOW })).toBeNull();
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

describe('siku lane: spot-check bar', () => {
  it('passes at 0 wrong-leaf, 0 invented, sense errors on <= 1 page in 3', () => {
    const v = (s = 0, o = {}) => ({ sense_errors: s, wrong_leaf: false, invented: false, ...o });
    expect(tallyBar([v(1), v(), v(), v(1), v(), v(), v(1), v(), v(), v()]).pass).toBe(true);
    expect(tallyBar([v(1), v(2), v(), v(1), v(), v(), v(1), v(), v(), v()]).pass).toBe(false);
    expect(tallyBar([v(), v(0, { invented: true }), v()]).pass).toBe(false);
    expect(tallyBar([]).pass).toBe(false);
  });
});

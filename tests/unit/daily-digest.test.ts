/**
 * daily-digest (#5441): one message a day, ≤ 25 lines. The collectors are I/O; everything they
 * produce goes through these pure parsers and formatDigest, so this pins the message itself —
 * the line cap, the lane split, and that an unreadable source is SAID rather than left out.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyLane, sumByLane, parseChainedLog, parseSpeedtest, parseGpuLog, parseDecisions,
  formatDigest, MAX_LINES,
} from '../../scripts/maintenance/daily-digest.mjs';

const fx = (f: string) => fs.readFileSync(path.join(__dirname, '../fixtures/daily-digest', f), 'utf8');

describe('lanes', () => {
  it('classifies the five lanes from both stores', () => {
    expect(classifyLane({ type: 'translation', mode: 'batch', endpoint: 'hetzner/translate-batch-chained' })).toBe('chained');
    expect(classifyLane({ type: 'translation', mode: 'batch', endpoint: 'eval/translate-batch-chained-shadow' })).toBe('other');
    expect(classifyLane({ type: 'translation', mode: 'realtime', endpoint: 'worker/hetzner-translate-batch' })).toBe('realtime');
    expect(classifyLane({ type: 'ocr', mode: 'batch', endpoint: 'scripts/batch/bulk-reocr-local.mjs' })).toBe('ocr_batch');
    expect(classifyLane({ type: 'image_extraction', mode: 'realtime' })).toBe('images'); // Mongo's name
    expect(classifyLane({ type: 'extract_images', mode: 'realtime' })).toBe('images'); // Supabase's name
    expect(classifyLane({ type: 'index', mode: 'realtime' })).toBe('other');
  });
  it('sums grouped and raw rows, counting costless rows without adding them', () => {
    const s = sumByLane([
      { type: 'ocr', mode: 'batch', cost_usd: 2 },
      { type: 'ocr', mode: 'batch', cost_usd: null, n: 3 },
      { type: 'index', mode: 'realtime', cost_usd: 0.5, n: 10 },
    ]);
    expect(s).toMatchObject({ usd: 2.5, rows: 14, costless: 3 });
    expect(s.lanes).toMatchObject({ ocr_batch: 2, other: 0.5, chained: 0 });
  });
});

describe('box parsers', () => {
  it('takes the LAST tick stamp of the chained log and dates it across midnight', () => {
    const r = parseChainedLog(fx('chained.log'), new Date('2026-10-01T00:05:00Z'));
    expect(r.lastStamp).toBe('00:03:12');
    expect(r.openFromLog).toBe(63);
    expect(r.lastTick?.toISOString()).toBe('2026-10-01T00:03:12.000Z');
    const before = parseChainedLog('  23:58:50 open chained runs: 64', new Date('2026-10-01T00:01:00Z'));
    expect(before.lastTick?.toISOString()).toBe('2026-09-30T23:58:50.000Z');
  });
  it('reads the last status row of the speed test, skipping events and junk', () => {
    expect(parseSpeedtest(fx('ticks.jsonl'))).toMatchObject({ t: '2026-10-01T04:15:02Z', ocrPages: 73288, trPages: 1199, todayUsd: 126.75 });
  });
  it('reads only the last GPU watchdog block', () => {
    const g = parseGpuLog(fx('gpu-lease-watchdog.log'));
    expect(g?.at).toBe('2026-10-01T08:00:01.915Z');
    expect(g?.stopped).toBe(1);
    expect(g?.live).toHaveLength(1);
    expect(g?.live[0]).toContain('demo-gpu');
  });
  it('counts pending decision rows by their bold lead, never the Done section', () => {
    const rows = parseDecisions(fx('decisions-pending.md'));
    expect(rows.map((r: { lead: string }) => r.lead)).toEqual([
      'Merge PR #1 (widget copy)?', 'Run the gadget sweep at $40?', 'Retire the old gadget lane?',
    ]);
    expect(rows[0].section).toBe('Widgets');
  });
});

const lanes = { chained: 16.75, realtime: 3.8, ocr_batch: 53.42, images: 34.49, other: 24.07 };
const full = {
  now: '2026-10-01T06:30:00Z', date: '2026-10-01', yesterday: '2026-09-30',
  spend: {
    dial: 300, envelopes: 2, ySupa: 123.07, yMongo: 9.46,
    y: { usd: 132.53, rows: 15898, costless: 44, lanes },
    mtd: { usd: 1042.4, rows: 90000, costless: 300, lanes: { ...lanes, ocr_batch: 445.84, realtime: 207.11 } },
    mtdLabel: '09-01..09-30', today: { usd: 12.5 },
  },
  jobs: {
    running: Array.from({ length: 7 }, (_, i) => ({ name: `job${i}`, state: 'running', last: 'x'.repeat(300) })),
    finished: [{ name: 'old', state: 'done', last: '[claude-job] exit 0' }],
  },
  chained: { lastTick: '2026-10-01T05:15:00Z', open: 67, parked: 5, parked24: 1, complete24: 414 },
  speedtest: { t: '2026-10-01T04:15:02Z', test: 'speedtest-demo', status: 'running', ocrPages: 94897, trPages: 27791, todayUsd: 126.75 },
  gpu: { at: '2026-10-01T06:20:00Z', stopped: 1, live: ['ok demo-gpu (abcdef12) · lease 3.8 h left'] },
  decisions: { rows: Array.from({ length: 9 }, (_, i) => ({ section: 's', lead: `Decision ${i} ` + 'y'.repeat(200) })) },
  holds: Array.from({ length: 12 }, (_, i) => ({ number: 5000 + i, title: `PR ${i} ` + 'z'.repeat(200), createdAt: '2026-09-28T00:00:00Z' })),
};

describe('formatDigest', () => {
  it(`stays within ${MAX_LINES} lines on a crowded day, with no markdown tables`, () => {
    const text = formatDigest(full);
    const lines = text.split('\n');
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(lines.every((l: string) => l.length <= 200)).toBe(true);
    expect(text).not.toMatch(/^\|/m);
    expect(text).not.toContain('…(truncated)'); // the per-section caps hold on their own
  });
  it('says spend vs dial, every lane, and month to date', () => {
    const text = formatDigest(full);
    expect(text).toContain('SPEND 2026-09-30: $132.53 vs dial $300.00 (44%) + 2 envelopes');
    expect(text).toContain('supabase $123.07 + mongo $9.46');
    expect(text).toMatch(/chained \$16\.75 · realtime tr \$3\.80 · ocr batch \$53\.42 · images \$34\.49 · other \$24\.07/);
    expect(text).toContain('month to date (09-01..09-30): $1,042');
    expect(text).toContain('not billed');
  });
  it('flags a stale chained tick, and caps the long lists with a count of the rest', () => {
    const text = formatDigest(full);
    expect(text).toContain('last tick 05:15Z (75 min ago) — STALE');
    expect(text).toContain('WAITING ON DEREK: 9 rows');
    expect(text).toContain('…6 more (/decisions)');
    expect(text).toContain('TIER:HOLD PRs open > 24 h: 12');
    expect(text).toContain('…8 more');
    expect(text).toContain('JOBS: 7 running');
  });
  it('names every unreadable source instead of dropping it', () => {
    const text = formatDigest({
      ...full,
      spend: { error: 'Supabase read failed (503) on 2026-09-30' },
      jobs: { error: 'tmux exploded' },
      chained: { error: 'mongo down' },
      speedtest: null,
      gpu: { error: 'no /var/log/sourcelibrary/gpu-lease-watchdog.log' },
      decisions: { error: 'ops repo unreadable from the box — skipped' },
      holds: { error: 'gh: not logged in' },
    });
    expect(text).toContain('SPEND: UNREADABLE — Supabase read failed (503)');
    expect(text).toContain('JOBS: UNREADABLE');
    expect(text).toContain('chained lane: UNREADABLE');
    expect(text).toContain('GPU leases: UNREADABLE');
    expect(text).toContain('WAITING ON DEREK: ops repo unreadable from the box');
    expect(text).toContain('TIER:HOLD PRs: UNREADABLE');
    expect(text).not.toContain('speedtest');
  });
  it('keeps private ops-repo decision leads out of the public-repo copy', () => {
    const text = formatDigest(full, { publicSafe: true });
    expect(text).toContain('WAITING ON DEREK: 9 rows');
    expect(text).not.toContain('Decision 0');
    expect(text).toContain('leads omitted');
  });
  it('says the dial is closed when it is unset', () => {
    const text = formatDigest({ ...full, spend: { ...full.spend, dial: null, envelopes: 0 } });
    expect(text).toContain('vs dial UNSET (closed) ·');
  });
});

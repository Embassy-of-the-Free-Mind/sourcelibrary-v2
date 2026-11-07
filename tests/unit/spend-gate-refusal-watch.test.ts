/**
 * spend-gate-refusal-watch (#7492): the positive control is the 2026-10-25 → 10-27 envelope expiry, when
 * embed-gemini's gate refused every run but the one a day the reset dial let through. The fixture is the
 * `[spend-guard] embed-gemini:` lines of that window's cron log, one per 4-hourly run from 10-25 00:30Z.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — scripts-side module, no types
import { parseVerdict, judgeWorker } from '../../scripts/audit/spend-gate-refusal-watch.mjs';

const SCRIPT = join(__dirname, '../../scripts/audit/spend-gate-refusal-watch.mjs');
const FIXTURE = join(__dirname, '../fixtures/spend-gate-refusal-watch/2026-10-25-embed-gemini.log');
const START = Date.parse('2026-10-25T00:30:00Z');
const H = 3.6e6;

type V = { t: number; ok: boolean; closed?: { expired: Record<string, string[]>; spent: string[] } };
const verdicts: V[] = readFileSync(FIXTURE, 'utf8').split('\n')
  .map((l) => parseVerdict(l, 'embed-gemini')).filter(Boolean)
  .map((v: Omit<V, 't'>, i: number) => ({ ...v, t: START + i * 4 * H }));
const at = (iso: string) => {
  const now = Date.parse(iso);
  return judgeWorker(verdicts.filter((v) => v.t <= now), { now });
};

describe('spend-gate-refusal-watch on the 2026-10-25 expiry (positive control)', () => {
  it('the fixture is the incident: 18 runs, 6 refused, one dial-reset dispatch inside the streak', () => {
    expect(verdicts).toHaveLength(18);
    expect(verdicts.map((v) => (v.ok ? 'A' : 'R')).join('')).toBe('AAAAARARRRRRAAAAAA');
  });

  it('is quiet before 24 h of refusals, fires at 10-26 20:30Z, clears on the next allowed run', () => {
    expect(at('2026-10-25T21:00:00Z')).toMatchObject({ refusing: true, firing: false });
    expect(at('2026-10-26T20:00:00Z').firing).toBe(false);
    const r = at('2026-10-26T20:30:00Z');
    expect(r).toMatchObject({ firing: true, runs: 7, refused: 6, allowed: 1 });
    expect(at('2026-10-27T00:30:00Z')).toMatchObject({ firing: false, refusing: false });
  });

  it('names the closed envelopes, grouped by expiry', () => {
    const r = at('2026-10-26T20:30:00Z');
    expect(r.closed.expired['2026-10-25T16:50:14.398Z']).toHaveLength(26);
    expect(r.closed.expired['2026-10-25T16:50:14.398Z']).toContain('embed-tail-5729');
  });

  it('a strict "no dispatch for 24 h" rule would never have fired (why the rule is a share)', () => {
    let longest = 0;
    let since: number | null = null;
    for (const v of verdicts) { if (v.ok) since = null; else { since ??= v.t; longest = Math.max(longest, v.t - since + 4 * H); } }
    expect(longest).toBeLessThan(24 * H);
  });

  it('the CLI replay pages exactly once and exits 1', () => {
    let out = '';
    let code = 0;
    try {
      execFileSync('node', [SCRIPT, '--replay', FIXTURE, '--label', 'embed-gemini', '--start', '2026-10-25T00:30:00Z', '--every-min', '240', '--json'], { encoding: 'utf8' });
    } catch (e: unknown) { const err = e as { status: number; stdout: string }; code = err.status; out = err.stdout; }
    expect(code).toBe(1);
    const events = JSON.parse(out).events;
    expect(events.map((e: { event: string }) => e.event)).toEqual(['PAGE', 'CLEARED']);
    expect(events[0].at).toBe('2026-10-26T20:30:00Z');
  });
});

describe('parseVerdict', () => {
  it('reads every spend-guard verdict shape for its own label only', () => {
    const p = (s: string) => parseVerdict(`  [spend-guard] enrich-worker-batch: ${s}`, 'enrich-worker-batch');
    expect(p('spend $0.00 / $5.00 today (UTC, both stores), 0 calls → DISPATCH')).toEqual({ ok: true });
    expect(p('global daily ceiling reached → SCOPED DISPATCH, confined to 3 book(s). Envelopes: x')).toEqual({ ok: true });
    expect(p('global daily ceiling reached → DISPATCH unscoped on lane-wide envelope e. Envelopes: x')).toEqual({ ok: true });
    expect(p('spend $6.00 / $5.00 today (UTC, both stores), 9 calls → CEILING REACHED — no new dispatch')).toMatchObject({ ok: false });
    expect(p('METER UNREADABLE (boom) — refusing dispatch (all lanes). Partial sum was $1.00.')).toMatchObject({ ok: false });
    expect(p('no daily_budget_usd set — paid dispatch stays OFF (the dial is default-closed).')).toMatchObject({ ok: false });
    expect(p('daily meter truncated (x) at $6.00 ≥ $5.00 — the dial is reached; envelopes decide.')).toBeNull();
    expect(parseVerdict('  [spend-guard] embed-gemini: … → DISPATCH', 'enrich-worker-batch')).toBeNull();
  });
});

describe('the cron path (state file, incremental reads, logrotate)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sgrw-'));
  const env = { ...process.env, SPEND_GATE_WATCH_LOG_DIR: dir, SPEND_GATE_WATCH_STATE: join(dir, 'state.json'), SPEND_GATE_WATCH_TOPIC: 'http://127.0.0.1:9/never' };
  const REFUSE = '  [spend-guard] embed-gemini: global daily ceiling reached; every envelope closed (a: EXPIRED 2026-10-25T16:50:14.398Z — closed) — no new dispatch.\n';
  const run = () => { try { execFileSync('node', [SCRIPT, '--json'], { env, encoding: 'utf8' }); return 0; } catch (e: unknown) { return (e as { status: number }).status; } };
  const state = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).workers['embed-gemini'];

  it('sets a baseline without counting lines of unknown age, then counts appended and rotated lines', () => {
    for (const f of ['embed-gemini.log', 'enrich-batch.log', 'site-pages.log']) writeFileSync(join(dir, f), REFUSE.repeat(5));
    expect(run()).toBe(0);
    expect(state().verdicts).toHaveLength(0);
    appendFileSync(join(dir, 'embed-gemini.log'), REFUSE);
    expect(run()).toBe(0);
    expect(state().verdicts).toHaveLength(1);
    appendFileSync(join(dir, 'embed-gemini.log'), REFUSE); // written before the rotation …
    renameSync(join(dir, 'embed-gemini.log'), join(dir, 'embed-gemini.log.1'));
    writeFileSync(join(dir, 'embed-gemini.log'), REFUSE + REFUSE); // … and after
    expect(run()).toBe(0); // all seen just now: refusing, not yet for 24 h
    expect(state().verdicts).toHaveLength(4);
    expect(state().verdicts.at(-1).closed.expired['2026-10-25T16:50:14.398Z']).toEqual(['a']);
  });
});

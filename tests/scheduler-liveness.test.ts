import { describe, it, expect } from 'vitest';
import { judgeSchedulerLiveness, alertAction, WITNESSES, REPAGE_AFTER_MS } from '../src/lib/scheduler-liveness';

const now = new Date('2026-11-12T18:30:00Z');
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);

describe('judgeSchedulerLiveness (v2#4528)', () => {
  it('alive when every witness is fresh', () => {
    const r = judgeSchedulerLiveness({ scheduler: minsAgo(1), 'health-check': minsAgo(28) }, now);
    expect(r.verdict).toBe('alive');
  });

  // Positive control: the 2026-08-31 shape, every cron-driven writer silent for hours.
  it('dead when every witness is stale — the 25h cron.service outage', () => {
    const r = judgeSchedulerLiveness({ scheduler: minsAgo(25 * 60), 'health-check': minsAgo(25 * 60) }, now);
    expect(r.verdict).toBe('dead');
    expect(r.summary).toMatch(/DEAD/);
  });

  it('dead when cron_runs holds no row at all (never ran / TTL expired)', () => {
    expect(judgeSchedulerLiveness({}, now).verdict).toBe('dead');
  });

  it('partial when one job is quiet but cron is still firing', () => {
    const r = judgeSchedulerLiveness({ scheduler: minsAgo(90), 'health-check': minsAgo(20) }, now);
    expect(r.verdict).toBe('partial');
    expect(r.witnesses.find((w) => w.cron === 'scheduler')?.stale).toBe(true);
  });

  it('thresholds sit above each cadence: an hourly health-check 61 minutes old is not stale', () => {
    const r = judgeSchedulerLiveness({ scheduler: minsAgo(3), 'health-check': minsAgo(61) }, now);
    expect(r.verdict).toBe('alive');
  });

  it('every witness has a threshold', () => {
    for (const w of WITNESSES) expect(w.staleAfterMin).toBeGreaterThan(0);
  });
});

describe('alertAction', () => {
  it('pages on the first bad verdict and on recovery, not while alive', () => {
    expect(alertAction('dead', null, now)).toBe('page');
    expect(alertAction('alive', null, now)).toBe('none');
    expect(alertAction('alive', { last_verdict: 'dead', last_sent_at: minsAgo(60) }, now)).toBe('recovered');
  });

  it('re-pages an unchanged bad verdict only after the cooldown', () => {
    expect(alertAction('dead', { last_verdict: 'dead', last_sent_at: minsAgo(60) }, now)).toBe('none');
    expect(alertAction('dead', { last_verdict: 'dead', last_sent_at: new Date(now.getTime() - REPAGE_AFTER_MS) }, now)).toBe('page');
  });

  it('escalation partial → dead pages at once', () => {
    expect(alertAction('dead', { last_verdict: 'partial', last_sent_at: minsAgo(5) }, now)).toBe('page');
  });
});

/**
 * vercel-prod-watch (#5708): the judge over production deployments + main's history. The positive control is
 * the 2026-10-02 freeze — every production build after f718cdd (13:28Z) until the #5662 fix 96b89df (21:54Z)
 * ended ERROR — replayed from tests/fixtures/vercel-prod-watch/2026-10-02.json at chosen instants.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — scripts-side module, no types
import { judge, selfTest, buildInputsFromIgnoreCommand, renderText, MAX_BEHIND_MIN } from '../../scripts/audit/vercel-prod-watch.mjs';

type Dep = { uid: string; readyState: string; createdAt: number; readyAt: number; meta: { githubCommitSha: string; githubCommitMessage: string }; errorMessage?: string };
type Commit = { sha: string; date: string; subject: string; touches_inputs: boolean };
const fx = JSON.parse(readFileSync(join(__dirname, '../fixtures/vercel-prod-watch/2026-10-02.json'), 'utf8')) as {
  build_inputs: string[]; main_commits: Commit[]; deployments: Dep[];
};

const FREEZE = 'f718cdd';
const FIX = '96b89df';

/** The world as the cron would have seen it at `at`: deployments created by then, unsettled ones in flight. */
function at(when: string, deployments: Dep[] = fx.deployments) {
  const now = new Date(when);
  const t = now.getTime();
  const deps = deployments.filter((d) => d.createdAt <= t).map((d) => (d.readyAt > t ? { ...d, readyState: 'BUILDING' } : d));
  const mainCommits = fx.main_commits.filter((c) => Date.parse(c.date) <= t);
  return judge(deps, { mainCommits, now });
}

describe('vercel-prod-watch on the 2026-10-02 window (positive control)', () => {
  it('the fixture is the incident: production froze at f718cdd and 18 builds failed until 96b89df', () => {
    const errors = fx.deployments.filter((d) => d.readyState === 'ERROR');
    expect(errors).toHaveLength(18);
    expect(errors.every((d) => d.errorMessage?.startsWith(`fatal: bad object ${FREEZE}`))).toBe(true);
  });

  it('is clean before the freeze and after one failed build', () => {
    expect(at('2026-10-02T13:20:00Z').status).toBe('PASS');
    const r = at('2026-10-02T13:45:00Z');
    expect(r.status).toBe('PASS');
    expect(r.streak).toHaveLength(1);
    expect(r.production.sha.startsWith(FREEZE)).toBe(true);
  });

  it('FIRES on the second consecutive ERROR, naming the commits and the first error line', () => {
    const r = at('2026-10-02T13:55:00Z');
    expect(r.status).toBe('FAIL');
    expect(r.fails.map((f: { rule: string }) => f.rule)).toEqual(['failing_streak']);
    expect(r.streak.map((d: { sha: string }) => d.sha.slice(0, 7))).toEqual(['444e61d', '1f2c1a6']);
    expect(r.fails[0].first_error).toMatch(/^fatal: bad object f718cdd/);
    expect(r.incident_key).toBe('failing_streak@1f2c1a6');
    const text = renderText(r);
    expect(text).toContain('444e61d');
    expect(text).toContain('fatal: bad object f718cdd');
  });

  it('keeps firing through the whole window with a stable incident key (one issue, not 18)', () => {
    for (const t of ['2026-10-02T15:00:00Z', '2026-10-02T18:00:00Z', '2026-10-02T21:50:00Z']) {
      const r = at(t);
      expect(r.status).toBe('FAIL');
      expect(r.incident_key).toBe('failing_streak@1f2c1a6');
    }
    expect(at('2026-10-02T21:50:00Z').streak).toHaveLength(18);
  });

  it('is clean once the fix is READY (the issue closes)', () => {
    const r = at('2026-10-02T22:05:00Z');
    expect(r.status).toBe('PASS');
    expect(r.production.sha.startsWith(FIX)).toBe(true);
  });

  it('behind_main: the window only shipped one build-input commit late (60d3b31, 24 min) — it does not fire there', () => {
    const r = at('2026-10-02T21:50:00Z');
    expect(r.behind.unshipped_inputs.map((c: { sha: string }) => c.sha.slice(0, 7))).toEqual(['60d3b31']);
    expect(r.behind.lag_min).toBeLessThan(MAX_BEHIND_MIN);
    expect(r.fails.some((f: { rule: string }) => f.rule === 'behind_main')).toBe(false);
  });

  it('behind_main FIRES when the integration goes silent (no deployments created at all after f718cdd)', () => {
    const freezeAt = fx.deployments.find((d) => d.meta.githubCommitSha.startsWith(FREEZE))!.createdAt;
    const silent = fx.deployments.filter((d) => d.createdAt <= freezeAt);
    // 60d3b31 (src/ change) merged 21:30:44Z; 61 min later production still lacks it.
    expect(at('2026-10-02T22:20:00Z', silent).status).toBe('PASS');
    const r = at('2026-10-02T22:32:00Z', silent);
    expect(r.status).toBe('FAIL');
    expect(r.fails.map((f: { rule: string }) => f.rule)).toEqual(['behind_main']);
    expect(r.fails[0].text).toContain('60d3b31');
  });
});

describe('vercel-prod-watch judge', () => {
  const NOW = new Date('2026-01-01T12:00:00Z');
  const sha = (c: string) => c.repeat(40);
  const commit = (c: string, minsAgo: number, touches = true) => ({ sha: sha(c), date: new Date(NOW.getTime() - minsAgo * 60e3).toISOString(), subject: c, touches_inputs: touches });
  const dep = (c: string, state: string, minsAgo: number, extra: object = {}) => ({ uid: `dpl_${c}`, readyState: state, createdAt: NOW.getTime() - minsAgo * 60e3, meta: { githubCommitSha: sha(c) }, ...extra });

  it('a CANCELED build for a commit that changed no build input is the ignore step: not counted, not a break', () => {
    const main = [commit('a', 50), commit('b', 40, false), commit('c', 30, false)];
    const r = judge([dep('a', 'READY', 50), dep('b', 'CANCELED', 40), dep('c', 'CANCELED', 30)], { mainCommits: main, now: NOW });
    expect(r.status).toBe('PASS');
    expect(r.skipped).toHaveLength(2);
  });

  it('a CANCELED build that dropped a src/ change counts (three merges minutes apart, the later ones canceled)', () => {
    const main = [commit('a', 50), commit('b', 40), commit('c', 30)];
    const r = judge([dep('a', 'READY', 50), dep('b', 'CANCELED', 40), dep('c', 'CANCELED', 30)], { mainCommits: main, now: NOW });
    expect(r.fails.map((f: { rule: string }) => f.rule)).toEqual(['failing_streak']);
  });

  it('an in-flight build is skipped, and ERROR on either side of it still makes a streak', () => {
    const main = [commit('a', 50), commit('b', 40), commit('c', 30), commit('d', 5)];
    const r = judge([dep('a', 'READY', 50), dep('b', 'ERROR', 40), dep('c', 'ERROR', 30), dep('d', 'BUILDING', 5)], { mainCommits: main, now: NOW });
    expect(r.streak).toHaveLength(2);
    expect(r.skipped.map((d: { why: string }) => d.why)).toEqual(['in flight']);
  });

  it('a READY build ends the streak', () => {
    const main = [commit('a', 50), commit('b', 40), commit('c', 30)];
    const r = judge([dep('a', 'ERROR', 50), dep('b', 'ERROR', 40), dep('c', 'READY', 30)], { mainCommits: main, now: NOW });
    expect(r.status).toBe('PASS');
  });

  it('production commit unknown → UNKNOWN (exit 2), never PASS', () => {
    const main = [commit('a', 50)];
    expect(judge([], { mainCommits: main, now: NOW }).status).toBe('UNKNOWN');
    expect(judge([dep('z', 'READY', 10)], { mainCommits: main, now: NOW }).status).toBe('UNKNOWN');
    expect(judge([{ uid: 'x', readyState: 'READY', createdAt: NOW.getTime(), meta: {} }], { mainCommits: main, now: NOW }).status).toBe('UNKNOWN');
  });

  it('a finding still fires when the behind check cannot be measured', () => {
    const r = judge([dep('z', 'READY', 60), dep('b', 'ERROR', 40), dep('c', 'ERROR', 30)], { mainCommits: [commit('b', 40), commit('c', 30)], now: NOW });
    expect(r.status).toBe('FAIL');
    expect(r.unknown).toHaveLength(1);
  });

  it('the per-run self-test fires', () => {
    expect(selfTest()).toBe(true);
  });
});

describe('build inputs come from vercel.json, so the check and Vercel cannot drift', () => {
  it('parses the live ignoreCommand to the fixture paths', () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, '../../vercel.json'), 'utf8'));
    expect(buildInputsFromIgnoreCommand(vercel.ignoreCommand)).toEqual(fx.build_inputs);
  });
  it('throws (exit 2) on an ignoreCommand it cannot read', () => {
    expect(() => buildInputsFromIgnoreCommand('exit 1')).toThrow(/could not read build-input paths/);
  });
});

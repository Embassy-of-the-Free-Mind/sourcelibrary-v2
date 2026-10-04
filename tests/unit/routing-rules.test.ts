/**
 * The routing-eval rule library (#5828): the checks a preregistered rule file is made of, the
 * negative control, and the replay of #5795 from its STORED results (no model call, no Mongo).
 *
 * Why the replay is pinned: #5795's rule (b), "flash catastrophic ≤ lite", flipped Persian on one
 * page in 30 and Derek overrode it. The library must give that same verdict under the rule as it
 * was registered, and must say what a rule with a margin gives on the same pages.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  wilson95, labelPrecision, countNoWorse, rateNonInferior, adjudicationWins, inventionVeto,
  groupInputs, plantInferior, applyRule, negativeControl,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/lib/routing-rules.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { decide, decideMarkdown } from '../../scripts/eval/routing-eval.mjs';

const ROOT = path.resolve(__dirname, '../..');
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const RESULTS = json('scripts/eval/results/hidden-flash-5795/results.json');
const REGISTERED = json('scripts/eval/routing-eval/rules/hidden-flash-5795-registered.json');
const MARGIN = json('scripts/eval/routing-eval/rules/margin-v1.json');
const pairs = (n: number, cand: number, base: number) => Array.from({ length: n }, (_, i) => ({ candidate: i < cand, baseline: i >= n - base }));

describe('rule library: the checks', () => {
  it('wilson95 matches the interval #5795 reported for 25 of 27', () => {
    expect(wilson95(25, 27)).toEqual([0.766, 0.979]);
    expect(wilson95(0, 0)).toBeNull();
  });

  it('labelPrecision reads the point estimate by default and the lower bound when asked', () => {
    expect(labelPrecision({ yes: 25, n: 27 }).pass).toBe(true);
    expect(labelPrecision({ yes: 25, n: 27 }, { use: 'wilson_lower' }).pass).toBe(false);
    expect(labelPrecision({ yes: 22, n: 30 }).pass).toBe(false);
    expect(labelPrecision({ yes: 0, n: 0 }).pass).toBeNull();
  });

  it('countNoWorse without slack fails on one page; with the cost-lane slack of 1 it passes', () => {
    expect(countNoWorse({ candidate: 1, baseline: 0 }).pass).toBe(false);
    expect(countNoWorse({ candidate: 1, baseline: 0 }, { slack: 1 }).pass).toBe(true);
    expect(countNoWorse({ candidate: 2, baseline: 0 }, { slack: 1 }).pass).toBe(false);
  });

  it('rateNonInferior: one failure in 30 against none is inside a 10-point margin and outside a 5-point one', () => {
    const one = rateNonInferior(pairs(30, 1, 0), { margin: 0.1, slack: 1 });
    expect(one.pass).toBe(true);
    expect(one.rate_diff).toBe(0.033);
    expect(one.rate_diff_ci95[1]).toBeLessThanOrEqual(0.1);
    expect(one.candidate_wilson95).toEqual([0.006, 0.167]);
    expect(one.discordant).toMatchObject({ candidate_only: 1, baseline_only: 0 });
    expect(rateNonInferior(pairs(30, 1, 0), { margin: 0.05, slack: 1 }).pass).toBe(false);
  });

  it('rateNonInferior is seeded: the same pages give the same interval', () => {
    expect(rateNonInferior(pairs(30, 4, 2))).toEqual(rateNonInferior(pairs(30, 4, 2)));
  });

  it('NEGATIVE CONTROL: a planted inferior arm FAILS the margin rule', () => {
    // 8 failures in 30 against 1: no margin a routing decision would accept covers that.
    const bad = rateNonInferior(pairs(30, 8, 1), { margin: 0.1, slack: 1 });
    expect(bad.pass).toBe(false);
    expect(bad.rate_diff_ci95[1]).toBeGreaterThan(0.1);
    expect(bad.min_margin_to_pass).toBeNull();
    // Inside the count slack but outside the margin: 2 against 1 passes the slack, and the interval must still refuse 4 against 3 of 12.
    expect(rateNonInferior(pairs(12, 4, 3), { margin: 0.1, slack: 1 }).pass).toBe(false);
  });

  it('plantInferior builds an arm that is worse than the baseline on every group, and both rule files refuse it', () => {
    for (const g of ['fas', 'san', 'pli', 'ara']) for (const rule of [REGISTERED, MARGIN]) {
      const x = groupInputs(RESULTS, g, rule);
      const planted = plantInferior(x);
      const k = (key: 'candidate' | 'baseline') => planted.pairs.filter((p: Record<string, boolean>) => p[key]).length;
      expect(k('candidate')).toBeGreaterThanOrEqual(k('baseline') + 2);
      expect(negativeControl(rule, x)).toMatchObject({ held: true });
    }
    expect(negativeControl(MARGIN, groupInputs(RESULTS, 'gez', MARGIN))).toBeNull(); // one page: the rule is not applied
  });

  it('adjudicationWins: a tie fails ("more than"), and the Wilson mode asks for more than a bare majority', () => {
    expect(adjudicationWins({ wins: 0, losses: 0 }).pass).toBe(false);
    expect(adjudicationWins({ wins: 3, losses: 3 }).pass).toBe(false);
    expect(adjudicationWins({ wins: 9, losses: 0 }).pass).toBe(true);
    expect(adjudicationWins({ wins: 3, losses: 2 }).pass).toBe(true);
    expect(adjudicationWins({ wins: 3, losses: 2 }, { mode: 'wilson_lower' }).pass).toBe(false);
    expect(adjudicationWins({ wins: 9, losses: 0 }, { mode: 'wilson_lower' }).pass).toBe(true);
  });

  it('inventionVeto: one invented page by the candidate fails, whatever the baseline did', () => {
    expect(inventionVeto({ candidateInvented: [], baselineInvented: ['x', 'y'] }).pass).toBe(true);
    expect(inventionVeto({ candidateInvented: ['pli-11'], baselineInvented: ['pli-03'] }).pass).toBe(false);
  });

  it('applyRule refuses a check it does not know, and reports "pending" until the adjudication is complete', () => {
    const x = groupInputs(RESULTS, 'fas', REGISTERED);
    expect(() => applyRule({ ...REGISTERED, checks: [{ id: 'z', rule: 'vibes' }] }, x)).toThrow(/unknown check/);
    expect(applyRule(REGISTERED, { ...x, adjudication: null }).verdict).toBe('pending adjudication');
  });
});

describe('#5795 replayed from its stored results.json', () => {
  it('the rule as registered reproduces every stored verdict and every stored a/b/c', () => {
    for (const [g, fam] of Object.entries(RESULTS.families) as [string, { verdict: string; rule: Record<string, boolean> }][]) {
      const out = applyRule(REGISTERED, groupInputs(RESULTS, g, REGISTERED));
      expect([g, out.verdict]).toEqual([g, fam.verdict]);
      expect([g, out.passed]).toEqual([g, fam.rule]);
    }
  });

  it('Persian: "stay on lite" as registered (fails (b) by one page), "route to flash" under the margin rule', () => {
    const x = groupInputs(RESULTS, 'fas', REGISTERED);
    expect(applyRule(REGISTERED, x)).toMatchObject({ verdict: 'stay on lite', passed: { a: true, b: false, c: true } });
    const m = applyRule(MARGIN, x);
    expect(m).toMatchObject({ verdict: 'route to flash', passed: { a: true, b: true, c: true } });
    expect(m.checks.b).toMatchObject({ candidate: 1, baseline: 0, n: 30 });
  });

  it('the margin rule changes no other family: labels still send Sanskrit, Pali and Arabic to relabelling, Ge\'ez is too small', () => {
    for (const g of ['san', 'pli', 'ara']) expect(applyRule(MARGIN, groupInputs(RESULTS, g, MARGIN)).verdict).toBe('relabel (#4884)');
    expect(applyRule(MARGIN, groupInputs(RESULTS, 'gez', MARGIN)).verdict).toBe('undecided: n too small');
  });

  it('the committed reproduction (routing-eval.json / .md) is what the tool writes today', () => {
    const d = decide(RESULTS, [REGISTERED, MARGIN]);
    const committed = json('scripts/eval/results/hidden-flash-5795/routing-eval.json');
    expect({ ...d, inputs: committed.inputs }).toEqual(committed);
    expect(decideMarkdown(d)).toBe(fs.readFileSync(path.join(ROOT, 'scripts/eval/results/hidden-flash-5795/routing-eval.md'), 'utf8'));
  });
});

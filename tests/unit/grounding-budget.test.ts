/**
 * The monthly grounded-search ceiling (default $100) and its standing coverage guard.
 *
 * Why: two FT verification runs in Aug–Sep 2026 billed $3,229 in Google search queries
 * while logging ~$30 — every budget counted tokens only. scripts/lib/grounding-budget.mjs
 * records the search fee and refuses a run past the monthly cap; this file pins that it
 * (a) fails closed on an unreadable meter, (b) stops at the cap, and (c) that every file
 * enabling `googleSearch` actually uses it.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
// @ts-expect-error — plain .mjs module without type declarations
import { openGroundingBudget, monthlyCapUsd } from '../../scripts/lib/grounding-budget.mjs';

const env = { SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const quiet = { log: () => {}, warn: () => {} };
const meterReturning = (rows: Array<{ cost_usd: number }>) =>
  async () => ({ ok: true, status: 200, json: async () => rows }) as unknown as Response;

describe('grounding budget', () => {
  it('defaults to a $100 monthly cap and honours the env override', () => {
    expect(monthlyCapUsd({})).toBe(100);
    expect(monthlyCapUsd({ GROUNDING_MONTHLY_CAP_USD: '40' })).toBe(40);
  });

  it('fails closed when the meter cannot be read', async () => {
    const broken = async () => ({ ok: false, status: 500, json: async () => [] }) as unknown as Response;
    await expect(openGroundingBudget({ endpoint: 't', env, fetchImpl: broken, log: quiet })).rejects.toThrow(/refusing to spend/);
    await expect(openGroundingBudget({ endpoint: 't', env: {}, fetchImpl: broken, log: quiet })).rejects.toThrow(/refusing to spend/);
  });

  it('refuses to open once the month is at the cap', async () => {
    await expect(openGroundingBudget({ endpoint: 't', env, fetchImpl: meterReturning([{ cost_usd: 60 }, { cost_usd: 40 }]), log: quiet }))
      .rejects.toThrow(/cap/);
  });

  it('stops allowing calls when this run spends the remainder', async () => {
    const gb = await openGroundingBudget({ endpoint: 't', env, fetchImpl: meterReturning([{ cost_usd: 99 }]), log: quiet });
    expect(gb.remaining()).toBeCloseTo(1);
    expect(gb.allows()).toBe(true);
    // 60 queries on gemini-3-flash-preview at $0.014 = $0.84; the usage write is best-effort.
    const cost = await gb.record({ model: 'gemini-3-flash-preview', queries: 60 });
    expect(cost).toBeCloseTo(0.84);
    expect(gb.allows()).toBe(false);
  });
});

/**
 * Coverage guard: every tracked file that enables grounding must import the budget.
 * ALLOW-LIST entries need a reason a reviewer can check.
 */
const ALLOW: Record<string, string> = {
  // gemini-2.5-flash grounding is billed per grounded PROMPT and the first 1,500/day are
  // free; the route has run ~60 grounded prompts in Aug–Sep 2026, all in the free tier.
  // The external backstop is the grounding line in scripts/audit/spend-reconcile.mjs.
  'src/app/api/identify/route.ts': 'free-tier 2.5-flash grounding on a reader request path',
  'scripts/lib/grounding-budget.mjs': 'the budget itself',
  'scripts/lib/model-pricing.mjs': 'the price table; names the tool in a comment, makes no call',
  'tests/unit/grounding-budget.test.ts': 'this test',
};

describe('every googleSearch call site is under the monthly budget', () => {
  const files = execSync("git grep -l -E 'googleSearch\\s*:' -- 'src/**' 'scripts/**' 'tests/**' ':!**/*.md'", { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  it('finds the known grounded scripts (positive control)', () => {
    expect(files).toContain('scripts/eval/ft-ladder.ts');
  });
  for (const f of files) {
    if (ALLOW[f]) continue;
    it(`${f} imports grounding-budget`, () => {
      expect(fs.readFileSync(f, 'utf8')).toMatch(/grounding-budget\.mjs/);
    });
  }
});

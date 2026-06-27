import { describe, it, expect } from 'vitest';
import { resolve, type Tier, type Tiers } from '@/lib/first-translation/resolve';
import { summarizePriorEvidence } from '@/lib/first-translation/prior-evidence';
import type { FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';

const at = (over: Partial<FirstTranslationAttempt>): FirstTranslationAttempt => ({
  attempt_id: 'a', book_id: 'b', date: '2026-06-27T00:00:00Z', method: 'tier2_agent',
  match_key: 'author_title', sources_checked: [], result: 'none', evidence_strength: 'moderate', ...over,
});

// A tier that records whether it ran, so we can prove the short-circuit spends nothing.
function spyTier(ran: { count: number }): Tier {
  return async (_book, ctx) => {
    ran.count++;
    return {
      verdict: { verdict: 'first_no_prior', evidence_strength: 'moderate', our_completeness: 'unknown', match_key: 'none', resolver: 'tier1_catalog', resolved_at: ctx.now },
      attempt: at({ attempt_id: 'fresh' }),
      terminal: true,
    };
  };
}

describe('resolve — read-before-verify short-circuit (#2780)', () => {
  const now = '2026-06-27T00:00:00Z';

  it('reuse_prior → NOT_FIRST with zero tier calls and zero new attempts', async () => {
    const ran = { count: 0 };
    const tiers: Tiers = { tier0: spyTier(ran), tier1: spyTier(ran), tier2: spyTier(ran) };
    const pe = summarizePriorEvidence([
      at({ attempt_id: 'gem-1', method: 'gemini_verifier', result: 'found', evidence_strength: 'strong',
        priors: [{ english_title: 'The Foo', source_url: 'https://archive.org/x' }] }),
    ]);
    const res = await resolve({ id: 'b' }, tiers, { now, priorEvidence: pe });
    expect(ran.count).toBe(0); // spent nothing
    expect(res.attempts).toEqual([]);
    expect(res.resolved.verdict).toBe('not_first');
    expect(res.resolved.best_attempt_id).toBe('gem-1'); // points at the reused evidence
  });

  it('forceTier2 overrides reuse — the sampler still gets a fresh pass', async () => {
    const ran = { count: 0 };
    const tiers: Tiers = { tier0: spyTier(ran), tier1: spyTier(ran), tier2: spyTier(ran) };
    const pe = summarizePriorEvidence([
      at({ result: 'found', evidence_strength: 'strong', priors: [{ english_title: 'X', source_url: 'https://x.org' }] }),
    ]);
    const res = await resolve({ id: 'b' }, tiers, { now, priorEvidence: pe, forceTier2: true });
    expect(ran.count).toBeGreaterThan(0); // did NOT short-circuit
    expect(res.resolved.verdict).toBe('first_no_prior');
  });

  it('no reusable prior (absence only) → runs the cascade normally', async () => {
    const ran = { count: 0 };
    const tiers: Tiers = { tier0: spyTier(ran), tier1: spyTier(ran) };
    const pe = summarizePriorEvidence([at({ method: 'gemini_verifier', result: 'none' })]);
    const res = await resolve({ id: 'b' }, tiers, { now, priorEvidence: pe });
    expect(ran.count).toBeGreaterThan(0);
    expect(res.resolved.verdict).toBe('first_no_prior');
  });

  it('no priorEvidence at all → unchanged behaviour (runs cascade)', async () => {
    const ran = { count: 0 };
    const tiers: Tiers = { tier0: spyTier(ran), tier1: spyTier(ran) };
    const res = await resolve({ id: 'b' }, tiers, { now });
    expect(ran.count).toBeGreaterThan(0);
  });

  it('summarizePriorEvidence exposes foundAttemptId for the reuse path', () => {
    const s = summarizePriorEvidence([
      at({ attempt_id: 'keep-me', result: 'found', evidence_strength: 'strong',
        priors: [{ english_title: 'Y', source_url: 'https://y.org' }] }),
    ]);
    expect(s.foundAttemptId).toBe('keep-me');
    const none = summarizePriorEvidence([at({ result: 'none' })]);
    expect(none.foundAttemptId).toBeNull();
  });
});

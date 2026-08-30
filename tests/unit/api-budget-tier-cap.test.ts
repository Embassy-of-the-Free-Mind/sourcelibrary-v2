import { describe, it, expect } from 'vitest';
import { pickLimit } from '@/lib/api-budget';
import { DATASET_TIERS } from '@/lib/dataset/types';
import type { ApiIdentity } from '@/lib/api-auth';

/**
 * Business-model invariant (the "/text hole", closed 2026-07-05): the free
 * Explorer API tier must be page-capped on /api/books/[id]/text, while paid
 * tiers stay uncapped. Before the fix, pickLimit handed EVERY apikey identity
 * Infinity — so a free Explorer key could pull the whole corpus (one key had
 * extracted ~1.9M pages). These tests pin the mapping so it can't regress.
 */

const key = (tier?: string): ApiIdentity => ({
  kind: 'apikey',
  apiKeyId: 'k1',
  userId: 'u1',
  apiKeyTier: tier,
});

describe('pickLimit — API key tier caps on /text', () => {
  it('caps the free Explorer tier at its published daily budget (finite, above session)', () => {
    const { limit, tier } = pickLimit(key('explorer'));
    expect(limit).toBe(DATASET_TIERS.explorer.pagesPerDay);
    // Raised 100 → 2000 in #4366: a free key must OUT-RANK anonymous (500)
    // and session (1000) access — identity is an upgrade, never a downgrade.
    expect(limit).toBe(2000);
    expect(Number.isFinite(limit)).toBe(true);
    expect(tier).toBe('apikey');
  });

  it('leaves paid tiers uncapped (pagesPerDay: 0 → Infinity)', () => {
    for (const t of ['language', 'domain', 'full', 'enterprise'] as const) {
      expect(pickLimit(key(t)).limit).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('treats an unknown or absent tier as Explorer (safe floor, never unlimited)', () => {
    expect(pickLimit(key('bogus')).limit).toBe(DATASET_TIERS.explorer.pagesPerDay);
    expect(pickLimit(key(undefined)).limit).toBe(DATASET_TIERS.explorer.pagesPerDay);
  });

  it('keeps verified bots (SEO crawlers) uncapped', () => {
    expect(pickLimit({ kind: 'bot', bot: 'googlebot' }).limit).toBe(Number.POSITIVE_INFINITY);
  });

  it('applies the session and anon page budgets unchanged', () => {
    expect(pickLimit({ kind: 'session', userId: 'u1' }).tier).toBe('session');
    expect(pickLimit({ kind: 'anon' }).tier).toBe('anon');
  });
});

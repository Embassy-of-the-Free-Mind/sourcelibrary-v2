import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { API_LIMITS, keyRequestsPerMinute } from '@/lib/api-limits';
import { DATASET_TIERS } from '@/lib/dataset/types';

/**
 * #4366 — the coherence guards.
 *
 * 1. The ORDERING INVARIANT: identity is an upgrade at every step. The 2026
 *    field norm (Wikimedia, Unsplash, Europeana) is that identified callers
 *    get more, instantly. Before this, a free key LOWERED a signed-in
 *    caller's allowance from 1,000 pages/day to 100.
 *
 * 2. The DOCS PIN: every prose copy of a limit must match the module. A
 *    number that lives in prose but not in api-limits.ts is a bug; if you
 *    change the module, this test walks you to each copy that must move.
 */

const repo = join(__dirname, '..', '..');

describe('the ordering invariant — a key is never a downgrade', () => {
  it('anon < session < free key on daily pages', () => {
    expect(API_LIMITS.anon.pagesPerDay).toBeLessThan(API_LIMITS.session.pagesPerDay);
    expect(API_LIMITS.session.pagesPerDay).toBeLessThan(API_LIMITS.explorerKey.pagesPerDay);
  });

  it('same ordering for images', () => {
    expect(API_LIMITS.anon.imagesPerDay).toBeLessThan(API_LIMITS.session.imagesPerDay);
    expect(API_LIMITS.session.imagesPerDay).toBeLessThan(API_LIMITS.explorerKey.imagesPerDay);
  });

  it('paid tiers stay uncapped on pages (pagesPerDay: 0 = unlimited by design)', () => {
    for (const t of ['language', 'domain', 'full', 'enterprise'] as const) {
      expect(DATASET_TIERS[t].pagesPerDay).toBe(0);
    }
  });

  it('explorer tier and the module agree (single source)', () => {
    expect(API_LIMITS.explorerKey.pagesPerDay).toBe(DATASET_TIERS.explorer.pagesPerDay);
    expect(API_LIMITS.explorerKey.requestsPerMinute).toBe(DATASET_TIERS.explorer.requestsPerMinute);
  });
});

describe('keyRequestsPerMinute — stored value vs tier default', () => {
  it('takes the larger of stored and tier default (old keys keep working after a raise)', () => {
    expect(keyRequestsPerMinute({ tier: 'explorer', rate_limit: { requests_per_minute: 10 } }))
      .toBe(DATASET_TIERS.explorer.requestsPerMinute);
    expect(keyRequestsPerMinute({ tier: 'explorer', rate_limit: { requests_per_minute: 500 } }))
      .toBe(500);
    expect(keyRequestsPerMinute({ tier: 'enterprise' }))
      .toBe(DATASET_TIERS.enterprise.requestsPerMinute);
    expect(keyRequestsPerMinute({})).toBe(DATASET_TIERS.explorer.requestsPerMinute);
  });
});

describe('the docs pin — prose copies match the module', () => {
  const explorer = API_LIMITS.explorerKey.pagesPerDay.toLocaleString('en-US');
  const anon = API_LIMITS.anon.pagesPerDay.toLocaleString('en-US');
  const session = API_LIMITS.session.pagesPerDay.toLocaleString('en-US');

  it('MCP tool prose states the current budgets', () => {
    const mcp = readFileSync(join(repo, 'src/app/api/mcp/route.ts'), 'utf8');
    expect(mcp).toContain(
      `anonymous ${anon} pages/24h, signed-in ${session}, free Explorer keys ${explorer}, paid keys uncapped`,
    );
  });

  it('llms.txt states the current free-tier budget', () => {
    const llms = readFileSync(join(repo, 'public/llms.txt'), 'utf8');
    expect(llms).toContain(`free self-serve tier (${explorer} pages/day)`);
    // The stale claim must be gone.
    expect(llms).not.toContain('100 pages/day');
  });

  it('/dataset page states the current Explorer scope', () => {
    const page = readFileSync(join(repo, 'src/app/dataset/page.tsx'), 'utf8');
    expect(page).toContain(`${explorer} pages/day`);
    expect(page).not.toContain("'100 pages/day");
  });

  it('robots.txt declares the RSL license document', () => {
    const robots = readFileSync(join(repo, 'src/app/robots.txt/route.ts'), 'utf8');
    expect(robots).toContain('License: ${BASE_URL}/license.xml');
  });
});

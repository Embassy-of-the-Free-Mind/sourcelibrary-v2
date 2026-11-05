import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/api-usage', () => ({ getPagesServedLast24h: async () => 0 }));

import { bulkBudgetExceededBody, type BudgetCheck } from '@/lib/api-budget';

/**
 * An assistant reading for someone cannot sign in or get a key. When it runs out
 * of budget, the refusal has to name a page it can still open, or the person
 * gets nothing (#8161).
 */
describe('page budget refusal', () => {
  const anon: BudgetCheck = { allowed: false, used: 500, limit: 500, remaining: 0, tier: 'anon' };
  const url = 'https://sourcelibrary.org/book/abc/page/99';

  it('names the reader page when the route knows it', () => {
    const body = bulkBudgetExceededBody(anon, url);
    expect(body.next_steps).toMatchObject({ read_on_site: url });
    expect(body.error).toContain(url);
    // A trailing full stop glued to a URL breaks it when a model copies the link.
    expect(body.error).not.toContain(`${url}.`);
  });

  it('keeps the sign-in and key routes for a person', () => {
    const body = bulkBudgetExceededBody(anon, url);
    expect(body.next_steps.sign_in).toContain('/auth/signin');
    expect(body.next_steps.get_api_key).toContain('/developers');
  });

  it('says nothing about the site when the route has no page to name', () => {
    const body = bulkBudgetExceededBody(anon);
    expect(body.next_steps).not.toHaveProperty('read_on_site');
    expect(body.error).not.toContain('does not count');
  });
});

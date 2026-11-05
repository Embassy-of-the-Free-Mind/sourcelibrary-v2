import { execSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadChargesEnabled, membershipCheckoutEnabled } from '@/lib/payment-flags';

describe('payment flags (#8227)', () => {
  afterEach(() => vi.unstubAllEnvs());

  function env(key: string, charges: string, membership: string) {
    vi.stubEnv('STRIPE_SECRET_KEY', key);
    vi.stubEnv('DOWNLOAD_CHARGES_ENABLED', charges);
    vi.stubEnv('NEXT_PUBLIC_MEMBERSHIP_CHECKOUT_ENABLED', membership);
  }

  it('a Stripe key alone charges nobody and opens nothing', () => {
    env('sk_test_x', '', '');
    expect(downloadChargesEnabled()).toBe(false);
    expect(membershipCheckoutEnabled()).toBe(false);
  });

  it('opening membership does not turn on download charges', () => {
    env('sk_test_x', '', 'true');
    expect(membershipCheckoutEnabled()).toBe(true);
    expect(downloadChargesEnabled()).toBe(false);
  });

  it('a flag without a key does nothing', () => {
    env('', 'true', 'true');
    expect(downloadChargesEnabled()).toBe(false);
    expect(membershipCheckoutEnabled()).toBe(false);
  });

  it('charges need their own flag', () => {
    env('sk_test_x', 'true', '');
    expect(downloadChargesEnabled()).toBe(true);
    expect(membershipCheckoutEnabled()).toBe(false);
  });

  it('nothing outside the flags and the client reads the key', () => {
    const hits = execSync(`git grep -l "process\\.env\\.STRIPE_SECRET_KEY" -- src`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .sort();
    expect(hits).toEqual(['src/lib/payment-flags.ts', 'src/lib/stripe.ts']);
  });
});

/**
 * Per-account reading checks in the traffic detector (2026-11-11). Every older check
 * works per network, so a scraper on one free account at a person's pace per minute
 * was invisible. Pinned: a capped account always surfaces, a heavy one warns, farmed
 * accounts on one address show, and ordinary readers stay quiet.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs worker, no types
import { accountFindings, ACCOUNT_HEAVY_PAGES, SHARED_ADDRESS_MIN_ACCOUNTS, SHARED_ADDRESS_MIN_PAGES } from '../../scripts/workers/traffic-anomaly-alert.mjs';

const acct = (user_id: string, reader_pages: number, capped_calls = 0) => ({ user_id, reader_pages, text_pages: 0, capped_calls, addresses: 1, agents: [] });

describe('accountFindings', () => {
  it('surfaces an account that hit the cap, whatever its page count', () => {
    const r = accountFindings([acct('a', 10, 1), acct('b', 50)]);
    expect(r.capped.map((a: { user_id: string }) => a.user_id)).toEqual(['a']);
    expect(r.heavy).toEqual([]);
  });

  it('warns on a heavy account under the cap, and not on ordinary readers', () => {
    const r = accountFindings([acct('h', ACCOUNT_HEAVY_PAGES), acct('r', ACCOUNT_HEAVY_PAGES - 1)]);
    expect(r.heavy.map((a: { user_id: string }) => a.user_id)).toEqual(['h']);
  });

  it('flags an address with several accounts each reading in earnest', () => {
    const many = Array.from({ length: SHARED_ADDRESS_MIN_ACCOUNTS }, (_, i) => ({ user_id: `u${i}`, pages: SHARED_ADDRESS_MIN_PAGES }));
    const r = accountFindings([], [
      { ip_hash: 'farm', accounts: many },
      { ip_hash: 'family', accounts: [...many.slice(0, SHARED_ADDRESS_MIN_ACCOUNTS - 1), { user_id: 'light', pages: 5 }] },
    ]);
    expect(r.shared.map((x: { ip_hash: string }) => x.ip_hash)).toEqual(['farm']);
  });

  it('is empty on no data', () => {
    expect(accountFindings()).toEqual({ capped: [], heavy: [], shared: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { API_TERMS_DEADLINE, API_TERMS_VERSION, keyBlockedForTerms, keyHasCurrentTerms } from '@/lib/api-terms-version';

const before = new Date(new Date(API_TERMS_DEADLINE).getTime() - 1000);
const after = new Date(new Date(API_TERMS_DEADLINE).getTime() + 1000);

describe('API terms gate (#8235)', () => {
  it('lets a free key without terms through until the deadline', () => {
    expect(keyBlockedForTerms({ tier: 'explorer' }, before)).toBe(false);
  });

  it('refuses a free key without terms after the deadline', () => {
    expect(keyBlockedForTerms({ tier: 'explorer' }, after)).toBe(true);
    expect(keyBlockedForTerms({ tier: 'explorer', terms_version: '2026-11-04' }, after)).toBe(true);
  });

  it('treats a key with no tier as free', () => {
    expect(keyBlockedForTerms({}, after)).toBe(true);
  });

  it('serves a free key that agreed to the current terms', () => {
    expect(keyBlockedForTerms({ tier: 'explorer', terms_version: API_TERMS_VERSION }, after)).toBe(false);
    expect(keyHasCurrentTerms({ terms_version: API_TERMS_VERSION })).toBe(true);
  });

  it('never refuses a paid or partner tier for terms', () => {
    for (const tier of ['language', 'domain', 'full', 'enterprise']) {
      expect(keyBlockedForTerms({ tier }, after)).toBe(false);
    }
  });
});

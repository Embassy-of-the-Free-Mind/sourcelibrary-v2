import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintCitationToken, verifyCitationToken } from '@/lib/citation-token';

/**
 * Pins the citation-token exception to the metered reader (#4357): a /q/
 * quote link mints a per-page capability so published citations always
 * resolve. Guards: tokens verify only for the page they were minted for
 * (cannot be walked along the book), and with no secret nothing mints or
 * verifies (fail closed).
 */
describe('citation tokens', () => {
  const priorAuth = process.env.AUTH_SECRET;
  const priorNextAuth = process.env.NEXTAUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret-for-citation-tokens';
    delete process.env.NEXTAUTH_SECRET;
  });
  afterEach(() => {
    if (priorAuth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = priorAuth;
    if (priorNextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = priorNextAuth;
  });

  it('mints a stable 32-hex token and verifies it for the same page', () => {
    const token = mintCitationToken('page-abc');
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(mintCitationToken('page-abc')).toBe(token);
    expect(verifyCitationToken('page-abc', token)).toBe(true);
  });

  it('a token for one page never verifies for another', () => {
    const token = mintCitationToken('page-abc')!;
    expect(verifyCitationToken('page-xyz', token)).toBe(false);
  });

  it('rejects malformed and missing tokens', () => {
    expect(verifyCitationToken('page-abc', null)).toBe(false);
    expect(verifyCitationToken('page-abc', undefined)).toBe(false);
    expect(verifyCitationToken('page-abc', 'not-a-token')).toBe(false);
    expect(verifyCitationToken('page-abc', '')).toBe(false);
  });

  it('fails closed with no secret: mints nothing, verifies nothing', () => {
    const token = mintCitationToken('page-abc')!;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(mintCitationToken('page-abc')).toBeNull();
    expect(verifyCitationToken('page-abc', token)).toBe(false);
  });
});

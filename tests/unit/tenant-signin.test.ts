import { describe, it, expect } from 'vitest';
import { buildSignInHref, isTenantSubdomain } from '@/lib/tenant-signin-url';
import { resolvePostSignInRedirect, isSourceLibraryHost } from '@/lib/auth-redirect';

/**
 * Sign-in from a partner subdomain (#3468).
 *
 * These call the real functions rather than asserting that some string appears
 * in a source file. Per CLAUDE.md ("A test that greps source is not a guard"),
 * the question to ask of each case is: what code change makes it fail?
 * Here, breaking either half of the round trip does — which is the point,
 * because the two halves live in different files and each looks harmless to
 * delete on its own.
 */

describe('isTenantSubdomain', () => {
  it('recognises partner subdomains', () => {
    expect(isTenantSubdomain('bph.sourcelibrary.org')).toBe(true);
    expect(isTenantSubdomain('kloss-collection.sourcelibrary.org')).toBe(true);
  });

  it('excludes the apex, previews and localhost', () => {
    expect(isTenantSubdomain('sourcelibrary.org')).toBe(false);
    expect(isTenantSubdomain('sourcelibrary-v2-git-foo.vercel.app')).toBe(false);
    expect(isTenantSubdomain('localhost:3000')).toBe(false);
  });
});

describe('buildSignInHref', () => {
  it('sends a BPH visitor to the apex and brings them back to the exact page', () => {
    const href = buildSignInHref(
      'bph.sourcelibrary.org',
      'https://bph.sourcelibrary.org/catalog/BPH%20151'
    );

    const url = new URL(href);
    expect(url.origin).toBe('https://sourcelibrary.org');
    expect(url.pathname).toBe('/auth/signin');
    // The whole point: the callback must return to the TENANT host, not the apex.
    expect(url.searchParams.get('callbackUrl')).toBe(
      'https://bph.sourcelibrary.org/catalog/BPH%20151'
    );
  });

  it('never emits a relative sign-in link on a tenant host', () => {
    // A relative /auth/signin is swallowed by the proxy rewrite and lands on
    // the tenant homepage — "nothing happens", which is the original bug.
    const href = buildSignInHref('bph.sourcelibrary.org', 'https://bph.sourcelibrary.org/');
    expect(href.startsWith('https://sourcelibrary.org/')).toBe(true);
  });

  it('stays relative off-tenant so previews and localhost work', () => {
    expect(
      buildSignInHref('sourcelibrary.org', 'https://sourcelibrary.org/catalog/X?a=1')
    ).toBe('/auth/signin?callbackUrl=%2Fcatalog%2FX%3Fa%3D1');

    expect(
      buildSignInHref('localhost:3000', 'http://localhost:3000/catalog/X')
    ).toBe('/auth/signin?callbackUrl=%2Fcatalog%2FX');
  });

  it('degrades to the homepage rather than throwing on a junk current URL', () => {
    expect(buildSignInHref('sourcelibrary.org', 'not a url')).toBe(
      '/auth/signin?callbackUrl=%2F'
    );
  });
});

describe('resolvePostSignInRedirect', () => {
  const baseUrl = 'https://sourcelibrary.org';

  it('permits the return trip to a tenant subdomain', () => {
    // Without this, NextAuth's default callback drops the cataloguer on the
    // apex after sign-in and it reads as "signing in did not work".
    expect(
      resolvePostSignInRedirect('https://bph.sourcelibrary.org/catalog/BPH%20151', baseUrl)
    ).toBe('https://bph.sourcelibrary.org/catalog/BPH%20151');
  });

  it('keeps NextAuth default behaviour for relative and same-origin URLs', () => {
    expect(resolvePostSignInRedirect('/account', baseUrl)).toBe(
      'https://sourcelibrary.org/account'
    );
    expect(resolvePostSignInRedirect('https://sourcelibrary.org/x', baseUrl)).toBe(
      'https://sourcelibrary.org/x'
    );
  });

  it('is not an open redirect', () => {
    for (const hostile of [
      'https://evil.com/phish',
      'https://evilsourcelibrary.org/phish',        // no dot separator
      'https://sourcelibrary.org.evil.com/phish',   // apex as a prefix
      'https://bph.sourcelibrary.org.evil.com/x',   // subdomain as a prefix
      'https://sourcelibrary.org@evil.com/phish',   // userinfo trick
      'http://bph.sourcelibrary.org/x',             // downgraded to http
      'javascript:alert(1)',
      'garbage',
    ]) {
      expect(resolvePostSignInRedirect(hostile, baseUrl), hostile).toBe(baseUrl);
    }
  });
});

describe('isSourceLibraryHost', () => {
  it('requires https and a real dot-separated subdomain', () => {
    expect(isSourceLibraryHost(new URL('https://bph.sourcelibrary.org/'))).toBe(true);
    expect(isSourceLibraryHost(new URL('https://sourcelibrary.org/'))).toBe(true);
    expect(isSourceLibraryHost(new URL('http://bph.sourcelibrary.org/'))).toBe(false);
    expect(isSourceLibraryHost(new URL('https://notsourcelibrary.org/'))).toBe(false);
  });
});

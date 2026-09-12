import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { getProviderPrefixRedirect, TENANT_ROOT_PATHS } from '@/lib/provider-prefix';
import { LIBRARY_PARTNERS } from '@/lib/library-partners';

// Provider-prefixed content URLs (/internet-archive/book/foo) must 308 to
// their global equivalent (/book/foo). This safety net shipped in PR #2025,
// was removed in commit 8e348991 (its Mongo `kind:'provider'` lookup
// conflicted with tenant resolution), and the regression showed up as ~770
// provider-prefixed 404s/week in not_found_reports. The redirect is now
// derived statically from LIBRARY_PARTNERS — these tests guard both the
// mapping and the proxy wiring so it can't be silently dropped again.

describe('getProviderPrefixRedirect', () => {
  it('strips a provider prefix from content paths', () => {
    expect(getProviderPrefixRedirect('/internet-archive/book/the-kybalion')).toBe(
      '/book/the-kybalion'
    );
    expect(getProviderPrefixRedirect('/gallica/gallery/image/abc-0')).toBe(
      '/gallery/image/abc-0'
    );
    expect(
      getProviderPrefixRedirect('/internet-archive/book/foo/page-number/31')
    ).toBe('/book/foo/page-number/31');
  });

  it('sends a bare provider root to its /libraries credit page', () => {
    expect(getProviderPrefixRedirect('/internet-archive')).toBe(
      '/libraries/internet-archive'
    );
    expect(getProviderPrefixRedirect('/bodleian/')).toBe('/libraries/bodleian');
  });

  it('never touches routing-tenant URL space', () => {
    for (const slug of TENANT_ROOT_PATHS) {
      expect(getProviderPrefixRedirect(`/${slug}`)).toBeNull();
      expect(getProviderPrefixRedirect(`/${slug}/book/foo`)).toBeNull();
    }
  });

  it('strips a /libraries/<lib> prefix off deep content paths', () => {
    expect(
      getProviderPrefixRedirect('/libraries/bibliotheca-philosophica-hermetica/book/the-new-jerusalem-teellinck')
    ).toBe('/book/the-new-jerusalem-teellinck');
    expect(getProviderPrefixRedirect('/libraries/bph/book/foo/page/abc123')).toBe(
      '/book/foo/page/abc123'
    );
    // Unknown library segments strip too — the content slug is what matters.
    expect(getProviderPrefixRedirect('/libraries/not-a-partner/gallery/image/x-0')).toBe(
      '/gallery/image/x-0'
    );
    // The credit page itself and non-content children stay untouched.
    expect(getProviderPrefixRedirect('/libraries/internet-archive')).toBeNull();
    expect(getProviderPrefixRedirect('/libraries')).toBeNull();
    expect(getProviderPrefixRedirect('/libraries/bph/about')).toBeNull();
  });

  it('strips the phantom default-tenant prefix', () => {
    expect(getProviderPrefixRedirect('/default/book/foo')).toBe('/book/foo');
    expect(getProviderPrefixRedirect('/default/book/foo/page/abc123')).toBe(
      '/book/foo/page/abc123'
    );
    expect(getProviderPrefixRedirect('/default')).toBe('/');
    expect(getProviderPrefixRedirect('/default/')).toBe('/');
  });

  it('ignores non-provider paths', () => {
    expect(getProviderPrefixRedirect('/book/foo')).toBeNull();
    expect(getProviderPrefixRedirect('/author/marsilio-ficino')).toBeNull();
    expect(getProviderPrefixRedirect('/libraries/internet-archive')).toBeNull();
    expect(getProviderPrefixRedirect('/api/books/123')).toBeNull();
    expect(getProviderPrefixRedirect('/_next/static/chunks/x.css')).toBeNull();
    expect(getProviderPrefixRedirect('/')).toBeNull();
  });

  it('covers every LIBRARY_PARTNERS slug except routing tenants', () => {
    for (const slug of Object.keys(LIBRARY_PARTNERS)) {
      const redirect = getProviderPrefixRedirect(`/${slug}/book/foo`);
      if (TENANT_ROOT_PATHS.has(slug)) {
        expect(redirect, `${slug} is a routing tenant`).toBeNull();
      } else {
        expect(redirect, `${slug} must strip`).toBe('/book/foo');
      }
    }
  });
});

describe('proxy wiring', () => {
  it('proxy.ts calls getProviderPrefixRedirect and issues a 308', () => {
    const src = readFileSync(
      path.join(path.resolve(__dirname, '../..'), 'src/proxy.ts'),
      'utf8'
    );
    expect(
      src,
      'src/proxy.ts must import getProviderPrefixRedirect from @/lib/provider-prefix'
    ).toMatch(/import\s*\{[^}]*getProviderPrefixRedirect[^}]*\}\s*from\s*['"]@\/lib\/provider-prefix['"]/);
    const callIdx = src.indexOf('getProviderPrefixRedirect(pathname)');
    expect(callIdx, 'proxy() must call getProviderPrefixRedirect(pathname)').toBeGreaterThan(-1);
    expect(
      src.slice(callIdx, callIdx + 400),
      'the provider strip must redirect with a 308'
    ).toMatch(/NextResponse\.redirect\([^)]*,\s*308\)/);
  });
});

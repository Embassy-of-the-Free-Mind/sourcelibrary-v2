/**
 * Search results inside /embed/<tenant> stay in the room, and the routes the
 * embed lacks open the page instead (#8047).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const nav = vi.hoisted(() => ({ pathname: '/embed/bph/search' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

import { useRoomResultHref } from '@/lib/EmbedContext';

const repoRoot = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

describe('useRoomResultHref', () => {
  beforeEach(() => { nav.pathname = '/embed/bph/search'; });
  // No React state in these hooks, only the mocked path, so they can be called directly.
  const href = (input: string) => useRoomResultHref()(input);

  it('keeps the prefix on /embed', () => {
    expect(href('/book/maier')).toBe('/embed/bph/book/maier');
    expect(href('/catalog/9180')).toBe('/embed/bph/catalog/9180');
  });
  it('opens the page where the embed has no guide route', () => {
    expect(href('/book/maier/guide?page=12')).toBe('/embed/bph/book/maier/page-number/12');
  });
  it('leaves the subdomain and the main site alone', () => {
    nav.pathname = '/search';
    expect(href('/book/maier')).toBe('/book/maier');
    expect(href('/book/maier/guide?page=12')).toBe('/book/maier/guide?page=12');
  });
});

describe('the search page', () => {
  const src = read('src/app/search/page.tsx');
  it('sends the tenant on its raw semantic fetch, header and cache key', () => {
    expect(src).toMatch(/semanticParams\.set\('tenant', tenant\)/);
    expect(src).toMatch(/\/api\/search\/semantic\?[^\n]*'X-Tenant-Slug': tenant/);
  });
  it('builds result links through the room hook', () => {
    const results = src.slice(src.indexOf('function WorkEditionsLink'));
    expect(results).not.toMatch(/= useLocalePath\(\)/);
  });
});

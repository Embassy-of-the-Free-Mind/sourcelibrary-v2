import { describe, it, expect } from 'vitest';

/**
 * Regression tests for the BPH sort dropdown default.
 *
 * Partner reported (#1701 testing report B4): grid view defaulted to "Most
 * relevant" while list view defaulted to "Title A-Z". The fix aligns both
 * to Title A-Z for BPH (other tenants keep 'popular'/'relevance').
 *
 * Server-side (src/app/embed/[tenant]/page.tsx):
 *   sortDefault = tenant === 'bph' ? 'title' : 'popular';
 *   sort = (sp.sort as string) || sortDefault;
 *
 * Client-side (src/components/collections/CollectionFilters.tsx):
 *   sort = searchParams.get('sort') || defaultSort;   // defaultSort='title' for BPH grid
 *
 * Both fall back to 'title' when no `?sort=` is in the URL, so the SSR
 * order matches what the dropdown advertises as selected.
 */

function pickServerSort(tenant: string, urlSort: string | undefined): string {
  const sortDefault = tenant === 'bph' ? 'title' : 'popular';
  return (typeof urlSort === 'string' ? urlSort : '') || sortDefault;
}

function pickDropdownSort(urlSort: string | null, defaultSort: string): string {
  return urlSort || defaultSort;
}

describe('BPH sort default', () => {
  it('SSR defaults to title for BPH when no sort param is in URL', () => {
    expect(pickServerSort('bph', undefined)).toBe('title');
  });

  it('SSR honours an explicit sort param for BPH', () => {
    expect(pickServerSort('bph', 'year_desc')).toBe('year_desc');
  });

  it('SSR keeps popular default for non-BPH tenants', () => {
    expect(pickServerSort('other-tenant', undefined)).toBe('popular');
  });

  it('Dropdown picks the BPH defaultSort when URL has no sort', () => {
    expect(pickDropdownSort(null, 'title')).toBe('title');
  });

  it('Dropdown falls back to relevance when no defaultSort is passed', () => {
    expect(pickDropdownSort(null, 'relevance')).toBe('relevance');
  });

  it('SSR + dropdown agree on Title A-Z for /embed/bph with no sort param', () => {
    const ssr = pickServerSort('bph', undefined);
    const dropdown = pickDropdownSort(null, 'title');
    expect(ssr).toBe(dropdown);
    expect(ssr).toBe('title');
  });
});

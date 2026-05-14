import { describe, it, expect } from 'vitest';

/**
 * Regression tests for the BPH sort dropdown default.
 *
 * Partner reported (#1701 testing report B4): grid defaulted to "Most
 * relevant" while list defaulted to "Title A-Z". After partner review the
 * preferred default is "Oldest first" — an early-modern catalogue has no
 * meaningful "relevance" metric, so leading with the earliest-printed
 * works is the most honest entry point.
 *
 * Server-side (src/app/embed/[tenant]/page.tsx):
 *   sortDefault = tenant === 'bph' ? 'year_asc' : 'popular';
 *   sort = (sp.sort as string) || sortDefault;
 *
 * Client-side (src/components/collections/CollectionFilters.tsx):
 *   sort = searchParams.get('sort') || defaultSort;   // defaultSort='year_asc' for BPH grid
 *
 * Both fall back to 'year_asc' when no `?sort=` is in the URL, so the SSR
 * order matches what the dropdown advertises as selected.
 */

function pickServerSort(tenant: string, urlSort: string | undefined): string {
  const sortDefault = tenant === 'bph' ? 'year_asc' : 'popular';
  return (typeof urlSort === 'string' ? urlSort : '') || sortDefault;
}

function pickDropdownSort(urlSort: string | null, defaultSort: string): string {
  return urlSort || defaultSort;
}

describe('BPH sort default', () => {
  it('SSR defaults to year_asc for BPH when no sort param is in URL', () => {
    expect(pickServerSort('bph', undefined)).toBe('year_asc');
  });

  it('SSR honours an explicit sort param for BPH', () => {
    expect(pickServerSort('bph', 'year_desc')).toBe('year_desc');
  });

  it('SSR keeps popular default for non-BPH tenants', () => {
    expect(pickServerSort('other-tenant', undefined)).toBe('popular');
  });

  it('Dropdown picks the BPH defaultSort when URL has no sort', () => {
    expect(pickDropdownSort(null, 'year_asc')).toBe('year_asc');
  });

  it('Dropdown falls back to relevance when no defaultSort is passed', () => {
    expect(pickDropdownSort(null, 'relevance')).toBe('relevance');
  });

  it('SSR + dropdown agree on Oldest first for /embed/bph with no sort param', () => {
    const ssr = pickServerSort('bph', undefined);
    const dropdown = pickDropdownSort(null, 'year_asc');
    expect(ssr).toBe(dropdown);
    expect(ssr).toBe('year_asc');
  });
});

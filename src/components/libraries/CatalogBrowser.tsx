'use client';

// Generic per-tenant catalogue browser. Reads from `/api/catalog/[tenant]`,
// which queries the unified `library_catalog_records` table. Modelled on
// BphCatalogBrowser; the BPH version stays in place because BPH still uses
// its own `bph_works` table with bespoke search columns.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { Search, X, ChevronLeft, ChevronRight, BookMarked, SlidersHorizontal } from 'lucide-react';
import { tenantBookUrl } from '@/lib/slugify';

export interface CatalogRecord {
  catalog_id: string;
  title: string | null;
  parallel_title: string | null;
  uniform_title: string | null;
  author: string | null;
  variant_author: string | null;
  pseudonym: string | null;
  editor: string | null;
  variant_editor: string | null;
  place: string | null;
  printer: string | null;
  publisher: string | null;
  variant_printer: string | null;
  variant_publisher: string | null;
  year: number | null;
  year_text: string | null;
  shelf_mark: string | null;
  state_shelf_mark: string | null;
  present_location: string | null;
  keywords: string | null;
  language: string | null;
  series_title: string | null;
  volume_title: string | null;
  bibliography: string | null;
  remarks: string | null;
  number_of_copies: number | null;
  object_size_cm: string | null;
  binding: string | null;
  bound_with: string | null;
  provenance: string | null;
  thumbnail: string | null;
  file_count: number | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
  sl_external_book_id?: string | null;
  sl_external_slug?: string | null;
  sl_external_source?: string | null;
  ia_identifier: string | null;
  ustc_sn: string | null;
  metadata?: Record<string, unknown> | null;
  /** Attached server-side when the row is linked to a digitised SL book. */
  sl_cover?: string | null;
}

/** Display-friendly label for an external scan provider. */
function externalSourceLabel(source: string | null | undefined): string {
  if (!source) return 'another archive';
  const map: Record<string, string> = {
    internet_archive: 'Internet Archive',
    cmc_kloss: 'CMC (Kloss collection)',
    mdz: 'MDZ',
    gallica: 'Gallica',
    'e-rara': 'e-rara',
    google_books: 'Google Books',
    allard_pierson: 'Allard Pierson',
    bodleian: 'Bodleian',
    vatican: 'Vatican',
    cambridge: 'Cambridge',
    laurenziana: 'Laurenziana',
  };
  if (map[source]) return map[source];
  return source.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface AdvancedFilters {
  author: string;
  title: string;
  editor: string;
  place: string;
  printer: string;
  publisher: string;
  shelf_mark: string;
  language: string;
  yearFrom: string;
  yearTo: string;
  digitized: '' | 'true' | 'sl' | 'false';
}

const EMPTY_ADV: AdvancedFilters = {
  author: '', title: '', editor: '', place: '', printer: '', publisher: '',
  shelf_mark: '', language: '', yearFrom: '', yearTo: '', digitized: '',
};

const PER_PAGE = 50;

const SORT_OPTIONS = [
  { value: 'title', label: 'Title A-Z' },
  { value: 'author', label: 'Author A-Z' },
  { value: 'year_asc', label: 'Year (oldest first)' },
  { value: 'year_desc', label: 'Year (newest first)' },
  { value: 'shelfmark', label: 'Shelfmark' },
];

interface Props {
  /** Tenant slug — used in the API path: `/api/catalog/${tenant}`. */
  tenant: string;
  /** Map of catalog_id → { id, slug } for digitised books (overrides sl_book_id from row). */
  digitizedIds: Record<string, { id: string; slug: string }>;
  /** Optional tenant slug for nested book URLs (often matches `tenant`). */
  tenantSlug?: string;
  /** When true, defaults to advanced search expanded. */
  defaultAdvanced?: boolean;
  /** Optional subject-keyword dropdown. Omit to hide it (Kloss has no curated subject list yet). */
  keywordOptions?: Array<{ value: string; label: string }>;
  /** Fires when the filtered result count changes so a parent shell can show "X of N works". */
  onTotalChange?: (total: number, isFiltered: boolean) => void;
  /** When true, hide the inline "{total} works" label on the simple-search row. */
  hideInlineCount?: boolean;
  /** Optional content rendered inline in the search row, between the subjects dropdown and Advanced. */
  searchRowSlot?: React.ReactNode;
  /** Optional content rendered in a results-header row above the table; receives the sort dropdown when present. */
  resultsHeaderSlot?: React.ReactNode;
  /** When set, the header reads "{total} of {catalogTotal} works". */
  catalogTotal?: number;
  /** Lock the digitised filter to "On Source Library" and hide its control in Advanced. */
  lockDigitized?: boolean;
  /** "list" renders the catalogue table; "grid" renders covers for the same filtered page. */
  display?: 'list' | 'grid';
}

export default function CatalogBrowser({
  tenant,
  digitizedIds,
  tenantSlug,
  defaultAdvanced = false,
  keywordOptions,
  onTotalChange,
  hideInlineCount = false,
  searchRowSlot,
  resultsHeaderSlot,
  catalogTotal,
  lockDigitized = false,
  display = 'list',
}: Props) {
  const searchParams = useSearchParams();

  const initialQ = searchParams.get('cq') || '';
  const initialSort = searchParams.get('csort') || 'title';
  const initialKeyword = searchParams.get('ckeyword') || '';
  const initialOffset = parseInt(searchParams.get('coffset') || '0') || 0;
  const initialAdv: AdvancedFilters = {
    author: searchParams.get('cauthor') || '',
    title: searchParams.get('ctitle') || '',
    editor: searchParams.get('ceditor') || '',
    place: searchParams.get('cplace') || '',
    printer: searchParams.get('cprinter') || '',
    publisher: searchParams.get('cpublisher') || '',
    shelf_mark: searchParams.get('cshelf') || '',
    language: searchParams.get('clang') || '',
    yearFrom: searchParams.get('cyfrom') || '',
    yearTo: searchParams.get('cyto') || '',
    digitized: lockDigitized ? 'sl' : ((searchParams.get('cdig') || '') as AdvancedFilters['digitized']),
  };
  const hasAnyAdv = Object.entries(initialAdv).some(
    ([k, v]) => v !== '' && !(lockDigitized && k === 'digitized')
  );
  const cadvParam = searchParams.get('cadv') === '1';

  const [works, setWorks] = useState<CatalogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(initialQ);
  const [sort, setSort] = useState(initialSort);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [offset, setOffset] = useState(initialOffset);
  const [adv, setAdv] = useState<AdvancedFilters>(initialAdv);
  const [showAdvanced, setShowAdvanced] = useState(defaultAdvanced || hasAnyAdv || cadvParam);
  const abortRef = useRef<AbortController | null>(null);

  const buildParams = useCallback((q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (s) params.set('sort', s);
    if (kw) params.set('keyword', kw);
    if (off) params.set('offset', String(off));
    if (a.author) params.set('author', a.author);
    if (a.title) params.set('title', a.title);
    if (a.editor) params.set('editor', a.editor);
    if (a.place) params.set('place', a.place);
    if (a.printer) params.set('printer', a.printer);
    if (a.publisher) params.set('publisher', a.publisher);
    if (a.shelf_mark) params.set('shelf_mark', a.shelf_mark);
    if (a.language) params.set('language', a.language);
    if (a.yearFrom) params.set('yearFrom', a.yearFrom);
    if (a.yearTo) params.set('yearTo', a.yearTo);
    if (a.digitized) params.set('digitized', a.digitized);
    return params;
  }, []);

  const fetchWorks = useCallback(async (q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const isFiltered = !!q || !!kw || Object.entries(a).some(
      ([k, v]) => v !== '' && !(lockDigitized && k === 'digitized')
    );

    setLoading(true);
    try {
      const params = buildParams(q, s, kw, off, a);
      const res = await fetch(`/api/catalog/${encodeURIComponent(tenant)}?${params}`, { signal: controller.signal });
      const data = await res.json();
      setWorks(data.works || []);
      setTotal(data.total || 0);
      onTotalChange?.(data.total || 0, isFiltered);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setWorks([]);
      setTotal(0);
      onTotalChange?.(0, isFiltered);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [tenant, buildParams, onTotalChange, lockDigitized]);

  const updateUrl = useCallback((q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const setOrDel = (key: string, val: string) => {
      if (val) params.set(key, val);
      else params.delete(key);
    };
    setOrDel('cq', q);
    setOrDel('csort', s !== 'title' ? s : '');
    setOrDel('ckeyword', kw);
    setOrDel('coffset', off ? String(off) : '');
    setOrDel('cauthor', a.author);
    setOrDel('ctitle', a.title);
    setOrDel('ceditor', a.editor);
    setOrDel('cplace', a.place);
    setOrDel('cprinter', a.printer);
    setOrDel('cpublisher', a.publisher);
    setOrDel('cshelf', a.shelf_mark);
    setOrDel('clang', a.language);
    setOrDel('cyfrom', a.yearFrom);
    setOrDel('cyto', a.yearTo);
    setOrDel('cdig', a.digitized);
    const qs = params.toString();
    const path = window.location.pathname;
    window.history.replaceState(null, '', qs ? `${path}?${qs}` : path);
  }, []);

  useEffect(() => {
    fetchWorks(initialQ, initialSort, initialKeyword, initialOffset, initialAdv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setOffset(0);
    fetchWorks(value, sort, keyword, 0, adv);
    updateUrl(value, sort, keyword, 0, adv);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort);
    setOffset(0);
    fetchWorks(searchQuery, newSort, keyword, 0, adv);
    updateUrl(searchQuery, newSort, keyword, 0, adv);
  };

  const handleKeywordChange = (newKw: string) => {
    setKeyword(newKw);
    setOffset(0);
    fetchWorks(searchQuery, sort, newKw, 0, adv);
    updateUrl(searchQuery, sort, newKw, 0, adv);
  };

  const handlePage = (newOffset: number) => {
    setOffset(newOffset);
    fetchWorks(searchQuery, sort, keyword, newOffset, adv);
    updateUrl(searchQuery, sort, keyword, newOffset, adv);
  };

  const applyAdvanced = (nextAdv: AdvancedFilters = adv) => {
    setOffset(0);
    fetchWorks(searchQuery, sort, keyword, 0, nextAdv);
    updateUrl(searchQuery, sort, keyword, 0, nextAdv);
  };

  const debouncedApplyAdvanced = useDebouncedCallback((nextAdv: AdvancedFilters) => {
    applyAdvanced(nextAdv);
  }, 300);

  const handleAdvChange = (key: keyof AdvancedFilters, value: string) => {
    const next = { ...adv, [key]: value } as AdvancedFilters;
    setAdv(next);
    debouncedApplyAdvanced(next);
  };

  const clearAll = () => {
    const cleared: AdvancedFilters = lockDigitized ? { ...EMPTY_ADV, digitized: 'sl' } : EMPTY_ADV;
    setSearchQuery('');
    setKeyword('');
    setAdv(cleared);
    setOffset(0);
    fetchWorks('', sort, '', 0, cleared);
    updateUrl('', sort, '', 0, cleared);
  };

  const advCount = useMemo(
    () => Object.entries(adv).filter(([k, v]) => v !== '' && !(lockDigitized && k === 'digitized')).length,
    [adv, lockDigitized]
  );
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const totalPages = Math.ceil(total / PER_PAGE);

  // Resolve the digitised destination for a row: prefer the parent-supplied
  // live map (Mongo-fresh), fall back to the row's stored sl_book_id.
  const resolveDigitized = (w: CatalogRecord) => {
    const fromMap = digitizedIds[w.catalog_id];
    if (fromMap) return fromMap;
    if (w.sl_book_id) return { id: w.sl_book_id, slug: w.sl_book_slug || w.sl_book_id };
    return null;
  };

  // Cross-provider link: tenant holds the physical work, scan lives elsewhere.
  // Surfaced as a secondary "Read at [source]" link when no tenant-native scan.
  const resolveExternal = (w: CatalogRecord, hasDigitized: boolean) => {
    if (hasDigitized || !w.sl_external_book_id) return null;
    return {
      id: w.sl_external_book_id,
      slug: w.sl_external_slug || w.sl_external_book_id,
      source: w.sl_external_source || null,
    };
  };

  const sortLivesInHeader = resultsHeaderSlot !== undefined;
  const showKeywordDropdown = !!keywordOptions && keywordOptions.length > 0;

  // Year for display: prefer parsed int, fall back to free-text ("[ca. 1805-06]").
  const yearDisplay = (w: CatalogRecord): string =>
    (w.year ? String(w.year) : '') || (w.year_text || '');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative flex-1 min-w-[14rem] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search across all fields…"
            className="w-full text-sm border border-border-light rounded-md pl-9 pr-9 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {showKeywordDropdown && (
          <select
            value={keyword}
            onChange={(e) => handleKeywordChange(e.target.value)}
            className="text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary"
          >
            {keywordOptions!.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}

        {searchRowSlot}

        {!sortLivesInHeader && (
          <select
            value={sort}
            onChange={(e) => handleSortChange(e.target.value)}
            className="text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}

        <button
          onClick={() => setShowAdvanced(s => !s)}
          className="inline-flex items-center gap-1.5 text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary hover:bg-warm transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Advanced
          {advCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-accent-rust text-white">
              {advCount}
            </span>
          )}
        </button>

        {!hideInlineCount && !sortLivesInHeader && (
          <span className="text-sm text-muted ml-auto">
            {total.toLocaleString('en-US')} works
          </span>
        )}
      </div>

      {sortLivesInHeader && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-sm text-muted">
            <span className="font-medium text-primary">{total.toLocaleString('en-US')}</span>
            {catalogTotal && catalogTotal > 0 ? ` of ${catalogTotal.toLocaleString('en-US')} works` : ' works'}
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <label className="inline-flex items-center gap-2 text-sm text-muted">
              <span>Sort by</span>
              <select
                value={sort}
                onChange={(e) => handleSortChange(e.target.value)}
                className="text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            {resultsHeaderSlot}
          </div>
        </div>
      )}

      {showAdvanced && (
        <div className="mb-4 p-4 bg-warm border border-border-light rounded-lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AdvField label="Author" value={adv.author} onChange={v => handleAdvChange('author', v)} />
            <AdvField label="Title" value={adv.title} onChange={v => handleAdvChange('title', v)} />
            <AdvField label="Editor / translator" value={adv.editor} onChange={v => handleAdvChange('editor', v)} />
            <AdvField label="Place of publication" value={adv.place} onChange={v => handleAdvChange('place', v)} placeholder="London, Lyon, Amsterdam…" />
            <AdvField label="Printer" value={adv.printer} onChange={v => handleAdvChange('printer', v)} />
            <AdvField label="Publisher" value={adv.publisher} onChange={v => handleAdvChange('publisher', v)} />
            <AdvField label="Shelfmark" value={adv.shelf_mark} onChange={v => handleAdvChange('shelf_mark', v)} />
            <AdvField label="Language" value={adv.language} onChange={v => handleAdvChange('language', v)} placeholder="Latin, German, English…" />
            <div>
              <label className="block text-xs text-muted mb-1">Year range</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={adv.yearFrom}
                  onChange={(e) => handleAdvChange('yearFrom', e.target.value)}
                  placeholder="from"
                  className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  value={adv.yearTo}
                  onChange={(e) => handleAdvChange('yearTo', e.target.value)}
                  placeholder="to"
                  className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                />
              </div>
            </div>
            {!lockDigitized && (
              <div>
                <label className="block text-xs text-muted mb-1">Digitization</label>
                <select
                  value={adv.digitized}
                  onChange={(e) => handleAdvChange('digitized', e.target.value)}
                  className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary"
                >
                  <option value="">All</option>
                  <option value="sl">On Source Library</option>
                  <option value="true">Digitised anywhere</option>
                  <option value="false">Not digitised</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={clearAll}
              className="px-3 py-1.5 text-sm text-muted hover:text-primary transition-colors"
            >
              Clear all
            </button>
            <span className="text-xs text-muted ml-auto">
              Filters apply as you type. The simple search above queries every field at once.
            </span>
          </div>
        </div>
      )}

      {display === 'list' ? (
      <div className="border border-border-light rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-warm">
                <th className="text-left px-3 py-2.5 font-medium text-secondary">Title</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden sm:table-cell">Author</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary w-16">Year</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden md:table-cell">Place</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden md:table-cell">Shelfmark</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden lg:table-cell">Subject</th>
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-50' : ''}>
              {loading && works.length === 0 && (
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-border-light last:border-0">
                    <td className="px-3 py-3 align-top">
                      <div className="h-4 w-3/4 bg-border-light/40 rounded animate-pulse" />
                    </td>
                    <td className="px-3 py-3 align-top hidden sm:table-cell">
                      <div className="h-4 w-1/2 bg-border-light/40 rounded animate-pulse" />
                    </td>
                    <td className="px-3 py-3 align-top tabular-nums">
                      <div className="h-4 w-10 bg-border-light/40 rounded animate-pulse" />
                    </td>
                    <td className="px-3 py-3 align-top hidden md:table-cell">
                      <div className="h-4 w-16 bg-border-light/40 rounded animate-pulse" />
                    </td>
                    <td className="px-3 py-3 align-top hidden md:table-cell">
                      <div className="h-4 w-20 bg-border-light/40 rounded animate-pulse" />
                    </td>
                    <td className="px-3 py-3 align-top hidden lg:table-cell">
                      <div className="h-5 w-20 bg-border-light/40 rounded-full animate-pulse" />
                    </td>
                  </tr>
                ))
              )}
              {works.map((w) => {
                const digitized = resolveDigitized(w);
                const external = resolveExternal(w, !!digitized);
                const displayTitle = w.title || w.parallel_title || w.uniform_title || '(untitled)';
                const displayAuthor = w.author || w.variant_author || w.pseudonym;
                // Title link target: digitised SL book if any, then external,
                // then plain text. We deliberately do NOT link to a catalogue
                // detail page here — Phase 6 introduces that per tenant.
                const titleHref = digitized
                  ? tenantBookUrl({ id: digitized.id, slug: digitized.slug }, tenantSlug)
                  : external
                    ? tenantBookUrl({ id: external.id, slug: external.slug }, tenantSlug)
                    : null;
                return (
                  <tr
                    key={w.catalog_id}
                    className="border-b border-border-light last:border-0 hover:bg-cream/50 transition-colors"
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-primary leading-snug">
                        {titleHref ? (
                          <a href={titleHref} className="hover:text-accent-rust transition-colors">
                            {displayTitle}
                          </a>
                        ) : (
                          <span>{displayTitle}</span>
                        )}
                      </div>
                      {digitized && (
                        <a
                          href={tenantBookUrl({ id: digitized.id, slug: digitized.slug }, tenantSlug)}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-accent-rust hover:underline"
                        >
                          <BookMarked className="w-3 h-3" />
                          Digitised copy
                        </a>
                      )}
                      {external && (
                        <a
                          href={tenantBookUrl({ id: external.id, slug: external.slug }, tenantSlug)}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-secondary hover:text-accent-rust hover:underline"
                        >
                          <BookMarked className="w-3 h-3 opacity-60" />
                          Read at {externalSourceLabel(external.source)}
                        </a>
                      )}
                      <div className="text-xs text-muted sm:hidden mt-0.5">
                        {displayAuthor}{w.place ? ` · ${w.place}` : ''}
                      </div>
                      {w.printer && (
                        <div className="text-[11px] text-muted mt-0.5 hidden md:block">
                          {w.printer}{w.publisher && w.publisher !== w.printer ? ` / ${w.publisher}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-secondary hidden sm:table-cell">
                      {displayAuthor || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-secondary tabular-nums">
                      {yearDisplay(w) || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-secondary hidden md:table-cell">
                      {w.place || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-secondary font-mono text-xs hidden md:table-cell">
                      {w.shelf_mark || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top hidden lg:table-cell">
                      {w.keywords ? (
                        <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-cream border border-border-light text-secondary capitalize">
                          {w.keywords}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && works.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-muted">
                    No works found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      ) : (
        <div className={loading ? 'opacity-50' : ''}>
          {loading && works.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={`skel-${i}`} className="flex flex-col">
                  <div className="aspect-[2/3] bg-border-light/40 rounded-md animate-pulse" />
                  <div className="h-4 w-3/4 bg-border-light/40 rounded mt-2 animate-pulse" />
                  <div className="h-3 w-1/2 bg-border-light/40 rounded mt-1 animate-pulse" />
                </div>
              ))}
            </div>
          ) : works.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {works.map((w) => {
                const digitized = resolveDigitized(w);
                const external = resolveExternal(w, !!digitized);
                const displayTitle = w.title || w.parallel_title || w.uniform_title || '(untitled)';
                const displayAuthor = w.author || w.variant_author || w.pseudonym;
                const href = digitized
                  ? tenantBookUrl({ id: digitized.id, slug: digitized.slug }, tenantSlug)
                  : external
                    ? tenantBookUrl({ id: external.id, slug: external.slug }, tenantSlug)
                    : '#';
                return (
                  <a
                    key={w.catalog_id}
                    href={href}
                    className="group flex flex-col text-left"
                  >
                    <div className="relative aspect-[2/3] bg-warm rounded-md overflow-hidden border border-border-light group-hover:border-accent-rust/40 transition-colors">
                      {w.sl_cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={w.sl_cover}
                          alt={displayTitle}
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted">
                          <BookMarked className="w-8 h-8 opacity-40" />
                        </div>
                      )}
                      {external && (
                        <div className="absolute bottom-1 left-1 right-1 px-1.5 py-0.5 text-[10px] leading-tight text-white bg-black/55 rounded-sm text-center">
                          via {externalSourceLabel(external.source)}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 text-sm font-medium text-primary leading-snug line-clamp-2 group-hover:text-accent-rust transition-colors">
                      {displayTitle}
                    </div>
                    {displayAuthor && (
                      <div className="text-xs text-muted mt-0.5 line-clamp-1">
                        {displayAuthor}
                        {w.year ? ` · ${w.year}` : ''}
                      </div>
                    )}
                  </a>
                );
              })}
            </div>
          ) : (
            !loading && (
              <div className="text-center py-16 text-muted">
                No works found matching your search.
              </div>
            )
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => handlePage(Math.max(0, offset - PER_PAGE))}
            disabled={offset === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-border-light rounded-md hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-sm text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => handlePage(offset + PER_PAGE)}
            disabled={currentPage >= totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-border-light rounded-md hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-default"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function AdvField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
      />
    </div>
  );
}

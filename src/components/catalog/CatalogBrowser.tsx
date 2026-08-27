'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { LayoutGrid, List, Download, X, SlidersHorizontal, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionListView from '@/components/collections/CollectionListView';
import CatalogPagination from '@/components/collections/CatalogPagination';
import FacetMenu, { type FacetOption } from './FacetMenu';
import YearRangeMenu from './YearRangeMenu';
import CatalogSearchBar, { type SearchMode } from './CatalogSearchBar';
import {
  DEFAULT_FILTERS,
  buildCatalogParams,
  parseCatalogParams,
  clearFilters,
  countActiveFilters,
  type CatalogFilters,
  type CatalogSort,
  type CatalogView,
} from '@/lib/catalog-query';

const PER_PAGE = 60;

const ASK_EXAMPLES = [
  'alchemy printed before 1600',
  'Arabic medicine we have translated',
  'books about angels and spirits',
];

const SORT_LABELS: { value: CatalogSort; label: string }[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'popular', label: 'Most read' },
  { value: 'recent', label: 'Recently added' },
  { value: 'last_translated', label: 'Recently translated' },
  { value: 'quality', label: 'Best scans' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'author', label: 'Author A–Z' },
  { value: 'year_asc', label: 'Year, oldest' },
  { value: 'year_desc', label: 'Year, newest' },
];

export interface BookItem {
  id: string;
  slug?: string | null;
  title: string;
  display_title?: string | null;
  author?: string | null;
  year?: number | null;
  language?: string | null;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_blank?: number;
  photo?: string | null;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  published?: string | null;
  read_count?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
}

export interface CatalogFacetsProp {
  total: number;
  languages: { value: string; count: number }[];
  categories: { value: string; count: number }[];
  collections: { value: string; count: number }[];
  providers: { value: string; count: number }[];
  decades: { year: number; count: number }[];
  yearMin: number | null;
  yearMax: number | null;
  firstTranslations: number;
  translated: number;
  transcribed: number;
  languageCount: number;
}

interface CatalogBrowserProps {
  initialBooks: BookItem[];
  initialTotal: number;
  facets: CatalogFacetsProp;
  /** slug → display name, for collections and categories and libraries. */
  collectionNames: Record<string, string>;
  categoryNames: Record<string, string>;
  providerNames: Record<string, string>;
  /** The collection this page arrived scoped to, if any. */
  collection?: string;
  collectionName?: string | null;
}

function getStoredView(): CatalogView | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem('sl-catalog-view');
  return v === 'grid' || v === 'list' ? v : null;
}

/** Micro heading used across the toolbar and hero, matching the reader's rails. */
const MICRO = 'text-[10.5px] uppercase tracking-[0.14em]';

export default function CatalogBrowser({
  initialBooks,
  initialTotal,
  facets,
  collectionNames,
  categoryNames,
  providerNames,
  collection: initialCollection,
  collectionName,
}: CatalogBrowserProps) {
  const [filters, setFilters] = useState<CatalogFilters>({
    ...DEFAULT_FILTERS,
    collection: initialCollection || '',
  });
  const [books, setBooks] = useState<BookItem[]>(initialBooks);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<SearchMode>('search');
  const [searchInput, setSearchInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState('');
  const [askDegraded, setAskDegraded] = useState(false);
  /** The ask filled its similarity pool, so there may be more beyond it. */
  const [poolCapped, setPoolCapped] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Mirrors `filters` so callbacks always read the committed value without
  // threading it through every handler.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const initializedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.ceil(total / PER_PAGE);
  const activeCount = countActiveFilters(filters);

  const fetchBooks = useCallback(async (next: CatalogFilters) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const qs = buildCatalogParams(next);
      const res = await fetch(`/api/catalog/browse?${qs.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      // abort() doesn't stop res.json() once the fetch has resolved, so drop a
      // result a newer request has superseded (same race as #2132).
      if (abortRef.current !== controller) return;
      setBooks(data.books || []);
      setTotal(data.total || 0);
      setPoolCapped(!!data.poolCapped);
      if (data.askDegraded) setAskDegraded(true);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // Keep whatever is on screen; the toolbar count still describes it.
    } finally {
      if (abortRef.current === controller && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Read the URL once on mount. Deliberately not useSearchParams(): that hook
  // bails the whole route out of static prerendering unless every consumer sits
  // in its own Suspense boundary (rendering-and-seo.md), and this page's first
  // screen is server-rendered HTML we want to keep.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const parsed = parseCatalogParams(params);
    const view = parsed.view !== DEFAULT_FILTERS.view ? parsed.view : (getStoredView() || DEFAULT_FILTERS.view);
    const next: CatalogFilters = { ...parsed, view, collection: parsed.collection || initialCollection || '' };

    setFilters(next);
    filtersRef.current = next;
    setSearchInput(next.ask || next.q);
    if (next.ask) setMode('ask');

    // The server already rendered page 1 of the default query; anything else
    // has to be fetched.
    const isDefault = JSON.stringify({ ...next, view: 'grid' }) === JSON.stringify({ ...DEFAULT_FILTERS, collection: initialCollection || '' });
    if (!isDefault) fetchBooks(next);
  }, [fetchBooks, initialCollection]);

  const writeUrl = useCallback((next: CatalogFilters) => {
    const qs = buildCatalogParams(next, { includeView: true }).toString();
    window.history.replaceState(null, '', `/catalog${qs ? `?${qs}` : ''}`);
  }, []);

  /** Commit a change: merge, reset to page 1 unless paging, sync URL, refetch. */
  const apply = useCallback((patch: Partial<CatalogFilters>, opts: { refetch?: boolean } = {}) => {
    const { refetch = true } = opts;
    const next: CatalogFilters = { ...filtersRef.current, ...patch };
    if (patch.page === undefined) next.page = 1;
    filtersRef.current = next;
    setFilters(next);
    writeUrl(next);
    if (refetch) fetchBooks(next);
  }, [fetchBooks, writeUrl]);

  // ── Search + ask ──────────────────────────────────────────────────────────

  const submitSearch = useCallback(async () => {
    const text = searchInput.trim();

    if (mode === 'search') {
      setAskNote('');
      setAskDegraded(false);
      const sort = filtersRef.current.sort === 'relevance' ? 'popular' : filtersRef.current.sort;
      apply({ q: text, ask: '', sort });
      return;
    }

    if (!text) { apply({ ask: '', q: '' }); setAskNote(''); return; }

    setAsking(true);
    setAskDegraded(false);
    setAskNote('');
    try {
      const res = await fetch('/api/catalog/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          // The vocabulary the librarian may choose from is this page's own
          // facet lists, so it can only ever answer with a filter this
          // catalogue actually has.
          vocab: {
            languages: facets.languages.slice(0, 60).map((l) => l.value),
            categories: facets.categories.slice(0, 60).map((c) => ({ id: c.value, name: categoryNames[c.value] || c.value })),
            collections: facets.collections.slice(0, 250).map((c) => ({ id: c.value, name: collectionNames[c.value] || c.value })),
          },
        }),
      });

      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { plan?: Record<string, unknown>; parsed?: boolean };
      const plan = data.plan || {};

      if (!data.parsed) setAskDegraded(true);
      setAskNote(typeof plan.note === 'string' ? plan.note : '');

      apply({
        ask: (plan.topic as string) || text,
        q: (plan.keywords as string) || '',
        language: (plan.language as string) || '',
        collection: (plan.collection as string) || filtersRef.current.collection,
        category: (plan.category as string) || '',
        yearMin: (plan.yearMin as number | null) ?? null,
        yearMax: (plan.yearMax as number | null) ?? null,
        firstTranslation: plan.firstTranslation === true,
        hasTranslation: plan.hasTranslation === true,
        sort: (plan.sort as CatalogSort) || 'relevance',
      });
    } catch {
      // The librarian is unreachable: fall back to matching the words. Say so,
      // rather than showing a thinner result set as if it were the answer.
      setAskDegraded(true);
      apply({ ask: text, q: '', sort: 'relevance' });
    } finally {
      setAsking(false);
    }
  }, [mode, searchInput, apply, facets, categoryNames, collectionNames]);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    setAskNote('');
    setAskDegraded(false);
    const sort = filtersRef.current.sort === 'relevance' ? 'popular' : filtersRef.current.sort;
    apply({ q: '', ask: '', sort });
  }, [apply]);

  const handlePage = useCallback((page: number) => {
    apply({ page });
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [apply]);

  const handleView = useCallback((view: CatalogView) => {
    localStorage.setItem('sl-catalog-view', view);
    apply({ view }, { refetch: false });
  }, [apply]);

  const resetAll = useCallback(() => {
    setSearchInput('');
    setAskNote('');
    setAskDegraded(false);
    const next = clearFilters(filtersRef.current);
    if (next.sort === 'relevance') next.sort = 'popular';
    filtersRef.current = next;
    setFilters(next);
    writeUrl(next);
    fetchBooks(next);
  }, [fetchBooks, writeUrl]);

  // ── Facet options ─────────────────────────────────────────────────────────

  const languageOptions: FacetOption[] = useMemo(
    () => facets.languages.map((l) => ({ value: l.value, label: l.value, count: l.count })),
    [facets.languages],
  );
  const categoryOptions: FacetOption[] = useMemo(
    () => facets.categories
      .filter((c) => categoryNames[c.value])
      .map((c) => ({ value: c.value, label: categoryNames[c.value], count: c.count })),
    [facets.categories, categoryNames],
  );
  const collectionOptions: FacetOption[] = useMemo(
    () => facets.collections
      .filter((c) => collectionNames[c.value])
      .map((c) => ({ value: c.value, label: collectionNames[c.value], count: c.count })),
    [facets.collections, collectionNames],
  );
  const providerOptions: FacetOption[] = useMemo(
    () => facets.providers
      .filter((p) => providerNames[p.value])
      .map((p) => ({ value: p.value, label: providerNames[p.value], count: p.count })),
    [facets.providers, providerNames],
  );

  const sortOptions = useMemo(
    () => SORT_LABELS.filter((s) => s.value !== 'relevance' || filters.ask),
    [filters.ask],
  );
  const sortLabel = SORT_LABELS.find((s) => s.value === filters.sort)?.label || 'Most read';

  // ── Active-filter chips ───────────────────────────────────────────────────

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.ask) chips.push({ key: 'ask', label: `Asked: ${filters.ask}`, onRemove: clearSearch });
  if (filters.q) chips.push({ key: 'q', label: `“${filters.q}”`, onRemove: () => { setSearchInput(''); apply({ q: '' }); } });
  if (filters.language) chips.push({ key: 'language', label: filters.language, onRemove: () => apply({ language: '' }) });
  if (filters.category) chips.push({ key: 'category', label: categoryNames[filters.category] || filters.category, onRemove: () => apply({ category: '' }) });
  if (filters.collection) chips.push({ key: 'collection', label: collectionNames[filters.collection] || filters.collection, onRemove: () => apply({ collection: '' }) });
  if (filters.provider) chips.push({ key: 'provider', label: providerNames[filters.provider] || filters.provider, onRemove: () => apply({ provider: '' }) });
  if (filters.yearMin != null || filters.yearMax != null) {
    const label = filters.yearMin != null && filters.yearMax != null
      ? `${filters.yearMin}–${filters.yearMax}`
      : filters.yearMin != null ? `${filters.yearMin} onwards` : `to ${filters.yearMax}`;
    chips.push({ key: 'years', label, onRemove: () => apply({ yearMin: null, yearMax: null }) });
  }
  if (filters.firstTranslation) chips.push({ key: 'ft', label: 'First translations', onRemove: () => apply({ firstTranslation: false }) });
  if (filters.hasTranslation) chips.push({ key: 'tr', label: 'Translated', onRemove: () => apply({ hasTranslation: false }) });
  if (filters.hasOcr) chips.push({ key: 'ocr', label: 'Transcribed', onRemove: () => apply({ hasOcr: false }) });

  const heroTitle = initialCollection ? (collectionName || 'Collection') : 'The Catalogue';

  // ── Render ────────────────────────────────────────────────────────────────

  const facetControls = (
    <>
      <FacetMenu
        label="Language"
        value={filters.language}
        options={languageOptions}
        onChange={(v) => apply({ language: v })}
        allLabel="All languages"
        placeholder="Find a language…"
      />
      <FacetMenu
        label="Subject"
        value={filters.category ? (categoryNames[filters.category] || filters.category) : ''}
        options={categoryOptions}
        onChange={(v) => apply({ category: v })}
        allLabel="All subjects"
        placeholder="Find a subject…"
      />
      <FacetMenu
        label="Collection"
        value={filters.collection ? (collectionNames[filters.collection] || filters.collection) : ''}
        options={collectionOptions}
        onChange={(v) => apply({ collection: v })}
        allLabel="All collections"
        placeholder="Find a collection…"
        width={300}
      />
      <YearRangeMenu
        min={filters.yearMin}
        max={filters.yearMax}
        onChange={(min, max) => apply({ yearMin: min, yearMax: max })}
        buckets={facets.decades}
      />
      <FacetMenu
        label="Held by"
        value={filters.provider ? (providerNames[filters.provider] || filters.provider) : ''}
        options={providerOptions}
        onChange={(v) => apply({ provider: v })}
        allLabel="Every library"
        placeholder="Find a library…"
        width={300}
      />
      <FacetMenu
        label="Shows"
        value={
          [filters.hasTranslation && 'Translated', filters.hasOcr && 'Transcribed', filters.firstTranslation && 'First translations']
            .filter(Boolean).join(', ')
        }
        options={[]}
        onChange={() => {}}
        width={286}
      >
        <div className="p-1.5">
          {([
            { key: 'hasTranslation' as const, label: 'Readable in English', hint: facets.translated },
            { key: 'hasOcr' as const, label: 'Transcribed', hint: facets.transcribed },
            { key: 'firstTranslation' as const, label: 'First translations', hint: facets.firstTranslations },
          ]).map((row) => (
            <label
              key={row.key}
              className="flex items-center justify-between gap-3 px-2.5 py-2 text-[13px] cursor-pointer hover:bg-warm"
            >
              <span className="flex items-center gap-2.5 text-secondary">
                <input
                  type="checkbox"
                  checked={filters[row.key]}
                  onChange={(e) => apply({ [row.key]: e.target.checked } as Partial<CatalogFilters>)}
                  className="w-3.5 h-3.5 accent-[#a5503d] cursor-pointer"
                />
                {row.label}
              </span>
              <span className="text-[11px] text-muted tabular-nums">{row.hint.toLocaleString('en-US')}</span>
            </label>
          ))}
        </div>
      </FacetMenu>
    </>
  );

  return (
    <div>
      {/* ===================== Hero ===================== */}
      <section className="relative overflow-hidden" style={{ background: '#14100c' }}>
        <div className="absolute inset-0">
          {/* One composited plate of the library's own engravings — a single
              optimized asset rather than fifty thumbnails flashing in. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/api/catalog/hero-collage"
            alt=""
            aria-hidden="true"
            loading="eager"
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* The book hero's tint, so the two pages read as one system. */}
          <div className="absolute inset-0" style={{ background: 'rgba(16,12,8,0.78)' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(14,10,7,0.62) 0%, rgba(14,10,7,0.22) 62%, transparent 100%)' }} />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 84% 12%, rgba(165,80,61,0.18) 0%, transparent 58%)' }} />
        </div>

        <div className="relative max-w-[1500px] mx-auto px-6 md:px-12 pt-10 md:pt-14 pb-9 md:pb-12">
          {initialCollection && (
            <Link
              href={`/collections/${initialCollection}`}
              className="inline-flex items-center gap-1.5 mb-5 text-[13px] transition-opacity hover:opacity-80"
              style={{ color: 'rgba(245,240,232,0.7)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to {collectionName || initialCollection}
            </Link>
          )}

          <p className={MICRO} style={{ color: 'rgba(201,168,108,0.9)' }}>
            {initialCollection ? 'Collection' : 'Every book in the library'}
          </p>
          <h1
            className="font-display font-medium text-[34px] sm:text-5xl md:text-[56px] leading-[1.05] tracking-[-0.01em] mt-2 mb-3"
            style={{ color: '#f7f2ea' }}
          >
            {heroTitle}
          </h1>
          <p className="text-[15px] md:text-base max-w-2xl mb-5" style={{ color: 'rgba(245,240,232,0.78)' }}>
            Search it, filter it, or ask the librarian to find what you need.
          </p>

          {/* The catalogue's own extent, stated once. Every number here counts
              the same set the facets below are built from. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-7 text-[12px]">
            {[
              `${facets.total.toLocaleString('en-US')} works`,
              `${facets.languageCount} languages`,
              facets.firstTranslations > 0 ? `${facets.firstTranslations.toLocaleString('en-US')} first translations` : '',
              `${facets.translated.toLocaleString('en-US')} readable in English`,
            ].filter(Boolean).map((stat) => (
              <span key={stat} className="px-2.5 py-1 border" style={{ borderColor: 'rgba(245,240,232,0.22)', color: 'rgba(245,240,232,0.86)' }}>
                {stat}
              </span>
            ))}
          </div>

          <CatalogSearchBar
            mode={mode}
            onModeChange={setMode}
            value={searchInput}
            onValueChange={setSearchInput}
            onSubmit={submitSearch}
            onClear={clearSearch}
            asking={asking}
            askNote={askNote}
            askDegraded={askDegraded}
            examples={ASK_EXAMPLES}
          />
        </div>
      </section>

      {/* ===================== Toolbar ===================== */}
      <div className="sticky top-0 z-30 border-b border-border-light bg-cream/95 backdrop-blur-sm">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12">
          <div className="flex items-center gap-3 py-3">
            <p className={`${MICRO} text-muted whitespace-nowrap tabular-nums`}>
              {loading ? 'Searching' : `${total.toLocaleString('en-US')} ${total === 1 ? 'book' : 'books'}`}
              {!loading && activeCount > 0 && (
                <span className="text-faint"> of {facets.total.toLocaleString('en-US')}</span>
              )}
              {!loading && poolCapped && (
                <span
                  className="text-faint normal-case tracking-normal"
                  title="The librarian ranks the closest 200 books by similarity, then applies your filters to those. There may be more beyond them."
                > · closest 200</span>
              )}
            </p>

            {/* Desktop: every facet inline. Mobile: one button that opens them. */}
            <div className="hidden lg:flex items-center gap-2 flex-wrap">{facetControls}</div>

            <button
              type="button"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              className={`lg:hidden inline-flex items-center gap-1.5 h-9 px-3 text-[13px] border transition-colors cursor-pointer ${
                activeCount > 0 ? 'border-border-medium bg-warm text-primary' : 'border-border-light bg-white text-secondary'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              {activeCount > 0 && <span className="tabular-nums">({activeCount})</span>}
            </button>

            <div className="ml-auto flex items-center gap-2">
              <FacetMenu
                label="Sort"
                value={sortLabel}
                options={sortOptions.map((s) => ({ value: s.value, label: s.label }))}
                onChange={(v) => apply({ sort: (v || 'popular') as CatalogSort })}
                allLabel="Most read"
                searchable={false}
                align="right"
                width={210}
              />
              <div className="hidden sm:flex items-center border border-border-light bg-white">
                {([
                  { id: 'grid' as const, Icon: LayoutGrid, label: 'Grid view' },
                  { id: 'list' as const, Icon: List, label: 'List view' },
                ]).map(({ id, Icon, label }) => (
                  <button
                    key={id}
                    onClick={() => handleView(id)}
                    aria-label={label}
                    title={label}
                    className={`p-2 transition-colors cursor-pointer ${
                      filters.view === id ? 'bg-warm text-primary' : 'text-muted hover:text-primary'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {mobileFiltersOpen && (
            <div className="lg:hidden flex flex-wrap items-center gap-2 pb-3">{facetControls}</div>
          )}

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-3">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onRemove}
                  className="group inline-flex items-center gap-1.5 max-w-full pl-2.5 pr-2 py-1 text-[12px] bg-warm border border-border-light text-secondary hover:border-border-medium hover:text-primary transition-colors cursor-pointer"
                >
                  <span className="truncate max-w-[18rem]">{chip.label}</span>
                  <X className="w-3 h-3 shrink-0 text-muted group-hover:text-primary" />
                </button>
              ))}
              <button
                type="button"
                onClick={resetAll}
                className="ml-1 text-[12px] text-muted hover:text-primary underline underline-offset-2 transition-colors cursor-pointer"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===================== Results ===================== */}
      <div
        className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-10"
        ref={gridRef}
        /* The list view and the pager are shared components that accent in
           rust. On a page of sixty results that reads as sixty warnings, so the
           accent token is re-pointed to the gold this page already uses for the
           first-translation line. Scoped to the results, and it moves with the
           token rather than forking two components. */
        style={{ ['--accent-rust' as string]: 'var(--accent-gold-dark)' }}
      >
        <div className={loading ? 'opacity-50 transition-opacity duration-200' : 'transition-opacity duration-200'}>
          {books.length === 0 && !loading ? (
            <div className="py-24 text-center">
              <p className="font-display text-2xl text-primary mb-2">Nothing here yet</p>
              <p className="text-secondary mb-6 max-w-xl mx-auto">
                {filters.ask && askDegraded
                  /* We never reached the librarian, so this is not a statement
                     about the corpus. Say which question was actually asked. */
                  ? 'The librarian could not be reached, so the words themselves were matched against titles and authors, and nothing came back. Try the Search tab with a title or an author.'
                  : filters.ask
                    ? 'The librarian found no books that match that. Try fewer conditions, or different words.'
                    : 'No books match these filters.'}
              </p>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={resetAll}
                  className="inline-flex items-center px-5 py-2.5 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 cursor-pointer"
                  style={{ background: '#a5503d' }}
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : filters.view === 'list' ? (
            <CollectionListView
              books={books as never}
              sort={filters.sort}
              onSort={(s) => apply({ sort: s as CatalogSort })}
              loading={loading}
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
              {books.map((book, i) => (
                <CollectionBookCard
                  key={book.id}
                  variant="catalog"
                  priority={i < 5}
                  book={{
                    ...book,
                    bookId: book.id,
                    slug: book.slug || undefined,
                    author: book.author || 'Unknown',
                    year: book.year || 0,
                    pages_count: book.pages_count || 0,
                    pages_translated: book.pages_translated || 0,
                    pages_ocr: book.pages_ocr || 0,
                    thumbnail: book.thumbnail || undefined,
                    thumbnail_blob: book.thumbnail_blob || undefined,
                    language: book.language || undefined,
                    published: book.published || undefined,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <CatalogPagination
          currentPage={filters.page}
          totalPages={totalPages}
          onPageChange={handlePage}
        />

        {/* The exits a catalogue owes its readers: the same set as a file, and
            the bibliographic view. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-10 pt-6 border-t border-border-light text-[12.5px] text-muted">
          <a
            href={`/api/catalog/csv${filters.language ? `?language=${encodeURIComponent(filters.language)}` : ''}`}
            className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
            title="Download this catalogue as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Download as CSV
          </a>
          <Link href="/catalog/scholar" className="hover:text-primary transition-colors">
            Scholar view
          </Link>
          <Link href="/browse" className="hover:text-primary transition-colors">
            Browse by author, title and year
          </Link>
          <span className="ml-auto hidden md:inline text-faint">
            Press <kbd className="px-1 border border-border-light bg-white">/</kbd> to search
          </span>
        </div>
      </div>
    </div>
  );
}

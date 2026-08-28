'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { LayoutGrid, List, Download, X, SlidersHorizontal, ArrowLeft, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionListView from '@/components/collections/CollectionListView';
import CatalogPagination from '@/components/collections/CatalogPagination';
import FilterRail from './FilterRail';
import CatalogSearchBar, { type SearchMode } from './CatalogSearchBar';
import type { CatalogBookItem, CatalogFacetsProp } from './catalog-types';
import {
  DEFAULT_FILTERS,
  TEXT_ROLE_LABELS,
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
  { value: 'year_asc', label: 'Earliest first' },
  { value: 'year_desc', label: 'Latest first' },
  { value: 'longest', label: 'Longest first' },
];

interface CatalogBrowserProps {
  initialBooks: CatalogBookItem[];
  initialTotal: number;
  facets: CatalogFacetsProp;
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

/** The letterspaced micro label used across the reader and this page. */
const MICRO = 'text-[10px] uppercase tracking-[0.14em]';

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
    collections: initialCollection ? [initialCollection] : [],
  });
  const [books, setBooks] = useState<CatalogBookItem[]>(initialBooks);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<SearchMode>('search');
  const [searchInput, setSearchInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState('');
  const [askDegraded, setAskDegraded] = useState(false);
  const [poolCapped, setPoolCapped] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Mirrors `filters` so callbacks always read the committed value without
  // threading it through every handler.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const initializedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

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
    const collections = parsed.collections.length
      ? parsed.collections
      : (initialCollection ? [initialCollection] : []);
    const next: CatalogFilters = { ...parsed, view, collections };

    setFilters(next);
    filtersRef.current = next;
    setSearchInput(next.ask || next.q);
    if (next.ask) setMode('ask');
    if (countActiveFilters(next) > 0) setRailOpen(true);

    // The server already rendered page 1 of the default query; anything else
    // has to be fetched.
    const base: CatalogFilters = {
      ...DEFAULT_FILTERS,
      collections: initialCollection ? [initialCollection] : [],
    };
    const isDefault = JSON.stringify({ ...next, view: 'grid' }) === JSON.stringify(base);
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
          // facet lists, so it can only ever answer with a filter this library
          // actually has.
          vocab: {
            languages: facets.languages.slice(0, 60).map((l) => l.value),
            categories: facets.categories.slice(0, 60).map((c) => ({ id: c.value, name: categoryNames[c.value] || c.value })),
            collections: facets.collections.slice(0, 250).map((c) => ({ id: c.value, name: collectionNames[c.value] || c.value })),
          },
        }),
      });

      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { plan?: Record<string, unknown>; parsed?: boolean; unreadable?: boolean; note?: string };
      const plan = data.plan || {};

      if (!data.parsed) setAskDegraded(true);
      setAskNote(typeof plan.note === 'string' ? plan.note : '');

      // The librarian read the request and found nothing to look for. Leave the
      // grid exactly as it was and let the note do the talking — running the
      // search anyway would answer a question nobody managed to ask.
      if (data.unreadable) {
        setAskNote(data.note || 'I could not tell what to look for in that.');
        return;
      }

      const one = (v: unknown) => (typeof v === 'string' && v ? [v] : []);
      apply({
        ask: (plan.topic as string) || text,
        q: (plan.keywords as string) || '',
        languages: one(plan.language),
        collections: one(plan.collection).length ? one(plan.collection) : filtersRef.current.collections,
        categories: one(plan.category),
        yearMin: (plan.yearMin as number | null) ?? null,
        yearMax: (plan.yearMax as number | null) ?? null,
        firstTranslation: plan.firstTranslation === true,
        hasTranslation: plan.hasTranslation === true,
        sort: (plan.sort as CatalogSort) || 'relevance',
      });
      setRailOpen(true);
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
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  // Close the sort menu on an outside click or Escape.
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSortOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [sortOpen]);

  const sortOptions = useMemo(
    () => SORT_LABELS.filter((s) => s.value !== 'relevance' || filters.ask),
    [filters.ask],
  );
  const sortLabel = SORT_LABELS.find((s) => s.value === filters.sort)?.label || 'Most read';

  // ── Active-filter chips: one per removable condition ──────────────────────

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  const dropFrom = (list: string[], v: string) => list.filter((x) => x !== v);

  if (filters.ask) chips.push({ key: 'ask', label: `Asked: ${filters.ask}`, onRemove: clearSearch });
  if (filters.q) chips.push({ key: 'q', label: `“${filters.q}”`, onRemove: () => { setSearchInput(''); apply({ q: '' }); } });
  for (const v of filters.languages) {
    chips.push({ key: `lang:${v}`, label: v, onRemove: () => apply({ languages: dropFrom(filters.languages, v) }) });
  }
  for (const v of filters.categories) {
    chips.push({ key: `cat:${v}`, label: categoryNames[v] || v, onRemove: () => apply({ categories: dropFrom(filters.categories, v) }) });
  }
  for (const v of filters.collections) {
    chips.push({ key: `col:${v}`, label: collectionNames[v] || v, onRemove: () => apply({ collections: dropFrom(filters.collections, v) }) });
  }
  for (const v of filters.providers) {
    chips.push({ key: `pro:${v}`, label: providerNames[v] || v, onRemove: () => apply({ providers: dropFrom(filters.providers, v) }) });
  }
  for (const v of filters.textRoles) {
    chips.push({ key: `role:${v}`, label: TEXT_ROLE_LABELS[v] || v, onRemove: () => apply({ textRoles: dropFrom(filters.textRoles, v) }) });
  }
  if (filters.yearMin != null || filters.yearMax != null) {
    const label = filters.yearMin != null && filters.yearMax != null
      ? `${filters.yearMin}–${filters.yearMax}`
      : filters.yearMin != null ? `${filters.yearMin} onwards` : `to ${filters.yearMax}`;
    chips.push({ key: 'years', label, onRemove: () => apply({ yearMin: null, yearMax: null }) });
  }
  if (filters.pagesMin != null || filters.pagesMax != null) {
    const label = filters.pagesMin != null && filters.pagesMax != null
      ? `${filters.pagesMin}–${filters.pagesMax} pages`
      : filters.pagesMin != null ? `${filters.pagesMin}+ pages` : `under ${(filters.pagesMax ?? 0) + 1} pages`;
    chips.push({ key: 'pages', label, onRemove: () => apply({ pagesMin: null, pagesMax: null }) });
  }
  if (filters.hasTranslation) chips.push({ key: 'tr', label: 'Readable in English', onRemove: () => apply({ hasTranslation: false }) });
  if (filters.hasOcr) chips.push({ key: 'ocr', label: 'Transcribed', onRemove: () => apply({ hasOcr: false }) });
  if (filters.firstTranslation) chips.push({ key: 'ft', label: 'First translation', onRemove: () => apply({ firstTranslation: false }) });
  if (filters.hasDoi) chips.push({ key: 'doi', label: 'Has a DOI', onRemove: () => apply({ hasDoi: false }) });

  const heroTitle = initialCollection ? (collectionName || 'Collection') : 'The Library';

  const rail = (
    <FilterRail
      filters={filters}
      facets={facets}
      collectionNames={collectionNames}
      categoryNames={categoryNames}
      providerNames={providerNames}
      apply={apply}
    />
  );

  return (
    <div>
      {/* ===================== Hero ===================== */}
      {/* No imagery. A collage behind the search box competed with the covers
          below it and made the one thing you came here to do hard to find. */}
      <section className="relative overflow-hidden" style={{ background: '#14100c' }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(120% 140% at 78% 0%, rgba(165,80,61,0.13) 0%, transparent 60%)' }}
        />
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pt-9 md:pt-12 pb-8 md:pb-10">
          {initialCollection && (
            <Link
              href={`/collections/${initialCollection}`}
              className="inline-flex items-center gap-1.5 mb-4 text-[13px] transition-opacity hover:opacity-80 focus-ink"
              style={{ color: 'rgba(245,240,232,0.7)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to {collectionName || initialCollection}
            </Link>
          )}

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-4 md:mb-5">
            <h1
              className="font-display font-medium text-[30px] sm:text-[42px] md:text-[48px] leading-[1.05] tracking-[-0.01em]"
              style={{ color: '#f7f2ea' }}
            >
              {heroTitle}
            </h1>
            <p className={`${MICRO} pb-1`} style={{ color: 'rgba(201,168,108,0.85)' }}>
              {facets.total.toLocaleString('en-US')} works · {facets.languageCount} languages ·{' '}
              {facets.firstTranslations.toLocaleString('en-US')} first translations
            </p>
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

      {/* ===================== Body ===================== */}
      <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
        <div className="flex flex-col lg:flex-row lg:gap-10">
          {/* ---- Filter rail ---- */}
          <aside className="lg:w-[236px] lg:shrink-0">
            {/* Desktop: always open, sticky beside the results. */}
            <div className="hidden lg:block sticky top-6 py-8 max-h-[calc(100vh-3rem)] overflow-y-auto overscroll-contain pr-1">
              <div className="flex items-baseline justify-between gap-2 mb-6">
                <h2 className={`${MICRO} text-primary`}>Refine</h2>
                {activeCount > 0 && (
                  <button
                    type="button"
                    onClick={resetAll}
                    className="text-[11px] text-muted hover:text-primary underline underline-offset-2 transition-colors cursor-pointer focus-ink"
                  >
                    Reset all
                  </button>
                )}
              </div>
              {rail}
            </div>

            {/* Mobile: one button that reveals the same rail. */}
            <div className="lg:hidden border-b border-border-light">
              <button
                type="button"
                onClick={() => setRailOpen((v) => !v)}
                aria-expanded={railOpen}
                className="w-full flex items-center justify-between gap-2 py-3.5 text-[13px] text-primary cursor-pointer focus-ink"
              >
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-muted" />
                  Refine
                  {activeCount > 0 && <span className="text-muted tabular-nums">({activeCount})</span>}
                </span>
                <ChevronDown className={`w-4 h-4 text-muted transition-transform ${railOpen ? 'rotate-180' : ''}`} />
              </button>
              {railOpen && <div className="pb-7">{rail}</div>}
            </div>
          </aside>

          {/* ---- Results ---- */}
          <div className="min-w-0 flex-1 py-6 lg:py-8" ref={resultsRef}>
            {/* Toolbar */}
            <div className="flex items-center gap-3 flex-wrap pb-4 border-b border-border-light">
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

              <div className="ml-auto flex items-center gap-2">
                {/* Sort */}
                <div ref={sortRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setSortOpen((v) => !v)}
                    aria-expanded={sortOpen}
                    aria-haspopup="listbox"
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 text-[13px] text-secondary hover:text-primary transition-colors cursor-pointer focus-ink"
                  >
                    <span className="text-muted">Sort</span>
                    {sortLabel}
                    <ChevronDown className={`w-3.5 h-3.5 text-muted transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {sortOpen && (
                    <div
                      role="listbox"
                      className="absolute right-0 z-40 mt-1 w-[13rem] bg-white border border-border-medium py-1 shadow-[0_18px_40px_-24px_rgba(26,22,18,0.55)]"
                    >
                      {sortOptions.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          role="option"
                          aria-selected={s.value === filters.sort}
                          onClick={() => { apply({ sort: s.value }); setSortOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-warm cursor-pointer focus-ink ${
                            s.value === filters.sort ? 'text-primary font-medium' : 'text-secondary'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

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
                      className={`p-1.5 transition-colors cursor-pointer focus-ink ${
                        filters.view === id ? 'bg-warm text-primary' : 'text-muted hover:text-primary'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Active conditions */}
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-3">
                {chips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.onRemove}
                    className="group inline-flex items-center gap-1.5 max-w-full pl-2.5 pr-1.5 py-[3px] text-[12px] bg-warm border border-border-light text-secondary hover:border-border-medium hover:text-primary transition-colors cursor-pointer focus-ink"
                  >
                    <span className="truncate max-w-[18rem]">{chip.label}</span>
                    <X className="w-3 h-3 shrink-0 text-muted group-hover:text-primary" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={resetAll}
                  className="ml-1 text-[12px] text-muted hover:text-primary underline underline-offset-2 transition-colors cursor-pointer focus-ink"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Results */}
            <div className={`pt-6 ${loading ? 'opacity-50 transition-opacity duration-200' : 'transition-opacity duration-200'}`}>
              {books.length === 0 && !loading ? (
                <div className="py-24 text-center">
                  <p className="font-display text-2xl text-primary mb-2">Nothing here yet</p>
                  <p className="text-secondary mb-6 max-w-xl mx-auto">
                    {filters.ask && askDegraded
                      ? 'The librarian could not be reached, so the words themselves were matched against titles and authors, and nothing came back. Try the Search tab with a title or an author.'
                      : filters.ask
                        ? 'The librarian found no books that match that. Try fewer conditions, or different words.'
                        : 'No books match these filters.'}
                  </p>
                  {activeCount > 0 && (
                    <button
                      type="button"
                      onClick={resetAll}
                      className="inline-flex items-center px-5 py-2.5 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 cursor-pointer focus-ink"
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
                  accent="gold"
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
                  {books.map((book, i) => (
                    <CollectionBookCard
                      key={book.id}
                      variant="catalog"
                      priority={i < 4}
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

            {/* Gold, not rust: a red marker under sixty results reads as an
                error state. See the prop's note in CatalogPagination. */}
            <CatalogPagination
              currentPage={filters.page}
              totalPages={totalPages}
              onPageChange={handlePage}
              accent="gold"
            />

            {/* The exits a library owes its readers. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-10 pt-5 border-t border-border-light text-[12.5px] text-muted">
              <a
                href={`/api/catalog/csv${filters.languages[0] ? `?language=${encodeURIComponent(filters.languages[0])}` : ''}`}
                className="inline-flex items-center gap-1.5 hover:text-primary transition-colors focus-ink"
                title="Download this library as CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Download as CSV
              </a>
              <Link href="/catalog/scholar" className="hover:text-primary transition-colors focus-ink">
                Scholar view
              </Link>
              <Link href="/browse" className="hover:text-primary transition-colors focus-ink">
                Browse by author, title and year
              </Link>
              <span className="ml-auto hidden md:inline text-faint">
                Press <kbd className="px-1 border border-border-light bg-white">/</kbd> to search
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

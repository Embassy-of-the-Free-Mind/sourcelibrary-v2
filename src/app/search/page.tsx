'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search, Book, ExternalLink, Filter, X, Loader2,
  Quote, User, MapPin, Lightbulb, BookOpen, Languages,
  ChevronLeft, ChevronRight, ArrowUpDown, ImageIcon, ChevronDown
} from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import { useDebouncedCallback } from 'use-debounce';
import { reportError } from '@/components/providers/ErrorReporter';
import {
  search as searchApi,
  gallery as galleryApi,
  categories as categoriesApi,
  collections as collectionsApi,
  utils,
  type SearchResult,
  type IndexSearchResult,
  type GalleryItem,
  type Collection,
} from '@/lib/api-client';
import HighlightedText from '@/components/search/HighlightedText';
import { SEARCH_TYPE_STYLES, type SearchIndexType } from '@/lib/style-constants';
import { BookLoader } from '@/components/ui/BookLoader';
import { LIBRARY_PARTNERS } from '@/lib/library-partners';
import BookCard from '@/components/book/BookCard';

// How many results to show in unified view per section
const PREVIEW_BOOKS = 5;
const PREVIEW_INDEX = 5;
const PREVIEW_IMAGES = 6;
const DEFAULT_RESULTS_PER_PAGE = 20;
const RESULTS_PER_PAGE_OPTIONS = [20, 48, 96];

const INDEX_TYPES = [
  { value: '', label: 'All Types', icon: Search },
  { value: 'concept', label: 'Concepts', icon: Lightbulb },
  { value: 'person', label: 'People', icon: User },
  { value: 'place', label: 'Places', icon: MapPin },
  { value: 'quote', label: 'Quotes', icon: Quote },
  { value: 'keyword', label: 'Keywords', icon: BookOpen },
  { value: 'vocabulary', label: 'Vocabulary', icon: Languages },
];

interface LanguageOption { value: string; label: string; }
interface CategoryOption { value: string; label: string; icon?: string; }

type ViewMode = 'unified' | 'books' | 'index' | 'images';

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialMode = (searchParams.get('mode') as ViewMode) || 'unified';
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [loading, setLoading] = useState(false);

  // Unified results
  const [bookResults, setBookResults] = useState<SearchResult[]>([]);
  const [bookTotal, setBookTotal] = useState(0);
  const [indexResults, setIndexResults] = useState<IndexSearchResult[]>([]);
  const [indexTotal, setIndexTotal] = useState(0);
  const [imageResults, setImageResults] = useState<GalleryItem[]>([]);
  const [imageTotal, setImageTotal] = useState(0);

  // Drill-down state
  const [offset, setOffset] = useState(parseInt(searchParams.get('offset') || '0'));
  const [indexType, setIndexType] = useState(searchParams.get('type') || '');
  const [sortBy, setSortBy] = useState<'relevance' | 'date_asc' | 'date_desc' | 'title'>(
    (searchParams.get('sort') as any) || 'relevance'
  );

  // Filters
  const hasInitialFilters = !!(searchParams.get('language') || searchParams.get('category') || searchParams.get('collection') || searchParams.get('date_from') || searchParams.get('date_to') || searchParams.get('has_doi') || searchParams.get('has_translation') || searchParams.get('first_translation') || searchParams.get('library'));
  const [showFilters, setShowFilters] = useState(hasInitialFilters);
  const [language, setLanguage] = useState(searchParams.get('language') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [collection, setCollection] = useState(searchParams.get('collection') || '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '');
  const [hasDoi, setHasDoi] = useState(searchParams.get('has_doi') === 'true');
  const [hasTranslation, setHasTranslation] = useState(searchParams.get('has_translation') === 'true');
  const [firstTranslation, setFirstTranslation] = useState(searchParams.get('first_translation') === 'true');
  const [library, setLibrary] = useState(searchParams.get('library') || '');
  const [languages, setLanguages] = useState<LanguageOption[]>([{ value: '', label: 'All Languages' }]);
  const [categories, setCategories] = useState<CategoryOption[]>([{ value: '', label: 'All Categories' }]);
  const [collectionsList, setCollectionsList] = useState<Collection[]>([]);

  // Results per page
  const [resultsPerPage, setResultsPerPage] = useState(
    parseInt(searchParams.get('per_page') || '') || DEFAULT_RESULTS_PER_PAGE
  );

  // Browse mode state
  const [browseBooks, setBrowseBooks] = useState<any[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState(false);
  const [browseSortBy, setBrowseSortBy] = useState<string>(
    searchParams.get('sort') || 'recent-translation'
  );

  // Suggestions
  const [suggestion, setSuggestion] = useState<string | null>(null);

  // AI-assisted search — streaming narration + expanded terms
  const [aiNarration, setAiNarration] = useState('');
  const [aiTerms, setAiTerms] = useState<string[]>([]);
  const [aiResults, setAiResults] = useState<SearchResult[]>([]);
  const [aiStreaming, setAiStreaming] = useState(false);
  const aiAbortRef = useRef<(() => void) | null>(null);

  // Load filter options + collections (independent so one failure doesn't block others)
  useEffect(() => {
    utils.languages().then((langData) => {
      if (langData.languages) {
        setLanguages([
          { value: '', label: 'All Languages' },
          ...langData.languages.map((l: any) => ({ value: l.code, label: `${l.name} (${l.book_count})` })),
        ]);
      }
    }).catch(() => {});

    categoriesApi.list().then((catData) => {
      if (catData.categories) {
        setCategories([
          { value: '', label: 'All Categories' },
          ...catData.categories
            .filter((c: any) => c.book_count > 0)
            .map((c: any) => ({ value: c.id, label: `${c.icon ? c.icon + ' ' : ''}${c.name} (${c.book_count})`, icon: c.icon })),
        ]);
      }
    }).catch(() => {});

    collectionsApi.list().then((colData) => {
      if (colData.collections) {
        setCollectionsList(colData.collections);
      }
    }).catch(() => {});
  }, []);

  // AI-assisted search — start streaming immediately when user searches
  const startAiStream = useCallback((q: string) => {
    // Abort any existing stream
    aiAbortRef.current?.();
    setAiNarration('');
    setAiTerms([]);
    setAiResults([]);

    if (!q || q.length < 3) return;
    setAiStreaming(true);

    let narrationAccum = '';
    const abort = searchApi.aiExpandStream(
      q,
      (text) => {
        narrationAccum += text;
        setAiNarration(narrationAccum);
      },
      async (terms) => {
        const originalLower = q.toLowerCase();
        const newTerms = terms.filter(t => t.toLowerCase() !== originalLower);
        setAiTerms(newTerms);

        if (newTerms.length === 0) return;
        // Search expanded terms sequentially to avoid saturating the backend
        const mainBookIds = new Set(bookResults.map(r => r.book_id));
        const seen = new Set<string>();
        const deduped: SearchResult[] = [];
        for (const term of newTerms) {
          try {
            const res = await searchApi.search(term, { limit: 3 });
            for (const r of (res.results || [])) {
              if (mainBookIds.has(r.book_id)) continue;
              const key = r.book_id + (r.type === 'page' ? `-p${r.page_number}` : '');
              if (!seen.has(key)) {
                seen.add(key);
                deduped.push(r);
              }
            }
            // Update results incrementally as each term resolves
            setAiResults([...deduped].slice(0, 8));
          } catch { /* skip failed term */ }
        }
      },
      () => setAiStreaming(false),
    );
    aiAbortRef.current = abort;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookResults]);

  const performSearch = useCallback(async (q: string, mode: ViewMode = viewMode, pageOffset = 0) => {
    if (!q || q.length < 2) {
      setBookResults([]); setBookTotal(0);
      setIndexResults([]); setIndexTotal(0);
      setImageResults([]); setImageTotal(0);
      return;
    }
    setLoading(true);

    try {
      if (mode === 'unified') {
        // Check client-side cache first
        const cacheKey = `unified:${q}:${language}:${category}:${hasTranslation}:${firstTranslation}:${library}`;
        const cached = searchCache.current.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setBookResults(cached.books);
          setBookTotal(cached.bookTotal);
          setIndexResults(cached.index);
          setIndexTotal(cached.indexTotal);
          setImageResults(cached.images);
          setImageTotal(cached.imageTotal);
          setLoading(false);
          return;
        }

        // Single unified request — books + index + gallery in one roundtrip
        try {
          const filters: Record<string, string | undefined> = {
            language: language || undefined,
            category: category || undefined,
            has_translation: hasTranslation ? 'true' : undefined,
            first_translation: firstTranslation ? 'true' : undefined,
            library: library || undefined,
          };
          const data = await searchApi.unified(q, {
            limit: PREVIEW_BOOKS,
            galleryLimit: PREVIEW_IMAGES,
            filters,
          });

          const books = data.books?.results || [];
          const bTotal = data.books?.total || 0;
          const index = (data.index?.results || []).slice(0, PREVIEW_INDEX);
          const iTotal = data.index?.total || 0;

          // Map unified gallery results to GalleryItem shape
          const galleryResults = data.gallery?.results || [];
          const images: GalleryItem[] = galleryResults.map((g: any) => {
            const parts = (g.id || '').split('-');
            const detectionIndex = parseInt(parts.pop() || '0');
            const pageId = parts.join('-');
            return {
              pageId,
              bookId: g.bookId || '',
              pageNumber: 0,
              detectionIndex,
              imageUrl: g.imageUrl || '',
              thumbnailUrl: g.imageUrl || '',
              bookTitle: g.bookTitle || '',
              author: '',
              description: g.description || '',
              type: g.type,
            } as GalleryItem;
          });
          const imTotal = data.gallery?.total || 0;

          setBookResults(books);
          setBookTotal(bTotal);
          setIndexResults(index);
          setIndexTotal(iTotal);
          setImageResults(images);
          setImageTotal(imTotal);

          // Cache the result
          searchCache.current.set(cacheKey, {
            ts: Date.now(),
            books, bookTotal: bTotal,
            index, indexTotal: iTotal,
            images, imageTotal: imTotal,
          });
          // Evict old cache entries
          if (searchCache.current.size > 50) {
            const oldest = [...searchCache.current.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
            if (oldest) searchCache.current.delete(oldest[0]);
          }
        } catch (err) {
          reportError({
            message: `Unified search failed: ${err instanceof Error ? err.message : String(err)}`,
            source: 'search_query',
          });
        }
      } else if (mode === 'books') {
        const data = await searchApi.search(q, {
          language: language || undefined,
          category: category || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          has_doi: hasDoi ? 'true' : undefined,
          has_translation: hasTranslation ? 'true' : undefined,
          first_translation: firstTranslation ? 'true' : undefined,
          library: library || undefined,
          sort: sortBy !== 'relevance' ? sortBy : undefined,
          offset: pageOffset > 0 ? pageOffset : undefined,
          limit: resultsPerPage,
          search_content: 'true',
        });
        setBookResults(data.results || []);
        setBookTotal(data.total || 0);
      } else if (mode === 'index') {
        const data = await searchApi.index(q, { type: indexType || undefined });
        setIndexResults(data.results || []);
        setIndexTotal(data.total || 0);
      } else if (mode === 'images') {
        const data = await galleryApi.list({ query: q, limit: resultsPerPage, offset: pageOffset });
        setImageResults(data.items || []);
        setImageTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation, firstTranslation, library, sortBy, resultsPerPage]);

  const updateUrl = useCallback((q: string, mode: ViewMode, pageOffset = 0) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (mode !== 'unified') params.set('mode', mode);
    if (mode === 'index' && indexType) params.set('type', indexType);
    // Persist filters in URL for all modes
    if (language) params.set('language', language);
    if (category) params.set('category', category);
    if (collection) params.set('collection', collection);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (hasDoi) params.set('has_doi', 'true');
    if (hasTranslation) params.set('has_translation', 'true');
    if (firstTranslation) params.set('first_translation', 'true');
    if (library) params.set('library', library);
    if (q && sortBy !== 'relevance') params.set('sort', sortBy);
    if (!q && browseSortBy !== 'recent-translation') params.set('sort', browseSortBy);
    if (pageOffset > 0) params.set('offset', pageOffset.toString());
    if (resultsPerPage !== DEFAULT_RESULTS_PER_PAGE) params.set('per_page', resultsPerPage.toString());
    router.replace(`/search?${params.toString()}`, { scroll: false });
  }, [router, indexType, language, category, collection, dateFrom, dateTo, hasDoi, hasTranslation, firstTranslation, library, sortBy, browseSortBy, resultsPerPage]);

  // Client-side search cache — avoids re-fetching on backspace/retype
  const searchCache = useRef(new Map<string, { ts: number; books: SearchResult[]; bookTotal: number; index: IndexSearchResult[]; indexTotal: number; images: GalleryItem[]; imageTotal: number }>());
  const CACHE_TTL = 60_000; // 1 minute

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setOffset(0);
    performSearch(value, viewMode, 0);
    updateUrl(value, viewMode, 0);
  }, 450);

  // Search on initial load (from URL params) and when filters/sort/mode change
  const aiTriggeredForQuery = useRef('');
  useEffect(() => {
    if (query.length >= 2) {
      performSearch(query, viewMode, offset);
      updateUrl(query, viewMode, offset);
      // Trigger AI stream once per distinct query (on page load / enter / filter change)
      if (aiTriggeredForQuery.current !== query) {
        aiTriggeredForQuery.current = query;
        startAiStream(query);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation, firstTranslation, library, sortBy, offset, performSearch, updateUrl]);

  // Browse mode: fetch books when no query
  const isBrowseMode = !query || query.length < 2;
  const prefetchUsed = useRef(false);
  const performBrowse = useCallback(async () => {
    // Check for prefetched data from homepage (instant load for common views)
    if (!prefetchUsed.current && typeof window !== 'undefined' && offset === 0 && !language && !category && !collection && !library && browseSortBy === 'recent-translation') {
      const prefetch = (window as any).__BROWSE_PREFETCH;
      const prefetchTs = (window as any).__BROWSE_PREFETCH_TS;
      const key = firstTranslation ? 'first_translation' : hasTranslation ? 'has_translation' : null;
      if (key && prefetch?.[key] && prefetchTs && (Date.now() - prefetchTs) < 300_000) {
        prefetchUsed.current = true;
        setBrowseBooks(prefetch[key].books || []);
        setBrowseTotal(prefetch[key].total || 0);
        return;
      }
    }

    setBrowseLoading(true);
    setBrowseError(false);
    try {
      const data = await searchApi.browse({
        language: language || undefined,
        category: category || undefined,
        collection: collection || undefined,
        library: library || undefined,
        sort: browseSortBy,
        limit: resultsPerPage,
        skip: offset,
        first_translation: firstTranslation || undefined,
        has_translation: hasTranslation || undefined,
      });
      setBrowseBooks(data.books || []);
      setBrowseTotal(data.total || 0);
    } catch (err) {
      setBrowseBooks([]);
      setBrowseTotal(0);
      setBrowseError(true);
      reportError({
        message: `Browse API failed: ${err instanceof Error ? err.message : String(err)}`,
        source: 'search_browse',
      });
    } finally {
      setBrowseLoading(false);
    }
  }, [language, category, collection, library, browseSortBy, offset, firstTranslation, hasTranslation, resultsPerPage]);

  useEffect(() => {
    if (isBrowseMode) {
      performBrowse();
      updateUrl('', 'unified', offset);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBrowseMode, language, category, collection, library, browseSortBy, offset, firstTranslation, hasTranslation]);

  // Fuzzy suggestions on zero results
  const totalResults = bookTotal + indexTotal + imageTotal;
  const noResults = query.length >= 2 && !loading && totalResults === 0;
  useEffect(() => {
    if (!noResults || query.length < 3) { setSuggestion(null); return; }
    let cancelled = false;
    searchApi.suggest(query).then(data => {
      if (!cancelled) setSuggestion(data.suggestions?.[0] || null);
    }).catch(() => { if (!cancelled) setSuggestion(null); });
    return () => { cancelled = true; };
  }, [noResults, query]);


  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (value.length >= 2) {
      setOffset(0);
    }
    // Clear AI state while typing — AI only fires on Enter
    aiAbortRef.current?.();
    setAiNarration('');
    setAiTerms([]);
    setAiResults([]);
    setAiStreaming(false);
    aiTriggeredForQuery.current = '';
    debouncedSearch(value);
  };

  const handleSearchSubmit = () => {
    if (query.length >= 3) {
      aiTriggeredForQuery.current = query;
      startAiStream(query);
    }
  };

  const drillInto = (mode: ViewMode) => {
    setViewMode(mode);
    setOffset(0);
  };

  const backToUnified = () => {
    setViewMode('unified');
    setOffset(0);
    setShowFilters(false);
  };

  const clearFilters = () => {
    setLanguage(''); setCategory(''); setCollection(''); setDateFrom(''); setDateTo('');
    setHasDoi(false); setHasTranslation(false); setFirstTranslation(false); setLibrary(''); setSortBy('relevance'); setBrowseSortBy('recent-translation'); setOffset(0);
  };
  const hasActiveFilters = language || category || collection || dateFrom || dateTo || hasDoi || hasTranslation || firstTranslation || library || sortBy !== 'relevance';

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="dark" />

      {/* Search Bar */}
      <div className="bg-white border-b border-border-light sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSubmit(); }}
                placeholder="Search books, concepts, people, images..."
                className="w-full pl-12 pr-4 py-3 border border-border-medium rounded-xl bg-cream/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust/40 text-lg text-primary font-body"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted animate-spin" />
              )}
            </div>
            {!isBrowseMode && (
              <div className="relative flex-shrink-0">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value as any); setOffset(0); }}
                  className="w-full sm:w-auto pl-9 pr-3 py-3 border border-border-medium rounded-xl text-sm text-secondary bg-white focus:outline-none focus:ring-2 focus:ring-accent-rust/30 appearance-none cursor-pointer"
                >
                  <option value="relevance">Relevance</option>
                  <option value="date_desc">Newest first</option>
                  <option value="date_asc">Oldest first</option>
                  <option value="title">Title A-Z</option>
                </select>
              </div>
            )}
            {isBrowseMode && (
              <div className="relative flex-shrink-0">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                <select
                  value={browseSortBy}
                  onChange={(e) => { setBrowseSortBy(e.target.value); setOffset(0); }}
                  className="w-full sm:w-auto pl-9 pr-3 py-3 border border-border-medium rounded-xl text-sm text-secondary bg-white focus:outline-none focus:ring-2 focus:ring-accent-rust/30 appearance-none cursor-pointer"
                >
                  <option value="recent-translation">Recently translated</option>
                  <option value="recent">Recently added</option>
                  <option value="date_desc">Oldest first</option>
                  <option value="date_asc">Newest first</option>
                  <option value="title-asc">Title A-Z</option>
                  <option value="title-desc">Title Z-A</option>
                </select>
              </div>
            )}
          </div>

          {/* Mode tabs — hidden in browse mode */}
          {!isBrowseMode && (
            <div className="mt-3 flex gap-1 border-b border-border-light -mx-4 px-4">
              {([
                { mode: 'unified' as ViewMode, label: 'All', icon: Search },
                { mode: 'books' as ViewMode, label: 'Books', icon: Book },
                { mode: 'index' as ViewMode, label: 'Index', icon: Lightbulb },
                { mode: 'images' as ViewMode, label: 'Images', icon: ImageIcon },
              ] as const).map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => { setViewMode(mode); setOffset(0); }}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    viewMode === mode
                      ? 'border-accent-rust text-accent-rust'
                      : 'border-transparent text-muted hover:text-secondary hover:border-border-medium'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                  {mode === 'books' && bookTotal > 0 && viewMode !== 'unified' && (
                    <span className="text-xs text-muted">({bookTotal})</span>
                  )}
                  {mode === 'index' && indexTotal > 0 && viewMode !== 'unified' && (
                    <span className="text-xs text-muted">({indexTotal})</span>
                  )}
                  {mode === 'images' && imageTotal > 0 && viewMode !== 'unified' && (
                    <span className="text-xs text-muted">({imageTotal})</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Index type filter pills (index drill-down mode) */}
          {viewMode === 'index' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {INDEX_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.value}
                    onClick={() => { setIndexType(type.value); setOffset(0); }}
                    className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
                      indexType === type.value
                        ? 'bg-accent-violet/12 text-accent-violet border border-accent-violet/30'
                        : 'bg-warm text-secondary border border-transparent hover:bg-border-light'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {type.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Filter toggle + count badge */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 text-sm text-muted hover:text-secondary transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? '' : '-rotate-90'}`} />
              <Filter className="w-3.5 h-3.5" />
              Filters
              {hasActiveFilters && <span className="w-1.5 h-1.5 bg-accent-rust rounded-full" />}
            </button>
          </div>

          {/* Filter panel — inline on desktop, bottom sheet on mobile */}
          {showFilters && (
            <>
              {/* Mobile: backdrop + bottom sheet */}
              <div className="md:hidden fixed inset-0 bg-black/30 z-40" onClick={() => setShowFilters(false)} />
              <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
                <div className="sticky top-0 bg-white border-b border-border-light px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-primary">Filters</span>
                  <div className="flex items-center gap-3">
                    {hasActiveFilters && (
                      <button onClick={clearFilters} className="text-sm text-muted hover:text-primary flex items-center gap-1">
                        <X className="w-3.5 h-3.5" /> Clear
                      </button>
                    )}
                    <button onClick={() => setShowFilters(false)} className="text-sm font-medium text-accent-rust">
                      Done
                    </button>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-secondary mb-1">Language</label>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      {languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Subject</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Collection</label>
                    <select value={collection} onChange={(e) => { setCollection(e.target.value); setOffset(0); }}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      <option value="">All Collections</option>
                      {collectionsList.map((c) => (
                        <option key={c.slug} value={c.slug}>{c.name} ({c.book_count})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Library</label>
                    <select value={library} onChange={(e) => setLibrary(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      <option value="">All Libraries</option>
                      {Object.values(LIBRARY_PARTNERS).map((p) => (
                        <option key={p.providerKey} value={p.providerKey}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Published after</label>
                    <input type="text" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                      placeholder="e.g., 1500" className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30" />
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Published before</label>
                    <input type="text" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                      placeholder="e.g., 1700" className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30" />
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-2">
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={hasTranslation} onChange={(e) => setHasTranslation(e.target.checked)}
                        className="rounded border-border-medium text-accent-rust focus:ring-accent-rust/30" /> Has translation
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={firstTranslation} onChange={(e) => setFirstTranslation(e.target.checked)}
                        className="rounded border-border-medium text-accent-gold focus:ring-accent-gold/30" /> First translation
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={hasDoi} onChange={(e) => setHasDoi(e.target.checked)}
                        className="rounded border-border-medium text-accent-rust focus:ring-accent-rust/30" /> Has DOI
                    </label>
                  </div>
                </div>
              </div>

              {/* Desktop: inline panel */}
              <div className="hidden md:block mt-3 p-4 bg-warm rounded-xl border border-border-light relative z-20">
                <div className="flex items-center justify-between mb-3">
                  {hasActiveFilters && (
                    <button onClick={clearFilters} className="text-sm text-muted hover:text-primary flex items-center gap-1 ml-auto">
                      <X className="w-4 h-4" /> Clear all
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-secondary mb-1">Language</label>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      {languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Subject</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Collection</label>
                    <select value={collection} onChange={(e) => { setCollection(e.target.value); setOffset(0); }}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      <option value="">All Collections</option>
                      {collectionsList.map((c) => (
                        <option key={c.slug} value={c.slug}>{c.name} ({c.book_count})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Library</label>
                    <select value={library} onChange={(e) => setLibrary(e.target.value)}
                      className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30">
                      <option value="">All Libraries</option>
                      {Object.values(LIBRARY_PARTNERS).map((p) => (
                        <option key={p.providerKey} value={p.providerKey}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Published after</label>
                    <input type="text" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                      placeholder="e.g., 1500" className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30" />
                  </div>
                  <div>
                    <label className="block text-sm text-secondary mb-1">Published before</label>
                    <input type="text" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                      placeholder="e.g., 1700" className="w-full px-3 py-2 border border-border-medium rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30" />
                  </div>
                  <div className="flex flex-col gap-2 justify-end">
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={hasTranslation} onChange={(e) => setHasTranslation(e.target.checked)}
                        className="rounded border-border-medium text-accent-rust focus:ring-accent-rust/30" /> Has translation
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={firstTranslation} onChange={(e) => setFirstTranslation(e.target.checked)}
                        className="rounded border-border-medium text-accent-gold focus:ring-accent-gold/30" /> First translation
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                      <input type="checkbox" checked={hasDoi} onChange={(e) => setHasDoi(e.target.checked)}
                        className="rounded border-border-medium text-accent-rust focus:ring-accent-rust/30" /> Has DOI
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Results */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Browse mode — shown when no query */}
        {isBrowseMode && (
          <div>
            {/* Collection pills */}
            {collectionsList.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  onClick={() => { setCollection(''); setOffset(0); }}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    !collection
                      ? 'bg-accent-rust text-white'
                      : 'bg-warm text-secondary hover:bg-accent-rust/10 hover:text-accent-rust border border-border-light'
                  }`}
                >
                  All books
                  {!collection && browseTotal > 0 && (
                    <span className="ml-1.5 text-white/80">({browseTotal})</span>
                  )}
                </button>
                {collectionsList.map((col) => (
                  <button
                    key={col.slug}
                    onClick={() => { setCollection(col.slug); setOffset(0); }}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      collection === col.slug
                        ? 'bg-accent-rust text-white'
                        : 'bg-warm text-secondary hover:bg-accent-rust/10 hover:text-accent-rust border border-border-light'
                    }`}
                  >
                    {col.name}
                    <span className={`ml-1.5 ${collection === col.slug ? 'text-white/80' : 'text-muted'}`}>
                      ({col.book_count})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Results count + per-page selector */}
            {!browseLoading && browseTotal > 0 && (
              <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
                <div className="text-muted">
                  <span className="font-medium text-primary">{browseTotal}</span> books
                  {collection && collectionsList.find(c => c.slug === collection) && (
                    <span> in <span className="font-medium text-primary">{collectionsList.find(c => c.slug === collection)!.name}</span></span>
                  )}
                  {browseTotal > resultsPerPage && (
                    <span className="ml-2 text-faint">
                      (showing {offset + 1}&ndash;{Math.min(offset + resultsPerPage, browseTotal)})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <span>Show</span>
                    <select
                      value={resultsPerPage}
                      onChange={(e) => { setResultsPerPage(Number(e.target.value)); setOffset(0); }}
                      className="px-2 py-1 border border-border-medium rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                    >
                      {RESULTS_PER_PAGE_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span>per page</span>
                  </div>
                  <Link href="/catalog" className="text-sm text-accent-rust hover:underline">
                    Browse Full Catalog
                  </Link>
                </div>
              </div>
            )}

            {browseLoading && <div className="py-8"><BookLoader size="xs" /></div>}

            {/* Book grid */}
            {!browseLoading && browseBooks.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {browseBooks.map((book, idx) => (
                  <BookCard key={book.id} book={book} priority={idx < 5} />
                ))}
              </div>
            )}

            {!browseLoading && browseError && (
              <div className="text-center py-16">
                <Book className="w-16 h-16 text-border-medium mx-auto mb-4" />
                <h2 className="text-2xl font-serif font-medium text-primary mb-2">Something went wrong</h2>
                <p className="text-base text-muted mb-4">We couldn&apos;t load the library right now.</p>
                <button
                  onClick={() => performBrowse()}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
                >
                  Try again
                </button>
              </div>
            )}

            {!browseLoading && !browseError && browseBooks.length === 0 && browseTotal === 0 && (
              <div className="text-center py-16">
                <Book className="w-16 h-16 text-border-medium mx-auto mb-4" />
                <h2 className="text-2xl font-serif font-medium text-primary mb-2">No books found</h2>
                <p className="text-base text-muted">Try adjusting your filters.</p>
              </div>
            )}

            <Pagination total={browseTotal} offset={offset} setOffset={setOffset} loading={browseLoading} pageSize={resultsPerPage} />
          </div>
        )}

        {/* Loading */}
        {query.length >= 2 && loading && viewMode === 'unified' && (
          <div className="py-8"><BookLoader size="xs" /></div>
        )}

        {/* AI narration — streams while search loads */}
        {query.length >= 3 && (aiStreaming || aiNarration) && (
          <div className="mb-6 px-4 py-3 bg-warm rounded-lg border border-border-light">
            <p className="text-sm text-secondary italic leading-relaxed"
               dangerouslySetInnerHTML={{
                 __html: aiNarration
                   .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                   + (aiStreaming ? '<span class="inline-block w-1.5 h-4 bg-accent-rust/40 animate-pulse ml-0.5 align-text-bottom"></span>' : '')
               }}
            />
            {aiTerms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {aiTerms.map(term => (
                  <button
                    key={term}
                    onClick={() => { setQuery(term); setOffset(0); performSearch(term, viewMode, 0); updateUrl(term, viewMode, 0); }}
                    className="px-2.5 py-1 bg-white/60 text-secondary text-xs rounded-full hover:bg-accent-rust/10 hover:text-accent-rust transition-colors"
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No results */}
        {noResults && !aiStreaming && aiResults.length === 0 && (
          <div className="text-center py-16 max-w-lg mx-auto">
            <Search className="w-16 h-16 text-border-medium mx-auto mb-4" />
            <h2 className="text-2xl font-serif font-medium text-primary mb-2">No results found</h2>
            {suggestion && (
              <p className="text-secondary mb-6">
                Did you mean{' '}
                <button
                  onClick={() => { setQuery(suggestion); setOffset(0); performSearch(suggestion, viewMode, 0); updateUrl(suggestion, viewMode, 0); }}
                  className="font-semibold text-accent-rust hover:text-accent-rust/80 underline underline-offset-2"
                >{suggestion}</button>?
              </p>
            )}
            <p className="text-muted mb-6">
              The library focuses on Western esoteric tradition — alchemy, Hermetica, Kabbalah, natural philosophy, and early modern science.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {['alchemy', 'Hermes', 'Paracelsus', 'Kabbalah', 'astrology', 'Ficino'].map(term => (
                <button
                  key={term}
                  onClick={() => { setQuery(term); setOffset(0); performSearch(term, viewMode, 0); updateUrl(term, viewMode, 0); }}
                  className="px-3 py-1.5 bg-warm text-secondary text-sm rounded-full hover:bg-accent-rust/10 hover:text-accent-rust transition-colors"
                >
                  {term}
                </button>
              ))}
              <button
                onClick={() => { setQuery(''); setOffset(0); }}
                className="px-3 py-1.5 bg-warm text-secondary text-sm rounded-full hover:bg-accent-rust/10 hover:text-accent-rust transition-colors"
              >
                Browse all books
              </button>
            </div>
          </div>
        )}

        {/* AI-expanded results when no main results */}
        {noResults && aiResults.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Related results from AI-expanded search:</p>
            {aiResults.map(result => {
              const cover = result.thumbnail || (result as any).thumbnail_blob;
              const text = result.snippet || result.summary;
              return (
                <Link
                  key={result.id}
                  href={result.type === 'page' ? `/book/${result.slug || result.book_id}/page-number/${result.page_number}` : `/book/${result.slug || result.book_id}`}
                  className="flex items-start gap-3 p-4 bg-warm rounded-lg hover:bg-warm-hover transition-colors"
                >
                  {cover && (
                    <Image src={cover} alt="" width={48} height={68} className="rounded shadow-sm flex-shrink-0 object-cover" />
                  )}
                  <div className="min-w-0">
                    <h3 className="font-serif font-medium text-primary text-sm leading-tight">
                      {result.display_title || result.title}
                    </h3>
                    <p className="text-xs text-muted mt-0.5">
                      {result.author}{result.published ? `, ${result.published}` : ''}
                      {result.type === 'page' && result.page_number && <span> &middot; p. {result.page_number}</span>}
                    </p>
                    {text && (
                      <p className="text-xs text-secondary mt-1 line-clamp-2">{text}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* ==================== UNIFIED VIEW ==================== */}
        {viewMode === 'unified' && !loading && query.length >= 2 && totalResults > 0 && (
          <div className="space-y-10">
            {/* Images Section (first for visual impact) */}
            {imageTotal > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="flex items-center gap-2 text-xl font-semibold text-primary">
                    <ImageIcon className="w-6 h-6 text-accent-gold" />
                    Images
                    <span className="text-base font-normal text-muted">({imageTotal})</span>
                  </h2>
                  {imageTotal > PREVIEW_IMAGES && (
                    <button onClick={() => drillInto('images')} className="px-4 py-2 bg-accent-gold/10 text-accent-gold-dark font-medium rounded-lg hover:bg-accent-gold/20 transition-colors flex items-center gap-1.5">
                      See all {imageTotal} images <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {imageResults.slice(0, PREVIEW_IMAGES).map((item, idx) => (
                    <ImageResultCard key={`${item.pageId}-${item.detectionIndex}-${idx}`} item={item} query={query} />
                  ))}
                </div>
              </section>
            )}

            {/* Results — books and index entries together */}
            {(bookTotal > 0 || indexTotal > 0) && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-medium text-muted uppercase tracking-wide">
                    {bookTotal + indexTotal} results
                  </h2>
                </div>

                <div className="space-y-3">
                  {/* Books first */}
                  {bookResults.slice(0, PREVIEW_BOOKS).map((result) => (
                    <BookResultCard key={result.id} result={result} query={query} />
                  ))}
                  {bookTotal > PREVIEW_BOOKS && (
                    <button onClick={() => drillInto('books')} className="w-full py-3 bg-accent-rust/8 text-accent-rust font-medium rounded-xl hover:bg-accent-rust/15 transition-colors flex items-center justify-center gap-1.5">
                      See all {bookTotal} books & pages <ChevronRight className="w-4 h-4" />
                    </button>
                  )}

                  {/* Index entries after books */}
                  {indexResults.slice(0, PREVIEW_INDEX).map((result, idx) => (
                    <IndexResultCard key={`${result.book_id}-${result.type}-${idx}`} result={result} query={query} />
                  ))}
                  {indexTotal > PREVIEW_INDEX && (
                    <button onClick={() => drillInto('index')} className="w-full py-3 bg-accent-violet/8 text-accent-violet font-medium rounded-xl hover:bg-accent-violet/15 transition-colors flex items-center justify-center gap-1.5">
                      See all {indexTotal} index entries <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ==================== BOOKS DRILL-DOWN ==================== */}
        {viewMode === 'books' && query.length >= 2 && (
          <>
            {!loading && (
              <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
                <div className="text-muted">
                  Found <span className="font-medium text-primary">{bookTotal}</span> books & pages for &ldquo;{query}&rdquo;
                  {bookTotal > resultsPerPage && (
                    <span className="ml-2 text-faint">
                      (showing {offset + 1}&ndash;{Math.min(offset + resultsPerPage, bookTotal)})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span>Show</span>
                  <select
                    value={resultsPerPage}
                    onChange={(e) => { setResultsPerPage(Number(e.target.value)); setOffset(0); }}
                    className="px-2 py-1 border border-border-medium rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                  >
                    {RESULTS_PER_PAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <span>per page</span>
                </div>
              </div>
            )}
            {loading && <div className="py-4"><BookLoader size="xs" /></div>}
            <div className="space-y-3">
              {bookResults.map((result) => (
                <BookResultCard key={result.id} result={result} query={query} />
              ))}
            </div>
            <Pagination total={bookTotal} offset={offset} setOffset={setOffset} loading={loading} pageSize={resultsPerPage} />
          </>
        )}

        {/* ==================== INDEX DRILL-DOWN ==================== */}
        {viewMode === 'index' && query.length >= 2 && (
          <>
            {!loading && (
              <div className="mb-6 text-muted">
                Found <span className="font-medium text-primary">{indexTotal}</span> index entries for &ldquo;{query}&rdquo;
              </div>
            )}
            {loading && <div className="py-4"><BookLoader size="xs" /></div>}
            <div className="space-y-3">
              {indexResults.map((result, idx) => (
                <IndexResultCard key={`${result.book_id}-${result.type}-${idx}`} result={result} query={query} />
              ))}
            </div>
          </>
        )}

        {/* ==================== IMAGES DRILL-DOWN ==================== */}
        {viewMode === 'images' && query.length >= 2 && (
          <>
            {!loading && (
              <div className="mb-6 text-muted">
                Found <span className="font-medium text-primary">{imageTotal}</span> images for &ldquo;{query}&rdquo;
                {imageTotal > resultsPerPage && (
                  <span className="ml-2 text-faint">
                    (showing {offset + 1}&ndash;{Math.min(offset + resultsPerPage, imageTotal)})
                  </span>
                )}
              </div>
            )}
            {loading && <div className="py-4"><BookLoader size="xs" /></div>}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {imageResults.map((item, idx) => (
                <ImageResultCard key={`${item.pageId}-${item.detectionIndex}-${idx}`} item={item} query={query} large />
              ))}
            </div>
            <Pagination total={imageTotal} offset={offset} setOffset={setOffset} loading={loading} pageSize={resultsPerPage} />
          </>
        )}
        {/* AI-expanded related results — shows for all searches with results */}
        {!noResults && !loading && query.length >= 3 && !aiStreaming && aiResults.length > 0 && (
          <section className="mt-12 pt-8 border-t border-border-light">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">Related in the Library</h2>
            <div className="space-y-3">
              {aiResults.map(result => {
                const cover = result.thumbnail || (result as any).thumbnail_blob;
                const text = result.snippet || result.summary;
                return (
                  <Link
                    key={result.id}
                    href={result.type === 'page' ? `/book/${result.slug || result.book_id}/page-number/${result.page_number}` : `/book/${result.slug || result.book_id}`}
                    className="flex items-start gap-3 p-3 bg-warm rounded-lg hover:bg-warm-hover transition-colors"
                  >
                    {cover && (
                      <Image src={cover} alt="" width={48} height={68} className="rounded shadow-sm flex-shrink-0 object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-serif font-medium text-primary text-sm leading-tight line-clamp-1">
                        {result.display_title || result.title}
                      </h3>
                      <p className="text-xs text-muted mt-0.5">
                        {result.author}{result.published ? `, ${result.published}` : ''}
                        {result.type === 'page' && result.page_number && <span> &middot; p. {result.page_number}</span>}
                      </p>
                      {text && (
                        <p className="text-xs text-secondary mt-1 line-clamp-2">{text}</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>

    </div>
  );
}

// ==================== RESULT CARDS ====================

function BookResultCard({ result, query }: { result: SearchResult; query: string }) {
  const cover = result.thumbnail || (result as any).thumbnail_blob;
  const text = result.snippet || result.summary;
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={result.type === 'page' ? `/book/${result.slug || result.book_id}/page-number/${result.page_number}` : `/book/${result.slug || result.book_id}`}
      className="block bg-white rounded-xl border border-border-light p-4 hover:border-accent-rust/30 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-4">
        {cover && !imgError ? (
          <Image
            src={cover}
            alt=""
            width={60}
            height={84}
            className="rounded shadow-sm flex-shrink-0 object-cover"
            onError={() => setImgError(true)}
            unoptimized
          />
        ) : (
          <div className="w-[60px] h-[84px] rounded bg-warm flex items-center justify-center flex-shrink-0">
            <Book className="w-6 h-6 text-border-medium" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-medium text-primary line-clamp-2 font-serif leading-snug">
                <HighlightedText text={result.display_title || result.title} query={query} />
                {result.type === 'page' && <span className="text-muted font-normal text-sm ml-2">p. {result.page_number}</span>}
              </h3>
              <p className="text-sm text-secondary mt-0.5">
                <HighlightedText text={result.author} query={query} /> · {result.published}
              </p>
            </div>
            {result.has_doi && result.doi && (
              <a href={`https://doi.org/${result.doi}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-2 py-1 bg-accent-sage/15 text-accent-sage-dark rounded text-xs font-medium hover:bg-accent-sage/25 flex-shrink-0">
                DOI <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {text && (
            <p className="mt-1.5 text-sm text-secondary line-clamp-2 font-body leading-relaxed">
              <HighlightedText text={text} query={query} />
            </p>
          )}
          {result.type === 'book' && result.page_count && (
            <p className="mt-1.5 text-xs text-muted">
              {result.page_count} pages{result.translated_count ? ` · ${result.translated_count} translated` : ''}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function IndexResultCard({ result, query }: { result: IndexSearchResult; query: string }) {
  const typeLabel = INDEX_TYPES.find(t => t.value === result.type)?.label || result.type;
  const isQuote = result.type === 'quote';

  return (
    <Link
      href={isQuote && result.quote_page
        ? `/book/${result.book_slug || result.book_id}/guide?page=${result.quote_page}`
        : result.pages && result.pages.length > 0
        ? `/book/${result.book_slug || result.book_id}/guide?page=${result.pages[0]}`
        : `/book/${result.book_slug || result.book_id}`
      }
      className="block bg-white rounded-xl border border-border-light p-4 hover:border-accent-violet/30 hover:shadow-md transition-all"
    >
      <div className="min-w-0">
        <span className={`text-xs px-2 py-0.5 rounded-full ${(SEARCH_TYPE_STYLES[result.type as SearchIndexType] ?? SEARCH_TYPE_STYLES.keyword).badge}`}>{typeLabel}</span>

        {isQuote ? (
          <>
            <blockquote className="font-serif text-lg text-primary italic border-l-2 border-accent-gold/40 pl-3 my-2">
              &ldquo;<HighlightedText text={result.quote_text || ''} query={query} />&rdquo;
            </blockquote>
            {result.quote_significance && (
              <p className="text-sm text-secondary mt-1"><HighlightedText text={result.quote_significance} query={query} /></p>
            )}
          </>
        ) : (
          <h3 className="text-lg font-medium text-primary mt-1 font-serif"><HighlightedText text={result.term} query={query} /></h3>
        )}

        <p className="text-sm text-muted mt-1.5">
          {result.book_title} · {result.book_author}
          {result.pages && result.pages.length > 0 && (
            <span className="ml-1">· p. {result.pages.slice(0, 3).join(', ')}{result.pages.length > 3 && ` +${result.pages.length - 3}`}</span>
          )}
        </p>
      </div>
    </Link>
  );
}

function ImageResultCard({ item, query, large }: { item: GalleryItem; query: string; large?: boolean }) {
  const [imageError, setImageError] = useState(false);

  // Use pre-generated thumbnail/extracted URL first (publicly accessible),
  // fall back to original imageUrl (crop-image API requires auth and breaks for visitors)
  const displayUrl = item.thumbnailUrl || item.extractedUrl || item.imageUrl;

  return (
    <Link
      href={`/gallery/image/${item.pageId}-${item.detectionIndex}`}
      className="group block bg-white rounded-lg border border-border-light overflow-hidden hover:border-accent-gold/30 hover:shadow-md transition-all"
    >
      <div className={`relative bg-warm ${large ? 'aspect-[3/4]' : 'aspect-square'}`}>
        {!imageError && displayUrl ? (
          <Image
            src={displayUrl}
            alt={item.description}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes={large ? '(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw' : '(max-width: 640px) 50vw, 16vw'}
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-border-medium" />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-sm text-secondary line-clamp-2 mb-1">
          {query ? <HighlightedText text={item.description} query={query} /> : item.description}
        </p>
        <p className="text-xs text-muted line-clamp-1">{item.bookTitle}</p>
      </div>
    </Link>
  );
}

// ==================== PAGINATION ====================

function Pagination({ total, offset, setOffset, loading, pageSize }: {
  total: number; offset: number; setOffset: (n: number) => void; loading: boolean; pageSize: number;
}) {
  if (total <= pageSize || loading) return null;

  return (
    <div className="flex items-center justify-center gap-4 mt-8 pt-6 border-t border-border-light">
      <button
        onClick={() => { setOffset(Math.max(0, offset - pageSize)); window.scrollTo(0, 0); }}
        disabled={offset === 0}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-border-medium text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-warm"
      >
        <ChevronLeft className="w-4 h-4" /> Previous
      </button>
      <span className="text-sm text-muted">
        Page {Math.floor(offset / pageSize) + 1} of {Math.ceil(total / pageSize)}
      </span>
      <button
        onClick={() => { setOffset(offset + pageSize); window.scrollTo(0, 0); }}
        disabled={offset + pageSize >= total}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-border-medium text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-warm"
      >
        Next <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

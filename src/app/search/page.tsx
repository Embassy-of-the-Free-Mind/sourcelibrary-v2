'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search, Book, FileText, ExternalLink, Filter, X, Loader2,
  Quote, User, MapPin, Lightbulb, BookOpen, Languages,
  ChevronLeft, ChevronRight, ArrowUpDown, ImageIcon, ChevronDown
} from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import {
  search as searchApi,
  gallery as galleryApi,
  categories as categoriesApi,
  utils,
  type SearchResult,
  type IndexSearchResult,
  type GalleryItem,
} from '@/lib/api-client';
import { sendGAEvent } from '@/lib/ga';
import HighlightedText from '@/components/search/HighlightedText';
import { SEARCH_TYPE_STYLES, type SearchIndexType } from '@/lib/style-constants';

// How many results to show in unified view per section
const PREVIEW_BOOKS = 5;
const PREVIEW_INDEX = 5;
const PREVIEW_IMAGES = 6;
const RESULTS_PER_PAGE = 20;

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

  // Filters (books mode)
  const [showFilters, setShowFilters] = useState(false);
  const [language, setLanguage] = useState(searchParams.get('language') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '');
  const [hasDoi, setHasDoi] = useState(searchParams.get('has_doi') === 'true');
  const [hasTranslation, setHasTranslation] = useState(searchParams.get('has_translation') === 'true');
  const [languages, setLanguages] = useState<LanguageOption[]>([{ value: '', label: 'All Languages' }]);
  const [categories, setCategories] = useState<CategoryOption[]>([{ value: '', label: 'All Categories' }]);

  // Suggestions
  const [suggestion, setSuggestion] = useState<string | null>(null);

  // Load filter options
  useEffect(() => {
    (async () => {
      try {
        const [langData, catData] = await Promise.all([utils.languages(), categoriesApi.list()]);
        if (langData.languages) {
          setLanguages([
            { value: '', label: 'All Languages' },
            ...langData.languages.map((l: any) => ({ value: l.code, label: `${l.name} (${l.book_count})` })),
          ]);
        }
        if (catData.categories) {
          setCategories([
            { value: '', label: 'All Categories' },
            ...catData.categories
              .filter((c: any) => c.book_count > 0)
              .map((c: any) => ({ value: c.id, label: `${c.icon ? c.icon + ' ' : ''}${c.name} (${c.book_count})`, icon: c.icon })),
          ]);
        }
      } catch {}
    })();
  }, []);

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
        // Run all three in parallel, limited previews
        const [bookData, indexData, imageData] = await Promise.all([
          searchApi.search(q, { limit: PREVIEW_BOOKS }),
          searchApi.index(q, {}),
          galleryApi.list({ query: q, limit: PREVIEW_IMAGES }),
        ]);
        setBookResults(bookData.results || []);
        setBookTotal(bookData.total || 0);
        setIndexResults((indexData.results || []).slice(0, PREVIEW_INDEX));
        setIndexTotal(indexData.total || 0);
        setImageResults(imageData.items || []);
        setImageTotal(imageData.total || 0);
        sendGAEvent({ action: 'search', category: 'engagement', label: q, value: (bookData.total || 0) + (indexData.total || 0) + (imageData.total || 0), search_term: q });
      } else if (mode === 'books') {
        const data = await searchApi.search(q, {
          language: language || undefined,
          category: category || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          has_doi: hasDoi ? 'true' : undefined,
          has_translation: hasTranslation ? 'true' : undefined,
          sort: sortBy !== 'relevance' ? sortBy : undefined,
          offset: pageOffset > 0 ? pageOffset : undefined,
          limit: RESULTS_PER_PAGE,
        });
        setBookResults(data.results || []);
        setBookTotal(data.total || 0);
      } else if (mode === 'index') {
        const data = await searchApi.index(q, { type: indexType || undefined });
        setIndexResults(data.results || []);
        setIndexTotal(data.total || 0);
      } else if (mode === 'images') {
        const data = await galleryApi.list({ query: q, limit: RESULTS_PER_PAGE, offset: pageOffset });
        setImageResults(data.items || []);
        setImageTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }, [viewMode, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation, sortBy]);

  const updateUrl = useCallback((q: string, mode: ViewMode, pageOffset = 0) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (mode !== 'unified') params.set('mode', mode);
    if (mode === 'index' && indexType) params.set('type', indexType);
    if (mode === 'books') {
      if (language) params.set('language', language);
      if (category) params.set('category', category);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (hasDoi) params.set('has_doi', 'true');
      if (hasTranslation) params.set('has_translation', 'true');
      if (sortBy !== 'relevance') params.set('sort', sortBy);
    }
    if (pageOffset > 0) params.set('offset', pageOffset.toString());
    router.replace(`/search?${params.toString()}`, { scroll: false });
  }, [router, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation, sortBy]);

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setOffset(0);
    performSearch(value, viewMode, 0);
    updateUrl(value, viewMode, 0);
  }, 300);

  // Re-search when filters/sort/mode change
  useEffect(() => {
    if (query.length >= 2) {
      performSearch(query, viewMode, offset);
      updateUrl(query, viewMode, offset);
    }
  }, [viewMode, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation, sortBy, offset]);

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
    debouncedSearch(value);
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
    setLanguage(''); setCategory(''); setDateFrom(''); setDateTo('');
    setHasDoi(false); setHasTranslation(false); setSortBy('relevance'); setOffset(0);
  };
  const hasActiveFilters = language || category || dateFrom || dateTo || hasDoi || hasTranslation || sortBy !== 'relevance';

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <Link href="/" className="text-2xl font-serif font-bold text-stone-900 hover:text-amber-700">
            Source Library
          </Link>
          <p className="text-stone-500 mt-1">Search translated historical texts</p>
        </div>
      </header>

      {/* Search Bar */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          {/* Back to unified + mode label */}
          {viewMode !== 'unified' && (
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={backToUnified}
                className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                All results
              </button>
              <span className="text-sm text-stone-400">/</span>
              <span className="text-sm font-medium text-stone-700">
                {viewMode === 'books' ? 'Books & Pages' : viewMode === 'index' ? 'Index' : 'Images'}
              </span>
            </div>
          )}

          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="Search books, concepts, people, images..."
                className="w-full pl-12 pr-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 animate-spin" />
              )}
            </div>
            {viewMode === 'books' && (
              <>
                <div className="relative">
                  <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                  <select
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value as any); setOffset(0); }}
                    className="pl-9 pr-3 py-3 border border-stone-300 rounded-xl text-sm text-stone-600 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="relevance">Relevance</option>
                    <option value="date_desc">Newest first</option>
                    <option value="date_asc">Oldest first</option>
                    <option value="title">Title A-Z</option>
                  </select>
                </div>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-4 py-3 border rounded-xl flex items-center gap-2 transition-colors ${
                    showFilters || hasActiveFilters
                      ? 'bg-amber-100 border-amber-300 text-amber-800'
                      : 'border-stone-300 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  <Filter className="w-5 h-5" />
                  Filters
                  {hasActiveFilters && <span className="w-2 h-2 bg-amber-500 rounded-full" />}
                </button>
              </>
            )}
          </div>

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
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : 'bg-stone-100 text-stone-600 border border-transparent hover:bg-stone-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {type.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Filters Panel (books drill-down mode) */}
          {showFilters && viewMode === 'books' && (
            <div className="mt-4 p-4 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-stone-700">Filters</span>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="text-sm text-stone-500 hover:text-stone-700 flex items-center gap-1">
                    <X className="w-4 h-4" /> Clear all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Language</label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
                    {languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Subject</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
                    {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Published After</label>
                  <input type="text" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                    placeholder="e.g., 1500" className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Published Before</label>
                  <input type="text" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                    placeholder="e.g., 1700" className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div className="flex flex-col gap-2 pt-6">
                  <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
                    <input type="checkbox" checked={hasDoi} onChange={(e) => setHasDoi(e.target.checked)}
                      className="rounded border-stone-300 text-amber-500 focus:ring-amber-500" /> Has DOI
                  </label>
                  <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
                    <input type="checkbox" checked={hasTranslation} onChange={(e) => setHasTranslation(e.target.checked)}
                      className="rounded border-stone-300 text-amber-500 focus:ring-amber-500" /> Has translation
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Empty state */}
        {!query && (
          <div className="text-center py-16">
            <Book className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-stone-700 mb-2">Search the Library</h2>
            <p className="text-stone-500 max-w-md mx-auto">
              Search across translated historical texts, concepts, people, and illustrations.
            </p>
          </div>
        )}

        {/* Loading */}
        {query.length >= 2 && loading && viewMode === 'unified' && (
          <div className="text-stone-500 mb-6">Searching...</div>
        )}

        {/* No results */}
        {noResults && (
          <div className="text-center py-16">
            <Search className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-stone-700 mb-2">No results found</h2>
            {suggestion ? (
              <p className="text-stone-600">
                Did you mean{' '}
                <button
                  onClick={() => { setQuery(suggestion); setOffset(0); performSearch(suggestion, viewMode, 0); updateUrl(suggestion, viewMode, 0); }}
                  className="font-semibold text-amber-700 hover:text-amber-800 underline underline-offset-2"
                >{suggestion}</button>?
              </p>
            ) : (
              <p className="text-stone-500">Try different keywords.</p>
            )}
          </div>
        )}

        {/* ==================== UNIFIED VIEW ==================== */}
        {viewMode === 'unified' && !loading && query.length >= 2 && totalResults > 0 && (
          <div className="space-y-10">
            {/* Books Section */}
            {bookTotal > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-800">
                    <Book className="w-5 h-5 text-amber-600" />
                    Books & Pages
                    <span className="text-sm font-normal text-stone-500">({bookTotal})</span>
                  </h2>
                  {bookTotal > PREVIEW_BOOKS && (
                    <button onClick={() => drillInto('books')} className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1">
                      See all {bookTotal} <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {bookResults.slice(0, PREVIEW_BOOKS).map((result) => (
                    <BookResultCard key={result.id} result={result} query={query} />
                  ))}
                </div>
              </section>
            )}

            {/* Index Section */}
            {indexTotal > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-800">
                    <Lightbulb className="w-5 h-5 text-purple-600" />
                    Index
                    <span className="text-sm font-normal text-stone-500">({indexTotal})</span>
                  </h2>
                  {indexTotal > PREVIEW_INDEX && (
                    <button onClick={() => drillInto('index')} className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1">
                      See all {indexTotal} <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {indexResults.slice(0, PREVIEW_INDEX).map((result, idx) => (
                    <IndexResultCard key={`${result.book_id}-${result.type}-${idx}`} result={result} query={query} />
                  ))}
                </div>
              </section>
            )}

            {/* Images Section */}
            {imageTotal > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-800">
                    <ImageIcon className="w-5 h-5 text-rose-600" />
                    Images
                    <span className="text-sm font-normal text-stone-500">({imageTotal})</span>
                  </h2>
                  {imageTotal > PREVIEW_IMAGES && (
                    <button onClick={() => drillInto('images')} className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1">
                      See all {imageTotal} <ChevronRight className="w-4 h-4" />
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
          </div>
        )}

        {/* ==================== BOOKS DRILL-DOWN ==================== */}
        {viewMode === 'books' && query.length >= 2 && (
          <>
            {!loading && (
              <div className="mb-6 text-stone-600">
                Found <span className="font-medium text-stone-900">{bookTotal}</span> books & pages for &ldquo;{query}&rdquo;
                {bookTotal > RESULTS_PER_PAGE && (
                  <span className="ml-2 text-stone-500">
                    (showing {offset + 1}&ndash;{Math.min(offset + RESULTS_PER_PAGE, bookTotal)})
                  </span>
                )}
              </div>
            )}
            {loading && <div className="text-stone-500 mb-6">Searching...</div>}
            <div className="space-y-3">
              {bookResults.map((result) => (
                <BookResultCard key={result.id} result={result} query={query} />
              ))}
            </div>
            <Pagination total={bookTotal} offset={offset} setOffset={setOffset} loading={loading} />
          </>
        )}

        {/* ==================== INDEX DRILL-DOWN ==================== */}
        {viewMode === 'index' && query.length >= 2 && (
          <>
            {!loading && (
              <div className="mb-6 text-stone-600">
                Found <span className="font-medium text-stone-900">{indexTotal}</span> index entries for &ldquo;{query}&rdquo;
              </div>
            )}
            {loading && <div className="text-stone-500 mb-6">Searching...</div>}
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
              <div className="mb-6 text-stone-600">
                Found <span className="font-medium text-stone-900">{imageTotal}</span> images for &ldquo;{query}&rdquo;
                {imageTotal > RESULTS_PER_PAGE && (
                  <span className="ml-2 text-stone-500">
                    (showing {offset + 1}&ndash;{Math.min(offset + RESULTS_PER_PAGE, imageTotal)})
                  </span>
                )}
              </div>
            )}
            {loading && <div className="text-stone-500 mb-6">Searching...</div>}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {imageResults.map((item, idx) => (
                <ImageResultCard key={`${item.pageId}-${item.detectionIndex}-${idx}`} item={item} query={query} large />
              ))}
            </div>
            <Pagination total={imageTotal} offset={offset} setOffset={setOffset} loading={loading} />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 mt-16 py-8 bg-white">
        <div className="max-w-5xl mx-auto px-4 text-center text-sm text-stone-500">
          <p>Source Library — Making historical texts accessible through AI-assisted translation.</p>
          <p className="mt-2">All translations are citable with DOIs via Zenodo.</p>
        </div>
      </footer>
    </div>
  );
}

// ==================== RESULT CARDS ====================

function BookResultCard({ result, query }: { result: SearchResult; query: string }) {
  return (
    <Link
      href={result.type === 'page' ? `/book/${result.book_id}/page/${result.page_number}` : `/book/${result.book_id}`}
      className="block bg-white rounded-xl border border-stone-200 p-4 hover:border-amber-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg flex-shrink-0 ${result.type === 'book' ? 'bg-amber-100' : 'bg-accent-sage/12'}`}>
          {result.type === 'book' ? <Book className="w-4 h-4 text-amber-700" /> : <FileText className="w-4 h-4 text-accent-sage-dark" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-medium text-stone-900 line-clamp-1">
                <HighlightedText text={result.display_title || result.title} query={query} />
                {result.type === 'page' && <span className="text-stone-500 font-normal ml-2">— Page {result.page_number}</span>}
              </h3>
              <p className="text-sm text-stone-600 mt-0.5">
                <HighlightedText text={result.author} query={query} /> • {result.published} • {result.language}
              </p>
            </div>
            {result.has_doi && result.doi && (
              <a href={`https://doi.org/${result.doi}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200 flex-shrink-0">
                DOI <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {result.snippet && (
            <p className="mt-2 text-sm text-stone-600 line-clamp-2">
              <HighlightedText text={result.snippet} query={query} />
            </p>
          )}
          {result.type === 'book' && result.page_count && (
            <p className="mt-1.5 text-xs text-stone-500">
              {result.page_count} pages{result.translated_count ? ` • ${result.translated_count} translated` : ''}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function IndexResultCard({ result, query }: { result: IndexSearchResult; query: string }) {
  const TypeIcon = INDEX_TYPES.find(t => t.value === result.type)?.icon || Search;
  const typeLabel = INDEX_TYPES.find(t => t.value === result.type)?.label || result.type;
  const isQuote = result.type === 'quote';

  return (
    <Link
      href={isQuote && result.quote_page
        ? `/book/${result.book_id}/guide?page=${result.quote_page}`
        : result.pages && result.pages.length > 0
        ? `/book/${result.book_id}/guide?page=${result.pages[0]}`
        : `/book/${result.book_id}`
      }
      className="block bg-white rounded-xl border border-stone-200 p-4 hover:border-accent-violet/30 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg flex-shrink-0 ${(SEARCH_TYPE_STYLES[result.type as SearchIndexType] ?? SEARCH_TYPE_STYLES.keyword).badge.split(' ')[0]}`}>
          <TypeIcon className={`w-4 h-4 ${(SEARCH_TYPE_STYLES[result.type as SearchIndexType] ?? SEARCH_TYPE_STYLES.keyword).iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded-full ${(SEARCH_TYPE_STYLES[result.type as SearchIndexType] ?? SEARCH_TYPE_STYLES.keyword).badge}`}>{typeLabel}</span>

          {isQuote ? (
            <>
              <blockquote className="font-serif text-stone-800 italic border-l-2 border-amber-300 pl-3 my-2">
                &ldquo;<HighlightedText text={result.quote_text || ''} query={query} />&rdquo;
              </blockquote>
              {result.quote_significance && (
                <p className="text-sm text-stone-600 mt-1"><HighlightedText text={result.quote_significance} query={query} /></p>
              )}
            </>
          ) : (
            <h3 className="font-medium text-stone-900 mt-1"><HighlightedText text={result.term} query={query} /></h3>
          )}

          <p className="text-sm text-stone-500 mt-1.5">
            From: <span className="text-stone-700">{result.book_title}</span> • {result.book_author}
          </p>
          {result.pages && result.pages.length > 0 && (
            <p className="text-xs text-stone-500 mt-1">
              Pages: {result.pages.slice(0, 5).join(', ')}{result.pages.length > 5 && ` +${result.pages.length - 5} more`}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function ImageResultCard({ item, query, large }: { item: GalleryItem; query: string; large?: boolean }) {
  const [imageError, setImageError] = useState(false);

  const displayUrl = item.bbox
    ? `/api/crop-image?url=${encodeURIComponent(item.imageUrl)}&x=${item.bbox.x}&y=${item.bbox.y}&w=${item.bbox.width}&h=${item.bbox.height}`
    : item.imageUrl;

  return (
    <Link
      href={`/gallery/image/${item.pageId}-${item.detectionIndex}`}
      className="group block bg-white rounded-lg border border-stone-200 overflow-hidden hover:border-rose-300 hover:shadow-md transition-all"
    >
      <div className={`relative bg-stone-100 ${large ? 'aspect-[3/4]' : 'aspect-square'}`}>
        {!imageError ? (
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
            <ImageIcon className="w-8 h-8 text-stone-300" />
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs text-stone-700 line-clamp-2 mb-1">
          {query ? <HighlightedText text={item.description} query={query} /> : item.description}
        </p>
        <p className="text-[10px] text-stone-400 line-clamp-1">{item.bookTitle}</p>
      </div>
    </Link>
  );
}

// ==================== PAGINATION ====================

function Pagination({ total, offset, setOffset, loading }: {
  total: number; offset: number; setOffset: (n: number) => void; loading: boolean;
}) {
  if (total <= RESULTS_PER_PAGE || loading) return null;

  return (
    <div className="flex items-center justify-center gap-4 mt-8 pt-6 border-t border-stone-200">
      <button
        onClick={() => { setOffset(Math.max(0, offset - RESULTS_PER_PAGE)); window.scrollTo(0, 0); }}
        disabled={offset === 0}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-stone-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-50"
      >
        <ChevronLeft className="w-4 h-4" /> Previous
      </button>
      <span className="text-sm text-stone-600">
        Page {Math.floor(offset / RESULTS_PER_PAGE) + 1} of {Math.ceil(total / RESULTS_PER_PAGE)}
      </span>
      <button
        onClick={() => { setOffset(offset + RESULTS_PER_PAGE); window.scrollTo(0, 0); }}
        disabled={offset + RESULTS_PER_PAGE >= total}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-stone-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-50"
      >
        Next <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

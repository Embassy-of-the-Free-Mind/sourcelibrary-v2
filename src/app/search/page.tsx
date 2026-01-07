'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Book, FileText, ExternalLink, Filter, X, Loader2, Quote, User, MapPin, Lightbulb, BookOpen, Languages } from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { search as searchApi, type SearchResult, type IndexSearchResult, type IndexSearchResponse } from '@/lib/api-client';

const INDEX_TYPES = [
  { value: '', label: 'All Types', icon: Search },
  { value: 'concept', label: 'Concepts', icon: Lightbulb },
  { value: 'person', label: 'People', icon: User },
  { value: 'place', label: 'Places', icon: MapPin },
  { value: 'quote', label: 'Quotes', icon: Quote },
  { value: 'keyword', label: 'Keywords', icon: BookOpen },
  { value: 'vocabulary', label: 'Vocabulary', icon: Languages },
];

interface LanguageOption {
  value: string;
  label: string;
  book_count?: number;
}

interface CategoryOption {
  value: string;
  label: string;
  icon?: string;
  book_count?: number;
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [indexResults, setIndexResults] = useState<IndexSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [indexByType, setIndexByType] = useState<IndexSearchResponse['byType'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searchMode, setSearchMode] = useState<'books' | 'index'>(
    searchParams.get('mode') === 'index' ? 'index' : 'books'
  );
  const [indexType, setIndexType] = useState(searchParams.get('type') || '');

  // Dynamic filter options
  const [languages, setLanguages] = useState<LanguageOption[]>([{ value: '', label: 'All Languages' }]);
  const [categories, setCategories] = useState<CategoryOption[]>([{ value: '', label: 'All Categories' }]);

  // Filters
  const [language, setLanguage] = useState(searchParams.get('language') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '');
  const [hasDoi, setHasDoi] = useState(searchParams.get('has_doi') === 'true');
  const [hasTranslation, setHasTranslation] = useState(searchParams.get('has_translation') === 'true');

  // Fetch languages and categories on mount
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        // Fetch languages
        const langResponse = await fetch('/api/languages');
        const langData = await langResponse.json();
        if (langData.languages) {
          setLanguages([
            { value: '', label: 'All Languages' },
            ...langData.languages.map((lang: any) => ({
              value: lang.code,
              label: `${lang.name} (${lang.book_count})`,
              book_count: lang.book_count,
            })),
          ]);
        }

        // Fetch categories
        const catResponse = await fetch('/api/categories');
        const catData = await catResponse.json();
        if (catData.categories) {
          setCategories([
            { value: '', label: 'All Categories' },
            ...catData.categories
              .filter((cat: any) => cat.book_count > 0)
              .map((cat: any) => ({
                value: cat.id,
                label: `${cat.icon ? cat.icon + ' ' : ''}${cat.name} (${cat.book_count})`,
                icon: cat.icon,
                book_count: cat.book_count,
              })),
          ]);
        }
      } catch (error) {
        console.error('Error fetching filter options:', error);
      }
    };

    fetchFilterOptions();
  }, []);

  const performSearch = useCallback(async (searchQuery: string, mode: 'books' | 'index' = searchMode) => {
    if (!searchQuery || searchQuery.length < 2) {
      setResults([]);
      setIndexResults([]);
      setTotal(0);
      setIndexByType(null);
      return;
    }

    setLoading(true);

    try {
      if (mode === 'index') {
        // Index search
        const data = await searchApi.index(searchQuery, { type: indexType || undefined });

        setIndexResults(data.results || []);
        setTotal(data.total || 0);
        setIndexByType(data.byType || null);
        setResults([]);
      } else {
        // Book/page search
        const data = await searchApi.search(searchQuery, {
          language: language || undefined,
          category: category || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          has_doi: hasDoi ? 'true' : undefined,
          has_translation: hasTranslation ? 'true' : undefined,
        });

        setResults(data.results || []);
        setTotal(data.total || 0);
        setIndexResults([]);
        setIndexByType(null);
      }
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
      setIndexResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [searchMode, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation]);

  const debouncedSearch = useDebouncedCallback((value: string) => {
    performSearch(value);
    updateUrl(value);
  }, 300);

  const updateUrl = (q: string = query) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (searchMode === 'index') {
      params.set('mode', 'index');
      if (indexType) params.set('type', indexType);
    } else {
      if (language) params.set('language', language);
      if (category) params.set('category', category);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (hasDoi) params.set('has_doi', 'true');
      if (hasTranslation) params.set('has_translation', 'true');
    }
    router.replace(`/search?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (query) {
      performSearch(query);
      updateUrl();
    }
  }, [searchMode, indexType, language, category, dateFrom, dateTo, hasDoi, hasTranslation]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    debouncedSearch(value);
  };

  const clearFilters = () => {
    setLanguage('');
    setCategory('');
    setDateFrom('');
    setDateTo('');
    setHasDoi(false);
    setHasTranslation(false);
  };

  const hasActiveFilters = language || category || dateFrom || dateTo || hasDoi || hasTranslation;

  // Group results by category
  const groupedResults = () => {
    if (category) {
      // If filtering by category, don't group (all results are same category)
      return { [category]: results };
    }

    const groups: Record<string, SearchResult[]> = {
      uncategorized: [],
    };

    results.forEach(result => {
      if (!result.categories || result.categories.length === 0) {
        groups.uncategorized.push(result);
      } else {
        // Add to the first category (primary category)
        const primaryCategory = result.categories[0];
        if (!groups[primaryCategory]) {
          groups[primaryCategory] = [];
        }
        groups[primaryCategory].push(result);
      }
    });

    // Remove empty groups
    Object.keys(groups).forEach(key => {
      if (groups[key].length === 0) {
        delete groups[key];
      }
    });

    return groups;
  };

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
          {/* Mode Toggle */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setSearchMode('books')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchMode === 'books'
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-stone-100 text-stone-600 border border-transparent hover:bg-stone-200'
              }`}
            >
              <Book className="w-4 h-4 inline mr-1.5" />
              Books & Pages
            </button>
            <button
              onClick={() => setSearchMode('index')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchMode === 'index'
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-stone-100 text-stone-600 border border-transparent hover:bg-stone-200'
              }`}
            >
              <Lightbulb className="w-4 h-4 inline mr-1.5" />
              Index (Concepts, People, Quotes)
            </button>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder={searchMode === 'index'
                  ? "Search concepts, people, places, quotes..."
                  : "Search books, authors, translations..."}
                className="w-full pl-12 pr-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 animate-spin" />
              )}
            </div>
            {searchMode === 'books' && (
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
                {hasActiveFilters && (
                  <span className="w-2 h-2 bg-amber-500 rounded-full" />
                )}
              </button>
            )}
          </div>

          {/* Index Type Filter */}
          {searchMode === 'index' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {INDEX_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.value}
                    onClick={() => setIndexType(type.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
                      indexType === type.value
                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                        : 'bg-stone-100 text-stone-600 border border-transparent hover:bg-stone-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {type.label}
                    {indexByType && type.value && (
                      <span className="text-xs opacity-70">
                        ({indexByType[type.value as keyof typeof indexByType] || 0})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Filters Panel */}
          {showFilters && (
            <div className="mt-4 p-4 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-stone-700">Filters</span>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-sm text-stone-500 hover:text-stone-700 flex items-center gap-1"
                  >
                    <X className="w-4 h-4" />
                    Clear all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Language</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {languages.map((lang) => (
                      <option key={lang.value} value={lang.value}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Subject</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {categories.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Published After</label>
                  <input
                    type="text"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    placeholder="e.g., 1500"
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Published Before</label>
                  <input
                    type="text"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    placeholder="e.g., 1700"
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div className="flex flex-col gap-2 pt-6">
                  <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasDoi}
                      onChange={(e) => setHasDoi(e.target.checked)}
                      className="rounded border-stone-300 text-amber-500 focus:ring-amber-500"
                    />
                    Has DOI
                  </label>
                  <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasTranslation}
                      onChange={(e) => setHasTranslation(e.target.checked)}
                      className="rounded border-stone-300 text-amber-500 focus:ring-amber-500"
                    />
                    Has translation
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {query.length >= 2 && (
          <div className="mb-6 text-stone-600">
            {loading ? (
              'Searching...'
            ) : (
              <>
                Found <span className="font-medium text-stone-900">{total}</span> results for &ldquo;{query}&rdquo;
              </>
            )}
          </div>
        )}

        {!query && (
          <div className="text-center py-16">
            <Book className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-stone-700 mb-2">Search the Library</h2>
            <p className="text-stone-500 max-w-md mx-auto">
              Search across translated historical texts. Find primary sources on alchemy,
              natural philosophy, and early modern science.
            </p>
          </div>
        )}

        {query && results.length === 0 && indexResults.length === 0 && !loading && (
          <div className="text-center py-16">
            <Search className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-stone-700 mb-2">No results found</h2>
            <p className="text-stone-500">
              Try different keywords or adjust your filters.
            </p>
          </div>
        )}

        {/* Book/Page Results */}
        {searchMode === 'books' && results.length > 0 && (
          <div className="space-y-8">
            {Object.entries(groupedResults()).map(([categoryId, categoryResults]) => {
              const categoryInfo = categories.find(c => c.value === categoryId);
              const categoryName = categoryInfo?.label.replace(/\s*\(\d+\)$/, '') ||
                                   (categoryId === 'uncategorized' ? 'Other' :
                                   categoryId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
              const categoryIcon = categoryInfo?.icon;

              return (
                <div key={categoryId} className="space-y-4">
                  {!category && ( // Only show category headers when not filtering by a specific category
                    <div className="flex items-center gap-2 pb-2 border-b border-stone-200">
                      {categoryIcon && <span className="text-xl">{categoryIcon}</span>}
                      <h2 className="text-lg font-semibold text-stone-800">
                        {categoryName}
                      </h2>
                      <span className="text-sm text-stone-500">
                        ({categoryResults.length})
                      </span>
                    </div>
                  )}
                  {categoryResults.map((result) => (
              <Link
                key={result.id}
                href={result.type === 'page'
                  ? `/book/${result.book_id}/page/${result.page_number}`
                  : `/book/${result.book_id}`
                }
                className="block bg-white rounded-xl border border-stone-200 p-5 hover:border-amber-300 hover:shadow-md transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${
                    result.type === 'book' ? 'bg-amber-100' : 'bg-blue-100'
                  }`}>
                    {result.type === 'book' ? (
                      <Book className="w-5 h-5 text-amber-700" />
                    ) : (
                      <FileText className="w-5 h-5 text-blue-700" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-medium text-stone-900 line-clamp-1">
                          {result.display_title || result.title}
                          {result.type === 'page' && (
                            <span className="text-stone-500 font-normal ml-2">
                              — Page {result.page_number}
                            </span>
                          )}
                        </h3>
                        <p className="text-sm text-stone-600 mt-1">
                          {result.author} • {result.published} • {result.language}
                        </p>
                      </div>
                      {result.has_doi && result.doi && (
                        <a
                          href={`https://doi.org/${result.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200"
                        >
                          DOI
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    {result.snippet && (
                      <p className="mt-3 text-sm text-stone-600 line-clamp-2">
                        {result.snippet}
                      </p>
                    )}
                    {result.type === 'book' && result.page_count && (
                      <p className="mt-2 text-xs text-stone-500">
                        {result.page_count} pages
                        {result.translated_count ? ` • ${result.translated_count} translated` : ''}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Index Results */}
        {searchMode === 'index' && (
          <div className="space-y-4">
            {indexResults.map((result, idx) => {
              const TypeIcon = INDEX_TYPES.find(t => t.value === result.type)?.icon || Search;
              const typeLabel = INDEX_TYPES.find(t => t.value === result.type)?.label || result.type;
              const isQuote = result.type === 'quote';

              return (
                <Link
                  key={`${result.book_id}-${result.type}-${idx}`}
                  href={isQuote && result.quote_page
                    ? `/book/${result.book_id}/guide?page=${result.quote_page}`
                    : result.pages && result.pages.length > 0
                    ? `/book/${result.book_id}/guide?page=${result.pages[0]}`
                    : `/book/${result.book_id}`
                  }
                  className="block bg-white rounded-xl border border-stone-200 p-5 hover:border-amber-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg ${
                      result.type === 'concept' ? 'bg-purple-100' :
                      result.type === 'person' ? 'bg-blue-100' :
                      result.type === 'place' ? 'bg-green-100' :
                      result.type === 'quote' ? 'bg-amber-100' :
                      result.type === 'vocabulary' ? 'bg-rose-100' :
                      'bg-stone-100'
                    }`}>
                      <TypeIcon className={`w-5 h-5 ${
                        result.type === 'concept' ? 'text-purple-700' :
                        result.type === 'person' ? 'text-blue-700' :
                        result.type === 'place' ? 'text-green-700' :
                        result.type === 'quote' ? 'text-amber-700' :
                        result.type === 'vocabulary' ? 'text-rose-700' :
                        'text-stone-700'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              result.type === 'concept' ? 'bg-purple-100 text-purple-700' :
                              result.type === 'person' ? 'bg-blue-100 text-blue-700' :
                              result.type === 'place' ? 'bg-green-100 text-green-700' :
                              result.type === 'quote' ? 'bg-amber-100 text-amber-700' :
                              result.type === 'vocabulary' ? 'bg-rose-100 text-rose-700' :
                              'bg-stone-100 text-stone-700'
                            }`}>
                              {typeLabel}
                            </span>
                          </div>
                          {isQuote ? (
                            <>
                              <blockquote className="font-serif text-stone-800 italic border-l-2 border-amber-300 pl-3 my-2">
                                &ldquo;{result.quote_text}&rdquo;
                              </blockquote>
                              {result.quote_significance && (
                                <p className="text-sm text-stone-600 mt-2">
                                  {result.quote_significance}
                                </p>
                              )}
                            </>
                          ) : (
                            <h3 className="font-medium text-stone-900">
                              {result.term}
                            </h3>
                          )}
                          <p className="text-sm text-stone-500 mt-2">
                            From: <span className="text-stone-700">{result.book_title}</span>
                            <span className="mx-1">•</span>
                            {result.book_author}
                          </p>
                          {result.section_title && (
                            <p className="text-xs text-stone-500 mt-1">
                              Section: {result.section_title}
                            </p>
                          )}
                          {result.pages && result.pages.length > 0 && (
                            <p className="text-xs text-stone-500 mt-1">
                              Pages: {result.pages.slice(0, 5).join(', ')}
                              {result.pages.length > 5 && ` +${result.pages.length - 5} more`}
                            </p>
                          )}
                          {isQuote && result.quote_page && (
                            <p className="text-xs text-stone-500 mt-1">
                              Page {result.quote_page}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 mt-16 py-8 bg-white">
        <div className="max-w-5xl mx-auto px-4 text-center text-sm text-stone-500">
          <p>
            Source Library — Making historical texts accessible through AI-assisted translation.
          </p>
          <p className="mt-2">
            All translations are citable with DOIs via Zenodo.
          </p>
        </div>
      </footer>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Book, FileText, ExternalLink, Filter, X, Loader2, Quote, User, MapPin, Lightbulb, BookOpen, Languages } from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';

interface SearchResult {
  id: string;
  type: 'book' | 'page';
  book_id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  page_count?: number;
  translated_count?: number;
  has_doi: boolean;
  doi?: string;
  summary?: string;
  page_number?: number;
  snippet?: string;
  snippet_type?: 'translation' | 'ocr' | 'summary';
}

interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
  filters: {
    language?: string;
    date_from?: string;
    date_to?: string;
    has_doi?: string;
    has_translation?: string;
  };
}

interface IndexSearchResult {
  type: 'keyword' | 'concept' | 'person' | 'place' | 'vocabulary' | 'quote';
  term: string;
  book_id: string;
  book_title: string;
  book_author: string;
  pages?: number[];
  quote_text?: string;
  quote_page?: number;
  quote_significance?: string;
  section_title?: string;
}

interface IndexSearchResponse {
  query: string;
  total: number;
  byType: {
    vocabulary: number;
    keyword: number;
    concept: number;
    person: number;
    place: number;
    quote: number;
  };
  results: IndexSearchResult[];
}

const INDEX_TYPES = [
  { value: '', label: 'All Types', icon: Search },
  { value: 'concept', label: 'Concepts', icon: Lightbulb },
  { value: 'person', label: 'People', icon: User },
  { value: 'place', label: 'Places', icon: MapPin },
  { value: 'quote', label: 'Quotes', icon: Quote },
  { value: 'keyword', label: 'Keywords', icon: BookOpen },
  { value: 'vocabulary', label: 'Vocabulary', icon: Languages },
];

const LANGUAGES = [
  { value: '', label: 'All Languages' },
  { value: 'Latin', label: 'Latin' },
  { value: 'German', label: 'German' },
  { value: 'French', label: 'French' },
  { value: 'Italian', label: 'Italian' },
  { value: 'English', label: 'English' },
  { value: 'Dutch', label: 'Dutch' },
  { value: 'Spanish', label: 'Spanish' },
];

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'alchemy', label: 'Alchemy' },
  { value: 'hermeticism', label: 'Hermeticism' },
  { value: 'jewish-kabbalah', label: 'Jewish Kabbalah' },
  { value: 'christian-cabala', label: 'Christian Cabala' },
  { value: 'neoplatonism', label: 'Neoplatonism' },
  { value: 'rosicrucianism', label: 'Rosicrucianism' },
  { value: 'freemasonry', label: 'Freemasonry' },
  { value: 'natural-philosophy', label: 'Natural Philosophy' },
  { value: 'astrology', label: 'Astrology' },
  { value: 'natural-magic', label: 'Natural Magic' },
  { value: 'ritual-magic', label: 'Ritual Magic' },
  { value: 'theurgy', label: 'Theurgy' },
  { value: 'mysticism', label: 'Mysticism' },
  { value: 'theology', label: 'Theology' },
  { value: 'medicine', label: 'Medicine & Healing' },
  { value: 'gnosticism', label: 'Gnosticism' },
  { value: 'theosophy', label: 'Theosophy' },
  { value: 'pythagoreanism', label: 'Pythagoreanism' },
  { value: 'divination', label: 'Divination' },
  { value: 'paracelsian', label: 'Paracelsian' },
  { value: 'spiritual-alchemy', label: 'Spiritual Alchemy' },
  { value: 'christian-mysticism', label: 'Christian Mysticism' },
  { value: 'prisca-theologia', label: 'Prisca Theologia' },
  { value: 'florentine-platonism', label: 'Florentine Platonism' },
  { value: 'renaissance', label: 'Renaissance' },
  { value: 'reformation', label: 'Reformation Era' },
  { value: 'enlightenment', label: 'Enlightenment' },
  { value: '19th-century-revival', label: '19th Century Revival' },
];

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

  // Filters
  const [language, setLanguage] = useState(searchParams.get('language') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '');
  const [hasDoi, setHasDoi] = useState(searchParams.get('has_doi') === 'true');
  const [hasTranslation, setHasTranslation] = useState(searchParams.get('has_translation') === 'true');

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
        const params = new URLSearchParams({ q: searchQuery });
        if (indexType) params.set('type', indexType);

        const response = await fetch(`/api/search/index?${params}`);
        const data: IndexSearchResponse = await response.json();

        setIndexResults(data.results || []);
        setTotal(data.total || 0);
        setIndexByType(data.byType || null);
        setResults([]);
      } else {
        // Book/page search
        const params = new URLSearchParams({ q: searchQuery });
        if (language) params.set('language', language);
        if (category) params.set('category', category);
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        if (hasDoi) params.set('has_doi', 'true');
        if (hasTranslation) params.set('has_translation', 'true');

        const response = await fetch(`/api/search?${params}`);
        const data: SearchResponse = await response.json();

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
                    {LANGUAGES.map((lang) => (
                      <option key={lang.value} value={lang.value}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-stone-600 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {CATEGORIES.map((cat) => (
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
        {searchMode === 'books' && (
          <div className="space-y-4">
            {results.map((result) => (
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
                    ? `/book/${result.book_id}/read?page=${result.quote_page}`
                    : result.pages && result.pages.length > 0
                    ? `/book/${result.book_id}/read?page=${result.pages[0]}`
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

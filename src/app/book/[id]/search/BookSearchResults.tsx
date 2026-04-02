'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, FileText, Languages, Loader2, ArrowLeft, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import HighlightedText from '@/components/search/HighlightedText';

interface SearchMatch {
  field: 'ocr' | 'translation';
  snippet: string;
  position: number;
}

interface SearchResult {
  pageId: string;
  pageNumber: number;
  matches: SearchMatch[];
}

interface SearchResponse {
  query: string;
  total: number;
  ocrPages: number;
  translationPages: number;
  results: SearchResult[];
}

type FieldFilter = 'all' | 'ocr' | 'translation';

interface Props {
  bookId: string;
  bookTitle: string;
  backUrl: string;
  initialQuery: string;
}

export default function BookSearchResults({ bookId, bookTitle, backUrl, initialQuery }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const [ocrPages, setOcrPages] = useState(0);
  const [translationPages, setTranslationPages] = useState(0);
  const [fieldFilter, setFieldFilter] = useState<FieldFilter>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    try {
      const response = await fetch(
        `/api/books/${bookId}/search?q=${encodeURIComponent(searchQuery.trim())}`
      );
      if (response.ok) {
        const data: SearchResponse = await response.json();
        setResults(data.results);
        setTotalResults(data.total);
        setOcrPages(data.ocrPages);
        setTranslationPages(data.translationPages);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  }, [bookId]);

  // Search on mount if initial query provided
  useEffect(() => {
    if (initialQuery) {
      doSearch(initialQuery);
    } else {
      inputRef.current?.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    // Update URL without full navigation
    const url = new URL(window.location.href);
    url.searchParams.set('q', query.trim());
    router.replace(url.pathname + url.search, { scroll: false });
    doSearch(query.trim());
  };

  const filteredResults = fieldFilter === 'all'
    ? results
    : results
        .map(r => ({
          ...r,
          matches: r.matches.filter(m => m.field === fieldFilter)
        }))
        .filter(r => r.matches.length > 0);

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <Link
          href={backUrl}
          className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          {bookTitle}
        </Link>
        <h1 className="text-2xl font-serif text-stone-900">Search in book</h1>
      </div>

      {/* Search input */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-white border border-stone-200 focus-within:border-stone-400 transition-colors">
          {isSearching ? (
            <Loader2 className="w-5 h-5 text-stone-400 animate-spin flex-shrink-0" />
          ) : (
            <Search className="w-5 h-5 text-stone-400 flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search OCR text and translations..."
            className="flex-1 bg-transparent outline-none text-stone-900 placeholder-stone-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="text-stone-400 hover:text-stone-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </form>

      {/* Results summary + filter */}
      {hasSearched && !isSearching && results.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
          <span className="text-stone-600">
            {totalResults} page{totalResults !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-1 rounded-md bg-stone-100 p-0.5">
            <button
              onClick={() => setFieldFilter('all')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                fieldFilter === 'all'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              All
            </button>
            {ocrPages > 0 && (
              <button
                onClick={() => setFieldFilter('ocr')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  fieldFilter === 'ocr'
                    ? 'bg-white text-stone-900 shadow-sm'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                <FileText className="w-3 h-3 text-blue-600" />
                OCR ({ocrPages})
              </button>
            )}
            {translationPages > 0 && (
              <button
                onClick={() => setFieldFilter('translation')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  fieldFilter === 'translation'
                    ? 'bg-white text-stone-900 shadow-sm'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                <Languages className="w-3 h-3 text-status-success" />
                Translation ({translationPages})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {isSearching ? (
        <div className="py-16 text-center text-stone-500">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
          Searching...
        </div>
      ) : hasSearched && results.length === 0 ? (
        <div className="py-16 text-center text-stone-500">
          No results for &ldquo;{initialQuery || query}&rdquo;
        </div>
      ) : (
        <div className="space-y-3">
          {filteredResults.map((result) => (
            <Link
              key={result.pageId}
              href={`/book/${bookId}/page/${result.pageId}?highlight=${encodeURIComponent(query.trim())}`}
              className="block bg-white rounded-lg border border-stone-200 hover:border-stone-300 hover:shadow-sm transition-all px-5 py-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-stone-900">
                  Page {result.pageNumber}
                </span>
                <span className="text-xs text-stone-400">
                  {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                </span>
              </div>
              <div className="space-y-2">
                {result.matches.map((match, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    {match.field === 'translation' ? (
                      <Languages className="w-3.5 h-3.5 text-status-success mt-0.5 flex-shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-blue-600 mt-0.5 flex-shrink-0" />
                    )}
                    <HighlightedText
                      text={match.snippet}
                      query={query}
                      className="text-stone-600 leading-relaxed"
                    />
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

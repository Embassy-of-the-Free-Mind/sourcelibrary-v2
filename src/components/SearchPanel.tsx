'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, FileText, Languages, Loader2 } from 'lucide-react';
import Link from 'next/link';

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
  results: SearchResult[];
}

interface SearchPanelProps {
  bookId: string;
  className?: string;
}

export default function SearchPanel({ bookId, className = '' }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [totalResults, setTotalResults] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setTotalResults(0);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/books/${bookId}/search?q=${encodeURIComponent(query.trim())}`
        );
        if (response.ok) {
          const data: SearchResponse = await response.json();
          setResults(data.results);
          setTotalResults(data.total);
        }
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, bookId]);

  // Keyboard shortcut to open search (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        setQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => {
          setIsOpen(true);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${className}`}
        style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
      >
        <Search className="w-4 h-4" />
        <span>Search</span>
        <kbd className="hidden sm:inline-block ml-2 px-1.5 py-0.5 text-xs rounded bg-white/10">
          ⌘K
        </kbd>
      </button>
    );
  }

  return (
    <div className="relative">
      {/* Search Input */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{ background: 'rgba(255,255,255,0.15)' }}
      >
        {isSearching ? (
          <Loader2 className="w-4 h-4 text-white/70 animate-spin" />
        ) : (
          <Search className="w-4 h-4 text-white/70" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages..."
          className="bg-transparent text-white placeholder-white/50 outline-none text-sm w-48"
          autoFocus
        />
        {query && (
          <button onClick={handleClear} className="text-white/50 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => {
            setIsOpen(false);
            setQuery('');
          }}
          className="text-white/50 hover:text-white text-xs"
        >
          ESC
        </button>
      </div>

      {/* Results Dropdown */}
      {query.trim() && (
        <div
          className="absolute top-full left-0 right-0 mt-2 rounded-lg shadow-xl overflow-hidden z-50"
          style={{
            background: 'var(--bg-white)',
            border: '1px solid var(--border-light)',
            minWidth: '320px',
            maxHeight: '400px',
            overflowY: 'auto'
          }}
        >
          {isSearching ? (
            <div className="p-4 text-center text-stone-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-stone-500">
              No results for &quot;{query}&quot;
            </div>
          ) : (
            <>
              <div className="px-3 py-2 text-xs text-stone-500 border-b border-stone-100">
                {totalResults} result{totalResults !== 1 ? 's' : ''} found
              </div>
              <div className="divide-y divide-stone-100">
                {results.map((result) => (
                  <Link
                    key={result.pageId}
                    href={`/book/${bookId}/page/${result.pageId}`}
                    onClick={() => {
                      setIsOpen(false);
                      setQuery('');
                    }}
                    className="block px-3 py-3 hover:bg-stone-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-stone-900">
                        Page {result.pageNumber}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {result.matches.slice(0, 2).map((match, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm">
                          {match.field === 'translation' ? (
                            <Languages className="w-3.5 h-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-blue-600 mt-0.5 flex-shrink-0" />
                          )}
                          <span
                            className="text-stone-600 line-clamp-2"
                            dangerouslySetInnerHTML={{ __html: match.snippet }}
                          />
                        </div>
                      ))}
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

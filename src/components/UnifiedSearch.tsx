'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Search, Book, Image as ImageIcon, Lightbulb, User, MapPin, BookOpen, Loader2, X, ChevronRight } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';

interface BookResult {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  pages_count?: number;
  translation_percent?: number;
  thumbnail?: string;
}

interface ImageResult {
  id: string;
  pageId: string;
  detectionIndex: number;
  imageUrl: string;
  description: string;
  type?: string;
  bookTitle: string;
  bookId: string;
  bbox?: { x: number; y: number; width: number; height: number };
}

interface IndexResult {
  type: 'keyword' | 'concept' | 'person' | 'place' | 'vocabulary';
  term: string;
  book_id: string;
  book_title: string;
  pages?: number[];
}

interface SearchResults {
  query: string;
  books: { results: BookResult[]; total: number };
  images: { results: ImageResult[]; total: number };
  index: { results: IndexResult[]; total: number; byType: Record<string, number> };
}

function getCroppedImageUrl(imageUrl: string, bbox: { x: number; y: number; width: number; height: number }): string {
  const params = new URLSearchParams({
    url: imageUrl,
    x: bbox.x.toString(),
    y: bbox.y.toString(),
    w: bbox.width.toString(),
    h: bbox.height.toString()
  });
  return `/api/crop-image?${params}`;
}

const TYPE_ICONS: Record<string, typeof Lightbulb> = {
  concept: Lightbulb,
  person: User,
  place: MapPin,
  keyword: BookOpen,
  vocabulary: BookOpen
};

export default function UnifiedSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery || searchQuery.length < 2) {
      setResults(null);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    setIsOpen(true);

    try {
      const response = await fetch(`/api/search/unified?q=${encodeURIComponent(searchQuery)}&limit=4`);
      if (response.ok) {
        const data = await response.json();
        setResults(data);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedSearch = useDebouncedCallback(performSearch, 300);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    debouncedSearch(value);
  };

  const clearSearch = () => {
    setQuery('');
    setResults(null);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const hasResults = results && (
    results.books.total > 0 ||
    results.images.total > 0 ||
    results.index.total > 0
  );

  const noResults = results && !hasResults && query.length >= 2;

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl mx-auto">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => results && setIsOpen(true)}
          placeholder="Search books, images, concepts, people..."
          className="w-full pl-12 pr-12 py-4 bg-white border border-gray-200 rounded-2xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 text-lg shadow-sm"
        />
        {loading && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 animate-spin" />
        )}
        {query && !loading && (
          <button
            onClick={clearSearch}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && (hasResults || noResults) && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {noResults ? (
            <div className="p-8 text-center">
              <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No results found for &ldquo;{query}&rdquo;</p>
              <p className="text-gray-400 text-sm mt-1">Try different keywords</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {/* Books Section */}
              {results && results.books.total > 0 && (
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                      <Book className="w-4 h-4" />
                      Books ({results.books.total})
                    </h3>
                    {results.books.total > 4 && (
                      <Link
                        href={`/search?q=${encodeURIComponent(query)}`}
                        className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1"
                        onClick={() => setIsOpen(false)}
                      >
                        See all <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                  <div className="space-y-2">
                    {results.books.results.map((book) => (
                      <Link
                        key={book.id}
                        href={`/book/${book.id}`}
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-amber-50 transition-colors"
                      >
                        {book.thumbnail ? (
                          <Image
                            src={book.thumbnail}
                            alt=""
                            width={40}
                            height={52}
                            className="rounded object-cover"
                          />
                        ) : (
                          <div className="w-10 h-13 bg-gray-100 rounded flex items-center justify-center">
                            <Book className="w-5 h-5 text-gray-300" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {book.display_title || book.title}
                          </p>
                          <p className="text-sm text-gray-500 truncate">
                            {book.author} &middot; {book.published}
                          </p>
                        </div>
                        {book.translation_percent !== undefined && book.translation_percent > 0 && (
                          <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                            {book.translation_percent}% translated
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Images Section */}
              {results && results.images.total > 0 && (
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                      <ImageIcon className="w-4 h-4" />
                      Images ({results.images.total})
                    </h3>
                    {results.images.total > 4 && (
                      <Link
                        href={`/gallery?q=${encodeURIComponent(query)}`}
                        className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1"
                        onClick={() => setIsOpen(false)}
                      >
                        See all <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {results.images.results.map((image) => {
                      const displayUrl = image.bbox
                        ? getCroppedImageUrl(image.imageUrl, image.bbox)
                        : image.imageUrl;
                      return (
                        <Link
                          key={image.id}
                          href={`/gallery/image/${image.pageId}:${image.detectionIndex}`}
                          onClick={() => setIsOpen(false)}
                          className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden hover:ring-2 hover:ring-amber-500 transition-all"
                        >
                          <Image
                            src={displayUrl}
                            alt={image.description}
                            fill
                            className="object-cover"
                            unoptimized={!!image.bbox}
                          />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Index Section */}
              {results && results.index.total > 0 && (
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                      <Lightbulb className="w-4 h-4" />
                      Index ({results.index.total})
                    </h3>
                    {results.index.total > 4 && (
                      <Link
                        href={`/search?q=${encodeURIComponent(query)}&mode=index`}
                        className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1"
                        onClick={() => setIsOpen(false)}
                      >
                        See all <ChevronRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                  <div className="space-y-2">
                    {results.index.results.map((item, idx) => {
                      const Icon = TYPE_ICONS[item.type] || Lightbulb;
                      return (
                        <Link
                          key={`${item.book_id}-${item.type}-${idx}`}
                          href={item.pages?.[0]
                            ? `/book/${item.book_id}/guide?page=${item.pages[0]}`
                            : `/book/${item.book_id}`
                          }
                          onClick={() => setIsOpen(false)}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-purple-50 transition-colors"
                        >
                          <div className={`p-1.5 rounded-lg ${
                            item.type === 'concept' ? 'bg-purple-100' :
                            item.type === 'person' ? 'bg-blue-100' :
                            item.type === 'place' ? 'bg-green-100' :
                            'bg-gray-100'
                          }`}>
                            <Icon className={`w-4 h-4 ${
                              item.type === 'concept' ? 'text-purple-600' :
                              item.type === 'person' ? 'text-blue-600' :
                              item.type === 'place' ? 'text-green-600' :
                              'text-gray-600'
                            }`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900">{item.term}</p>
                            <p className="text-sm text-gray-500 truncate">
                              {item.book_title}
                              {item.pages && item.pages.length > 0 && (
                                <span className="text-gray-400"> &middot; {item.pages.length} pages</span>
                              )}
                            </p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            item.type === 'concept' ? 'bg-purple-100 text-purple-700' :
                            item.type === 'person' ? 'bg-blue-100 text-blue-700' :
                            item.type === 'place' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {item.type}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Full Search Link */}
              <div className="p-3 bg-gray-50">
                <Link
                  href={`/search?q=${encodeURIComponent(query)}`}
                  onClick={() => setIsOpen(false)}
                  className="flex items-center justify-center gap-2 text-gray-600 hover:text-gray-900 font-medium"
                >
                  <Search className="w-4 h-4" />
                  Full search for &ldquo;{query}&rdquo;
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

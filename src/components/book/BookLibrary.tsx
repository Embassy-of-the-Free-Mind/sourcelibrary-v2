'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import BookCard from '@/components/book/BookCard';
import { Book } from '@/lib/types';
import { normalizeText } from '@/lib/utils';
import { Search, Loader2, ExternalLink, BookOpen, Plus, Check } from 'lucide-react';
import { catalog, importBooks, type CatalogResult } from '@/lib/api-client';

interface FeaturedTopic {
  id: string;
  name: string;
  icon: string;
  book_count: number;
}

interface BookLibraryProps {
  books: Book[];
  languages: string[];
  featuredTopics?: FeaturedTopic[];
}

type SortOption = 'recent-translation' | 'recent' | 'title-asc' | 'title-desc';

const INITIAL_DISPLAY_LIMIT = 50;
const LOAD_MORE_INCREMENT = 50;

export default function BookLibrary({ books, languages, featuredTopics = [] }: BookLibraryProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent-translation');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT);

  // Catalog search state
  const [catalogResults, setCatalogResults] = useState<CatalogResult[]>([]);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [hasSearchedCatalog, setHasSearchedCatalog] = useState(false);
  const [showCatalogResults, setShowCatalogResults] = useState(false);

  // Import state
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importedBooks, setImportedBooks] = useState<Record<string, string>>({}); // catalogId -> bookId

  const filteredAndSortedBooks = useMemo(() => {
    let result = [...books];

    // Filter by search query (diacritic-insensitive)
    if (searchQuery.trim()) {
      const query = normalizeText(searchQuery);
      result = result.filter(book => {
        const title = normalizeText(book.display_title || book.title || '');
        const author = normalizeText(book.author || '');
        const language = normalizeText(book.language || '');
        const categories = normalizeText((book.categories || []).join(' '));
        return (
          title.includes(query) ||
          author.includes(query) ||
          language.includes(query) ||
          categories.includes(query)
        );
      });
    }

    // Filter by language
    if (selectedLanguage) {
      result = result.filter(book => book.language === selectedLanguage);
    }

    // Filter by category
    if (selectedCategory) {
      result = result.filter(book =>
        book.categories && book.categories.includes(selectedCategory)
      );
    }

    // Sort
    switch (sortBy) {
      case 'recent-translation':
        // Keep server order - already sorted by last_translation_at
        break;
      case 'recent':
        // Sort by last_processed (any update)
        result.sort((a, b) => {
          const aDate = a.last_processed ? new Date(a.last_processed).getTime() : 0;
          const bDate = b.last_processed ? new Date(b.last_processed).getTime() : 0;
          return bDate - aDate;
        });
        break;
      case 'title-asc':
        result.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'title-desc':
        result.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
        break;
    }

    return result;
  }, [books, searchQuery, selectedLanguage, selectedCategory, sortBy]);

  // Books to display (limited)
  const displayedBooks = useMemo(() => {
    return filteredAndSortedBooks.slice(0, displayLimit);
  }, [filteredAndSortedBooks, displayLimit]);

  const hasMoreBooks = filteredAndSortedBooks.length > displayLimit;
  const remainingBooks = filteredAndSortedBooks.length - displayLimit;

  // Reset display limit when filters change
  useEffect(() => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT);
  }, [searchQuery, selectedLanguage, selectedCategory, sortBy]);

  const loadMore = () => {
    setDisplayLimit(prev => prev + LOAD_MORE_INCREMENT);
  };

  // Search external catalogs
  const searchCatalogs = useCallback(async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return;

    setCatalogSearching(true);
    setHasSearchedCatalog(true);
    setShowCatalogResults(true);

    try {
      const data = await catalog.search(searchQuery, { limit: 10 });
      setCatalogResults(data.results || []);
    } catch (error) {
      console.error('Catalog search failed:', error);
      setCatalogResults([]);
    } finally {
      setCatalogSearching(false);
    }
  }, [searchQuery]);

  // Handle search submission
  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (searchQuery.trim().length >= 2) {
      searchCatalogs();
    }
  };

  // Handle key press in search input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
    setCatalogResults([]);
    setHasSearchedCatalog(false);
    setShowCatalogResults(false);
  };

  // Get source label
  const getSourceLabel = (source: CatalogResult['source']) => {
    switch (source) {
      case 'ia': return 'Internet Archive';
      case 'gallica': return 'Gallica (BnF)';
      case 'mdz': return 'MDZ München';
      case 'bph': return 'Embassy of the Free Mind';
      case 'ustc': return 'USTC';
      default: return source;
    }
  };

  // Import book from IA
  const importFromIA = async (item: CatalogResult) => {
    if (!item.iaIdentifier || importingIds.has(item.id)) return;

    setImportingIds(prev => new Set(prev).add(item.id));

    try {
      const data = await importBooks.fromIA({
        ia_identifier: item.iaIdentifier,
        title: item.title,
        author: item.author || 'Unknown',
        original_language: item.language || 'Unknown',
        year: item.year ? parseInt(item.year) : undefined,
      });

      setImportedBooks(prev => ({ ...prev, [item.id]: data.book_id }));
      // Refresh the page to show the new book
      router.refresh();
    } catch (error: any) {
      console.error('Import error:', error);
      const errorMessage = error.message || 'Import failed. Please try again.';

      // Check if book already exists (409 conflict)
      if (errorMessage.includes('already exists')) {
        // Try to extract book ID from error message if available
        alert('This book already exists in the library.');
      } else {
        alert(`Import failed: ${errorMessage}`);
      }
    } finally {
      setImportingIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  return (
    <>
      {/* Search & Filter Bar */}
      <div className="flex flex-col lg:flex-row gap-4 mb-8">
        {/* Search Input with Button */}
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <div className="flex-1 relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search library and external catalogs..."
              className="w-full pl-12 pr-10 py-3 bg-white border border-gray-200 rounded-full text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={searchQuery.length < 2 || catalogSearching}
            className="flex items-center gap-2 px-5 py-3 bg-amber-600 text-white rounded-full text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {catalogSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">Search</span>
          </button>
        </form>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          {/* Language Filter */}
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="px-4 py-3 bg-white border border-gray-200 rounded-full text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-600/20 appearance-none pr-10 bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:20px] bg-[right_12px_center] bg-no-repeat"
          >
            <option value="">All Languages</option>
            {languages.map(lang => (
              <option key={lang} value={lang}>
                {lang.startsWith('Multiple') ? 'Multiple' : lang}
              </option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="px-4 py-3 bg-white border border-gray-200 rounded-full text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-600/20 appearance-none pr-10 bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[length:20px] bg-[right_12px_center] bg-no-repeat min-w-[180px]"
          >
            <option value="recent-translation">Recent Translations</option>
            <option value="recent">Recently Updated</option>
            <option value="title-asc">Title (A-Z)</option>
            <option value="title-desc">Title (Z-A)</option>
          </select>

          {/* View Toggle */}
          <div className="flex rounded-full border border-gray-200 overflow-hidden">
            <button
              onClick={() => setViewMode('cards')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium ${viewMode === 'cards' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Cards
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium ${viewMode === 'list' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              List
            </button>
          </div>
        </div>
      </div>

      {/* Topic Chips */}
      {featuredTopics.length > 0 && (
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategory('')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                selectedCategory === ''
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              All Topics
            </button>
            {featuredTopics.map(topic => (
              <button
                key={topic.id}
                onClick={() => setSelectedCategory(selectedCategory === topic.id ? '' : topic.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedCategory === topic.id
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-amber-300 hover:bg-amber-50'
                }`}
              >
                {topic.name}
                <span className="ml-1.5 text-xs opacity-70">({topic.book_count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Book Count */}
      <div className="mb-8 text-gray-700">
        <span className="font-semibold">{filteredAndSortedBooks.length}</span>
        {filteredAndSortedBooks.length !== books.length && (
          <span className="text-gray-500"> of {books.length}</span>
        )}
        {' '}book{filteredAndSortedBooks.length !== 1 ? 's' : ''} in library
        {searchQuery && <span className="text-gray-500"> matching &ldquo;{searchQuery}&rdquo;</span>}
        {selectedLanguage && <span className="text-gray-500"> in {selectedLanguage}</span>}
        {selectedCategory && (
          <span className="text-gray-500">
            {' '}in {featuredTopics.find(t => t.id === selectedCategory)?.name || selectedCategory}
          </span>
        )}
      </div>

      {/* Library Results */}
      {filteredAndSortedBooks.length === 0 && !hasSearchedCatalog ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-200 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="text-xl text-gray-700 mb-2">No books found in library</h3>
          <p className="text-gray-500 mb-4">
            {searchQuery
              ? 'Click Search to also check Internet Archive and Embassy of the Free Mind catalogs.'
              : 'Books will appear here once added to the library.'}
          </p>
          {searchQuery && searchQuery.length >= 2 && (
            <button
              onClick={handleSearch}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-full text-sm font-medium hover:bg-amber-700 transition-colors"
            >
              <Search className="w-4 h-4" />
              Search External Catalogs
            </button>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 md:gap-8">
          {displayedBooks.map((book, index) => (
            <BookCard key={book.id} book={book} priority={index < 5} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {displayedBooks.map((book) => (
            <Link
              key={book.id}
              href={`/book/${book.id}`}
              className="flex items-center gap-4 p-4 bg-white rounded-lg border border-gray-200 hover:shadow-md transition-shadow"
            >
              {/* Thumbnail */}
              <div className="w-16 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                {book.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={book.thumbnail}
                    alt={book.title || ''}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 truncate">{book.display_title || book.title}</h3>
                {book.author && <p className="text-sm text-gray-500 truncate">{book.author}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                  {book.language && <span>{book.language.startsWith('Multiple') ? 'Multiple' : book.language}</span>}
                  {book.pages_count && <span>{book.pages_count} pages</span>}
                  {book.pages_count && book.pages_count > 0 && (() => {
                    const ocrPercent = Math.round(((book.pages_ocr || 0) / book.pages_count) * 100);
                    return (
                      <span className={ocrPercent === 100 ? 'text-blue-600' : ocrPercent > 0 ? 'text-blue-400' : 'text-gray-400'}>
                        {ocrPercent === 100 ? '✓ OCR' : ocrPercent > 0 ? `${ocrPercent}% OCR` : 'No OCR'}
                      </span>
                    );
                  })()}
                  {book.translation_percent !== undefined && (
                    <span className={book.translation_percent === 100 ? 'text-green-600' : 'text-amber-600'}>
                      {book.translation_percent === 100 ? '✓ Translated' : `${book.translation_percent}% translated`}
                    </span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {hasMoreBooks && (
        <div className="mt-10 text-center">
          <button
            onClick={loadMore}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-full text-sm font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            Load more ({remainingBooks} remaining)
          </button>
        </div>
      )}

      {/* External Catalog Results */}
      {showCatalogResults && (
        <div className="mt-12 pt-8 border-t border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
                Discover More
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Results from Internet Archive & Embassy of the Free Mind
              </p>
            </div>
            {catalogResults.length > 0 && (
              <span className="text-sm text-gray-500">
                {catalogResults.length} result{catalogResults.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {catalogSearching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
              <span className="ml-3 text-gray-500">Searching catalogs...</span>
            </div>
          ) : catalogResults.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <BookOpen className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No matching books found in external catalogs.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {catalogResults.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-4 p-4 bg-white rounded-lg border border-gray-200 hover:border-amber-300 transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="w-16 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BookOpen className="w-8 h-8 text-gray-300" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 line-clamp-2">{item.title}</h4>
                    {item.author && <p className="text-sm text-gray-500">{item.author}</p>}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.source === 'ia'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-purple-50 text-purple-700'
                      }`}>
                        <ExternalLink className="w-3 h-3" />
                        {getSourceLabel(item.source)}
                      </span>
                      {item.year && item.year !== 'Unknown' && (
                        <span className="text-xs text-gray-400">{item.year}</span>
                      )}
                      {item.language && item.language !== 'Unknown' && (
                        <span className="text-xs text-gray-400">{item.language}</span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-sm text-gray-500 mt-2 line-clamp-2">{item.description}</p>
                    )}
                  </div>

                  {/* Action */}
                  <div className="flex-shrink-0 flex flex-col gap-2">
                    {item.source === 'ia' && item.iaIdentifier ? (
                      <>
                        {importedBooks[item.id] ? (
                          <Link
                            href={`/book/${importedBooks[item.id]}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Open
                          </Link>
                        ) : (
                          <button
                            onClick={() => importFromIA(item)}
                            disabled={importingIds.has(item.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {importingIds.has(item.id) ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Plus className="w-3.5 h-3.5" />
                            )}
                            {importingIds.has(item.id) ? 'Importing...' : 'Import'}
                          </button>
                        )}
                        <a
                          href={`https://archive.org/details/${item.iaIdentifier}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                        >
                          View on IA
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">Catalog entry</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

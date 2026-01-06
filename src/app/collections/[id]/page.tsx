'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Loader2, BookOpen, Calendar, FileText, Star, Network, CheckCircle2, Globe, Award } from 'lucide-react';
import { useParams } from 'next/navigation';

interface Book {
  bookId: string;
  id?: string;
  title: string;
  author: string;
  year: number;
  pages: number;
  pages_count?: number;
  pages_translated?: number;
  pages_ocr?: number;
  poster_url?: string;
  language?: string;
  has_doi?: boolean;
  published?: string;
}

interface Collection {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  dateRange: string;
  totalBooks: number;
  totalPages: number;
  themes: string[];
  books: Book[];
  keyFigures?: string[];
  keyWorks?: string[];
  keyTheories?: string[];
  keyContributions?: string[];
  researchValue: string;
  connections: string[];
  featured: boolean;
  displayOrder: number;
  stats?: {
    totalBooks: number;
    totalPages: number;
    ocrComplete: number;
    translationsComplete: number;
    withDOI: number;
  };
}

export default function CollectionPage() {
  const params = useParams();
  const id = params.id as string;

  const [collection, setCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCollection() {
      try {
        const res = await fetch(`/api/collections/${id}/enriched`);
        if (res.ok) {
          const data = await res.json();
          setCollection(data);
        }
      } catch (error) {
        console.error('Failed to fetch collection:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchCollection();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-amber-600" />
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-16 h-16 text-stone-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-stone-700">Collection not found</h2>
          <Link href="/collections" className="text-amber-600 hover:text-amber-700 mt-4 inline-block">
            Browse all collections
          </Link>
        </div>
      </div>
    );
  }

  // Sort books by year
  const sortedBooks = [...collection.books].sort((a, b) => a.year - b.year);

  // Generate collection summary
  const languages = [...new Set(sortedBooks.map(b => b.language).filter(Boolean))];
  const centuriesSpan = Math.ceil((sortedBooks[sortedBooks.length - 1]?.year - sortedBooks[0]?.year) / 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 via-amber-50/10 to-stone-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-stone-800 via-stone-900 to-stone-800 border-b border-amber-900/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <Link
            href="/collections"
            className="inline-flex items-center gap-2 text-amber-200 hover:text-amber-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            All Collections
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="relative bg-gradient-to-br from-stone-800 via-amber-900 to-stone-900 text-white overflow-hidden">
        {/* Decorative pattern overlay */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />

        <div className="relative max-w-7xl mx-auto px-6 py-16">
          {collection.featured && (
            <div className="inline-flex items-center gap-2 mb-4 text-amber-300">
              <Star className="w-4 h-4 fill-current" />
              <span className="text-xs uppercase tracking-[0.3em] font-semibold">Featured Collection</span>
            </div>
          )}

          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight max-w-4xl"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            {collection.title}
          </h1>

          <p className="text-lg sm:text-xl text-amber-100 max-w-3xl mb-8 leading-relaxed">
            {collection.description}
          </p>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl">
            <div className="bg-amber-900/30 rounded-lg p-4 border border-amber-700/50">
              <div className="text-3xl font-bold text-amber-300">{collection.stats?.totalBooks || collection.totalBooks}</div>
              <div className="text-sm text-amber-100 mt-1">Books</div>
            </div>
            <div className="bg-amber-900/30 rounded-lg p-4 border border-amber-700/50">
              <div className="text-3xl font-bold text-amber-300">{((collection.stats?.totalPages || collection.totalPages) / 1000).toFixed(1)}k</div>
              <div className="text-sm text-amber-100 mt-1">Pages</div>
            </div>
            <div className="bg-amber-900/30 rounded-lg p-4 border border-amber-700/50">
              <div className="text-3xl font-bold text-amber-300">{collection.stats?.translationsComplete || 0}</div>
              <div className="text-sm text-amber-100 mt-1">Translated</div>
            </div>
            <div className="bg-amber-900/30 rounded-lg p-4 border border-amber-700/50">
              <div className="text-3xl font-bold text-amber-300">{centuriesSpan}</div>
              <div className="text-sm text-amber-100 mt-1">Centuries</div>
            </div>
          </div>

          {/* Themes */}
          <div className="flex flex-wrap gap-2 mt-6">
            {collection.themes.map(theme => (
              <span
                key={theme}
                className="px-4 py-2 bg-amber-900/40 text-amber-100 rounded-full text-sm border border-amber-700/50"
              >
                {theme}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Collection Summary Report */}
        <div className="mb-12 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-8 border-2 border-amber-200 shadow-xl">
          <div className="flex items-start gap-3 mb-6">
            <Award className="w-8 h-8 text-amber-600 flex-shrink-0 mt-1" />
            <div>
              <h2
                className="text-3xl font-bold text-stone-800 mb-2"
                style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
              >
                Collection Summary
              </h2>
              <p className="text-stone-600 text-sm">
                A curated journey through {collection.dateRange} • {languages.join(', ')} sources
              </p>
            </div>
          </div>

          <div className="prose prose-stone max-w-none">
            <p className="text-lg leading-relaxed text-stone-700 mb-6">
              {collection.researchValue}
            </p>

            <div className="grid sm:grid-cols-2 gap-6 mt-6">
              <div className="bg-white rounded-lg p-5 border border-amber-200">
                <h3 className="font-bold text-stone-800 mb-3 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-amber-600" />
                  Scope & Coverage
                </h3>
                <ul className="space-y-2 text-sm text-stone-700">
                  <li>• {collection.stats?.totalBooks || collection.totalBooks} primary source texts</li>
                  <li>• {((collection.stats?.totalPages || collection.totalPages) / 1000).toFixed(1)}k pages of historical material</li>
                  <li>• Spanning {centuriesSpan} centuries ({collection.dateRange})</li>
                  <li>• Languages: {languages.join(', ')}</li>
                </ul>
              </div>

              <div className="bg-white rounded-lg p-5 border border-amber-200">
                <h3 className="font-bold text-stone-800 mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Digitization Status
                </h3>
                <ul className="space-y-2 text-sm text-stone-700">
                  <li>• {collection.stats?.ocrComplete || 0} books with OCR complete</li>
                  <li>• {collection.stats?.translationsComplete || 0} books with translations</li>
                  <li>• {collection.stats?.withDOI || 0} books with DOI citations</li>
                  <li>• All available as CC0 Public Domain</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-4 gap-8">
          {/* Sidebar - Key Info */}
          <div className="lg:col-span-1 space-y-6">
            {/* Key Figures */}
            {collection.keyFigures && collection.keyFigures.length > 0 && (
              <div className="bg-white rounded-xl p-6 border-2 border-stone-200 shadow-lg">
                <h2
                  className="text-xl font-bold text-stone-800 mb-4"
                  style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                >
                  Key Figures
                </h2>
                <ul className="space-y-3">
                  {collection.keyFigures.map((figure, i) => (
                    <li key={i} className="text-sm text-stone-700 leading-relaxed border-l-2 border-amber-300 pl-3">
                      {figure}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Key Works */}
            {collection.keyWorks && collection.keyWorks.length > 0 && (
              <div className="bg-white rounded-xl p-6 border-2 border-stone-200 shadow-lg">
                <h2
                  className="text-xl font-bold text-stone-800 mb-4"
                  style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                >
                  Key Works
                </h2>
                <ul className="space-y-3">
                  {collection.keyWorks.map((work, i) => (
                    <li key={i} className="text-sm text-stone-700 leading-relaxed border-l-2 border-amber-300 pl-3">
                      {work}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Key Theories */}
            {collection.keyTheories && collection.keyTheories.length > 0 && (
              <div className="bg-white rounded-xl p-6 border-2 border-stone-200 shadow-lg">
                <h2
                  className="text-xl font-bold text-stone-800 mb-4"
                  style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                >
                  Key Theories
                </h2>
                <ul className="space-y-3">
                  {collection.keyTheories.map((theory, i) => (
                    <li key={i} className="text-sm text-stone-700 leading-relaxed border-l-2 border-amber-300 pl-3">
                      {theory}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Key Contributions */}
            {collection.keyContributions && collection.keyContributions.length > 0 && (
              <div className="bg-white rounded-xl p-6 border-2 border-stone-200 shadow-lg">
                <h2
                  className="text-xl font-bold text-stone-800 mb-4"
                  style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                >
                  Key Contributions
                </h2>
                <ul className="space-y-3">
                  {collection.keyContributions.map((contribution, i) => (
                    <li key={i} className="text-sm text-stone-700 leading-relaxed border-l-2 border-amber-300 pl-3">
                      {contribution}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Connected Collections */}
            {collection.connections.length > 0 && (
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 border-2 border-amber-300 shadow-lg">
                <h2
                  className="text-xl font-bold text-stone-800 mb-4 flex items-center gap-2"
                  style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                >
                  <Network className="w-5 h-5 text-amber-600" />
                  Related Collections
                </h2>
                <div className="flex flex-wrap gap-2">
                  {collection.connections.map(connectionId => (
                    <Link
                      key={connectionId}
                      href={`/collections/${connectionId}`}
                      className="text-xs px-3 py-2 bg-white border-2 border-amber-300 text-amber-800 rounded-lg hover:bg-amber-100 hover:border-amber-400 transition-colors"
                    >
                      {connectionId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Main Column - Books with Posters */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-xl p-6 border-2 border-stone-200 shadow-lg">
              <h2
                className="text-3xl font-bold text-stone-800 mb-6"
                style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
              >
                Books in this Collection
              </h2>

              {/* Timeline visualization */}
              <div className="mb-8 p-6 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg border border-amber-200">
                <div className="flex items-center justify-between text-sm text-stone-600 mb-2">
                  <span className="font-semibold">{sortedBooks[0]?.year}</span>
                  <span className="text-xs text-stone-500">→ {centuriesSpan} centuries →</span>
                  <span className="font-semibold">{sortedBooks[sortedBooks.length - 1]?.year}</span>
                </div>
                <div className="relative h-2 bg-gradient-to-r from-amber-300 via-orange-400 to-amber-300 rounded-full" />
              </div>

              {/* Books grid with posters */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {sortedBooks.map((book, index) => (
                  <Link
                    key={book.id || book.bookId}
                    href={`/book/${book.id || book.bookId}`}
                    className="group block"
                  >
                    <div className="h-full rounded-xl border-2 border-stone-200 hover:border-amber-400 hover:shadow-xl transition-all overflow-hidden bg-white">
                      {/* Book Poster */}
                      <div className="relative aspect-[3/4] bg-gradient-to-br from-stone-100 to-stone-200 overflow-hidden">
                        {book.poster_url ? (
                          <Image
                            src={book.poster_url}
                            alt={book.title}
                            fill
                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <BookOpen className="w-16 h-16 text-stone-300" />
                          </div>
                        )}

                        {/* Number badge */}
                        <div className="absolute top-3 left-3 w-8 h-8 rounded-full bg-amber-500 text-white font-bold text-sm flex items-center justify-center shadow-lg">
                          {index + 1}
                        </div>

                        {/* Status badges */}
                        <div className="absolute top-3 right-3 flex flex-col gap-2">
                          {book.pages_translated && book.pages_translated > 0 && (
                            <div className="bg-green-500 text-white text-xs px-2 py-1 rounded-full shadow-lg">
                              Translated
                            </div>
                          )}
                          {book.has_doi && (
                            <div className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full shadow-lg">
                              DOI
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Book Info */}
                      <div className="p-4">
                        <h3
                          className="text-base font-bold text-stone-900 group-hover:text-amber-700 transition-colors mb-2 leading-tight line-clamp-2"
                          style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                        >
                          {book.title}
                        </h3>
                        <p className="text-sm text-stone-600 mb-3 line-clamp-1">{book.author}</p>

                        <div className="flex flex-wrap gap-2 text-xs text-stone-500 mb-3">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {book.year}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {book.pages_count || book.pages} pages
                          </span>
                          {book.language && (
                            <>
                              <span>•</span>
                              <span>{book.language}</span>
                            </>
                          )}
                        </div>

                        {/* Progress bar if OCR/translation exists */}
                        {book.pages_count && book.pages_count > 0 && (
                          <div className="space-y-1">
                            {book.pages_ocr && book.pages_ocr > 0 && (
                              <div>
                                <div className="flex justify-between text-xs text-stone-500 mb-1">
                                  <span>OCR</span>
                                  <span>{Math.round((book.pages_ocr / book.pages_count) * 100)}%</span>
                                </div>
                                <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-amber-500 rounded-full"
                                    style={{ width: `${(book.pages_ocr / book.pages_count) * 100}%` }}
                                  />
                                </div>
                              </div>
                            )}
                            {book.pages_translated && book.pages_translated > 0 && (
                              <div>
                                <div className="flex justify-between text-xs text-stone-500 mb-1">
                                  <span>Translation</span>
                                  <span>{Math.round((book.pages_translated / book.pages_count) * 100)}%</span>
                                </div>
                                <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-green-500 rounded-full"
                                    style={{ width: `${(book.pages_translated / book.pages_count) * 100}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

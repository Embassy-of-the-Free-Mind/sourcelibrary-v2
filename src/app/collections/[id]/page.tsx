'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, BookOpen, Calendar, FileText, Star, Network } from 'lucide-react';
import { useParams } from 'next/navigation';

interface Book {
  bookId: string;
  title: string;
  author: string;
  year: number;
  pages: number;
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
}

export default function CollectionPage() {
  const params = useParams();
  const id = params.id as string;

  const [collection, setCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCollection() {
      try {
        const res = await fetch(`/api/collections/${id}`);
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

          {/* Stats */}
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-amber-300" />
              <span className="text-amber-100">{collection.totalBooks} books</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-300" />
              <span className="text-amber-100">{collection.totalPages.toLocaleString()} pages</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-300" />
              <span className="text-amber-100">{collection.dateRange}</span>
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
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Key Info */}
          <div className="lg:col-span-1 space-y-6">
            {/* Research Value */}
            <div className="bg-white rounded-xl p-6 border-2 border-amber-200 shadow-lg">
              <h2
                className="text-2xl font-bold text-stone-800 mb-4 flex items-center gap-2"
                style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
              >
                <Star className="w-5 h-5 text-amber-600" />
                Research Value
              </h2>
              <p className="text-stone-700 leading-relaxed">{collection.researchValue}</p>
            </div>

            {/* Key Figures */}
            {collection.keyFigures && collection.keyFigures.length > 0 && (
              <div className="bg-white rounded-xl p-6 border-2 border-stone-200 shadow-lg">
                <h2
                  className="text-2xl font-bold text-stone-800 mb-4"
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
                  className="text-2xl font-bold text-stone-800 mb-4"
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
                  className="text-2xl font-bold text-stone-800 mb-4"
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
                  className="text-2xl font-bold text-stone-800 mb-4"
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
                  className="text-2xl font-bold text-stone-800 mb-4 flex items-center gap-2"
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

          {/* Right Column - Books */}
          <div className="lg:col-span-2">
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
                  <span className="font-semibold">{sortedBooks[sortedBooks.length - 1]?.year}</span>
                </div>
                <div className="relative h-2 bg-gradient-to-r from-amber-300 via-orange-400 to-amber-300 rounded-full" />
                <p className="text-xs text-stone-500 mt-2 text-center">
                  {collection.totalBooks} works spanning {collection.dateRange}
                </p>
              </div>

              {/* Books list */}
              <div className="space-y-4">
                {sortedBooks.map((book, index) => (
                  <Link
                    key={book.bookId}
                    href={`/book/${book.bookId}`}
                    className="group block"
                  >
                    <div className="flex items-start gap-4 p-4 rounded-lg border-2 border-stone-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all">
                      {/* Number badge */}
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-amber-800 font-bold text-sm border-2 border-amber-300">
                        {index + 1}
                      </div>

                      {/* Book info */}
                      <div className="flex-1 min-w-0">
                        <h3
                          className="text-lg font-bold text-stone-900 group-hover:text-amber-700 transition-colors mb-1 leading-tight"
                          style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                        >
                          {book.title}
                        </h3>
                        <p className="text-sm text-stone-600 mb-2">{book.author}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-stone-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {book.year}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {book.pages} pages
                          </span>
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-stone-100 group-hover:bg-amber-200 flex items-center justify-center transition-colors">
                          <ArrowLeft className="w-4 h-4 text-stone-400 group-hover:text-amber-700 rotate-180" />
                        </div>
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

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, BookOpen, ChevronRight } from 'lucide-react';

interface Collection {
  id: string;
  title: string;
  shortTitle: string;
  category: string;
  books: number;
  pages: number;
  file: string;
  displayOrder: number;
}

interface CollectionsIndex {
  version: string;
  lastUpdated: string;
  description: string;
  collections: Collection[];
  categories: Record<string, {
    description: string;
    collections: string[];
  }>;
  summary: {
    totalCollections: number;
    totalBooks: number;
    totalPages: number;
    chronologicalSpan: string;
  };
}

// Color palettes for each category - Renaissance manuscript inspired
const CATEGORY_COLORS: Record<string, { primary: string; secondary: string; accent: string }> = {
  'Alchemy': { primary: 'amber-600', secondary: 'amber-50', accent: 'red-600' },
  'Renaissance': { primary: 'orange-700', secondary: 'orange-50', accent: 'amber-600' },
  'Byzantine': { primary: 'purple-700', secondary: 'purple-50', accent: 'yellow-500' },
  'Scientific Revolution': { primary: 'blue-700', secondary: 'blue-50', accent: 'sky-400' },
  'Comparative Esoteric': { primary: 'emerald-600', secondary: 'emerald-50', accent: 'teal-400' },
  'Political Philosophy': { primary: 'stone-700', secondary: 'stone-50', accent: 'amber-600' },
  'Economics': { primary: 'slate-700', secondary: 'slate-50', accent: 'green-600' },
  'Ancient Texts': { primary: 'yellow-700', secondary: 'yellow-50', accent: 'amber-500' },
  'Court Culture': { primary: 'violet-700', secondary: 'violet-50', accent: 'pink-400' },
  'Medieval Mysticism': { primary: 'indigo-700', secondary: 'indigo-50', accent: 'blue-400' },
  'Modern Occultism': { primary: 'fuchsia-700', secondary: 'fuchsia-50', accent: 'purple-400' },
  'Islamic Tradition': { primary: 'cyan-700', secondary: 'cyan-50', accent: 'teal-500' },
  'Philosophy': { primary: 'gray-700', secondary: 'gray-50', accent: 'blue-500' },
  'Medicine & Science': { primary: 'green-700', secondary: 'green-50', accent: 'lime-500' },
  'Medieval Art': { primary: 'rose-700', secondary: 'rose-50', accent: 'pink-500' },
  'Mathematics': { primary: 'sky-700', secondary: 'sky-50', accent: 'blue-400' },
};

export default function CollectionsPage() {
  const [index, setIndex] = useState<CollectionsIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Alchemy', 'Renaissance']));

  useEffect(() => {
    async function fetchIndex() {
      try {
        const res = await fetch('/api/collections');
        if (res.ok) {
          const data = await res.json();
          setIndex(data);
        }
      } catch (error) {
        console.error('Failed to fetch collections:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchIndex();
  }, []);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-amber-600" />
      </div>
    );
  }

  if (!index) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-16 h-16 text-stone-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-stone-700">Failed to load collections</h2>
        </div>
      </div>
    );
  }

  // Group collections by category
  const collectionsByCategory = new Map<string, Collection[]>();
  Object.entries(index.categories).forEach(([categoryName, categoryData]) => {
    const categoryCollections = categoryData.collections
      .map(id => index.collections.find(c => c.id === id))
      .filter((c): c is Collection => c !== undefined)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    if (categoryCollections.length > 0) {
      collectionsByCategory.set(categoryName, categoryCollections);
    }
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 via-amber-50/20 to-stone-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-stone-800 via-stone-900 to-stone-800 border-b border-amber-900/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-amber-200 hover:text-amber-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
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

        <div className="relative max-w-7xl mx-auto px-6 py-16 text-center">
          <div className="inline-block mb-4">
            <span className="text-xs uppercase tracking-[0.3em] text-amber-300 font-semibold">
              Curated Collections
            </span>
          </div>
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            Journeys Through<br />Wisdom Traditions
          </h1>
          <p className="text-lg sm:text-xl text-amber-100 max-w-3xl mx-auto mb-8 leading-relaxed">
            {index.description}
          </p>

          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-8 text-center">
            <div className="flex flex-col">
              <span className="text-4xl font-bold text-amber-300">{index.summary.totalCollections}</span>
              <span className="text-sm text-amber-200 uppercase tracking-wider mt-1">Collections</span>
            </div>
            <div className="flex flex-col">
              <span className="text-4xl font-bold text-amber-300">{index.summary.totalBooks}</span>
              <span className="text-sm text-amber-200 uppercase tracking-wider mt-1">Books</span>
            </div>
            <div className="flex flex-col">
              <span className="text-4xl font-bold text-amber-300">{(index.summary.totalPages / 1000).toFixed(0)}k</span>
              <span className="text-sm text-amber-200 uppercase tracking-wider mt-1">Pages</span>
            </div>
            <div className="flex flex-col">
              <span className="text-4xl font-bold text-amber-300">{index.summary.chronologicalSpan}</span>
              <span className="text-sm text-amber-200 uppercase tracking-wider mt-1">Span</span>
            </div>
          </div>
        </div>
      </div>

      {/* Collections by Category */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="space-y-8">
          {Array.from(collectionsByCategory.entries()).map(([categoryName, collections]) => {
            const isExpanded = expandedCategories.has(categoryName);
            const colors = CATEGORY_COLORS[categoryName] || CATEGORY_COLORS['Philosophy'];
            const categoryInfo = index.categories[categoryName];

            return (
              <div key={categoryName} className="space-y-4">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(categoryName)}
                  className="w-full text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2
                        className="text-2xl sm:text-3xl font-bold text-stone-800 group-hover:text-amber-700 transition-colors"
                        style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                      >
                        {categoryName}
                      </h2>
                      <p className="text-stone-600 mt-1 text-sm sm:text-base max-w-3xl">
                        {categoryInfo.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-semibold text-${colors.primary} bg-${colors.secondary} px-3 py-1 rounded-full`}>
                        {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
                      </span>
                      <ChevronRight
                        className={`w-6 h-6 text-stone-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      />
                    </div>
                  </div>
                </button>

                {/* Collections Grid */}
                {isExpanded && (
                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pt-4">
                    {collections.map(collection => (
                      <Link
                        key={collection.id}
                        href={`/collections/${collection.id}`}
                        className="group relative"
                      >
                        {/* Card */}
                        <div
                          className={`
                            relative h-full rounded-xl overflow-hidden
                            bg-gradient-to-br from-white to-${colors.secondary}
                            border-2 border-${colors.primary}/20
                            hover:border-${colors.accent} hover:shadow-2xl
                            transition-all duration-300
                          `}
                        >
                          {/* Decorative corner accent */}
                          <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-${colors.accent}/10 to-transparent`} />

                          {/* Content */}
                          <div className="relative p-6">
                            {/* Title */}
                            <h3
                              className={`text-xl font-bold text-stone-900 mb-2 group-hover:text-${colors.primary} transition-colors leading-tight`}
                              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
                            >
                              {collection.shortTitle}
                            </h3>

                            {/* Stats */}
                            <div className="flex flex-wrap gap-3 text-xs text-stone-600 mb-4">
                              <span className="flex items-center gap-1">
                                <BookOpen className="w-3 h-3" />
                                {collection.books} books
                              </span>
                              <span>•</span>
                              <span>{collection.pages.toLocaleString()} pages</span>
                            </div>

                            {/* View link */}
                            <div className={`inline-flex items-center gap-1 text-sm font-semibold text-${colors.primary} group-hover:text-${colors.accent} transition-colors`}>
                              Explore Collection
                              <ChevronRight className="w-4 h-4" />
                            </div>
                          </div>

                          {/* Bottom accent bar */}
                          <div className={`h-1 bg-gradient-to-r from-${colors.primary} via-${colors.accent} to-${colors.primary}`} />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

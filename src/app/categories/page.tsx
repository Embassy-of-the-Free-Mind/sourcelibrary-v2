'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, BookOpen, ChevronRight } from 'lucide-react';
import { categories as categoriesApi } from '@/lib/api-client';
import { Category } from '@/lib/api-client/types';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCategories() {
      try {
        const data = await categoriesApi.list();
        setCategories(data.categories);
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchCategories();
  }, []);

  // Separate categories with books from empty ones
  const activeCategories = categories.filter(c => c.book_count > 0);
  const emptyCategories = categories.filter(c => c.book_count === 0);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold">
            Browse by Category
          </h1>
          <p className="text-stone-300 mt-3 max-w-2xl mx-auto">
            Explore our collection of esoteric, alchemical, and early modern philosophical texts
            organized by tradition and subject.
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
          </div>
        ) : (
          <>
            {/* Categories with books */}
            {activeCategories.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeCategories.map(category => (
                  <Link
                    key={category.id}
                    href={`/categories/${category.id}`}
                    className="group bg-white rounded-xl border border-stone-200 p-5 hover:border-amber-300 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{category.icon}</span>
                        <div>
                          <h2 className="font-semibold text-stone-900 group-hover:text-amber-700 transition-colors">
                            {category.name}
                          </h2>
                          <p className="text-sm text-amber-600 font-medium">
                            {category.book_count} book{category.book_count !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-stone-400 group-hover:text-amber-600 transition-colors" />
                    </div>
                    {category.description && (
                      <p className="text-sm text-stone-600 mt-3 line-clamp-2">
                        {category.description}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}

            {/* Empty categories */}
            {emptyCategories.length > 0 && (
              <div className="mt-12">
                <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">
                  Coming Soon
                </h3>
                <div className="flex flex-wrap gap-3">
                  {emptyCategories.map(category => (
                    <div
                      key={category.id}
                      className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-500 rounded-lg"
                    >
                      <span>{category.icon}</span>
                      <span className="text-sm">{category.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No categories */}
            {categories.length === 0 && (
              <div className="text-center py-16">
                <BookOpen className="w-16 h-16 text-stone-300 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-stone-700 mb-2">
                  No categories yet
                </h2>
                <p className="text-stone-500">
                  Books will be organized into categories as they are processed.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

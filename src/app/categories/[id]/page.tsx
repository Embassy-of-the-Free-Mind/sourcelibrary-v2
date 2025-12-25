'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Loader2, BookOpen, Book as BookIcon } from 'lucide-react';

interface Book {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  thumbnail?: string;
  pages_count?: number;
  pages_translated?: number;
  translation_percent?: number;
  summary?: { data: string } | string;
}

interface Category {
  id: string;
  name: string;
  description: string;
  icon: string;
}

interface CategoryPageProps {
  params: Promise<{ id: string }>;
}

export default function CategoryPage({ params }: CategoryPageProps) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then(p => setCategoryId(p.id));
  }, [params]);

  useEffect(() => {
    if (!categoryId) return;

    async function fetchCategory() {
      try {
        const res = await fetch(`/api/categories/${categoryId}`);
        if (res.ok) {
          const data = await res.json();
          setCategory(data.category);
          setBooks(data.books);
        }
      } catch (error) {
        console.error('Failed to fetch category:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchCategory();
  }, [categoryId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Link
            href="/categories"
            className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft className="w-4 h-4" />
            All Categories
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <div className="flex items-center gap-4">
            <span className="text-4xl">{category?.icon || '📚'}</span>
            <div>
              <h1 className="text-3xl sm:text-4xl font-serif font-bold">
                {category?.name || categoryId}
              </h1>
              {category?.description && (
                <p className="text-stone-300 mt-2">{category.description}</p>
              )}
            </div>
          </div>
          <p className="text-amber-400 mt-4 font-medium">
            {books.length} book{books.length !== 1 ? 's' : ''} in this category
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {books.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-stone-700 mb-2">
              No books in this category yet
            </h2>
            <p className="text-stone-500">
              Books will appear here as they are categorized.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {books.map(book => {
              const summaryText = typeof book.summary === 'string'
                ? book.summary
                : book.summary?.data;

              return (
                <Link
                  key={book.id}
                  href={`/book/${book.id}`}
                  className="group bg-white rounded-xl border border-stone-200 overflow-hidden hover:border-amber-300 hover:shadow-lg transition-all"
                >
                  {/* Thumbnail */}
                  <div className="aspect-[3/2] bg-stone-100 relative overflow-hidden">
                    {book.thumbnail ? (
                      <Image
                        src={book.thumbnail}
                        alt={book.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <BookIcon className="w-12 h-12 text-stone-300" />
                      </div>
                    )}
                    {/* Translation badge */}
                    {book.translation_percent !== undefined && (
                      <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium ${
                        book.translation_percent === 100
                          ? 'bg-green-500 text-white'
                          : book.translation_percent > 0
                            ? 'bg-amber-500 text-white'
                            : 'bg-stone-500 text-white'
                      }`}>
                        {book.translation_percent === 100
                          ? 'Translated'
                          : `${book.translation_percent}%`}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="font-serif font-semibold text-stone-900 group-hover:text-amber-700 transition-colors line-clamp-2">
                      {book.display_title || book.title}
                    </h3>
                    <p className="text-sm text-stone-600 mt-1">{book.author}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-stone-500">
                      <span className="px-2 py-0.5 bg-stone-100 rounded">{book.language}</span>
                      {book.published && <span>{book.published}</span>}
                    </div>
                    {summaryText && (
                      <p className="text-sm text-stone-600 mt-3 line-clamp-2">
                        {summaryText}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

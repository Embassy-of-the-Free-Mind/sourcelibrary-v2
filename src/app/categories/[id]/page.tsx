import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, BookOpen, Book as BookIcon } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES } from '@/app/api/categories/route';
import { notFound } from 'next/navigation';

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

interface CategoryPageProps {
  params: Promise<{ id: string }>;
}

function getCategory(id: string) {
  return LIBRARY_CATEGORIES.find(c => c.id === id);
}

async function getCategoryBooks(id: string): Promise<Book[]> {
  const db = await getDb();
  return db.collection('books').aggregate([
    { $match: { categories: id, hidden: { $ne: true } } },
    {
      $lookup: {
        from: 'pages',
        localField: 'id',
        foreignField: 'book_id',
        as: 'pages_array'
      }
    },
    {
      $addFields: {
        pages_count: { $size: '$pages_array' },
        pages_translated: {
          $size: {
            $filter: {
              input: '$pages_array',
              as: 'page',
              cond: {
                $and: [
                  { $ne: ['$$page.translation', null] },
                  { $ne: ['$$page.translation.data', null] },
                  { $gt: [{ $strLenCP: { $ifNull: ['$$page.translation.data', ''] } }, 50] }
                ]
              }
            }
          }
        }
      }
    },
    {
      $addFields: {
        translation_percent: {
          $cond: {
            if: { $gt: ['$pages_count', 0] },
            then: { $round: [{ $multiply: [{ $divide: ['$pages_translated', '$pages_count'] }, 100] }] },
            else: 0
          }
        }
      }
    },
    { $project: { pages_array: 0, _id: 0 } },
    { $sort: { translation_percent: -1, title: 1 } }
  ]).toArray() as unknown as Book[];
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { id } = await params;
  const category = getCategory(id);
  if (!category) return { title: 'Category Not Found' };

  return {
    title: `${category.name} — Source Library`,
    description: `Browse ${category.description.toLowerCase()} in Source Library's collection of rare historical texts, digitized and translated with AI.`,
    openGraph: {
      title: `${category.name} — Source Library`,
      description: category.description,
    },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { id } = await params;
  const category = getCategory(id);
  if (!category) notFound();

  const books = await getCategoryBooks(id);

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
            <span className="text-4xl">{category.icon}</span>
            <div>
              <h1 className="text-3xl sm:text-4xl font-serif font-bold">
                {category.name}
              </h1>
              {category.description && (
                <p className="text-stone-300 mt-2">{category.description}</p>
              )}
            </div>
          </div>
          <p className="text-accent-gold mt-4 font-medium">
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
                  className="group bg-white rounded-xl border border-stone-200 overflow-hidden hover:border-accent-gold/20 hover:shadow-lg transition-all"
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
                          ? 'bg-status-success text-white'
                          : book.translation_percent > 0
                            ? 'bg-accent-gold/80 text-white'
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
                    <h3 className="font-serif font-semibold text-stone-900 group-hover:text-accent-rust transition-colors line-clamp-2">
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

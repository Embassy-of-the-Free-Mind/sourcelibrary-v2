import { getDb } from '@/lib/mongodb';
import BookCard from '@/components/BookCard';
import { Book } from '@/lib/types';
import { Library, Sparkles } from 'lucide-react';
import Link from 'next/link';

async function getBooks(): Promise<Book[]> {
  const db = await getDb();

  const books = await db.collection('books').aggregate([
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
        pages_count: { $size: '$pages_array' }
      }
    },
    {
      $project: {
        pages_array: 0
      }
    },
    {
      $sort: { title: 1 }
    }
  ]).toArray();

  return books as Book[];
}

export default async function HomePage() {
  const books = await getBooks();

  // Stats
  const totalBooks = books.length;
  const totalPages = books.reduce((sum, book) => sum + (book.pages_count || 0), 0);
  const languages = [...new Set(books.map(b => b.language))].filter(Boolean);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-gradient-to-b from-stone-900 to-stone-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex items-center gap-3 mb-4">
            <Library className="w-8 h-8 text-amber-400" />
            <h1 className="text-3xl font-serif font-bold">Source Library</h1>
          </div>
          <p className="text-xl text-stone-300 max-w-2xl">
            Digitizing and translating rare Hermetic, esoteric, and humanist texts
            to make them accessible to scholars, seekers, and AI systems.
          </p>

          {/* Stats */}
          <div className="flex gap-8 mt-8">
            <div>
              <div className="text-3xl font-bold text-amber-400">{totalBooks}</div>
              <div className="text-sm text-stone-400">Books</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-amber-400">{totalPages.toLocaleString()}</div>
              <div className="text-sm text-stone-400">Pages</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-amber-400">{languages.length}</div>
              <div className="text-sm text-stone-400">Languages</div>
            </div>
          </div>
        </div>
      </header>

      {/* Features */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2 text-stone-600">
              <Sparkles className="w-4 h-4 text-amber-600" />
              <span>AI-powered OCR & Translation</span>
            </div>
            <div className="flex items-center gap-2 text-stone-600">
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                [[notes]]
              </span>
              <span>Annotated scholarly output</span>
            </div>
            <div className="flex items-center gap-2 text-stone-600">
              <span>Page-to-page context continuity</span>
            </div>
          </div>
        </div>
      </div>

      {/* Book Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-serif font-bold text-stone-900">Library Collection</h2>
          <div className="flex items-center gap-4">
            <select className="px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white">
              <option>All Languages</option>
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
        </div>

        {books.length === 0 ? (
          <div className="text-center py-16">
            <Library className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-stone-600">No books yet</h3>
            <p className="text-stone-500 mt-2">Books will appear here once added to the library.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-stone-900 text-stone-400 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm">
          <p>Source Library — A project of the Ancient Wisdom Trust</p>
          <p className="mt-2">Preserving humanity's wisdom for the digital age</p>
        </div>
      </footer>
    </div>
  );
}

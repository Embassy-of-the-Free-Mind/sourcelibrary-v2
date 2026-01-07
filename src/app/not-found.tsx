'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Home, Book } from 'lucide-react';

export default function NotFound() {
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full text-center">
        <div className="mb-8">
          <h1 className="text-6xl font-bold text-stone-900 mb-4">404</h1>
          <h2 className="text-2xl font-serif font-semibold text-stone-800 mb-2">
            Page Not Found
          </h2>
          <p className="text-stone-600">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-8 mb-6">
          <h3 className="text-lg font-medium text-stone-800 mb-4">
            Search the Library
          </h3>
          <form onSubmit={handleSearch} className="mb-6">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search books, authors, translations..."
                className="w-full pl-12 pr-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-lg"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full mt-3 bg-amber-600 hover:bg-amber-700 text-white font-medium py-3 px-6 rounded-xl transition-colors"
            >
              Search
            </button>
          </form>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl transition-colors"
            >
              <Home className="w-5 h-5" />
              Go Home
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl transition-colors"
            >
              <Book className="w-5 h-5" />
              Browse Library
            </Link>
          </div>
        </div>

        <p className="text-sm text-stone-500">
          If you believe this is an error, please{' '}
          <Link href="/support" className="text-amber-600 hover:text-amber-700 underline">
            contact support
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

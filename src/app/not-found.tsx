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
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="max-w-2xl w-full text-center">
        <div className="mb-8">
          <h1 className="text-6xl font-bold text-accent-rust mb-4 font-serif">404</h1>
          <h2 className="text-2xl font-serif font-semibold text-primary mb-2">
            Page Not Found
          </h2>
          <p className="text-muted">
            The page you seek has eluded the archive.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-light p-8 mb-6">
          <h3 className="text-lg font-medium text-secondary mb-4">
            Search the Library
          </h3>
          <form onSubmit={handleSearch} className="mb-6">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search books, authors, translations..."
                className="w-full pl-12 pr-4 py-3 border border-medium rounded-xl focus:outline-none focus:ring-2 focus:ring-accent-rust/40 focus:border-accent-rust/50 text-lg"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full mt-3 bg-accent-rust hover:bg-accent-rust/90 text-white font-medium py-3 px-6 rounded-xl transition-colors"
            >
              Search
            </button>
          </form>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-warm hover:bg-accent-rust/10 text-secondary rounded-xl transition-colors"
            >
              <Home className="w-5 h-5" />
              Go Home
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-warm hover:bg-accent-rust/10 text-secondary rounded-xl transition-colors"
            >
              <Book className="w-5 h-5" />
              Browse Library
            </Link>
          </div>
        </div>

        <p className="text-sm text-faint">
          If you believe this is an error, please{' '}
          <Link href="/support" className="text-accent-rust hover:text-accent-rust/80 underline">
            contact support
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

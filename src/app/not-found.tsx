'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Home, BookOpen } from 'lucide-react';

const QUOTES = [
  { text: 'The lips of Wisdom are closed, except to the ears of Understanding.', source: 'The Kybalion' },
  { text: 'Nature is the living visible garment of God.', source: 'Goethe' },
  { text: 'All that we see or seem is but a dream within a dream.', source: 'Poe' },
  { text: 'The universe is not only queerer than we suppose, but queerer than we can suppose.', source: 'Haldane' },
  { text: 'As above, so below; as below, so above.', source: 'Hermes Trismegistus' },
];

export default function NotFound() {
  const [searchQuery, setSearchQuery] = useState('');
  const [quote, setQuote] = useState(QUOTES[0]);
  const router = useRouter();

  useEffect(() => {
    setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4 py-12">
      <div className="max-w-xl w-full text-center">
        <h1 className="text-7xl font-bold text-accent-rust/20 mb-2 font-serif">404</h1>
        <h2 className="text-2xl font-serif font-semibold text-primary mb-3">
          Lost in the Stacks
        </h2>
        <p className="text-muted mb-8 italic">
          &ldquo;{quote.text}&rdquo;
          <span className="block text-faint text-sm mt-1 not-italic">&mdash; {quote.source}</span>
        </p>

        <div className="bg-white rounded-xl border border-light p-6 mb-6">
          <form onSubmit={handleSearch} className="mb-5">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search the library..."
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

          <div className="flex gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-warm hover:bg-accent-rust/10 text-secondary rounded-xl transition-colors text-sm"
            >
              <Home className="w-4 h-4" />
              Home
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-warm hover:bg-accent-rust/10 text-secondary rounded-xl transition-colors text-sm"
            >
              <BookOpen className="w-4 h-4" />
              Browse
            </Link>
          </div>
        </div>

        <p className="text-xs text-faint">
          Something broken?{' '}
          <Link href="mailto:derek@sourcelibrary.org" className="text-accent-rust/70 hover:text-accent-rust underline">
            Let us know
          </Link>
        </p>
      </div>
    </div>
  );
}

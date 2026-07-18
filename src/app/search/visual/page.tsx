'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Search, Loader2 } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { bookUrl } from '@/lib/slugify';

interface VisualResult {
  id: string;
  sourceType: string;
  bookId: string;
  imageUrl: string;
  fullImageUrl: string;
  title: string;
  author: string;
  resourceType?: string;
  similarity: number;
}

interface SearchResponse {
  results: VisualResult[];
  query: string;
  total: number;
  mode: string;
}

const SUGGESTIONS = [
  'skeleton', 'ouroboros', 'dragon', 'tree', 'sun and moon',
  'angel', 'laboratory', 'zodiac', 'portrait', 'castle',
  'serpent', 'bird', 'geometric diagram', 'musical notation',
  'battle scene', 'garden', 'ship', 'skull', 'lion', 'eagle',
];

export default function VisualSearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VisualResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    setQuery(q);

    try {
      const resp = await fetch(`/api/search/visual?q=${encodeURIComponent(q.trim())}&limit=60`);
      if (!resp.ok) throw new Error(`Search failed (${resp.status})`);
      const data: SearchResponse = await resp.json();
      setResults(data.results);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(query);
  };

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <div className="bg-dark text-white">
        <SiteHeader variant="dark" breadcrumbs={[{ label: 'Gallery', href: '/gallery' }]} />
        <div className="max-w-6xl mx-auto px-4 py-6">
          <h1 className="text-2xl sm:text-3xl font-display font-semibold">Visual Search</h1>
          <p className="text-white/60 mt-1 text-sm">
            Search images by what they look like, not just their descriptions
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Search bar */}
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe what you're looking for..."
              className="w-full pl-12 pr-4 py-3.5 border border-border-light rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-accent-rust/40 focus:border-accent-rust/50 text-lg"
              autoFocus
            />
            {loading && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-accent-rust" />
            )}
          </div>
        </form>

        {/* Suggestions (before search) */}
        {!searched && (
          <div className="max-w-2xl mx-auto">
            <p className="text-sm text-muted mb-3">Try searching for:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => { setQuery(s); search(s); }}
                  className="px-3 py-1.5 text-sm bg-white border border-border-light rounded-full hover:border-accent-rust/30 hover:bg-accent-rust/5 transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted/60 mt-6 max-w-lg">
              Visual search uses CLIP embeddings to find images by visual similarity.
              Unlike keyword search, it matches what images look like — not just their metadata.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="max-w-2xl mx-auto rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Results */}
        {searched && !loading && results.length > 0 && (
          <div>
            <p className="text-sm text-muted mb-4">
              {total} visual matches for &ldquo;{query}&rdquo;
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {results.map((r) => (
                <Link
                  key={r.id}
                  href={bookUrl({ id: r.bookId })}
                  className="group relative rounded-lg overflow-hidden bg-stone-100 aspect-square hover:ring-2 hover:ring-accent-rust/40 transition-all"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.imageUrl}
                    alt={r.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-0 left-0 right-0 p-2.5">
                      <p className="text-white text-xs font-medium line-clamp-2 leading-snug">
                        {r.title}
                      </p>
                      {r.author && (
                        <p className="text-white/70 text-[10px] mt-0.5 line-clamp-1">{r.author}</p>
                      )}
                      <p className="text-white/50 text-[10px] mt-0.5">
                        {Math.round(r.similarity * 100)}% match
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {searched && !loading && results.length === 0 && !error && (
          <div className="text-center py-12">
            <p className="text-secondary">No visual matches found for &ldquo;{query}&rdquo;</p>
            <p className="text-sm text-muted mt-1">Try a different description or browse the suggestions above</p>
          </div>
        )}
      </div>
    </div>
  );
}

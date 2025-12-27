'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Loader2, BookOpen, Users, MapPin, FileText, Lightbulb, X } from 'lucide-react';
import { EncyclopediaEntry, EncyclopediaEntryType } from '@/lib/types';

const TYPE_ICONS: Record<EncyclopediaEntryType, React.ReactNode> = {
  term: <BookOpen className="w-3.5 h-3.5" />,
  person: <Users className="w-3.5 h-3.5" />,
  place: <MapPin className="w-3.5 h-3.5" />,
  work: <FileText className="w-3.5 h-3.5" />,
  concept: <Lightbulb className="w-3.5 h-3.5" />,
};

export default function EncyclopediaSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EncyclopediaEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/encyclopedia?q=${encodeURIComponent(q)}&limit=8`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.entries || []);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        search(query);
        setShowDropdown(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query) {
      router.push(`/encyclopedia?q=${encodeURIComponent(query)}`);
      setShowDropdown(false);
    }
  };

  return (
    <div className="relative w-full sm:w-80">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query && setShowDropdown(true)}
            placeholder="Search encyclopedia..."
            className="w-full pl-10 pr-8 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                setShowDropdown(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </form>

      {/* Dropdown results */}
      {showDropdown && (query.length >= 2 || results.length > 0) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-sm text-stone-500">
              <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-sm text-stone-500">
              No entries found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              {results.map((entry) => (
                <Link
                  key={entry.id}
                  href={`/encyclopedia/${entry.slug}`}
                  onClick={() => setShowDropdown(false)}
                  className="flex items-start gap-3 p-3 hover:bg-stone-50 border-b border-stone-100 last:border-0"
                >
                  <span className="text-stone-400 mt-0.5">{TYPE_ICONS[entry.type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-stone-900 text-sm">{entry.title}</div>
                    <div className="text-xs text-stone-500 line-clamp-1">{entry.summary}</div>
                  </div>
                </Link>
              ))}
              {results.length >= 8 && (
                <button
                  onClick={() => {
                    router.push(`/encyclopedia?q=${encodeURIComponent(query)}`);
                    setShowDropdown(false);
                  }}
                  className="w-full p-3 text-center text-sm text-amber-600 hover:bg-amber-50"
                >
                  View all results
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
}

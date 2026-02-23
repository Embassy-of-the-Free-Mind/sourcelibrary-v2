'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Search } from 'lucide-react';

export default function EncyclopediaFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const activeType = searchParams.get('type') || 'all';
  const minBooks = parseInt(searchParams.get('min_books') || '2');
  const query = searchParams.get('q') || '';
  const [searchInput, setSearchInput] = useState(query);

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '' || (key === 'type' && value === 'all') || (key === 'min_books' && value === '2')) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    // Reset pagination and letter on filter change
    params.delete('page');
    if (updates.q !== undefined) {
      params.delete('letter');
    }
    startTransition(() => {
      router.push(`/encyclopedia?${params.toString()}`, { scroll: false });
    });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ q: searchInput || null });
  }

  return (
    <div className={`bg-white border-b border-stone-200 sticky top-0 z-10 ${isPending ? 'opacity-70' : ''}`}>
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search entities..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onBlur={() => { if (searchInput !== query) updateParams({ q: searchInput || null }); }}
              className="w-full pl-10 pr-4 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus-visible:ring-accent-rust"
            />
          </form>

          {/* Type filter */}
          <div className="flex gap-1 bg-stone-100 p-1 rounded-lg">
            {(['all', 'person', 'place', 'concept'] as const).map((type) => (
              <button
                key={type}
                onClick={() => updateParams({ type })}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  activeType === type
                    ? 'bg-white text-stone-900 shadow-sm'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1) + 's'}
              </button>
            ))}
          </div>

          {/* Min books filter */}
          <select
            value={minBooks}
            onChange={(e) => updateParams({ min_books: e.target.value })}
            className="px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus-visible:ring-accent-rust"
          >
            <option value={1}>All entities</option>
            <option value={2}>2+ books</option>
            <option value={3}>3+ books</option>
            <option value={5}>5+ books</option>
          </select>
        </div>
      </div>
    </div>
  );
}

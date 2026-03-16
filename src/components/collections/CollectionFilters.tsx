'use client';

import { useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { Search, X } from 'lucide-react';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'popular', label: 'Most popular' },
  { value: 'year_asc', label: 'Oldest first' },
  { value: 'year_desc', label: 'Newest first' },
  { value: 'title', label: 'Title A-Z' },
  { value: 'recent', label: 'Recently added' },
];

interface CollectionFiltersProps {
  collectionId: string;
  languages: { lang: string; count: number }[];
  /** Override the base path for URL construction (default: /collections/{collectionId}) */
  basePath?: string;
  /** Show a search input for filtering within this collection */
  showSearch?: boolean;
}

export default function CollectionFilters({ collectionId, languages, basePath, showSearch }: CollectionFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sort = searchParams.get('sort') || 'relevance';
  const language = searchParams.get('language') || '';
  const initialQ = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQ);

  const resolvedPath = basePath || `/collections/${collectionId}`;

  const updateParams = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (updates.sort || updates.language || updates.q !== undefined) params.delete('offset');
    router.push(`${resolvedPath}?${params.toString()}`, { scroll: false });
  }, [searchParams, router, resolvedPath]);

  const debouncedSearch = useDebouncedCallback((value: string) => {
    updateParams({ q: value });
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {showSearch && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search within..."
            className="text-sm border border-border-light rounded-md pl-8 pr-8 py-1.5 bg-white text-primary w-48 focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <select
        value={sort}
        onChange={(e) => updateParams({ sort: e.target.value })}
        className="text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary"
      >
        {SORT_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {languages.length > 1 && (
        <select
          value={language}
          onChange={(e) => updateParams({ language: e.target.value })}
          className="text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary"
        >
          <option value="">All languages</option>
          {languages.map(l => (
            <option key={l.lang} value={l.lang}>{l.lang} ({l.count})</option>
          ))}
        </select>
      )}
    </div>
  );
}

'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const SORT_OPTIONS = [
  { value: 'popular', label: 'Most popular' },
  { value: 'year_asc', label: 'Oldest first' },
  { value: 'year_desc', label: 'Newest first' },
  { value: 'title', label: 'Title A-Z' },
  { value: 'recent', label: 'Recently added' },
];

interface CollectionFiltersProps {
  collectionId: string;
  languages: { lang: string; count: number }[];
}

export default function CollectionFilters({ collectionId, languages }: CollectionFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sort = searchParams.get('sort') || 'popular';
  const language = searchParams.get('language') || '';

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (updates.sort || updates.language) params.delete('offset');
    router.push(`/collections/${collectionId}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
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

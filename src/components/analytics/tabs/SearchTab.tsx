'use client';

import { useState, useEffect } from 'react';
import { Search, BookOpen, AlertTriangle } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import type { SearchAnalyticsData } from '@/lib/api-client/types/analytics';
import { formatNumber } from '../shared/formatters';
import { BarChart } from '../charts/BarChart';

interface SearchTabProps {
  days: number;
}

export default function SearchTab({ days }: SearchTabProps) {
  const [searchData, setSearchData] = useState<SearchAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analytics.search(days).then(setSearchData).finally(() => setLoading(false));
  }, [days]);

  if (loading) return <div className="py-12"><BookLoader size="xs" /></div>;

  if (!searchData) {
    return (
      <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
        <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
        <p>No search data available yet</p>
        <p className="text-sm mt-1">Search queries will appear here as users search the library</p>
      </div>
    );
  }

  const sourceLabels: Record<string, string> = { global: 'Full Search', unified: 'Quick Search', book_search: 'Within Book' };

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-4 h-4" style={{ color: 'var(--accent-violet)' }} />
            <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Total Searches</span>
          </div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatNumber(searchData.totalSearches)}
          </div>
        </div>
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
            <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Unique Queries</span>
          </div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatNumber(searchData.topQueries?.length || 0)}
          </div>
        </div>
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />
            <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Zero-Result Queries</span>
          </div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatNumber(searchData.zeroResultQueries?.length || 0)}
          </div>
        </div>
      </div>

      {/* Daily Search Volume Chart */}
      {searchData.searchesByDay && searchData.searchesByDay.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Daily Search Volume</h2>
          <BarChart
            data={searchData.searchesByDay.map(d => ({ x: d.date.slice(5), y: d.count }))}
            color="var(--accent-violet)"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Queries */}
        {searchData.topQueries && searchData.topQueries.length > 0 && (
          <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Search className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
              Top Searches
            </h2>
            <div className="space-y-2">
              {searchData.topQueries.slice(0, 20).map((q, idx) => (
                <div key={idx} className="flex items-center justify-between py-2" style={{ borderBottom: idx < Math.min(searchData.topQueries.length, 20) - 1 ? '1px solid var(--border-light)' : 'none' }}>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm truncate block" style={{ color: 'var(--text-primary)' }}>{q.query}</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>avg {q.avg_results} results</span>
                  </div>
                  <span className="text-sm font-medium ml-3 shrink-0" style={{ color: 'var(--text-secondary)' }}>{q.count}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Zero-Result Queries (Content Gaps) */}
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <AlertTriangle className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
            Content Gaps
            <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(zero results)</span>
          </h2>
          {searchData.zeroResultQueries && searchData.zeroResultQueries.length > 0 ? (
            <div className="space-y-2">
              {searchData.zeroResultQueries.map((q, idx) => (
                <div key={idx} className="flex items-center justify-between py-2" style={{ borderBottom: idx < searchData.zeroResultQueries.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                  <span className="font-medium text-sm truncate" style={{ color: 'var(--accent-rust)' }}>{q.query}</span>
                  <span className="text-sm font-medium ml-3 shrink-0" style={{ color: 'var(--text-muted)' }}>{q.count}x</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No zero-result queries in this period</p>
          )}
        </div>
      </div>

      {/* Search by Source */}
      {searchData.searchesBySource && searchData.searchesBySource.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Searches by Source</h2>
          <div className="flex gap-4 flex-wrap">
            {searchData.searchesBySource.map((s, idx) => (
              <div key={idx} className="px-4 py-3 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
                <div className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>{sourceLabels[s.source] || s.source}</div>
                <div className="text-xl font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{formatNumber(s.count)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

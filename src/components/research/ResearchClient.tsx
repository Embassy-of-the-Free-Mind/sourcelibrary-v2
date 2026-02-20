'use client';

import { useState, useCallback } from 'react';
import { research } from '@/lib/api-client/research';
import type { CuratorSessionListItem, CuratorSessionListResponse } from '@/lib/api-client/types/research';
import SessionCard from './SessionCard';

interface Props {
  initialData: CuratorSessionListResponse;
}

const TYPE_LABELS: Record<string, string> = {
  acquisition: 'Acquisition',
  research: 'Research',
  gap_analysis: 'Gap Analysis',
  mixed: 'Mixed',
};

export default function ResearchClient({ initialData }: Props) {
  const [sessions, setSessions] = useState<CuratorSessionListItem[]>(initialData.sessions);
  const [total, setTotal] = useState(initialData.total);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [sort, setSort] = useState<'date' | 'score'>('date');
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchSessions = useCallback(async (
    theme: string | null,
    type: string | null,
    sortBy: 'date' | 'score',
    newOffset: number,
  ) => {
    setLoading(true);
    try {
      const data = await research.list({
        theme: theme || undefined,
        type: type || undefined,
        sort: sortBy,
        limit: 20,
        offset: newOffset,
      });
      setSessions(data.sessions);
      setTotal(data.total);
      setOffset(newOffset);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleTheme = (theme: string | null) => {
    setActiveTheme(theme);
    fetchSessions(theme, activeType, sort, 0);
  };

  const handleType = (type: string | null) => {
    setActiveType(type);
    fetchSessions(activeTheme, type, sort, 0);
  };

  const handleSort = (s: 'date' | 'score') => {
    setSort(s);
    fetchSessions(activeTheme, activeType, s, 0);
  };

  const hasMore = offset + 20 < total;
  const hasPrev = offset > 0;

  return (
    <div>
      {/* Theme filter pills */}
      {initialData.themes.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => handleTheme(null)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              !activeTheme
                ? 'bg-stone-800 text-white'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            All themes
          </button>
          {initialData.themes.map(theme => (
            <button
              key={theme}
              onClick={() => handleTheme(activeTheme === theme ? null : theme)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                activeTheme === theme
                  ? 'bg-stone-800 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {theme.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Type tabs + sort */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1">
          <button
            onClick={() => handleType(null)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              !activeType ? 'bg-stone-200 font-medium' : 'hover:bg-stone-100'
            }`}
          >
            All ({total})
          </button>
          {initialData.types.map(type => (
            <button
              key={type}
              onClick={() => handleType(activeType === type ? null : type)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                activeType === type ? 'bg-stone-200 font-medium' : 'hover:bg-stone-100'
              }`}
            >
              {TYPE_LABELS[type] || type}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={e => handleSort(e.target.value as 'date' | 'score')}
          className="text-sm border border-border-light rounded px-2 py-1"
        >
          <option value="date">Newest first</option>
          <option value="score">Highest relevance</option>
        </select>
      </div>

      {/* Session list */}
      <div className={`space-y-3 ${loading ? 'opacity-60' : ''}`}>
        {sessions.length === 0 && !loading && (
          <p className="text-muted py-12 text-center">
            No research sessions found. Run the parser script to import conversation logs.
          </p>
        )}
        {sessions.map(session => (
          <SessionCard key={session.id} session={session} />
        ))}
      </div>

      {/* Pagination */}
      {(hasPrev || hasMore) && (
        <div className="flex justify-center gap-4 mt-8">
          {hasPrev && (
            <button
              onClick={() => fetchSessions(activeTheme, activeType, sort, Math.max(0, offset - 20))}
              className="px-4 py-2 text-sm border border-border-light rounded hover:bg-stone-50"
            >
              Previous
            </button>
          )}
          <span className="text-sm text-muted self-center">
            {offset + 1}–{Math.min(offset + 20, total)} of {total}
          </span>
          {hasMore && (
            <button
              onClick={() => fetchSessions(activeTheme, activeType, sort, offset + 20)}
              className="px-4 py-2 text-sm border border-border-light rounded hover:bg-stone-50"
            >
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw, ChevronLeft, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';
import { bookUrl } from '@/lib/slugify';

interface BookSummary {
  id: string;
  title: string;
  author: string;
  provider: string;
  pagesCount: number;
  pagesOcr: number;
  pagesTranslated: number;
  slug: string;
}

interface DupeGroup {
  tier: string;
  confidence: 'exact' | 'high' | 'medium';
  reason: string;
  keeper: BookSummary;
  dupes: BookSummary[];
}

interface DupeData {
  totalBooks: number;
  summary: {
    exact: { groups: number; dupes: number };
    high: { groups: number; dupes: number };
    medium: { groups: number; dupes: number };
  };
  groups: DupeGroup[];
}

const CONFIDENCE_COLORS: Record<string, string> = {
  exact: 'var(--accent-rust)',
  high: 'var(--accent-gold)',
  medium: 'var(--text-muted)',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  exact: 'Exact',
  high: 'High',
  medium: 'Medium',
};

export default function DuplicatesPage() {
  const [data, setData] = useState<DupeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'exact' | 'high' | 'medium'>('all');
  const [hiding, setHiding] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/duplicates?tier=${filter}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Failed to fetch duplicates:', e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hideDupe = async (bookId: string, keeperId: string) => {
    setHiding(prev => new Set(prev).add(bookId));
    try {
      const res = await fetch('/api/admin/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds: [bookId], keeperId }),
      });
      if (res.ok) {
        setHidden(prev => new Set(prev).add(bookId));
      }
    } catch (e) {
      console.error('Failed to hide:', e);
    } finally {
      setHiding(prev => { const s = new Set(prev); s.delete(bookId); return s; });
    }
  };

  const hideAllInGroup = async (group: DupeGroup) => {
    const ids = group.dupes.map(d => d.id).filter(id => !hidden.has(id));
    if (ids.length === 0) return;
    for (const id of ids) setHiding(prev => new Set(prev).add(id));
    try {
      const res = await fetch('/api/admin/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds: ids, keeperId: group.keeper.id }),
      });
      if (res.ok) {
        for (const id of ids) setHidden(prev => new Set(prev).add(id));
      }
    } catch (e) {
      console.error('Failed to hide group:', e);
    } finally {
      for (const id of ids) setHiding(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const progress = (b: BookSummary) => {
    if (!b.pagesCount) return '?';
    const ocrPct = Math.round((b.pagesOcr / b.pagesCount) * 100);
    const transPct = Math.round((b.pagesTranslated / b.pagesCount) * 100);
    return `${ocrPct}% OCR, ${transPct}% translated`;
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-parchment)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-lg hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronLeft size={20} />
            </Link>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              Duplicate Books
            </h1>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Summary cards */}
        {data && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            {(['exact', 'high', 'medium'] as const).map(level => (
              <button
                key={level}
                onClick={() => setFilter(filter === level ? 'all' : level)}
                className="p-4 rounded-xl text-left transition-all"
                style={{
                  background: 'var(--bg-white)',
                  border: filter === level ? `2px solid ${CONFIDENCE_COLORS[level]}` : '1px solid var(--border-light)',
                }}
              >
                <div className="text-xs font-medium mb-1" style={{ color: CONFIDENCE_COLORS[level] }}>
                  {CONFIDENCE_LABELS[level]} confidence
                </div>
                <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {data.summary[level].groups}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  groups ({data.summary[level].dupes} books to hide)
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <BookLoader />
          </div>
        )}

        {/* Groups */}
        {!loading && data && (
          <div className="space-y-4">
            {data.groups.map((group, i) => {
              const allHidden = group.dupes.every(d => hidden.has(d.id));
              return (
                <div
                  key={i}
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: 'var(--bg-white)',
                    border: '1px solid var(--border-light)',
                    opacity: allHidden ? 0.5 : 1,
                  }}
                >
                  {/* Group header */}
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-3">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          background: `${CONFIDENCE_COLORS[group.confidence]}20`,
                          color: CONFIDENCE_COLORS[group.confidence],
                        }}
                      >
                        {group.confidence}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {group.tier.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {group.reason}
                      </span>
                    </div>
                    {!allHidden && (
                      <button
                        onClick={() => hideAllInGroup(group)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-opacity hover:opacity-70"
                        style={{ color: 'var(--accent-rust)' }}
                      >
                        <EyeOff size={12} />
                        Hide all dupes
                      </button>
                    )}
                  </div>

                  {/* Keeper */}
                  <div className="px-4 py-3" style={{ background: 'var(--bg-parchment-light, var(--bg-parchment))' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Eye size={14} style={{ color: 'var(--accent-sage)' }} />
                          <span className="text-xs font-medium" style={{ color: 'var(--accent-sage)' }}>KEEP</span>
                          <Link
                            href={bookUrl({ slug: group.keeper.slug, id: group.keeper.id })}
                            className="text-sm font-medium truncate hover:underline"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {group.keeper.title}
                          </Link>
                        </div>
                        <div className="text-xs mt-0.5 flex gap-3" style={{ color: 'var(--text-muted)' }}>
                          <span>{group.keeper.author}</span>
                          <span>{group.keeper.provider}</span>
                          <span>{group.keeper.pagesCount} pages</span>
                          <span>{progress(group.keeper)}</span>
                        </div>
                      </div>
                      <Link
                        href={bookUrl({ slug: group.keeper.slug, id: group.keeper.id })}
                        target="_blank"
                        className="p-1 hover:opacity-70"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <ExternalLink size={14} />
                      </Link>
                    </div>
                  </div>

                  {/* Dupes */}
                  {group.dupes.map(dupe => {
                    const isHidden = hidden.has(dupe.id);
                    const isHiding = hiding.has(dupe.id);
                    return (
                      <div
                        key={dupe.id}
                        className="px-4 py-3 flex items-center justify-between"
                        style={{
                          borderTop: '1px solid var(--border-light)',
                          opacity: isHidden ? 0.4 : 1,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <EyeOff size={14} style={{ color: 'var(--accent-rust)' }} />
                            <span className="text-xs font-medium" style={{ color: 'var(--accent-rust)' }}>
                              {isHidden ? 'HIDDEN' : 'DUPE'}
                            </span>
                            <Link
                              href={bookUrl({ slug: dupe.slug, id: dupe.id })}
                              className="text-sm truncate hover:underline"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {dupe.title}
                            </Link>
                          </div>
                          <div className="text-xs mt-0.5 flex gap-3" style={{ color: 'var(--text-muted)' }}>
                            <span>{dupe.author}</span>
                            <span>{dupe.provider}</span>
                            <span>{dupe.pagesCount} pages</span>
                            <span>{progress(dupe)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={bookUrl({ slug: dupe.slug, id: dupe.id })}
                            target="_blank"
                            className="p-1 hover:opacity-70"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <ExternalLink size={14} />
                          </Link>
                          {!isHidden && (
                            <button
                              onClick={() => hideDupe(dupe.id, group.keeper.id)}
                              disabled={isHiding}
                              className="px-2 py-1 rounded text-xs transition-opacity hover:opacity-70 disabled:opacity-50"
                              style={{
                                color: 'var(--accent-rust)',
                                border: '1px solid var(--accent-rust)',
                              }}
                            >
                              {isHiding ? 'Hiding...' : 'Hide'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {data.groups.length === 0 && (
              <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
                No duplicates found at this confidence level.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

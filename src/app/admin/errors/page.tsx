'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw, ChevronLeft, AlertTriangle, Globe, Smartphone, Monitor } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

interface AppError {
  _id: string;
  message: string;
  stack?: string;
  component_stack?: string;
  source: string;
  url?: string;
  user_agent?: string;
  timestamp: string;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function deviceIcon(ua?: string) {
  if (!ua) return <Globe className="w-3.5 h-3.5" />;
  if (/mobile|android|iphone/i.test(ua)) return <Smartphone className="w-3.5 h-3.5" />;
  return <Monitor className="w-3.5 h-3.5" />;
}

const SOURCE_LABELS: Record<string, string> = {
  'window.onerror': 'JS Error',
  'unhandledrejection': 'Promise',
  'react_error_boundary': 'React',
  'search_browse': 'Browse API',
  'search_query': 'Search API',
};

export default function AdminErrorsPage() {
  const [errors, setErrors] = useState<AppError[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/errors?limit=100');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setErrors(data.errors);
      setTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchErrors(); }, [fetchErrors]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Group errors by message to show counts
  const grouped = errors.reduce<Map<string, AppError[]>>((acc, err) => {
    const key = err.message.slice(0, 200);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(err);
    return acc;
  }, new Map());

  const sortedGroups = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/admin/pipeline" className="text-muted hover:text-primary transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-serif font-semibold text-primary">Error Log</h1>
              <p className="text-sm text-muted">{total} total errors, {sortedGroups.length} unique</p>
            </div>
          </div>
          <button
            onClick={fetchErrors}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white border border-light rounded-lg hover:bg-warm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {loading && errors.length === 0 ? (
          <div className="flex justify-center py-20"><BookLoader /></div>
        ) : sortedGroups.length === 0 ? (
          <div className="text-center py-20 text-muted">No errors recorded.</div>
        ) : (
          <div className="space-y-2">
            {sortedGroups.map(([message, group]) => {
              const latest = group[0];
              const isExpanded = expanded.has(message);
              return (
                <div key={message} className="bg-white rounded-lg border border-light overflow-hidden">
                  <button
                    onClick={() => toggle(message)}
                    className="w-full text-left px-4 py-3 hover:bg-warm/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-4 h-4 text-accent-rust mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-primary truncate">{message}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                          <span className="px-1.5 py-0.5 bg-stone-100 rounded text-stone-600">
                            {SOURCE_LABELS[latest.source] || latest.source}
                          </span>
                          {latest.url && (
                            <span className="truncate max-w-[300px]">{new URL(latest.url, 'https://sourcelibrary.org').pathname}</span>
                          )}
                          <span>{timeAgo(latest.timestamp)}</span>
                          {group.length > 1 && (
                            <span className="px-1.5 py-0.5 bg-accent-rust/10 text-accent-rust rounded font-medium">
                              {group.length}x
                            </span>
                          )}
                          {deviceIcon(latest.user_agent)}
                        </div>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-light px-4 py-3 bg-stone-50">
                      {latest.stack && (
                        <pre className="text-xs text-stone-600 whitespace-pre-wrap break-all mb-3 max-h-48 overflow-auto font-mono">
                          {latest.stack}
                        </pre>
                      )}
                      {group.length > 1 && (
                        <div className="text-xs text-muted space-y-1">
                          <p className="font-medium text-stone-500">Occurrences:</p>
                          {group.slice(0, 10).map((err) => (
                            <div key={err._id} className="flex items-center gap-3">
                              {deviceIcon(err.user_agent)}
                              <span>{err.url ? new URL(err.url, 'https://sourcelibrary.org').pathname : '—'}</span>
                              <span>{timeAgo(err.timestamp)}</span>
                            </div>
                          ))}
                          {group.length > 10 && <p className="text-stone-400">...and {group.length - 10} more</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

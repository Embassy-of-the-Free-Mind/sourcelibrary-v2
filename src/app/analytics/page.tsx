'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Clock, Zap, TrendingUp } from 'lucide-react';

interface MetricStat {
  name: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number | null;
  p95: number | null;
}

interface RecentSample {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface AnalyticsData {
  stats: MetricStat[];
  recentSamples: RecentSample[];
  query: { hours: number; metricName: string | null };
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics/loading?hours=${hours}`);
      if (!res.ok) throw new Error('Failed to fetch analytics');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [hours]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
              Analytics
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={hours}
              onChange={(e) => setHours(parseInt(e.target.value))}
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
            >
              <option value={1}>Last hour</option>
              <option value={6}>Last 6 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={72}>Last 3 days</option>
              <option value={168}>Last week</option>
            </select>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
              style={{ color: 'var(--accent-rust)' }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="p-4 rounded-lg mb-6" style={{ background: '#fef2f2', color: '#991b1b' }}>
            {error}
          </div>
        )}

        {/* Stats Grid */}
        {data?.stats && data.stats.length > 0 ? (
          <div className="space-y-6">
            <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
              Performance Metrics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.stats.map((stat) => (
                <div
                  key={stat.name}
                  className="p-4 rounded-xl"
                  style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {stat.name.replace(/_/g, ' ')}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>
                      {stat.count} calls
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Avg</div>
                      <div className="text-sm font-medium" style={{ color: 'var(--accent-sage)' }}>
                        {formatDuration(stat.avg)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>P50</div>
                      <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {stat.p50 ? formatDuration(stat.p50) : '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>P95</div>
                      <div className="text-sm font-medium" style={{ color: 'var(--accent-rust)' }}>
                        {stat.p95 ? formatDuration(stat.p95) : '-'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 flex justify-between text-xs" style={{ borderTop: '1px solid var(--border-light)', color: 'var(--text-faint)' }}>
                    <span>Min: {formatDuration(stat.min)}</span>
                    <span>Max: {formatDuration(stat.max)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Recent Samples */}
            {data.recentSamples && data.recentSamples.length > 0 && (
              <div className="mt-8">
                <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                  Recent Activity
                </h2>
                <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--bg-warm)' }}>
                        <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Metric</th>
                        <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Duration</th>
                        <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Time</th>
                        <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentSamples.map((sample, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--border-light)' }}>
                          <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>
                            {sample.name.replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-2 font-mono" style={{ color: 'var(--accent-sage)' }}>
                            {formatDuration(sample.duration)}
                          </td>
                          <td className="px-4 py-2" style={{ color: 'var(--text-muted)' }}>
                            {formatTime(sample.timestamp)}
                          </td>
                          <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                            {sample.metadata ? Object.entries(sample.metadata).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ') : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : !loading ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No analytics data yet</p>
            <p className="text-sm mt-1">Metrics will appear here as the site is used</p>
          </div>
        ) : (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin opacity-30" />
            <p>Loading analytics...</p>
          </div>
        )}
      </main>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import type { PerformanceData } from '@/lib/api-client/types/analytics';
import { formatDuration, formatTime } from '../shared/formatters';

interface PerformanceTabProps {
  hours: number;
}

export default function PerformanceTab({ hours }: PerformanceTabProps) {
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analytics.loading(hours).then(setPerfData).finally(() => setLoading(false));
  }, [hours]);

  if (loading) return <div className="py-12"><BookLoader size="xs" /></div>;

  return (
    <div className="space-y-6">
      {/* Blob vs IA Comparison */}
      {perfData?.sourceStats && perfData.sourceStats.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            Image Loading: Blob vs Internet Archive
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {perfData.sourceStats.map((stat) => {
              const sourceLabels: Record<string, string> = {
                r2: 'R2 CDN (Archived)',
                ia: 'Internet Archive',
                local: 'API Proxy',
                other: 'Other',
              };
              const sourceColors: Record<string, string> = {
                r2: '#22c55e',
                ia: '#f59e0b',
                local: 'var(--accent-sage)',
                other: 'var(--text-muted)',
              };
              const color = sourceColors[stat.source] || sourceColors.other;
              return (
                <div
                  key={stat.source}
                  className="p-4 rounded-lg"
                  style={{ background: 'var(--bg-warm)', borderLeft: `4px solid ${color}` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {sourceLabels[stat.source] || stat.source}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-white)', color: 'var(--text-muted)' }}>
                      {stat.count} loads
                    </span>
                  </div>
                  <div className="text-2xl font-semibold mb-2" style={{ color }}>
                    {formatDuration(stat.avg)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>P50: </span>
                      <span style={{ color: 'var(--text-primary)' }}>{stat.p50 ? formatDuration(stat.p50) : '-'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>P95: </span>
                      <span style={{ color: 'var(--text-primary)' }}>{stat.p95 ? formatDuration(stat.p95) : '-'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Min: </span>
                      <span style={{ color: 'var(--text-primary)' }}>{formatDuration(stat.min)}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Max: </span>
                      <span style={{ color: 'var(--text-primary)' }}>{formatDuration(stat.max)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Comparison Bar */}
          {perfData.sourceStats.length >= 2 && (() => {
            const r2 = perfData.sourceStats.find(s => s.source === 'r2');
            const ia = perfData.sourceStats.find(s => s.source === 'ia');
            if (r2 && ia) {
              const speedup = ((ia.avg - r2.avg) / ia.avg * 100).toFixed(0);
              const faster = r2.avg < ia.avg ? 'r2' : 'ia';
              return (
                <div className="mt-4 p-4 rounded-lg text-center" style={{ background: 'var(--bg-cream)' }}>
                  {faster === 'r2' ? (
                    <p style={{ color: 'var(--text-primary)' }}>
                      <span className="font-semibold" style={{ color: '#22c55e' }}>R2 CDN</span> is{' '}
                      <span className="font-semibold">{speedup}% faster</span> than Internet Archive
                      <span className="text-sm ml-2" style={{ color: 'var(--text-muted)' }}>
                        ({formatDuration(r2.avg)} vs {formatDuration(ia.avg)})
                      </span>
                    </p>
                  ) : (
                    <p style={{ color: 'var(--text-primary)' }}>
                      <span className="font-semibold" style={{ color: '#f59e0b' }}>Internet Archive</span> is{' '}
                      <span className="font-semibold">{Math.abs(Number(speedup))}% faster</span> than R2 CDN
                      <span className="text-sm ml-2" style={{ color: 'var(--text-muted)' }}>
                        ({formatDuration(ia.avg)} vs {formatDuration(r2.avg)})
                      </span>
                    </p>
                  )}
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {perfData?.stats && perfData.stats.length > 0 ? (
        <>
          <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
            Performance Metrics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {perfData.stats.map((stat) => (
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
          {perfData.recentSamples && perfData.recentSamples.length > 0 && (
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
                    {perfData.recentSamples.map((sample, i) => (
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
        </>
      ) : (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No performance data yet</p>
          <p className="text-sm mt-1">Metrics will appear here as the site is used</p>
        </div>
      )}
    </div>
  );
}

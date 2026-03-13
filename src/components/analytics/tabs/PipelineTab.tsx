'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Clock, AlertTriangle, XCircle, BarChart3 } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import type { PipelineData } from '@/lib/api-client/types/analytics';
import { formatDuration } from '../shared/formatters';
import { MultiLineChart } from '../charts/MultiLineChart';
import { compactNumber, dateLabel } from '../charts/chart-utils';

/** Safely render error values that may be objects like {message: "..."} */
const errorText = (e: unknown): string =>
  typeof e === 'string' ? e : (e as any)?.message || JSON.stringify(e);

interface PipelineTabProps {
  hours: number;
}

export default function PipelineTab({ hours }: PipelineTabProps) {
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analytics.pipeline(hours).then(setPipelineData).finally(() => setLoading(false));
  }, [hours]);

  if (loading) return <div className="py-12"><BookLoader size="xs" /></div>;

  if (!pipelineData) {
    return (
      <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
        <p>No pipeline data available</p>
        <p className="text-sm mt-1">Pipeline observability data will appear after the post-import-pipeline cron runs</p>
      </div>
    );
  }

  // Build velocity chart from snapshots
  const velocityChart = (() => {
    if (!pipelineData.snapshots || pipelineData.snapshots.length < 2) return null;
    const sorted = [...pipelineData.snapshots].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const labels = sorted.map(s => dateLabel(s.timestamp));
    const ocrData = sorted.map(s => s.pages?.ocr ?? 0);
    const transData = sorted.map(s => s.pages?.translated ?? 0);
    return { labels, ocrData, transData };
  })();

  return (
    <div className="space-y-8">
      {/* Velocity Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #f0fdf4)', border: '1px solid var(--border-light)' }}>
          <div className="text-sm font-medium uppercase mb-1" style={{ color: 'var(--text-muted)' }}>OCR Velocity</div>
          <div className="text-3xl font-bold" style={{ color: 'var(--accent-sage-dark)' }}>
            {pipelineData.velocity?.ocr_per_hour || 0}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>pages / hour</div>
        </div>
        <div className="p-5 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #fef2f2)', border: '1px solid var(--border-light)' }}>
          <div className="text-sm font-medium uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Translation Velocity</div>
          <div className="text-3xl font-bold" style={{ color: 'var(--accent-rust)' }}>
            {pipelineData.velocity?.translate_per_hour || 0}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>pages / hour</div>
        </div>
        <div className="p-5 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #faf5ff)', border: '1px solid var(--border-light)' }}>
          <div className="text-sm font-medium uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Books Completing</div>
          <div className="text-3xl font-bold" style={{ color: 'var(--accent-violet)' }}>
            {pipelineData.velocity?.books_completing_per_day || 0}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>per day</div>
        </div>
        <div className="p-5 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #fffbeb)', border: '1px solid var(--border-light)' }}>
          <div className="text-sm font-medium uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Data Window</div>
          <div className="text-3xl font-bold" style={{ color: 'var(--accent-gold-dark)' }}>
            {pipelineData.velocity?.period_hours || 0}h
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {pipelineData.snapshots?.length || 0} snapshots
          </div>
        </div>
      </div>

      {/* OCR + Translation Velocity Chart */}
      {velocityChart && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            OCR & Translation Progress Over Time
          </h2>
          <MultiLineChart
            series={[
              { label: 'OCR Pages', data: velocityChart.ocrData, color: 'var(--accent-sage)' },
              { label: 'Translated Pages', data: velocityChart.transData, color: 'var(--accent-rust)' },
            ]}
            labels={velocityChart.labels}
            yLabel={compactNumber}
          />
        </div>
      )}

      {/* Stall Detection */}
      {pipelineData.stalls && pipelineData.stalls.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <AlertTriangle className="w-5 h-5" style={{ color: '#f59e0b' }} />
            Pipeline Stage Changes
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pipelineData.stalls.map((stall, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-lg"
                style={{
                  background: stall.direction === 'growing' ? '#fef2f2' : stall.direction === 'shrinking' ? '#f0fdf4' : 'var(--bg-warm)',
                  border: `1px solid ${stall.direction === 'growing' ? '#fecaca' : stall.direction === 'shrinking' ? '#bbf7d0' : 'var(--border-light)'}`,
                }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {stall.stage.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {stall.current} books
                  </div>
                </div>
                <div
                  className="text-sm font-bold"
                  style={{
                    color: stall.direction === 'growing' ? '#dc2626' : stall.direction === 'shrinking' ? '#16a34a' : 'var(--text-muted)',
                  }}
                >
                  {stall.delta > 0 ? '+' : ''}{stall.delta}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cron Health */}
      {pipelineData.cronHealth && Object.keys(pipelineData.cronHealth).length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Clock className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
            Cron Health
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-light)' }}>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--text-muted)' }}>Cron</th>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--text-muted)' }}>Last Run</th>
                  <th className="text-right py-2 pr-4 font-medium" style={{ color: 'var(--text-muted)' }}>Duration</th>
                  <th className="text-right py-2 pr-4 font-medium" style={{ color: 'var(--text-muted)' }}>Runs</th>
                  <th className="text-right py-2 pr-4 font-medium" style={{ color: 'var(--text-muted)' }}>Failures</th>
                  <th className="text-right py-2 font-medium" style={{ color: 'var(--text-muted)' }}>Avg Duration</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(pipelineData.cronHealth).map(([name, health]) => {
                  const timeSince = health.lastRun
                    ? Math.round((Date.now() - new Date(health.lastRun).getTime()) / 60000)
                    : null;
                  return (
                    <tr key={name} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="py-2.5 pr-4 font-medium" style={{ color: 'var(--text-primary)' }}>{name}</td>
                      <td className="py-2.5 pr-4" style={{ color: 'var(--text-muted)' }}>
                        {timeSince !== null ? (
                          <span title={new Date(health.lastRun!).toLocaleString()}>
                            {timeSince < 60 ? `${timeSince}m ago` : `${Math.round(timeSince / 60)}h ago`}
                          </span>
                        ) : 'Never'}
                      </td>
                      <td className="py-2.5 pr-4 text-right" style={{ color: 'var(--text-secondary)' }}>
                        {formatDuration(health.lastDuration)}
                      </td>
                      <td className="py-2.5 pr-4 text-right" style={{ color: 'var(--text-secondary)' }}>
                        {health.runsInPeriod}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <span style={{ color: health.failures > 0 ? '#dc2626' : '#16a34a', fontWeight: health.failures > 0 ? 600 : 400 }}>
                          {health.failures}
                        </span>
                      </td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>
                        {formatDuration(health.avgDuration)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Show recent errors if any */}
          {Object.entries(pipelineData.cronHealth).some(([, h]) => h.recentErrors?.length > 0) && (
            <div className="mt-4 p-3 rounded-lg" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
              <div className="text-sm font-medium mb-2" style={{ color: '#dc2626' }}>Recent Cron Errors</div>
              {Object.entries(pipelineData.cronHealth)
                .filter(([, h]) => h.recentErrors?.length > 0)
                .map(([name, h]) => (
                  <div key={name} className="text-xs mb-1" style={{ color: '#7f1d1d' }}>
                    <span className="font-medium">{name}:</span> {errorText(h.recentErrors[0])}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Recent AI Errors */}
      {pipelineData.recentErrors && pipelineData.recentErrors.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <XCircle className="w-5 h-5" style={{ color: '#ef4444' }} />
            Recent AI Errors (last 6h)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-light)' }}>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--text-muted)' }}>Type</th>
                  <th className="text-left py-2 pr-4 font-medium" style={{ color: 'var(--text-muted)' }}>Category</th>
                  <th className="text-right py-2 pr-4 font-medium" style={{ color: 'var(--text-muted)' }}>Count</th>
                  <th className="text-left py-2 font-medium" style={{ color: 'var(--text-muted)' }}>Last Error</th>
                </tr>
              </thead>
              <tbody>
                {pipelineData.recentErrors.map((err, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="py-2.5 pr-4 font-medium" style={{ color: 'var(--text-primary)' }}>{err.type}</td>
                    <td className="py-2.5 pr-4">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          background: err.category === 'rate_limit' ? '#fef3c7' : err.category === 'safety_filter' ? '#fce7f3' : '#fee2e2',
                          color: err.category === 'rate_limit' ? '#92400e' : err.category === 'safety_filter' ? '#9d174d' : '#991b1b',
                        }}
                      >
                        {err.category}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-bold" style={{ color: '#dc2626' }}>{err.count}</td>
                    <td className="py-2.5 text-xs truncate max-w-xs" style={{ color: 'var(--text-muted)' }}>{errorText(err.lastError)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Needs Attention Books */}
      {pipelineData.needsAttention && pipelineData.needsAttention.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <AlertTriangle className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
            Books Needing Attention ({pipelineData.needsAttention.length})
          </h2>
          <div className="space-y-3">
            {pipelineData.needsAttention.map((book) => (
              <div
                key={book.id}
                className="flex items-start justify-between p-3 rounded-lg"
                style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`https://sourcelibrary.org/book/${book.id}`}
                    target="_blank"
                    className="font-medium text-sm hover:underline truncate block"
                    style={{ color: 'var(--accent-rust)' }}
                  >
                    {book.title}
                  </Link>
                  <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>{book.language}</span>
                    <span>{book.ocr}/{book.pages} OCR</span>
                    <span>{book.translated}/{book.pages} translated</span>
                    {book.provider && <span className="capitalize">{book.provider}</span>}
                    {book.retryCount > 0 && (
                      <span style={{ color: '#dc2626' }}>{book.retryCount} retries</span>
                    )}
                  </div>
                  {book.error && (
                    <div className="text-xs mt-1 truncate" style={{ color: '#dc2626' }}>{errorText(book.error)}</div>
                  )}
                </div>
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium ml-3 shrink-0"
                  style={{
                    background: book.status === 'failed' ? '#fee2e2' : '#fef3c7',
                    color: book.status === 'failed' ? '#991b1b' : '#92400e',
                  }}
                >
                  {book.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No data hints */}
      {pipelineData.snapshots?.length === 0 && (
        <div className="p-4 rounded-lg text-sm" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>
          <p>No pipeline snapshots yet for this time window. Snapshots are recorded every 10 minutes by the post-import-pipeline cron.
          Try expanding the time range, or wait for the next cron run.</p>
        </div>
      )}
    </div>
  );
}

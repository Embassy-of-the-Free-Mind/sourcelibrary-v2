'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Clock, AlertTriangle, XCircle, BarChart3, Layers, Image } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import type { PipelineData } from '@/lib/api-client/types/analytics';
import { formatDuration } from '../shared/formatters';
import { MultiLineChart } from '../charts/MultiLineChart';
import { compactNumber, dateLabel } from '../charts/chart-utils';

/** Safely render error values that may be objects like {message: "..."} */
const errorText = (e: unknown): string =>
  typeof e === 'string' ? e : (e as any)?.message || JSON.stringify(e);

/** Smart x-axis label: time-only for <2d, date+time for 2-7d, date-only for >7d */
function smartLabel(iso: string, hours: number): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (hours <= 48) return `${hh}:${mm}`;
  if (hours <= 168) return `${months[d.getMonth()]} ${d.getDate()} ${hh}:00`;
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

/** Relative time ago string */
function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Small muted source label */
function SourceLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs ml-2 font-normal" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
      {children}
    </span>
  );
}

interface PipelineTabProps {
  hours: number;
}

export default function PipelineTab({ hours }: PipelineTabProps) {
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setLoading(true);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 3000);
    analytics.pipeline(hours).then(setPipelineData).finally(() => { setLoading(false); clearTimeout(timer); });
    return () => clearTimeout(timer);
  }, [hours]);

  if (loading) return (
    <div className="py-12">
      <div className="w-full h-1.5 rounded-full overflow-hidden mb-4" style={{ background: 'var(--bg-warm)' }}>
        <div className="h-full rounded-full animate-loading-bar" style={{ background: 'var(--accent-sage)', width: '40%' }} />
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(-100%); }
        }
        .animate-loading-bar { animation: loading-bar 2s ease-in-out infinite; }
      `}</style>
      <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        {slow ? 'Still loading — pipeline queries can be slow on Atlas...' : 'Loading pipeline data...'}
      </p>
    </div>
  );

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
    const labels = sorted.map(s => smartLabel(s.timestamp, hours));
    const ocrData = sorted.map(s => s.pages?.ocr ?? 0);
    const transData = sorted.map(s => s.pages?.translated ?? 0);
    return { labels, ocrData, transData };
  })();

  // Translation progress bar
  const ec = pipelineData.enrichmentCoverage;
  const translateRate = pipelineData.velocity?.translate_per_hour || 0;
  const progressBar = ec && ec.ocr > 0 ? (() => {
    const pct = Math.min(100, Math.round((ec.translation / ec.ocr) * 100));
    const fullyDone = ec.pipelineComplete || 0;
    const fullyPct = Math.min(100, Math.round((fullyDone / ec.ocr) * 100));
    // Rough ETA: assume ~140 pages/book average remaining, times books needing translation
    const booksRemaining = ec.ocr - ec.translation;
    const pagesEstimate = booksRemaining * 140;
    const etaHours = translateRate > 0 ? Math.round(pagesEstimate / translateRate) : 0;
    const etaDays = Math.round(etaHours / 24 * 10) / 10;
    return { pct, fullyPct, fullyDone, booksRemaining, etaHours, etaDays };
  })() : null;

  return (
    <div className="space-y-8">
      {/* Translation Progress */}
      {progressBar && (
        <div className="p-5 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="flex justify-between items-baseline mb-2">
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Translation Progress
              {pipelineData._meta?.snapshotComputedAt && (
                <SourceLabel>snapshot {timeAgo(pipelineData._meta.snapshotComputedAt)}</SourceLabel>
              )}
            </div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {ec!.translation.toLocaleString()} / {ec!.ocr.toLocaleString()} books with OCR
              {progressBar.etaDays > 0 && translateRate > 0 && (
                <span> &middot; ~{progressBar.etaDays < 1 ? `${progressBar.etaHours}h` : `${progressBar.etaDays}d`} remaining at {translateRate.toLocaleString()}/hr</span>
              )}
            </div>
          </div>
          <div className="w-full h-4 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressBar.pct}%`,
                background: 'linear-gradient(90deg, var(--accent-sage), var(--accent-sage-dark))',
              }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{progressBar.pct}% have translation</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{progressBar.fullyDone.toLocaleString()} pipeline complete ({progressBar.fullyPct}%)</span>
          </div>
        </div>
      )}

      {/* Velocity Cards */}
      {pipelineData._meta?.snapshotRange && (
        <div className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
          Velocity computed from {pipelineData._meta.snapshotCount} snapshots
          ({timeAgo(pipelineData._meta.snapshotRange.from)} to {timeAgo(pipelineData._meta.snapshotRange.to)})
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
          <div className="text-sm font-medium uppercase mb-1" style={{ color: 'var(--text-muted)' }}>First Translations</div>
          <div className="text-3xl font-bold" style={{ color: 'var(--accent-gold-dark)' }}>
            {(pipelineData.milestones?.firstTranslations || 0).toLocaleString()}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>into English</div>
        </div>
        <div className="p-5 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #fdf4ff)', border: '1px solid var(--border-light)' }}>
          <div className="text-sm font-medium uppercase mb-1" style={{ color: 'var(--text-muted)' }}>&gt;90% Translated</div>
          <div className="text-3xl font-bold" style={{ color: '#a855f7' }}>
            {(pipelineData.milestones?.nearComplete || 0).toLocaleString()}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>books</div>
        </div>
      </div>

      {/* Pipeline Funnel */}
      {pipelineData.funnel && Object.keys(pipelineData.funnel).length > 0 && (() => {
        const statusOrder = [
          'queued', 'archiving', 'archive_complete',
          'ocr_submitted', 'ocr_complete',
          'metadata_enriched', 'ft_verifying', 'ft_verified',
          'translate_submitted', 'translate_partial', 'translate_complete',
          'enriching', 'enriched', 'chapters', 'chapters_complete',
          'images_submitted', 'images_complete', 'visual_complete',
          'cover_selected',
          'complete',
          'paused', 'empty_shell', 'not_digitized',
          'replaced_by_alt_import', 'replaced_by_ia_import', 'duplicate_empty_shell',
          'needs_attention', 'failed',
        ];
        const sorted = statusOrder
          .filter(s => pipelineData.funnel![s])
          .map(s => ({ status: s, count: pipelineData.funnel![s] }));
        // Add any statuses not in our known list
        for (const [status, count] of Object.entries(pipelineData.funnel!)) {
          if (!statusOrder.includes(status)) sorted.push({ status, count });
        }
        const maxCount = Math.max(...sorted.map(s => s.count));

        const statusColors: Record<string, string> = {
          queued: '#94a3b8', archiving: '#94a3b8', archive_complete: '#94a3b8',
          ocr_submitted: '#3b82f6', ocr_complete: '#3b82f6',
          metadata_enriched: '#8b5cf6', ft_verifying: '#8b5cf6', ft_verified: '#8b5cf6',
          translate_submitted: '#f59e0b', translate_complete: '#f59e0b',
          enriching: '#10b981', enriched: '#10b981',
          chapters: '#06b6d4', chapters_complete: '#06b6d4',
          images_submitted: '#ec4899', images_complete: '#ec4899', visual_complete: '#ec4899',
          cover_selected: '#a855f7',
          complete: '#16a34a',
          paused: '#94a3b8', empty_shell: '#94a3b8', not_digitized: '#94a3b8',
          replaced_by_alt_import: '#64748b', replaced_by_ia_import: '#64748b', duplicate_empty_shell: '#64748b',
          needs_attention: '#dc2626', failed: '#dc2626',
        };

        return (
          <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Layers className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
              Pipeline Funnel
              {pipelineData._meta?.snapshotComputedAt && (
                <SourceLabel>snapshot {timeAgo(pipelineData._meta.snapshotComputedAt)}</SourceLabel>
              )}
            </h2>
            <div className="space-y-1.5">
              {sorted.map(({ status, count }) => (
                <div key={status} className="flex items-center gap-3">
                  <div className="w-40 text-xs font-medium truncate text-right" style={{ color: 'var(--text-muted)' }}>
                    {status.replace(/_/g, ' ')}
                  </div>
                  <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(1, (count / maxCount) * 100)}%`,
                        background: statusColors[status] || '#6b7280',
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <div className="w-16 text-xs font-bold text-right" style={{ color: 'var(--text-secondary)' }}>
                    {count.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Enrichment Coverage */}
      {pipelineData.enrichmentCoverage && (() => {
        const cov = pipelineData.enrichmentCoverage;
        const total = cov.total;
        if (total === 0) return null;

        const phases = [
          { label: 'OCR', count: cov.ocr, color: '#3b82f6' },
          { label: 'Translation', count: cov.translation, color: '#f59e0b' },
          { label: 'Metadata Enrichment', count: cov.metadata, color: '#8b5cf6' },
          { label: 'First-Translation Check', count: cov.ftVerification, color: '#a855f7' },
          { label: 'Summary & Index', count: cov.summary, color: '#10b981' },
          { label: 'Chapters', count: cov.chapters, color: '#06b6d4' },
          { label: 'Collection Classification', count: cov.collections, color: '#0891b2' },
          { label: 'Quality Score', count: cov.qualityScore, color: '#14b8a6' },
          { label: 'Image Extraction', count: cov.imageExtraction, color: '#ec4899' },
          { label: 'Faceted Tags', count: cov.facetedTags, color: '#f97316' },
          { label: 'Author Entity Linking', count: cov.authorEntity, color: '#64748b' },
          { label: 'Pipeline Complete', count: cov.pipelineComplete, color: '#16a34a' },
        ];

        return (
          <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-lg font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Image className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
              Enrichment Coverage
              {pipelineData._meta?.snapshotComputedAt && (
                <SourceLabel>snapshot {timeAgo(pipelineData._meta.snapshotComputedAt)}</SourceLabel>
              )}
            </h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              {total.toLocaleString()} books with pages &middot; {cov.galleryImages.toLocaleString()} gallery images
            </p>
            <div className="space-y-2.5">
              {phases.map(({ label, count, color }) => {
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={label} className="flex items-center gap-3">
                    <div className="w-44 text-xs font-medium text-right" style={{ color: 'var(--text-muted)' }}>
                      {label}
                    </div>
                    <div className="flex-1 h-5 rounded-full overflow-hidden relative" style={{ background: 'var(--bg-warm)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(1, pct)}%`, background: color, opacity: 0.75 }}
                      />
                    </div>
                    <div className="w-24 text-xs text-right" style={{ color: 'var(--text-secondary)' }}>
                      <span className="font-bold">{count.toLocaleString()}</span>
                      <span className="ml-1" style={{ color: 'var(--text-muted)' }}>({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* OCR + Translation Velocity Chart */}
      {velocityChart && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            OCR & Translation Progress Over Time
            <SourceLabel>pipeline_snapshots</SourceLabel>
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

      {/* Throughput Rate Chart (pages/hr) */}
      {(() => {
        if (!pipelineData.snapshots || pipelineData.snapshots.length < 3) return null;
        const sorted = [...pipelineData.snapshots].sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const labels: string[] = [];
        const ocrRate: number[] = [];
        const transRate: number[] = [];

        for (let i = 1; i < sorted.length; i++) {
          const dt = (new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime()) / 3600000;
          if (dt < 0.01) continue;
          labels.push(smartLabel(sorted[i].timestamp, hours));
          ocrRate.push(Math.max(0, Math.round(((sorted[i].pages?.ocr ?? 0) - (sorted[i - 1].pages?.ocr ?? 0)) / dt)));
          transRate.push(Math.max(0, Math.round(((sorted[i].pages?.translated ?? 0) - (sorted[i - 1].pages?.translated ?? 0)) / dt)));
        }

        if (labels.length < 2) return null;

        return (
          <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
              Pipeline Throughput (pages/hr)
              <SourceLabel>pipeline_snapshots</SourceLabel>
            </h2>
            <MultiLineChart
              series={[
                { label: 'OCR', data: ocrRate, color: 'var(--accent-sage)' },
                { label: 'Translation', data: transRate, color: 'var(--accent-rust)' },
              ]}
              labels={labels}
              yLabel={compactNumber}
            />
          </div>
        );
      })()}

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
            <SourceLabel>cron_runs ({pipelineData._meta?.cronRunsCount || 0} entries)</SourceLabel>
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
            <SourceLabel>gemini_usage</SourceLabel>
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
            <SourceLabel>live query</SourceLabel>
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

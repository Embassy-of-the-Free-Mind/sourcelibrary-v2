'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, RefreshCw, Activity, Zap, Clock, CheckCircle,
  AlertTriangle, Cpu, BookOpen, ExternalLink, Pause, Play,
} from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

interface ActiveJob {
  id: string;
  type: string;
  status: string;
  bookId: string;
  bookTitle: string;
  progress: { total: number; completed: number; failed: number };
  model?: string;
  language?: string;
  createdAt: string;
  updatedAt: string;
}

interface BatchJob {
  id: string;
  type: string;
  status: string;
  bookId: string;
  pageCount: number;
  model?: string;
  progress?: { total: number; completed: number; failed: number };
  createdAt: string;
}

interface HourlyType {
  type: string;
  count: number;
  cost: number;
}

interface PipelineStatus {
  status: string;
  count: number;
}

interface RecentCall {
  type: string;
  status: string;
  bookId: string;
  model?: string;
  cost?: number;
  timestamp: string;
}

interface Completion {
  id: string;
  title: string;
  completedAt: string;
  pages: number;
}

interface ThroughputMinute {
  minute: string;
  [type: string]: string | number;
}

interface DashboardData {
  timestamp: string;
  activeJobs: ActiveJob[];
  activeBatchJobs: BatchJob[];
  hourly: { byType: HourlyType[]; totalCalls: number; totalCost: number };
  throughput: ThroughputMinute[];
  pipelineFunnel: PipelineStatus[];
  recentActivity: RecentCall[];
  recentCompletions: Completion[];
}

const REFRESH_MS = 15_000;

const TYPE_COLORS: Record<string, string> = {
  ocr: 'var(--accent-sage)',
  translate: 'var(--accent-rust)',
  translation: 'var(--accent-rust)',
  index: 'var(--accent-gold)',
  summarize: 'var(--accent-violet)',
  summary: 'var(--accent-violet)',
  extract_chapters: 'var(--accent-gold)',
  extract_images: 'var(--accent-gold)',
  image_extraction: 'var(--accent-gold)',
};

const PIPELINE_ORDER = [
  'queued', 'archiving', 'archive_complete',
  'ocr_submitted', 'ocr_complete',
  'metadata_enriched',
  'translate_submitted', 'translate_complete',
  'enriching', 'enriched',
  'chapters', 'chapters_complete',
  'images_submitted', 'images_complete',
  'complete', 'failed', 'needs_attention',
];

export default function RealtimeDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/realtime');
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Realtime fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(fetchData, REFRESH_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData, paused]);

  const totalActivePages = data?.activeJobs.reduce((s, j) => s + (j.progress?.total || 0), 0) || 0;
  const totalCompletedPages = data?.activeJobs.reduce((s, j) => s + (j.progress?.completed || 0), 0) || 0;
  const totalFailedPages = data?.activeJobs.reduce((s, j) => s + (j.progress?.failed || 0), 0) || 0;

  // Sort pipeline funnel by defined order
  const sortedFunnel = data?.pipelineFunnel
    .filter(s => s.status !== 'complete' && s.status !== 'failed')
    .sort((a, b) => PIPELINE_ORDER.indexOf(a.status) - PIPELINE_ORDER.indexOf(b.status)) || [];
  const completedCount = data?.pipelineFunnel.find(s => s.status === 'complete')?.count || 0;
  const failedCount = data?.pipelineFunnel.find(s => s.status === 'failed')?.count || 0;
  const needsAttention = data?.pipelineFunnel.find(s => s.status === 'needs_attention')?.count || 0;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-20 px-4 py-3 border-b"
        style={{ background: 'var(--bg-cream)', borderColor: 'var(--border-light)' }}
      >
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <Link href="/admin/processing" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <Activity className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
            <h1 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
              Live Pipeline
            </h1>
            {!paused && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--accent-sage)' }} />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: 'var(--accent-sage)' }} />
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => setPaused(p => !p)}
              className="p-1.5 rounded"
              style={{ color: paused ? 'var(--accent-rust)' : 'var(--text-muted)' }}
              title={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
            >
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-1.5 rounded"
              style={{ color: 'var(--text-muted)' }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {!data ? (
        <div className="py-24"><BookLoader size="xs" /></div>
      ) : (
        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          {/* Top stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Active Jobs"
              value={data.activeJobs.length + data.activeBatchJobs.length}
              sub={`${data.activeJobs.length} realtime + ${data.activeBatchJobs.length} batch`}
              icon={<Cpu className="w-4 h-4" />}
              color="var(--accent-rust)"
            />
            <StatCard
              label="Pages in Flight"
              value={totalActivePages.toLocaleString()}
              sub={`${totalCompletedPages.toLocaleString()} done, ${totalFailedPages} failed`}
              icon={<Zap className="w-4 h-4" />}
              color="var(--accent-gold)"
            />
            <StatCard
              label="Last Hour"
              value={data.hourly.totalCalls.toLocaleString()}
              sub={`$${data.hourly.totalCost.toFixed(3)} spent`}
              icon={<Clock className="w-4 h-4" />}
              color="var(--accent-sage)"
            />
            <StatCard
              label="Pipeline Queue"
              value={sortedFunnel.reduce((s, f) => s + f.count, 0).toLocaleString()}
              sub={`${completedCount.toLocaleString()} complete, ${failedCount} failed`}
              icon={<BookOpen className="w-4 h-4" />}
              color="var(--accent-violet)"
            />
          </div>

          {/* Hourly breakdown */}
          {data.hourly.byType.length > 0 && (
            <Section title="Last Hour by Type">
              <div className="flex flex-wrap gap-2">
                {data.hourly.byType
                  .filter(t => t.count > 0)
                  .sort((a, b) => b.count - a.count)
                  .map(t => (
                    <div
                      key={t.type}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                      style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: TYPE_COLORS[t.type] || 'var(--text-muted)' }}
                      />
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t.count.toLocaleString()}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {t.type}
                      </span>
                      {t.cost > 0 && (
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          ${t.cost.toFixed(3)}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </Section>
          )}

          {/* Active Lambda jobs */}
          {data.activeJobs.length > 0 && (
            <Section title={`Active Jobs (${data.activeJobs.length})`}>
              <div className="space-y-2">
                {data.activeJobs.map(job => (
                  <JobRow key={job.id} job={job} />
                ))}
              </div>
            </Section>
          )}

          {/* Active batch jobs */}
          {data.activeBatchJobs.length > 0 && (
            <Section title={`Batch Jobs (${data.activeBatchJobs.length})`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data.activeBatchJobs.map(job => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}
                  >
                    <div className="flex items-center gap-2">
                      <TypeBadge type={job.type} />
                      <span className="text-sm truncate" style={{ color: 'var(--text-primary)', maxWidth: '200px' }}>
                        {job.bookId?.slice(0, 12)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>{job.pageCount} pages</span>
                      <span
                        className="px-1.5 py-0.5 rounded"
                        style={{
                          background: job.status.includes('RUNNING') || job.status === 'processing'
                            ? 'color-mix(in srgb, var(--accent-sage) 15%, transparent)'
                            : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                          color: job.status.includes('RUNNING') || job.status === 'processing'
                            ? 'var(--accent-sage)'
                            : 'var(--text-muted)',
                        }}
                      >
                        {job.status.replace('JOB_STATE_', '').toLowerCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Pipeline funnel */}
          <Section title="Pipeline Funnel">
            <div className="space-y-1">
              {sortedFunnel.map(s => {
                const maxCount = Math.max(...sortedFunnel.map(f => f.count));
                const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                const isActive = s.status.includes('submitted') || s.status === 'archiving' || s.status === 'enriching' || s.status === 'chapters';
                return (
                  <div key={s.status} className="flex items-center gap-3">
                    <span
                      className="text-xs w-40 text-right truncate"
                      style={{
                        color: s.status === 'needs_attention' ? 'var(--accent-rust)' : 'var(--text-muted)',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {s.status.replace(/_/g, ' ')}
                      {isActive && ' ...'}
                    </span>
                    <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                      <div
                        className="h-full rounded transition-all"
                        style={{
                          width: `${Math.max(pct, 1)}%`,
                          background: isActive
                            ? 'var(--accent-sage)'
                            : s.status === 'needs_attention'
                              ? 'var(--accent-rust)'
                              : 'var(--border-medium)',
                        }}
                      />
                    </div>
                    <span
                      className="text-xs tabular-nums w-12 text-right"
                      style={{ color: 'var(--text-secondary)', fontWeight: isActive ? 600 : 400 }}
                    >
                      {s.count.toLocaleString()}
                    </span>
                  </div>
                );
              })}
              {/* Terminal states */}
              <div className="flex items-center gap-3 pt-2 mt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
                <span className="text-xs w-40 text-right" style={{ color: 'var(--accent-sage)' }}>
                  <CheckCircle className="w-3 h-3 inline mr-1" />complete
                </span>
                <span className="text-sm tabular-nums" style={{ color: 'var(--accent-sage)' }}>
                  {completedCount.toLocaleString()}
                </span>
                {failedCount > 0 && (
                  <>
                    <span className="text-xs" style={{ color: 'var(--accent-rust)' }}>
                      <AlertTriangle className="w-3 h-3 inline mr-1" />failed
                    </span>
                    <span className="text-sm tabular-nums" style={{ color: 'var(--accent-rust)' }}>
                      {failedCount}
                    </span>
                  </>
                )}
                {needsAttention > 0 && (
                  <>
                    <span className="text-xs" style={{ color: 'var(--accent-rust)' }}>
                      needs attention
                    </span>
                    <span className="text-sm tabular-nums" style={{ color: 'var(--accent-rust)' }}>
                      {needsAttention}
                    </span>
                  </>
                )}
              </div>
            </div>
          </Section>

          {/* Throughput sparkline (last 30 min) */}
          {data.throughput.length > 0 && (
            <Section title="Throughput (last 30 min)">
              <div className="flex items-end gap-px h-16">
                {data.throughput.map((m, i) => {
                  const total = Object.entries(m)
                    .filter(([k]) => k !== 'minute')
                    .reduce((s, [, v]) => s + (typeof v === 'number' ? v : 0), 0);
                  const maxTotal = Math.max(
                    ...data.throughput.map(t =>
                      Object.entries(t)
                        .filter(([k]) => k !== 'minute')
                        .reduce((s, [, v]) => s + (typeof v === 'number' ? v : 0), 0)
                    )
                  );
                  const height = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t transition-all relative group"
                      style={{
                        height: `${Math.max(height, 3)}%`,
                        background: 'var(--accent-sage)',
                        opacity: 0.6 + (height / 100) * 0.4,
                        minWidth: '4px',
                      }}
                      title={`${m.minute}: ${total} calls`}
                    >
                      <div
                        className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] hidden group-hover:block whitespace-nowrap px-1 rounded"
                        style={{ background: 'var(--bg-dark)', color: 'white' }}
                      >
                        {m.minute} &middot; {total}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {data.throughput[0]?.minute}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  {data.throughput[data.throughput.length - 1]?.minute}
                </span>
              </div>
            </Section>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recent completions */}
            {data.recentCompletions.length > 0 && (
              <Section title="Recently Completed">
                <div className="space-y-1.5">
                  {data.recentCompletions.map(b => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between px-3 py-1.5 rounded"
                      style={{ background: 'var(--bg-warm)' }}
                    >
                      <a
                        href={`https://sourcelibrary.org/book/${b.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm truncate hover:underline flex items-center gap-1"
                        style={{ color: 'var(--accent-sage)', maxWidth: '250px' }}
                      >
                        <CheckCircle className="w-3 h-3 flex-shrink-0" />
                        {b.title}
                      </a>
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {b.pages}p &middot; {timeAgo(b.completedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Activity feed */}
            <Section title="Activity Feed (5 min)">
              {data.recentActivity.length === 0 ? (
                <p className="text-sm py-4 text-center" style={{ color: 'var(--text-faint)' }}>
                  No activity in last 5 minutes
                </p>
              ) : (
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {data.recentActivity.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1 text-xs rounded"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{
                          background: a.status === 'success'
                            ? (TYPE_COLORS[a.type] || 'var(--accent-sage)')
                            : 'var(--accent-rust)',
                        }}
                      />
                      <span style={{ color: TYPE_COLORS[a.type] || 'var(--text-muted)' }}>
                        {a.type}
                      </span>
                      <span className="truncate" style={{ maxWidth: '120px' }}>
                        {a.bookId?.slice(0, 10)}
                      </span>
                      {a.cost != null && a.cost > 0 && (
                        <span style={{ color: 'var(--text-faint)' }}>${a.cost.toFixed(4)}</span>
                      )}
                      <span className="ml-auto" style={{ color: 'var(--text-faint)' }}>
                        {timeAgo(a.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </main>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--border-light)', background: 'white' }}
    >
      <h2 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatCard({
  label, value, sub, icon, color,
}: { label: string; value: string | number; sub: string; icon: React.ReactNode; color: string }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--border-light)', background: 'white' }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="text-2xl font-serif tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{sub}</div>
    </div>
  );
}

function JobRow({ job }: { job: ActiveJob }) {
  const pct = job.progress?.total > 0
    ? Math.round((job.progress.completed / job.progress.total) * 100)
    : 0;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg border"
      style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}
    >
      <TypeBadge type={job.type} />
      <a
        href={`https://sourcelibrary.org/book/${job.bookId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm truncate hover:underline flex items-center gap-1"
        style={{ color: 'var(--text-primary)', maxWidth: '280px' }}
        title={job.bookTitle}
      >
        {job.bookTitle || job.bookId}
        <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-30" />
      </a>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-light)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: job.progress?.failed > 0
                ? 'var(--accent-gold)'
                : 'var(--accent-sage)',
            }}
          />
        </div>
        <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
          {job.progress?.completed}/{job.progress?.total}
        </span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {pct}%
        </span>
        {job.progress?.failed > 0 && (
          <span className="text-xs" style={{ color: 'var(--accent-rust)' }}>
            {job.progress.failed} err
          </span>
        )}
      </div>
      {job.language && (
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--border-light)', color: 'var(--text-faint)' }}>
          {job.language}
        </span>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] || 'var(--text-muted)';
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {type.replace('_', ' ').slice(0, 5)}
    </span>
  );
}

function timeAgo(ts: string): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

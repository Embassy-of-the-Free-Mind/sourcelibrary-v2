'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, RefreshCw, Activity, Zap, Clock, AlertTriangle,
  Cpu, BookOpen, Pause, Play, CheckCircle, ExternalLink,
  RotateCcw, ArrowRight, ShieldAlert, Timer, SkipForward,
  Undo, ArrowDown, ArrowUp, TrendingUp,
} from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

// ─── Types ───────────────────────────────────────────────────────────────

interface RealtimeData {
  timestamp: string;
  activeJobs: { id: string; type: string; status: string; bookId: string; bookTitle: string; progress: { total: number; completed: number; failed: number } }[];
  activeBatchJobs: { id: string; type: string; status: string; bookId: string; pageCount: number; progress?: { total: number; completed: number; failed: number } }[];
  hourly: { byType: { type: string; count: number; cost: number }[]; totalCalls: number; totalCost: number };
  pipelineFunnel: { status: string; count: number }[];
}

interface PipelineData {
  velocity: { ocr_per_hour: number; translate_per_hour: number; books_completing_per_day: number; period_hours: number };
  cronHealth: Record<string, {
    lastRun: string | null;
    lastDuration: number;
    runsInPeriod: number;
    failures: number;
    avgDuration: number;
    recentErrors: string[];
  }>;
  stalls: { stage: string; direction: 'growing' | 'shrinking' | 'stalled'; delta: number; current: number }[];
  needsAttention: {
    id: string; title: string; language: string; pages: number;
    ocr: number; translated: number; status: string; error: string;
    lastUpdated: string; retryCount: number; provider: string;
  }[];
  recentErrors: { type: string; category: string; count: number; lastError: string; lastAt: string }[];
  recentDecisions: { cron: string; timestamp: string; type: string; reason: string; data?: Record<string, unknown> }[];
}

interface EnrollStatus {
  total_enrolled: number;
  unenrolled: number;
  status_counts: Record<string, number>;
  recent_failures: { id: string; title: string; error: string; retries: number }[];
}

// ─── Constants ───────────────────────────────────────────────────────────

const REFRESH_MS = 30_000;

const PIPELINE_ORDER = [
  'queued', 'archiving', 'archive_complete',
  'ocr_submitted', 'ocr_complete',
  'metadata_enriched',
  'translate_submitted', 'translate_partial', 'translate_complete',
  'summarizing', 'summary_indexed',
  'chapters', 'chapters_complete',
  'images_submitted', 'images_complete',
  'cover_selected',
  'complete', 'failed', 'needs_attention',
];

const DECISION_STYLES: Record<string, { color: string; icon: typeof SkipForward }> = {
  skip: { color: 'var(--text-muted)', icon: SkipForward },
  backpressure: { color: 'var(--accent-gold)', icon: Pause },
  time_budget: { color: 'var(--accent-violet)', icon: Timer },
  circuit_breaker: { color: 'var(--accent-rust)', icon: ShieldAlert },
  early_return: { color: 'var(--text-faint)', icon: ArrowRight },
  rollback: { color: 'var(--accent-rust)', icon: Undo },
};

// ─── Page ────────────────────────────────────────────────────────────────

export default function PipelineDashboard() {
  const [realtime, setRealtime] = useState<RealtimeData | null>(null);
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [rtRes, plRes] = await Promise.all([
        fetch('/api/admin/realtime'),
        fetch('/api/analytics/pipeline?hours=24'),
      ]);
      if (rtRes.ok) setRealtime(await rtRes.json());
      if (plRes.ok) setPipeline(await plRes.json());
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Pipeline fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(fetchData, REFRESH_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData, paused]);

  // ─── Action handlers ──────────────────────────────────────────────────

  async function handleEnroll(action: string, body: Record<string, unknown>) {
    setActionLoading(action);
    setActionResult(null);
    try {
      // Dry run first
      const dryRes = await fetch('/api/admin/enroll-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, dryRun: true }),
      });
      const dryData = await dryRes.json();

      if (dryData.wouldEnroll === 0) {
        setActionResult(`No books to ${action.replace(/_/g, ' ')}.`);
        setActionLoading(null);
        return;
      }

      if (!confirm(`${action.replace(/_/g, ' ')}: ${dryData.wouldEnroll} books. Proceed?`)) {
        setActionLoading(null);
        return;
      }

      const res = await fetch('/api/admin/enroll-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setActionResult(data.message || `Enrolled ${data.enrolled} books.`);
      fetchData();
    } catch (e) {
      setActionResult(`Error: ${e instanceof Error ? e.message : 'Unknown'}`);
    } finally {
      setActionLoading(null);
    }
  }

  // ─── Derived data ─────────────────────────────────────────────────────

  const sortedFunnel = realtime?.pipelineFunnel
    .filter(s => s.status !== 'complete')
    .sort((a, b) => PIPELINE_ORDER.indexOf(a.status) - PIPELINE_ORDER.indexOf(b.status)) || [];

  const completedCount = realtime?.pipelineFunnel.find(s => s.status === 'complete')?.count || 0;
  const failedCount = realtime?.pipelineFunnel.find(s => s.status === 'failed')?.count || 0;
  const needsAttentionCount = realtime?.pipelineFunnel.find(s => s.status === 'needs_attention')?.count || 0;
  const inFlightCount = sortedFunnel.filter(s => s.status !== 'failed' && s.status !== 'needs_attention').reduce((s, f) => s + f.count, 0);
  const activeJobCount = (realtime?.activeJobs.length || 0) + (realtime?.activeBatchJobs.length || 0);

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
              Pipeline Health
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

      {!realtime ? (
        <div className="py-24"><BookLoader size="xs" /></div>
      ) : (
        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

          {/* ── Status Overview Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Pipeline Queue"
              value={inFlightCount.toLocaleString()}
              sub={`${completedCount.toLocaleString()} complete`}
              icon={<BookOpen className="w-4 h-4" />}
              color="var(--accent-violet)"
            />
            <StatCard
              label="Failed / Attention"
              value={failedCount + needsAttentionCount}
              sub={`${failedCount} failed, ${needsAttentionCount} attention`}
              icon={<AlertTriangle className="w-4 h-4" />}
              color={failedCount + needsAttentionCount > 0 ? 'var(--accent-rust)' : 'var(--accent-sage)'}
            />
            <StatCard
              label="Active Jobs"
              value={activeJobCount}
              sub={`${realtime.activeJobs.length} realtime + ${realtime.activeBatchJobs.length} batch`}
              icon={<Cpu className="w-4 h-4" />}
              color="var(--accent-rust)"
            />
            <StatCard
              label="OCR Velocity"
              value={pipeline ? `${pipeline.velocity.ocr_per_hour}/hr` : '...'}
              sub={pipeline ? `${pipeline.velocity.translate_per_hour}/hr translate` : ''}
              icon={<Zap className="w-4 h-4" />}
              color="var(--accent-sage)"
            />
          </div>

          {/* ── Pipeline Funnel with Actions ── */}
          <Section title="Pipeline Funnel">
            <div className="space-y-1">
              {sortedFunnel.map(s => {
                const maxCount = Math.max(...sortedFunnel.map(f => f.count), 1);
                const pct = (s.count / maxCount) * 100;
                const isActive = s.status.includes('submitted') || s.status === 'archiving' || s.status === 'enriching' || s.status === 'chapters';
                const isFailed = s.status === 'failed';
                const isAttention = s.status === 'needs_attention';
                return (
                  <div key={s.status} className="flex items-center gap-3">
                    <span
                      className="text-xs w-40 text-right truncate"
                      style={{
                        color: isFailed || isAttention ? 'var(--accent-rust)' : 'var(--text-muted)',
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
                          background: isActive ? 'var(--accent-sage)'
                            : isFailed || isAttention ? 'var(--accent-rust)'
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
                    {isFailed && s.count > 0 && (
                      <button
                        onClick={() => handleEnroll('re-enroll_failed', { reEnrollFailed: true })}
                        disabled={actionLoading !== null}
                        className="text-[10px] px-2 py-0.5 rounded border whitespace-nowrap"
                        style={{ borderColor: 'var(--accent-rust)', color: 'var(--accent-rust)' }}
                      >
                        <RotateCcw className="w-3 h-3 inline mr-0.5" />re-enroll
                      </button>
                    )}
                  </div>
                );
              })}
              {/* Terminal: complete */}
              <div className="flex items-center gap-3 pt-2 mt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
                <span className="text-xs w-40 text-right" style={{ color: 'var(--accent-sage)' }}>
                  <CheckCircle className="w-3 h-3 inline mr-1" />complete
                </span>
                <span className="text-sm tabular-nums" style={{ color: 'var(--accent-sage)' }}>
                  {completedCount.toLocaleString()}
                </span>
              </div>
            </div>
          </Section>

          {/* ── Action Panel ── */}
          <Section title="Actions">
            <div className="flex flex-wrap gap-3">
              <ActionButton
                label="Re-enroll Failed"
                description="Reset all failed books back to queued"
                loading={actionLoading === 're-enroll_failed'}
                disabled={actionLoading !== null}
                onClick={() => handleEnroll('re-enroll_failed', { reEnrollFailed: true })}
                color="var(--accent-rust)"
              />
              <ActionButton
                label="Backfill Completed"
                description="Re-enroll completed books for chapters + images"
                loading={actionLoading === 'backfill_completed'}
                disabled={actionLoading !== null}
                onClick={() => handleEnroll('backfill_completed', { reEnrollCompleted: true, limit: 50 })}
                color="var(--accent-violet)"
              />
              <ActionButton
                label="Enroll Unenrolled"
                description="Add new books to the auto pipeline"
                loading={actionLoading === 'enroll_new'}
                disabled={actionLoading !== null}
                onClick={() => handleEnroll('enroll_new', { limit: 50 })}
                color="var(--accent-sage)"
              />
            </div>
            {actionResult && (
              <p className="text-sm mt-3 px-3 py-2 rounded" style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}>
                {actionResult}
              </p>
            )}
          </Section>

          {/* ── Two-column: Cron Health + Stalls ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Cron Health */}
            {pipeline && (
              <div className="lg:col-span-2">
                <Section title="Cron Health (24h)">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ color: 'var(--text-muted)' }}>
                          <th className="text-left py-1 pr-3">Cron</th>
                          <th className="text-right py-1 px-2">Last Run</th>
                          <th className="text-right py-1 px-2">Duration</th>
                          <th className="text-right py-1 px-2">Runs</th>
                          <th className="text-right py-1 px-2">Failures</th>
                          <th className="text-left py-1 pl-2">Recent Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(pipeline.cronHealth)
                          .sort(([, a], [, b]) => (b.failures || 0) - (a.failures || 0))
                          .map(([name, cron]) => (
                          <tr key={name} className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                            <td className="py-1.5 pr-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                              {name.replace(/-/g, ' ')}
                            </td>
                            <td className="py-1.5 px-2 text-right whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                              {cron.lastRun ? timeAgo(cron.lastRun) : 'never'}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                              {cron.avgDuration ? `${(cron.avgDuration / 1000).toFixed(1)}s` : '-'}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {cron.runsInPeriod}
                            </td>
                            <td
                              className="py-1.5 px-2 text-right tabular-nums"
                              style={{ color: cron.failures > 0 ? 'var(--accent-rust)' : 'var(--text-muted)' }}
                            >
                              {cron.failures}
                            </td>
                            <td className="py-1.5 pl-2 truncate max-w-[200px]" style={{ color: 'var(--text-faint)' }}>
                              {cron.recentErrors?.[0] ? String(cron.recentErrors[0]).slice(0, 80) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </div>
            )}

            {/* Stall Detection */}
            {pipeline && pipeline.stalls.length > 0 && (
              <Section title="Stall Detection">
                <div className="space-y-2">
                  {pipeline.stalls.map(s => (
                    <div key={s.stage} className="flex items-center gap-2">
                      {s.direction === 'growing' ? (
                        <ArrowUp className="w-3.5 h-3.5" style={{ color: 'var(--accent-rust)' }} />
                      ) : s.direction === 'shrinking' ? (
                        <ArrowDown className="w-3.5 h-3.5" style={{ color: 'var(--accent-sage)' }} />
                      ) : (
                        <TrendingUp className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      )}
                      <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>
                        {s.stage.replace(/_/g, ' ')}
                      </span>
                      <span
                        className="text-xs tabular-nums font-medium"
                        style={{ color: s.direction === 'growing' ? 'var(--accent-rust)' : 'var(--accent-sage)' }}
                      >
                        {s.delta > 0 ? '+' : ''}{s.delta}
                      </span>
                      <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
                        ({s.current})
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>

          {/* ── Cron Decisions Feed ── */}
          {pipeline && pipeline.recentDecisions.length > 0 && (
            <Section title={`Cron Decisions (${pipeline.recentDecisions.length})`}>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {pipeline.recentDecisions.map((d, i) => {
                  const style = DECISION_STYLES[d.type] || DECISION_STYLES.skip;
                  const Icon = style.icon;
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-2 px-3 py-1.5 rounded"
                      style={{ background: 'var(--bg-warm)' }}
                    >
                      <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: style.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{ color: style.color, background: `color-mix(in srgb, ${style.color} 12%, transparent)` }}
                          >
                            {d.type}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {d.cron?.replace(/-/g, ' ')}
                          </span>
                          <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                            {timeAgo(d.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                          {d.reason}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Two-column: Needs Attention + Recent Errors ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Needs Attention Books */}
            {pipeline && pipeline.needsAttention.length > 0 && (
              <Section title={`Needs Attention (${pipeline.needsAttention.length})`}>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {pipeline.needsAttention.map(book => (
                    <div
                      key={book.id}
                      className="px-3 py-2 rounded-lg border"
                      style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}
                    >
                      <div className="flex items-center justify-between">
                        <a
                          href={`https://sourcelibrary.org/book/${book.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm truncate hover:underline flex items-center gap-1"
                          style={{ color: 'var(--text-primary)', maxWidth: '280px' }}
                        >
                          {book.title}
                          <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-30" />
                        </a>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            color: book.status === 'failed' ? 'var(--accent-rust)' : 'var(--accent-gold)',
                            background: book.status === 'failed'
                              ? 'color-mix(in srgb, var(--accent-rust) 12%, transparent)'
                              : 'color-mix(in srgb, var(--accent-gold) 12%, transparent)',
                          }}
                        >
                          {book.status?.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        <span>{book.language}</span>
                        <span>OCR {book.ocr}/{book.pages}</span>
                        <span>Trans {book.translated}/{book.pages}</span>
                        {book.retryCount > 0 && <span>{book.retryCount} retries</span>}
                      </div>
                      {book.error && (
                        <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--accent-rust)' }}>
                          {book.error}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Recent AI Errors */}
            {pipeline && pipeline.recentErrors.length > 0 && (
              <Section title={`Recent Errors (6h)`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th className="text-left py-1 pr-2">Type</th>
                        <th className="text-left py-1 pr-2">Category</th>
                        <th className="text-right py-1 px-2">Count</th>
                        <th className="text-left py-1 pl-2">Last Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pipeline.recentErrors.map((e, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                          <td className="py-1.5 pr-2" style={{ color: 'var(--text-primary)' }}>
                            {e.type}
                          </td>
                          <td className="py-1.5 pr-2">
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px]"
                              style={{
                                color: 'var(--accent-rust)',
                                background: 'color-mix(in srgb, var(--accent-rust) 10%, transparent)',
                              }}
                            >
                              {e.category}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums font-medium" style={{ color: 'var(--accent-rust)' }}>
                            {e.count}
                          </td>
                          <td className="py-1.5 pl-2 truncate max-w-[200px]" style={{ color: 'var(--text-faint)' }}>
                            {e.lastError}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
          </div>

          {/* ── Velocity Summary ── */}
          {pipeline && pipeline.velocity.period_hours > 0 && (
            <Section title={`Velocity (${pipeline.velocity.period_hours}h window)`}>
              <div className="flex flex-wrap gap-4">
                <VelocityStat label="OCR" value={`${pipeline.velocity.ocr_per_hour} pages/hr`} color="var(--accent-sage)" />
                <VelocityStat label="Translation" value={`${pipeline.velocity.translate_per_hour} pages/hr`} color="var(--accent-rust)" />
                <VelocityStat label="Books completing" value={`${pipeline.velocity.books_completing_per_day}/day`} color="var(--accent-violet)" />
              </div>
            </Section>
          )}
        </main>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border-light)', background: 'white' }}>
      <h2 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub: string; icon: React.ReactNode; color: string;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-light)', background: 'white' }}>
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

function ActionButton({ label, description, loading, disabled, onClick, color }: {
  label: string; description: string; loading: boolean; disabled: boolean;
  onClick: () => void; color: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-left transition-opacity disabled:opacity-50"
      style={{ borderColor: color, background: `color-mix(in srgb, ${color} 5%, white)` }}
    >
      {loading ? (
        <RefreshCw className="w-4 h-4 animate-spin" style={{ color }} />
      ) : (
        <RotateCcw className="w-4 h-4" style={{ color }} />
      )}
      <div>
        <div className="text-sm font-medium" style={{ color }}>{label}</div>
        <div className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{description}</div>
      </div>
    </button>
  );
}

function VelocityStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
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

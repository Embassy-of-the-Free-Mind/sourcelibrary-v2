'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, X, RotateCcw, CheckCircle, XCircle, Clock, Loader2, Zap, BookOpen, FileText, Plus, Pause, Cloud } from 'lucide-react';
import type { Job, JobStatus } from '@/lib/types';
import { jobs as jobsApi, batchJobs, type PendingStats, queueBooks } from '@/lib/api-client';

const STATUS_COLORS: Record<JobStatus, string> = {
  // New SQS-based statuses
  pending: 'var(--text-muted)',
  ocr: '#3b82f6',              // Blue - OCR processing
  translation: '#22c55e',       // Green - Translation processing
  completed: 'var(--accent-sage)',
  partial: 'var(--accent-gold)',
  // Legacy statuses
  processing: 'var(--accent-sage)',
  paused: 'var(--accent-gold)',
  failed: 'var(--accent-rust)',
  cancelled: 'var(--text-muted)',
};

const STATUS_ICONS: Record<JobStatus, typeof CheckCircle> = {
  // New SQS-based statuses
  pending: Clock,
  ocr: Loader2,
  translation: Loader2,
  completed: CheckCircle,
  partial: XCircle,
  // Legacy statuses
  processing: Loader2,
  paused: Pause,
  failed: XCircle,
  cancelled: X,
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pendingStats, setPendingStats] = useState<PendingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [creatingJobs, setCreatingJobs] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);
  const BOOKS_BATCH_SIZE = 2;

  const fetchJobs = useCallback(async () => {
    try {
      // Fetch jobs first - this is fast
      const data = await jobsApi.list({ limit: 100 });
      setJobs(data.jobs as any);
    } catch (e) {
      console.error('Failed to fetch jobs:', e);
    } finally {
      setLoading(false);
    }

    // Fetch stats separately - this can be slow, don't block on it
    try {
      const data = await batchJobs.stats();
      setPendingStats(data.stats || null);
    } catch (e) {
      // Stats fetch failed or timed out - that's ok
      console.warn('Stats fetch failed:', e);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs, autoRefresh]);

  // Create batch jobs for books needing work using new Vercel Queue system
  const createBatchJobs = async (_type: 'ocr' | 'translate' | 'both', limit: number = 10) => {
    setCreatingJobs(true);
    setCreateResult(null);
    try {
      // Use new Vercel Queue system - auto-finds books needing OCR
      const data = await queueBooks({ auto: true, limit });
      const jobCount = data.jobIds?.length || 0;
      setCreateResult(`Queued ${jobCount} books for processing`);
      await fetchJobs();
    } catch (e) {
      setCreateResult(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setCreatingJobs(false);
      // Clear result after 5 seconds
      setTimeout(() => setCreateResult(null), 5000);
    }
  };

  // SQS jobs auto-process - no manual intervention needed
  const handleAction = async (jobId: string, action: 'retry') => {
    try {
      if (action === 'retry') {
        await jobsApi.retry(jobId);
      }
      await fetchJobs();
    } catch (e) {
      console.error(`Failed to ${action} job:`, e);
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await jobsApi.delete(jobId);
      await fetchJobs();
    } catch (e) {
      console.error('Failed to delete job:', e);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  const getCompleted = (job: Job) => {
    if (job.status === 'ocr') {
      return job.progress.ocr_completed ?? 0;
    } else if (job.status === 'translation' || job.status === 'completed' || job.status === 'partial') {
      return job.progress.translation_completed ?? 0;
    } else {
      // Legacy jobs or other statuses
      return (job.progress as any).completed ?? 0;
    }
  };

  const getFailed = (job: Job) => {
    return (job as any).failed_page_ids?.length ?? 0;
  };

  const getPhase = (job: Job) => {
    if (job.status === 'ocr') return 'OCR';
    if (job.status === 'translation') return 'Translation';
    return ''; // No phase label for completed/partial/other statuses
  };

  const getProgress = (job: Job) => {
    if (job.progress.total === 0) return 0;
    const completed = getCompleted(job);
    return Math.round((completed / job.progress.total) * 100);
  };

  // Calculate active jobs (new SQS statuses)
  const activeJobs = jobs.filter(j => ['pending', 'ocr', 'translation'].includes(j.status));
  const ocrJobs = jobs.filter(j => j.status === 'ocr');
  const translationJobs = jobs.filter(j => j.status === 'translation');

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
              Jobs Manager
            </h1>
            <Link
              href="/analytics"
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
            >
              Analytics
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${autoRefresh ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-600'
                }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? 'Pause' : 'Live'}
            </button>
            <button
              onClick={fetchJobs}
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

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        {pendingStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <Zap className="w-4 h-4" />
                Active Jobs
              </div>
              <div className="text-2xl font-medium mt-1" style={{ color: 'var(--text-primary)' }}>
                {activeJobs.length}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                {ocrJobs.length} OCR, {translationJobs.length} translating
              </div>
            </div>

            <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <BookOpen className="w-4 h-4" />
                Needs OCR
              </div>
              <div className="text-2xl font-medium mt-1" style={{ color: 'var(--accent-gold)' }}>
                {pendingStats.total_pages_needing_ocr.toLocaleString()}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                {pendingStats.books_needing_ocr} books
              </div>
            </div>

            <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <FileText className="w-4 h-4" />
                Needs Translation
              </div>
              <div className="text-2xl font-medium mt-1" style={{ color: 'var(--accent-sage)' }}>
                {pendingStats.total_pages_needing_translation.toLocaleString()}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                {pendingStats.books_needing_translation} books
              </div>
            </div>

            <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <Cloud className="w-4 h-4" />
                Est. Cost (Batch)
              </div>
              <div className="text-2xl font-medium mt-1" style={{ color: 'var(--accent-rust)' }}>
                ${((pendingStats.total_pages_needing_ocr * 0.0025) + (pendingStats.total_pages_needing_translation * 0.0015)).toFixed(0)}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                50% off with Batch API
              </div>
            </div>
          </div>
        )}

        {/* Create Batch Jobs */}
        {pendingStats && (pendingStats.total_pages_needing_ocr > 0 || pendingStats.total_pages_needing_translation > 0) && (
          <div className="mb-6 p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Queue Batch Jobs</div>
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Create jobs for books needing OCR or translation
                </div>
              </div>
              <div className="flex items-center gap-2">
                {createResult && (
                  <span className={`text-sm px-3 py-1 rounded-lg ${createResult.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {createResult}
                  </span>
                )}
                <button
                  onClick={() => createBatchJobs('both', BOOKS_BATCH_SIZE)} // TODO: Set it to 10 after testing!
                  disabled={creatingJobs}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--accent-rust)' }}
                >
                  {creatingJobs ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Queue {BOOKS_BATCH_SIZE} Books
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SQS jobs auto-process - no manual intervention needed */}

        {loading && jobs.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin opacity-30" />
            <p>Loading jobs...</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No jobs yet</p>
            <p className="text-sm mt-1">Start a batch process from a book page or use the Pipeline</p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const StatusIcon = STATUS_ICONS[job.status];
              const progress = getProgress(job);

              return (
                <div
                  key={job.id}
                  className="p-4 rounded-xl"
                  style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusIcon
                          className={`w-4 h-4 ${(job.status === 'ocr' || job.status === 'translation') ? 'animate-spin' : ''}`}
                          style={{ color: STATUS_COLORS[job.status] }}
                        />
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {job.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full capitalize" style={{
                          background: 'var(--bg-warm)',
                          color: STATUS_COLORS[job.status],
                        }}>
                          {job.status}
                        </span>
                      </div>
                      {job.book_title && (
                        <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                          {job.book_id ? (
                            <Link href={`/book/${job.book_id}`} className="hover:underline">
                              {job.book_title}
                            </Link>
                          ) : (
                            job.book_title
                          )}
                        </div>
                      )}
                      {/* Job config info */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {job.config?.model && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono">
                            {job.config.model.replace('gemini-', '').replace('-preview', '')}
                          </span>
                        )}
                        {job.config?.language && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                            {job.config.language}
                          </span>
                        )}
                        {job.config?.use_batch_api && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                            Batch API 50%↓
                          </span>
                        )}
                        {job.progress?.total > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                            {job.progress.total} pages
                          </span>
                        )}
                        {job.config?.prompt_name && job.config.prompt_name !== 'Standard OCR' && job.config.prompt_name !== 'Standard Translation' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
                            {job.config.prompt_name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Actions - SQS jobs auto-process */}
                      {job.status === 'partial' && (
                        <button
                          onClick={() => handleAction(job.id, 'retry')}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Retry failed pages"
                        >
                          <RotateCcw className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                        </button>
                      )}
                      {/* X to remove from list */}
                      <button
                        onClick={() => handleDelete(job.id)}
                        className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors opacity-40 hover:opacity-100"
                        title="Remove from list"
                      >
                        <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mb-2">
                    <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                      <span>
                        {getPhase(job) && `${getPhase(job)}: `}{getCompleted(job)} / {job.progress.total} completed
                        {getFailed(job) > 0 && (
                          <span style={{ color: 'var(--accent-rust)' }}> • {getFailed(job)} failed</span>
                        )}
                      </span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${progress}%`,
                          background: getFailed(job) > 0 ? 'var(--accent-rust)' : 'var(--accent-sage)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Current item */}
                  {job.progress.currentItem && job.status === 'processing' && (
                    <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                      Processing: {job.progress.currentItem}
                    </div>
                  )}

                  {/* Error message */}
                  {job.error && (
                    <div className="text-xs p-2 rounded-lg mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>
                      {job.error}
                    </div>
                  )}

                  {/* Failed page errors from results */}
                  {job.results && job.results.filter(r => !r.success && r.error).length > 0 && (
                    <div className="text-xs p-2 rounded-lg mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>
                      <div className="font-medium mb-1">Failed pages:</div>
                      <ul className="space-y-0.5">
                        {job.results
                          .filter(r => !r.success && r.error)
                          .slice(-5)
                          .map((r, i) => (
                            <li key={i}>• {r.error}</li>
                          ))}
                        {job.results.filter(r => !r.success).length > 5 && (
                          <li className="italic opacity-75">
                            ...and {job.results.filter(r => !r.success).length - 5} more
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Footer info */}
                  <div className="flex justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
                    <span>Created: {formatDate(job.created_at)}</span>
                    {job.completed_at && (
                      <span>Completed: {formatDate(job.completed_at)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

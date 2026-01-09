'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Play, Pause, X, RotateCcw, CheckCircle, XCircle, Clock, Loader2, Cloud, Zap, BookOpen, FileText, Plus, StopCircle } from 'lucide-react';
import type { Job, JobStatus } from '@/lib/types';
import { jobs as jobsApi, batchJobs, type PendingStats } from '@/lib/api-client';

const STATUS_COLORS: Record<JobStatus, string> = {
  pending: 'var(--text-muted)',
  processing: 'var(--accent-sage)',
  paused: 'var(--accent-gold)',
  completed: 'var(--accent-sage)',
  failed: 'var(--accent-rust)',
  cancelled: 'var(--text-muted)',
};

const STATUS_ICONS: Record<JobStatus, typeof CheckCircle> = {
  pending: Clock,
  processing: Loader2,
  paused: Pause,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: X,
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pendingStats, setPendingStats] = useState<PendingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [creatingJobs, setCreatingJobs] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const [resumingStale, setResumingStale] = useState(false);
  const processingRef = useRef(false);
  const resumingStaleRef = useRef(false);
  const staleTimeoutMinutes = 5;

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

  // Create batch jobs for books needing work
  const createBatchJobs = async (type: 'ocr' | 'translate' | 'both', limit: number = 10) => {
    setCreatingJobs(true);
    setCreateResult(null);
    try {
      const data = await batchJobs.processAll({ type, limit });
      const ocrCount = data.ocr_jobs?.length || 0;
      const transCount = data.translate_jobs?.length || 0;
      setCreateResult(`Created ${ocrCount} OCR + ${transCount} translation jobs`);
      await fetchJobs();
    } catch (e) {
      setCreateResult(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setCreatingJobs(false);
      // Clear result after 5 seconds
      setTimeout(() => setCreateResult(null), 5000);
    }
  };

  // Process all pending batch jobs
  const processAllPending = async () => {
    setProcessingAll(true);
    try {
      // Keep calling process-pending until no more jobs need preparation
      let keepGoing = true;
      while (keepGoing) {
        const data = await batchJobs.processPending({ limit: 5 });
        await fetchJobs();

        // Stop if no jobs needing preparation remain
        if (!data.remaining?.needing_preparation || data.remaining.needing_preparation === 0) {
          keepGoing = false;
        }

        // Small delay between batches
        if (keepGoing) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } catch (e) {
      console.error('Error processing pending jobs:', e);
    } finally {
      setProcessingAll(false);
    }
  };

  // Process a job (runs in a loop until done/paused/cancelled)
  const processJob = useCallback(async (jobId: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessingJobId(jobId);

    try {
      let done = false;
      let paused = false;

      while (!done && !paused) {
        const data = await jobsApi.process(jobId);
        done = data.processed > 0 && data.success;

        // Refresh jobs list
        await fetchJobs();

        // Small delay to prevent hammering
        if (!done && !paused) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (e) {
      console.error('Error processing job:', e);
    } finally {
      processingRef.current = false;
      setProcessingJobId(null);
    }
  }, [fetchJobs]);

  // Get stale jobs (processing but not updated recently)
  const getStaleJobs = useCallback(() => {
    const now = Date.now();
    return jobs.filter(job => {
      if (job.status !== 'processing') return false;
      const lastUpdate = new Date(job.updated_at).getTime();
      return (now - lastUpdate) > staleTimeoutMinutes * 60 * 1000;
    });
  }, [jobs]);

  // Cancel bulk resume
  const cancelResumeAll = () => {
    resumingStaleRef.current = false;
  };

  // Resume all stale jobs sequentially
  const resumeAllStale = async () => {
    const staleJobs = getStaleJobs();
    if (staleJobs.length === 0) return;
    if (resumingStaleRef.current) return; // Already resuming

    resumingStaleRef.current = true;
    setResumingStale(true);
    try {
      for (const job of staleJobs) {
        if (!resumingStaleRef.current) break; // Allow cancellation via ref

        // Process this job until done or paused
        let done = false;

        while (!done && resumingStaleRef.current) {
          try {
            const data = await jobsApi.process(job.id);
            done = data.processed > 0 && data.success;
            await fetchJobs();

            if (!done) {
              await new Promise(r => setTimeout(r, 500));
            }
          } catch (e) {
            break;
          }
        }
      }
    } catch (e) {
      console.error('Error resuming stale jobs:', e);
    } finally {
      resumingStaleRef.current = false;
      setResumingStale(false);
    }
  };

  const handleAction = async (jobId: string, action: 'pause' | 'resume' | 'cancel' | 'retry') => {
    try {
      if (action === 'pause') {
        await jobsApi.pause(jobId);
      } else if (action === 'resume') {
        await jobsApi.resume(jobId);
      } else if (action === 'cancel') {
        await jobsApi.cancel(jobId);
      } else if (action === 'retry') {
        await jobsApi.retry(jobId);
      }

      await fetchJobs();

      // If resuming or retrying, start processing
      if (action === 'resume' || action === 'retry') {
        processJob(jobId);
      }
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

  const getProgress = (job: Job) => {
    if (job.progress.total === 0) return 0;
    return Math.round(((job.progress.completed + job.progress.failed) / job.progress.total) * 100);
  };

  // Calculate batch API stats
  const activeJobs = jobs.filter(j => ['pending', 'processing'].includes(j.status));
  const batchApiJobs = activeJobs.filter(j => j.config?.use_batch_api);
  const preparingJobs = batchApiJobs.filter(j => !j.gemini_batch_job);
  const submittedJobs = batchApiJobs.filter(j => j.gemini_batch_job);
  const staleJobs = getStaleJobs();

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
              {autoRefresh ? 'Live' : 'Paused'}
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
                {preparingJobs.length} preparing, {submittedJobs.length} with Gemini
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
                  onClick={() => createBatchJobs('both', 10)}
                  disabled={creatingJobs || processingAll}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--accent-rust)' }}
                >
                  {creatingJobs ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Queue 10 Books
                </button>
                {preparingJobs.length > 0 && (
                  <button
                    onClick={processAllPending}
                    disabled={processingAll || creatingJobs}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--accent-sage)', color: 'white' }}
                  >
                    {processingAll ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    Process All ({preparingJobs.length})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Gemini Batch Jobs Section */}
        {submittedJobs.length > 0 && (
          <div className="mb-6 p-4 rounded-xl" style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #eef2ff 100%)', border: '1px solid #bfdbfe' }}>
            <div className="flex items-center gap-2 mb-3">
              <Cloud className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-blue-900">Gemini Batch API Queue</span>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                {submittedJobs.length} processing
              </span>
            </div>
            <div className="space-y-2">
              {submittedJobs.map(job => {
                const extJob = job as Job & { gemini_batch_job?: string; gemini_state?: string };
                return (
                  <div key={job.id} className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-stone-700">
                        {job.book_title?.slice(0, 35) || 'Untitled'}
                      </span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                        {job.type.replace('batch_', '').toUpperCase()}
                      </span>
                      <span className="text-xs text-stone-500">
                        {job.progress.total} pages
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-indigo-600">
                        {extJob.gemini_state?.replace('JOB_STATE_', '') || 'PENDING'}
                      </span>
                      <button
                        onClick={() => processJob(job.id)}
                        disabled={processingJobId === job.id}
                        className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                      >
                        {processingJobId === job.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          'Check'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Resume All Stale Jobs */}
        {(staleJobs.length > 0 || resumingStale) && (
          <div className="mb-6 p-4 rounded-xl" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fef9c3 100%)', border: '1px solid #fbbf24' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-200 rounded-lg">
                  <Clock className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <div className="font-medium text-amber-900">
                    {resumingStale
                      ? `Resuming stale jobs... (${staleJobs.length} remaining)`
                      : `${staleJobs.length} Stale Job${staleJobs.length !== 1 ? 's' : ''} Detected`
                    }
                  </div>
                  <div className="text-sm text-amber-700">
                    {resumingStale
                      ? 'Processing jobs sequentially'
                      : `Jobs stuck for ${staleTimeoutMinutes}+ minutes without updates`
                    }
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {resumingStale ? (
                  <button
                    onClick={cancelResumeAll}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
                    style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24' }}
                  >
                    <X className="w-4 h-4" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={resumeAllStale}
                    disabled={processingJobId !== null}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: '#d97706' }}
                  >
                    <Play className="w-4 h-4" />
                    Resume All Stale
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

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
              const isActive = job.status === 'processing' || job.status === 'pending';
              const isProcessingThis = processingJobId === job.id;

              // Check if job is stale (processing but not updated in 5+ minutes)
              const lastUpdate = new Date(job.updated_at).getTime();
              const now = Date.now();
              const staleMinutes = 5;
              const isStale = job.status === 'processing' && (now - lastUpdate) > staleMinutes * 60 * 1000;

              return (
                <div
                  key={job.id}
                  className="p-4 rounded-xl"
                  style={{ background: 'var(--bg-white)', border: isStale ? '2px solid var(--accent-gold)' : '1px solid var(--border-light)' }}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusIcon
                          className={`w-4 h-4 ${job.status === 'processing' && !isStale ? 'animate-spin' : ''}`}
                          style={{ color: isStale ? 'var(--accent-gold)' : STATUS_COLORS[job.status] }}
                        />
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {job.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full capitalize" style={{
                          background: isStale ? '#fef3c7' : 'var(--bg-warm)',
                          color: isStale ? '#92400e' : STATUS_COLORS[job.status],
                        }}>
                          {isStale ? 'Stale' : job.status}
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
                      {/* Actions */}
                      {job.status === 'pending' && !isProcessingThis && !resumingStale && (
                        <button
                          onClick={() => processJob(job.id)}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Start"
                        >
                          <Play className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                        </button>
                      )}
                      {job.status === 'processing' && isStale && !isProcessingThis && !resumingStale && (
                        <button
                          onClick={() => processJob(job.id)}
                          className="p-1.5 rounded-lg hover:bg-amber-100 transition-colors"
                          title="Resume stale job"
                        >
                          <Play className="w-4 h-4" style={{ color: 'var(--accent-gold)' }} />
                        </button>
                      )}
                      {job.status === 'processing' && !isStale && (
                        <button
                          onClick={() => handleAction(job.id, 'pause')}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Pause"
                        >
                          <Pause className="w-4 h-4" style={{ color: 'var(--accent-gold)' }} />
                        </button>
                      )}
                      {job.status === 'paused' && !resumingStale && (
                        <button
                          onClick={() => handleAction(job.id, 'resume')}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Resume"
                        >
                          <Play className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                        </button>
                      )}
                      {isActive && !resumingStale && (
                        <button
                          onClick={() => handleAction(job.id, 'cancel')}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors"
                          style={{ color: 'var(--accent-rust)' }}
                          title="Cancel job"
                        >
                          <StopCircle className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      )}
                      {(job.status === 'failed' || job.status === 'cancelled') && !resumingStale && (
                        <button
                          onClick={() => handleAction(job.id, 'retry')}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Retry"
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
                        {job.progress.completed} / {job.progress.total} completed
                        {job.progress.failed > 0 && (
                          <span style={{ color: 'var(--accent-rust)' }}> • {job.progress.failed} failed</span>
                        )}
                      </span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${progress}%`,
                          background: job.progress.failed > 0 ? 'var(--accent-rust)' : 'var(--accent-sage)',
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

                  {/* Stale warning */}
                  {isStale && (
                    <div className="text-xs p-2 rounded-lg mb-2" style={{ background: '#fef3c7', color: '#92400e' }}>
                      Job appears stuck (no updates for {Math.round((now - lastUpdate) / 60000)} minutes). Click the play button to resume.
                    </div>
                  )}

                  {/* Footer info */}
                  <div className="flex justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
                    <span>Created: {formatDate(job.created_at)}</span>
                    {isStale && (
                      <span style={{ color: '#92400e' }}>Last update: {formatDate(job.updated_at)}</span>
                    )}
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

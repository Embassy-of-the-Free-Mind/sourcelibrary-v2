'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Clock, Loader2, Plus } from 'lucide-react';
import type { Job } from '@/lib/types';
import { jobs as jobsApi, batchJobs, type PendingStats, queueBooks } from '@/lib/api-client';
import { JobCard } from './job-card';

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pendingStats, setPendingStats] = useState<PendingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [creatingJobs, setCreatingJobs] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);
  const BOOKS_BATCH_SIZE = 10;
  const AUTO_REFRESH_INTERVAL_IN_MS = 10000;

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
    const interval = setInterval(fetchJobs, AUTO_REFRESH_INTERVAL_IN_MS);
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${autoRefresh ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-600'
                }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? 'Stop' : 'Start'} Live Update
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
        {/* {pendingStats && (
          <StatsCards
            stats={pendingStats}
            activeJobsCount={activeJobs.length}
            ocrJobsCount={ocrJobs.length}
            translationJobsCount={translationJobs.length}
          />
        )} */}

        {/* Create Batch Jobs */}
        {pendingStats && (pendingStats.total_pages_needing_ocr > 0 || pendingStats.total_pages_needing_translation > 0) && (
          <div className="mb-6 p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Queue Books</div>
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Create jobs for books needing OCR or translation.
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
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onRetry={() => handleAction(job.id, 'retry')}
                onDelete={() => handleDelete(job.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

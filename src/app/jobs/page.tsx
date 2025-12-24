'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Play, Pause, X, RotateCcw, Trash2, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import type { Job, JobStatus } from '@/lib/types';

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
  const [loading, setLoading] = useState(true);
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);
  const processingRef = useRef(false);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs?limit=100');
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs);
      }
    } catch (e) {
      console.error('Failed to fetch jobs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // Process a job (runs in a loop until done/paused/cancelled)
  const processJob = useCallback(async (jobId: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessingJobId(jobId);

    try {
      let done = false;
      let paused = false;

      while (!done && !paused) {
        const res = await fetch(`/api/jobs/${jobId}/process`, { method: 'POST' });
        if (!res.ok) break;

        const data = await res.json();
        done = data.done;
        paused = data.paused;

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

  const handleAction = async (jobId: string, action: 'pause' | 'resume' | 'cancel' | 'retry') => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        await fetchJobs();

        // If resuming or retrying, start processing
        if (action === 'resume' || action === 'retry') {
          processJob(jobId);
        }
      }
    } catch (e) {
      console.error(`Failed to ${action} job:`, e);
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this job?')) return;

    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchJobs();
      }
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

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
              Jobs
            </h1>
          </div>
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
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {loading && jobs.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin opacity-30" />
            <p>Loading jobs...</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No jobs yet</p>
            <p className="text-sm mt-1">Start a batch process from a book's prepare page</p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const StatusIcon = STATUS_ICONS[job.status];
              const progress = getProgress(job);
              const isActive = job.status === 'processing' || job.status === 'pending';
              const isProcessingThis = processingJobId === job.id;

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
                          className={`w-4 h-4 ${job.status === 'processing' ? 'animate-spin' : ''}`}
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
                          {job.book_title}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Actions */}
                      {job.status === 'pending' && !isProcessingThis && (
                        <button
                          onClick={() => processJob(job.id)}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Start"
                        >
                          <Play className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                        </button>
                      )}
                      {job.status === 'processing' && (
                        <button
                          onClick={() => handleAction(job.id, 'pause')}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Pause"
                        >
                          <Pause className="w-4 h-4" style={{ color: 'var(--accent-gold)' }} />
                        </button>
                      )}
                      {job.status === 'paused' && (
                        <button
                          onClick={() => handleAction(job.id, 'resume')}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Resume"
                        >
                          <Play className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                        </button>
                      )}
                      {isActive && (
                        <button
                          onClick={() => handleAction(job.id, 'cancel')}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />
                        </button>
                      )}
                      {(job.status === 'failed' || job.status === 'cancelled') && (
                        <button
                          onClick={() => handleAction(job.id, 'retry')}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Retry"
                        >
                          <RotateCcw className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                        </button>
                      )}
                      {!isActive && (
                        <button
                          onClick={() => handleDelete(job.id)}
                          className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                        </button>
                      )}
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

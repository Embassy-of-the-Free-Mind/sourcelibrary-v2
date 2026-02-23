'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Clock, RotateCw, Pause, Play } from 'lucide-react';
import type { Job } from '@/lib/types';
import { jobs as jobsApi } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import { JobCard } from './job-card';

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const AUTO_REFRESH_INTERVAL_IN_MS = 10000;

  const fetchJobs = useCallback(async () => {
    try {
      const realtimeData = await jobsApi.list({ limit: 100 });
      setJobs(realtimeData.jobs as any);
    } catch (e) {
      console.error('Failed to fetch jobs:', e);
    } finally {
      setLoading(false);
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

  const handleDelete = async (jobId: string) => {
    try {
      await jobsApi.delete(jobId);
      await fetchJobs();
    } catch (e) {
      console.error('Failed to delete job:', e);
    }
  };

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
              {autoRefresh ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {autoRefresh ? 'Stop' : 'Start'} Live Update
            </button>
            <button
              onClick={fetchJobs}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
              style={{ color: 'var(--accent-rust)' }}
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {loading && jobs.length === 0 ? (
          <div className="py-12">
            <BookLoader size="xs" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No jobs yet</p>
            <p className="text-sm mt-1">Start a process from a book page</p>
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

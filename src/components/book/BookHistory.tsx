'use client';

import { useState, useEffect } from 'react';
import { History, ChevronDown, ChevronUp, FileText, Languages, BookOpen, Scissors, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, AlertTriangle } from 'lucide-react';
import { jobs } from '@/lib/api-client';

interface JobResult {
  pageId: string;
  success: boolean;
  error?: string;
  duration?: number;
}

interface Job {
  id: string;
  type: string;
  status: string;
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  config?: {
    model?: string;
    prompt_name?: string;
    language?: string;
    page_ids?: string[];
  };
  error?: string;
  results?: JobResult[];
  created_at: string;
  completed_at?: string;
  initiated_by?: string;
}

interface BookHistoryProps {
  bookId: string;
}

const jobTypeConfig: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  batch_ocr: { label: 'OCR', icon: FileText, color: '#3b82f6' },
  batch_translate: { label: 'Translation', icon: Languages, color: '#22c55e' },
  batch_summary: { label: 'Summary', icon: BookOpen, color: '#a855f7' },
  batch_split: { label: 'Split', icon: Scissors, color: '#f59e0b' },
};

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  completed: { icon: CheckCircle2, color: '#22c55e' },
  failed: { icon: XCircle, color: '#ef4444' },
  processing: { icon: Loader2, color: '#3b82f6' },
  pending: { icon: Clock, color: '#a855f7' },
  cancelled: { icon: XCircle, color: '#6b7280' },
};

function formatRelativeTime(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(start: string, end?: string): string {
  if (!end) return 'In progress';
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);

  if (diffSecs < 60) return `${diffSecs}s`;
  if (diffMins < 60) return `${diffMins}m ${diffSecs % 60}s`;
  return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
}

export default function BookHistory({ bookId }: BookHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const [jobsList, setJobsList] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const data = await jobs.list({ book_id: bookId, limit: 20 });
      setJobsList(data.jobs || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded && jobsList.length === 0) {
      fetchJobs();
    }
  }, [expanded, bookId, jobsList.length]);

  const toggleErrorExpand = (jobId: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const handleRetry = async (jobId: string) => {
    setRetrying(jobId);
    try {
      await jobs.retry(jobId);
      // Refresh the jobs list
      await fetchJobs();
    } catch (error) {
      console.error('Retry error:', error);
    } finally {
      setRetrying(null);
    }
  };

  const getErrorsForJob = (job: Job): { jobError?: string; pageErrors: { pageId: string; error: string }[] } => {
    const pageErrors: { pageId: string; error: string }[] = [];
    if (job.results) {
      for (const result of job.results) {
        if (!result.success && result.error) {
          pageErrors.push({ pageId: result.pageId, error: result.error });
        }
      }
    }
    return { jobError: job.error, pageErrors };
  };

  const hasErrors = (job: Job): boolean => {
    if (job.error) return true;
    if (job.results?.some(r => !r.success && r.error)) return true;
    return false;
  };

  return (
    <div className="bg-white rounded-xl border border-stone-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-stone-700">
          <History className="w-5 h-5" />
          <span className="font-medium">Processing History</span>
          {jobsList.length > 0 && (
            <span className="text-xs text-stone-400">({jobsList.length} jobs)</span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-stone-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-stone-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-stone-200">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-stone-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading history...
            </div>
          ) : jobsList.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              No processing history yet
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {jobsList.map(job => {
                const typeInfo = jobTypeConfig[job.type] || { label: job.type, icon: FileText, color: '#6b7280' };
                const statusInfo = statusConfig[job.status] || statusConfig.pending;
                const TypeIcon = typeInfo.icon;
                const StatusIcon = statusInfo.icon;
                const jobHasErrors = hasErrors(job);
                const isErrorExpanded = expandedErrors.has(job.id);
                const errors = jobHasErrors ? getErrorsForJob(job) : null;
                const canRetry = job.status === 'failed' || job.status === 'cancelled';
                const isRetrying = retrying === job.id;

                return (
                  <div key={job.id} className="border-b border-stone-100 last:border-b-0">
                    <div className="px-4 py-3 flex items-center gap-4">
                      {/* Type icon */}
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${typeInfo.color}15` }}
                      >
                        <TypeIcon className="w-4 h-4" style={{ color: typeInfo.color }} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-stone-800">{typeInfo.label}</span>
                          <span className="text-xs text-stone-400">
                            {job.progress.completed}/{job.progress.total} pages
                          </span>
                          {job.progress.failed > 0 && (
                            <button
                              onClick={() => toggleErrorExpand(job.id)}
                              className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
                            >
                              ({job.progress.failed} failed)
                              {jobHasErrors && (
                                <ChevronDown className={`w-3 h-3 transition-transform ${isErrorExpanded ? 'rotate-180' : ''}`} />
                              )}
                            </button>
                          )}
                        </div>
                        <div className="text-xs text-stone-400 flex items-center gap-2 flex-wrap">
                          <span>{formatRelativeTime(job.created_at)}</span>
                          {job.config?.model && (
                            <>
                              <span className="text-stone-300">·</span>
                              <span>{job.config.model}</span>
                            </>
                          )}
                          {job.completed_at && (
                            <>
                              <span className="text-stone-300">·</span>
                              <span>{formatDuration(job.created_at, job.completed_at)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {canRetry && (
                          <button
                            onClick={() => handleRetry(job.id)}
                            disabled={isRetrying}
                            className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                            title="Retry with same parameters"
                          >
                            <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                            Retry
                          </button>
                        )}
                        <StatusIcon
                          className={`w-5 h-5 ${job.status === 'processing' ? 'animate-spin' : ''}`}
                          style={{ color: statusInfo.color }}
                        />
                      </div>
                    </div>

                    {/* Expanded error logs */}
                    {isErrorExpanded && errors && (
                      <div className="px-4 pb-3">
                        <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm">
                          {errors.jobError && (
                            <div className="flex items-start gap-2 text-red-700 mb-2">
                              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              <div>
                                <span className="font-medium">Job error:</span> {errors.jobError}
                              </div>
                            </div>
                          )}
                          {errors.pageErrors.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-red-600 font-medium text-xs mb-1">
                                Page errors ({errors.pageErrors.length}):
                              </div>
                              <div className="max-h-32 overflow-y-auto space-y-1">
                                {errors.pageErrors.map((err, idx) => (
                                  <div key={idx} className="text-xs text-red-600 flex gap-2">
                                    <span className="text-red-400 font-mono flex-shrink-0">
                                      {err.pageId.slice(0, 8)}...
                                    </span>
                                    <span className="truncate">{err.error}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {!errors.jobError && errors.pageErrors.length === 0 && (
                            <div className="text-red-500 text-xs">No error details available</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { History, ChevronDown, ChevronUp, FileText, Languages, BookOpen, Scissors, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

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
  };
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (expanded && jobs.length === 0) {
      setLoading(true);
      fetch(`/api/jobs?book_id=${bookId}&limit=20`)
        .then(res => res.json())
        .then(data => setJobs(data.jobs || []))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [expanded, bookId, jobs.length]);

  return (
    <div className="bg-white rounded-xl border border-stone-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-stone-700">
          <History className="w-5 h-5" />
          <span className="font-medium">Processing History</span>
          {jobs.length > 0 && (
            <span className="text-xs text-stone-400">({jobs.length} jobs)</span>
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
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              No processing history yet
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {jobs.map(job => {
                const typeInfo = jobTypeConfig[job.type] || { label: job.type, icon: FileText, color: '#6b7280' };
                const statusInfo = statusConfig[job.status] || statusConfig.pending;
                const TypeIcon = typeInfo.icon;
                const StatusIcon = statusInfo.icon;

                return (
                  <div key={job.id} className="px-4 py-3 flex items-center gap-4">
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
                          <span className="text-xs text-red-500">
                            ({job.progress.failed} failed)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-stone-400 flex items-center gap-2">
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

                    {/* Status */}
                    <div className="flex-shrink-0">
                      <StatusIcon
                        className={`w-5 h-5 ${job.status === 'processing' ? 'animate-spin' : ''}`}
                        style={{ color: statusInfo.color }}
                      />
                    </div>
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

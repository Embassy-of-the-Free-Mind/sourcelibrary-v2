'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ListChecks, CheckCircle, XCircle, Pause, Loader2, Clock } from 'lucide-react';
import { jobs } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import type { JobLog } from '@/lib/api-client';
import { formatDuration, formatJobType, getStatusColor } from '../shared/formatters';

export default function LogsTab() {
  const [jobLogs, setJobLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobLimit, setJobLimit] = useState(50);
  const [jobTypeFilter, setJobTypeFilter] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    jobs.list({
      limit: jobLimit,
      type: jobTypeFilter || undefined,
      status: (jobStatusFilter as 'pending' | 'processing' | 'completed' | 'failed') || undefined,
    }).then(data => setJobLogs(data.jobs || []))
      .finally(() => setLoading(false));
  }, [jobLimit, jobTypeFilter, jobStatusFilter]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4" style={{ color: '#22c55e' }} />;
      case 'failed': return <XCircle className="w-4 h-4" style={{ color: '#ef4444' }} />;
      case 'processing': return <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-sage)' }} />;
      case 'paused': return <Pause className="w-4 h-4" style={{ color: '#f59e0b' }} />;
      case 'cancelled': return <XCircle className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />;
      default: return <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />;
    }
  };

  if (loading) return <div className="py-12"><BookLoader size="xs" /></div>;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <select
          value={jobTypeFilter}
          onChange={(e) => setJobTypeFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
        >
          <option value="">All Types</option>
          <option value="batch_ocr">OCR</option>
          <option value="batch_translate">Translate</option>
          <option value="batch_split">Split</option>
          <option value="book_import">Import</option>
        </select>
        <select
          value={jobStatusFilter}
          onChange={(e) => setJobStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
        >
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select
          value={jobLimit}
          onChange={(e) => setJobLimit(Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
        >
          <option value={25}>25 jobs</option>
          <option value={50}>50 jobs</option>
          <option value={100}>100 jobs</option>
        </select>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <ListChecks className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
          Batch Job History
        </h2>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {jobLogs.length} jobs
        </span>
      </div>

      {jobLogs.length > 0 ? (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-warm)' }}>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Status</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Type</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>User</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Book</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Pages</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Model / Prompt</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Started</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {jobLogs.map((job) => {
                  const startTime = job.started_at ? new Date(job.started_at) : new Date(job.created_at);
                  const endTime = job.completed_at ? new Date(job.completed_at) : new Date();
                  const durationMs = job.started_at ? endTime.getTime() - startTime.getTime() : 0;
                  const durationStr = durationMs > 0 ? formatDuration(durationMs) : '-';

                  return (
                    <tr key={job.id} style={{ borderTop: '1px solid var(--border-light)' }} className="hover:bg-stone-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(job.status)}
                          <span className="capitalize text-xs font-medium" style={{ color: getStatusColor(job.status) }}>
                            {job.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded-md text-xs font-medium" style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)' }}>
                          {formatJobType(job.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {job.initiated_by || '-'}
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        {job.book_id ? (
                          <Link
                            href={`/book/${job.book_id}`}
                            className="block truncate hover:underline"
                            style={{ color: 'var(--text-primary)' }}
                            title={job.book_title || '-'}
                          >
                            {job.book_title || '-'}
                          </Link>
                        ) : (
                          <div className="truncate" style={{ color: 'var(--text-primary)' }} title={job.book_title || '-'}>
                            {job.book_title || '-'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div style={{ color: 'var(--text-primary)' }}>
                          {job.progress.completed}
                          <span style={{ color: 'var(--text-muted)' }}> / {job.progress.total}</span>
                        </div>
                        {job.progress.failed > 0 && (
                          <div className="text-xs" style={{ color: '#ef4444' }}>
                            {job.progress.failed} failed
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div style={{ color: 'var(--text-primary)' }}>{job.config.model || '-'}</div>
                        {job.config.prompt_name && (
                          <div style={{ color: 'var(--text-muted)' }}>{job.config.prompt_name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(job.created_at).toLocaleDateString()}
                        <br />
                        {new Date(job.created_at).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {job.status === 'processing' ? (
                          <span style={{ color: 'var(--accent-sage)' }}>In progress...</span>
                        ) : (
                          durationStr
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          <ListChecks className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No batch jobs found</p>
          <p className="text-sm mt-1">Jobs will appear here when you run batch operations</p>
        </div>
      )}
    </div>
  );
}

import { Loader2, CheckCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface Props {
  job: {
    id: string;
    type: 'ocr' | 'image_extraction';
    status: string;
    total_pages: number;
    total_batches: number;
    progress?: {
      completed: number;
      failed: number;
      pending: number;
      total: number;
    };
    book_title: string;
    created_at: Date;
  };
  onClose: () => void;
  onRefresh?: () => void;
  loading?: boolean;
}

export default function BatchJobStatusBanner({ job, onClose, onRefresh, loading = false }: Props) {
  const isPending = job.status === 'pending' || job.status === 'processing';
  const completed = job.progress?.completed || 0;
  const total = job.progress?.total || job.total_pages;
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {isPending && <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />}
            {job.status === 'completed' && <CheckCircle className="w-5 h-5 text-green-600" />}
            <span className="text-sm font-medium text-purple-900">
              {job.type.toUpperCase()} Batch Job ({job.total_batches} Gemini batches)
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">
              {job.status}
            </span>
          </div>

          {job.progress && (
            <div className="mt-2">
              <div className="flex items-center gap-2 text-xs text-purple-700">
                <span>{completed} / {total} pages</span>
                <span>•</span>
                <span>{percentComplete}% complete</span>
                {job.progress.failed > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-red-600">{job.progress.failed} failed</span>
                  </>
                )}
              </div>
              <div className="mt-1.5 h-2 bg-purple-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-600 transition-all"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
            </div>
          )}

          {!job.progress && (
            <div className="mt-2">
              <p className="text-xs text-purple-700">
                Processing {job.total_pages} pages in {job.total_batches} batches • Results in ~24 hours
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          {isPending && onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-purple-700 rounded-lg hover:bg-purple-100 border border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Loader2 className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
          <Link
            href="/jobs?tab=batch"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-purple-700 rounded-lg hover:bg-purple-100 border border-purple-300"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Details
          </Link>
          {!isPending && (
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-purple-700">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

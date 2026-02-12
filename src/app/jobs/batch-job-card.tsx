import Link from 'next/link';
import { Loader2, CheckCircle, AlertCircle, XCircle } from 'lucide-react';

interface Props {
  job: {
    id: string;
    type: 'ocr' | 'image_extraction';
    book_id: string;
    book_title?: string;
    status: string;
    total_pages?: number;
    child_job_ids?: string[];
    progress?: {
      completed: number;
      failed: number;
      pending: number;
      total: number;
    };
    created_at: Date;
    updated_at: Date;
  };
}

export function BatchJobCard({ job }: Props) {
  const isPending = job.status === 'pending' || job.status === 'processing';
  const isComplete = job.status === 'completed';
  const hasErrors = job.status === 'completed_with_errors';
  const isFailed = job.status === 'failed';

  const completed = job.progress?.completed || 0;
  const total = job.progress?.total || job.total_pages || 0;
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  const StatusIcon = isPending ? Loader2 : isComplete ? CheckCircle : hasErrors ? AlertCircle : XCircle;
  const statusColor = isPending
    ? 'text-purple-600'
    : isComplete
    ? 'text-green-600'
    : hasErrors
    ? 'text-amber-600'
    : 'text-red-600';

  return (
    <div className="p-4 rounded-xl bg-white border border-stone-200">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-4 h-4 ${isPending ? 'animate-spin' : ''} ${statusColor}`} />
            <span className="capitalize font-medium">{job.type === 'ocr' ? 'OCR' : 'Image Extraction'} Batch</span>
            <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 capitalize">
              {job.status.replace(/_/g, ' ')}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-600 font-mono">
              Gemini Batch API
            </span>
          </div>

          {job.book_title && (
            <div className="text-sm mt-1 text-stone-600">
              <Link href={`/book/${job.book_id}`} className="hover:underline">
                {job.book_title}
              </Link>
            </div>
          )}

          {job.progress && (
            <div className="mt-2">
              <div className="flex items-center gap-2 text-xs text-stone-600">
                <span>{completed} / {total} pages</span>
                <span>•</span>
                <span>{percentComplete}% complete</span>
                <span>•</span>
                <span>{job.child_job_ids?.length || 0} Gemini batches</span>
                {job.progress.failed > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-red-600">{job.progress.failed} failed</span>
                  </>
                )}
              </div>
              <div className="mt-1.5 h-2 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-600 transition-all"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
            </div>
          )}

          {!job.progress && (
            <div className="mt-2 text-xs text-stone-600">
              <span>{job.total_pages || 0} pages</span>
              <span> • </span>
              <span>{job.child_job_ids?.length || 0} Gemini batches</span>
            </div>
          )}

          <div className="text-xs text-stone-500 mt-2">
            Created {new Date(job.created_at).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

import { Loader2, RefreshCw, X, RotateCcw, Info, AlertCircle } from 'lucide-react';
import type { Job, JobType } from '@/lib/types/job';
import { PROCESSING_ACTION_LABELS, PROCESSING_ACTION_CSS_COLORS, type ProcessingAction } from '@/lib/style-constants';

interface JobStatusBannerProps {
  job: Job;
  loading: boolean;
  cancelling: boolean;
  retrying: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}

const actionConfig: Record<JobType, { label: string; color: string }> = Object.fromEntries(
  (['ocr', 'translation', 'summary', 'image_extraction'] as ProcessingAction[]).map(a => [
    a, { label: PROCESSING_ACTION_LABELS[a], color: PROCESSING_ACTION_CSS_COLORS[a] }
  ])
) as Record<JobType, { label: string; color: string }>;

export default function JobStatusBanner({
  job,
  loading,
  cancelling,
  retrying,
  onRefresh,
  onCancel,
  onRetry,
  onClose
}: JobStatusBannerProps) {
  const isProcessing = job.status === 'processing' || job.status === 'pending';
  const isCancelled = job.status === 'cancelled';
  const hasFailed = (job.progress.failed || 0) > 0;

  // Color scheme based on status
  const bgColor = isCancelled ? 'bg-stone-50' : hasFailed ? 'bg-red-50' : 'bg-blue-50';
  const borderColor = isCancelled ? 'border-stone-200' : hasFailed ? 'border-red-200' : 'border-blue-200';
  const textColor = isCancelled ? 'text-stone-900' : hasFailed ? 'text-red-900' : 'text-blue-900';
  const subTextColor = isCancelled ? 'text-stone-700' : hasFailed ? 'text-red-700' : 'text-blue-700';
  const iconColor = isCancelled ? 'text-stone-600' : hasFailed ? 'text-status-error' : 'text-blue-600';
  const progressBg = isCancelled ? 'bg-stone-200' : hasFailed ? 'bg-red-200' : 'bg-blue-200';
  const progressBar = isCancelled ? 'bg-stone-600' : hasFailed ? 'bg-status-error' : 'bg-blue-600';

  return (
    <div className={`${bgColor} rounded-xl border ${borderColor} p-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isProcessing ? (
            <Loader2 className={`w-5 h-5 ${iconColor} animate-spin`} />
          ) : isCancelled ? (
            <Info className={`w-5 h-5 ${iconColor}`} />
          ) : (
            <AlertCircle className={`w-5 h-5 ${iconColor}`} />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${textColor}`}>
                {isProcessing ? `${actionConfig[job.type].label} in progress` :
                 isCancelled ? `${actionConfig[job.type].label} cancelled` :
                 `${actionConfig[job.type].label} completed with errors`}
              </span>
              <span className={`text-xs ${isCancelled ? 'text-stone-600 bg-stone-100' : hasFailed ? 'text-status-error bg-red-100' : 'text-blue-600 bg-blue-100'} px-2 py-0.5 rounded`}>
                {job.status}
              </span>
            </div>
            <div className={`text-xs ${subTextColor} mt-1`}>
              {job.progress.completed} / {job.progress.total} pages completed
              {hasFailed && ` • ${job.progress.failed} failed`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <>
              <button
                onClick={onRefresh}
                disabled={loading || cancelling}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={onCancel}
                disabled={cancelling || loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-status-error text-white rounded-lg hover:bg-status-error/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cancelling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <X className="w-3.5 h-3.5" />
                )}
                {cancelling ? 'Cancelling...' : 'Cancel'}
              </button>
            </>
          )}
          {hasFailed && !isProcessing && (
            <>
              <button
                onClick={onRetry}
                disabled={retrying}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {retrying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                {retrying ? 'Retrying...' : 'Retry Failed'}
              </button>
              <button
                onClick={onClose}
                disabled={retrying}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-stone-700 rounded-lg hover:bg-stone-100 border border-stone-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="w-3.5 h-3.5" />
                Close
              </button>
            </>
          )}
          {isCancelled && (
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-stone-700 rounded-lg hover:bg-stone-100 border border-stone-300"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          )}
        </div>
      </div>
      {/* Progress bar */}
      <div className={`mt-3 h-2 ${progressBg} rounded-full overflow-hidden`}>
        <div
          className={`h-full ${progressBar} transition-all duration-300`}
          style={{ width: `${(job.progress.completed / job.progress.total) * 100}%` }}
        />
      </div>
    </div>
  );
}

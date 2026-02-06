import Link from 'next/link';
import { X, RotateCcw, CheckCircle, XCircle, Clock, Loader2, Pause } from 'lucide-react';
import type { Job, JobStatus, JobType } from '@/lib/types';

const STATUS_COLORS: Record<JobStatus, string> = {
    pending: 'var(--text-muted)',
    completed: 'var(--accent-sage)',
    partial: 'var(--accent-gold)',
    processing: 'var(--accent-sage)',
    failed: 'var(--accent-rust)',
    cancelled: 'var(--text-gold)',
};

const STATUS_ICONS: Record<JobStatus, typeof CheckCircle> = {
    pending: Clock,
    completed: CheckCircle,
    partial: XCircle,
    processing: Loader2,
    failed: XCircle,
    cancelled: X,
};

interface JobCardProps {
    job: Job;
    onRetry: (jobId: string) => void;
    onDelete: (jobId: string) => void;
}

function getJobTypeLabel(type: JobType) {
    switch (type) {
        case 'ocr':
            return 'OCR';
        case 'translation':
            return 'Translation';
        case 'image_extraction':
            return 'Image Extraction';
    }
}

function getFailed(job: Job) {
    return job.progress.failed ??= 0; // Ensure backward compatibility if 'failed' is missing    
}


function getProgress(job: Job) {
    if (job.progress.total === 0) return 0;
    const completed = job.progress.completed ?? 0;
    return Math.round((completed / job.progress.total) * 100);
}

function formatDate(date: Date | string) {
    return new Date(date).toLocaleString();
}

export function JobCard({ job, onRetry, onDelete }: JobCardProps) {
    const StatusIcon = STATUS_ICONS[job.status];
    const progress = getProgress(job);

    return (
        <div
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
                        <span className='capitalize'>
                            {getJobTypeLabel(job.type)}
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
                    {job.config && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono">
                                {job.config.model}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                                {job.config.language}
                            </span>
                            {job.progress?.total > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                                    {job.progress.total} pages
                                </span>
                            )}
                            {job.config.prompt_name !== 'Standard OCR' && job.config.prompt_name !== 'Standard Translation' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">
                                    {job.config.prompt_name}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {job.status === 'partial' && (
                        <button
                            onClick={() => onRetry(job.id)}
                            className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                            title="Retry failed pages"
                        >
                            <RotateCcw className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                        </button>
                    )}
                    <button
                        onClick={() => onDelete(job.id)}
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
                        {job.progress.completed} / {job.progress.total} Completed
                        {getFailed(job) > 0 && (
                            <span style={{ color: 'var(--accent-rust)' }}> • {getFailed(job)} failed</span>
                        )}
                    </span>
                    <span>{progress}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                    <div
                        className="h-full rounded-full transition-all"
                        style={{
                            width: `${progress}%`,
                            background: getFailed(job) > 0 ? 'var(--accent-rust)' : 'var(--accent-sage)',
                        }}
                    />
                </div>
            </div>

            {/* Current item */}
            {/* TODO: REMOVE IF NOT NEEDED */}
            {/* {job.progress.currentItem && job.status === 'processing' && (
                <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                    Processing: {job.progress.currentItem}
                </div>
            )} */}

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

            {/* Footer info */}
            <div className="flex justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
                <span>Created: {formatDate(job.created_at)}</span>
                {job.completed_at && (
                    <span>Completed: {formatDate(job.completed_at)}</span>
                )}
            </div>
        </div>
    );
}

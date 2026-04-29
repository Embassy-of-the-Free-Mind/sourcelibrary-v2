import { Zap, BookOpen, FileText, Cloud } from 'lucide-react';
import type { PendingStats } from '@/lib/api-client';

interface StatsCardsProps {
    stats: PendingStats;
    activeJobsCount: number;
    ocrJobsCount: number;
    translationJobsCount: number;
}

export function StatsCards({
    stats,
    activeJobsCount,
    ocrJobsCount,
    translationJobsCount,
}: StatsCardsProps) {
    const estimatedCost =
        stats.total_pages_needing_ocr * 0.0025 +
        stats.total_pages_needing_translation * 0.0015;

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div
                className="p-4 rounded-xl"
                style={{
                    background: 'var(--bg-white)',
                    border: '1px solid var(--border-light)',
                }}
            >
                <div
                    className="flex items-center gap-2 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                >
                    <Zap className="w-4 h-4" />
                    Active Jobs
                </div>
                <div
                    className="text-2xl font-medium mt-1"
                    style={{ color: 'var(--text-primary)' }}
                >
                    {activeJobsCount}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                    {ocrJobsCount} OCR, {translationJobsCount} translating
                </div>
            </div>

            <div
                className="p-4 rounded-xl"
                style={{
                    background: 'var(--bg-white)',
                    border: '1px solid var(--border-light)',
                }}
            >
                <div
                    className="flex items-center gap-2 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                >
                    <BookOpen className="w-4 h-4" />
                    Needs OCR
                </div>
                <div
                    className="text-2xl font-medium mt-1"
                    style={{ color: 'var(--accent-gold)' }}
                >
                    {stats.total_pages_needing_ocr.toLocaleString()}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                    {stats.books_needing_ocr} books
                </div>
            </div>

            <div
                className="p-4 rounded-xl"
                style={{
                    background: 'var(--bg-white)',
                    border: '1px solid var(--border-light)',
                }}
            >
                <div
                    className="flex items-center gap-2 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                >
                    <FileText className="w-4 h-4" />
                    Needs Translation
                </div>
                <div
                    className="text-2xl font-medium mt-1"
                    style={{ color: 'var(--accent-sage)' }}
                >
                    {stats.total_pages_needing_translation.toLocaleString()}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                    {stats.books_needing_translation} books
                </div>
            </div>

            <div
                className="p-4 rounded-xl"
                style={{
                    background: 'var(--bg-white)',
                    border: '1px solid var(--border-light)',
                }}
            >
                <div
                    className="flex items-center gap-2 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                >
                    <Cloud className="w-4 h-4" />
                    Est. Cost (Batch)
                </div>
                <div
                    className="text-2xl font-medium mt-1"
                    style={{ color: 'var(--accent-rust)' }}
                >
                    ${estimatedCost.toFixed(0)}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                    50% off with Batch API
                </div>
            </div>
        </div>
    );
}

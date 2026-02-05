'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { queueBooks } from '@/lib/api-client';

interface CreateBatchJobsProps {
    onJobsCreated: () => void;
}

export function CreateBatchJobs({ onJobsCreated }: CreateBatchJobsProps) {
    const [creatingJobs, setCreatingJobs] = useState(false);
    const [createResult, setCreateResult] = useState<string | null>(null);
    const BOOKS_BATCH_SIZE = 10;

    const handleCreateBatchJobs = async () => {
        setCreatingJobs(true);
        setCreateResult(null);
        try {
            const data = await queueBooks({ auto: true, limit: BOOKS_BATCH_SIZE });
            const jobCount = data.jobIds?.length || 0;
            setCreateResult(`Queued ${jobCount} books for processing`);
            onJobsCreated();
        } catch (e) {
            setCreateResult(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        } finally {
            setCreatingJobs(false);
            setTimeout(() => setCreateResult(null), 5000);
        }
    };

    return (
        <div className="mb-6 p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center justify-between">
                <div>
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Queue Books</div>
                    <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Create jobs for books needing OCR or translation.
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {createResult && (
                        <span className={`text-sm px-3 py-1 rounded-lg ${createResult.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {createResult}
                        </span>
                    )}
                    <button
                        onClick={handleCreateBatchJobs}
                        disabled={creatingJobs}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ background: 'var(--accent-rust)' }}
                    >
                        {creatingJobs ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Plus className="w-4 h-4" />
                        )}
                        Queue {BOOKS_BATCH_SIZE} Books
                    </button>
                </div>
            </div>
        </div>
    );
}

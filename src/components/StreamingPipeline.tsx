'use client';

import { useState, useEffect, useCallback } from 'react';
import { Zap, Loader2, Play, Square, CheckCircle, XCircle, Clock } from 'lucide-react';

interface StreamingPipelineProps {
  bookId: string;
  bookTitle: string;
  language: string;
}

interface PipelineStats {
  total: number;
  needsOcr: number;
  needsTranslation: number;
  hasCropSettings: number;
}

interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  currentItem?: string;
}

interface JobState {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
  progress: JobProgress;
  results: Array<{ pageId: string; success: boolean; error?: string; duration?: number }>;
  created_at: string;
  updated_at: string;
}

export default function StreamingPipeline({ bookId, bookTitle, language }: StreamingPipelineProps) {
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [model, setModel] = useState('gemini-2.5-flash');
  const [parallelPages, setParallelPages] = useState(3);
  const [overwrite, setOverwrite] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/pipeline-stream`);
      if (res.ok) {
        const data = await res.json();
        if (data.active && data.job) {
          setJob(data.job);
          setStats(null);
        } else {
          setJob(null);
          setStats(data.stats);
        }
      }
    } catch (error) {
      console.error('Error fetching pipeline status:', error);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll when job is active
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return;
    }

    const interval = setInterval(async () => {
      // Trigger processing
      await fetch(`/api/books/${bookId}/pipeline-stream/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      }).catch(() => {});

      // Then fetch status
      await fetchStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [job, bookId, fetchStatus]);

  const startPipeline = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/books/${bookId}/pipeline-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, language, parallelPages, overwrite }),
      });

      if (res.ok) {
        await fetchStatus();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to start pipeline');
      }
    } catch (error) {
      console.error('Error starting pipeline:', error);
    } finally {
      setStarting(false);
    }
  };

  const cancelPipeline = async () => {
    try {
      await fetch(`/api/books/${bookId}/pipeline-stream`, { method: 'DELETE' });
      await fetchStatus();
    } catch (error) {
      console.error('Error cancelling pipeline:', error);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-stone-200 p-6">
        <div className="flex items-center gap-2 text-stone-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  const progressPercent = job?.progress
    ? Math.round(((job.progress.completed + job.progress.failed) / job.progress.total) * 100)
    : 0;

  const isActive = job && !['completed', 'failed', 'cancelled'].includes(job.status);

  return (
    <div className="bg-white rounded-lg border border-stone-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-600" />
          <h3 className="text-lg font-semibold text-stone-900">Streaming Pipeline</h3>
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Experimental</span>
        </div>
      </div>

      <p className="text-sm text-stone-600 mb-4">
        Processes each page fully (crop → OCR → translate) before moving to the next.
        More efficient than batch processing — no waiting for all images before OCR starts.
      </p>

      {/* Stats when idle */}
      {!job && stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-stone-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-stone-900">{stats.total}</div>
            <div className="text-xs text-stone-500">Total Pages</div>
          </div>
          <div className="bg-stone-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-600">{stats.needsOcr}</div>
            <div className="text-xs text-stone-500">Need OCR</div>
          </div>
          <div className="bg-stone-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.needsTranslation}</div>
            <div className="text-xs text-stone-500">Need Translation</div>
          </div>
          <div className="bg-stone-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.hasCropSettings}</div>
            <div className="text-xs text-stone-500">Split Pages</div>
          </div>
        </div>
      )}

      {/* Active job progress */}
      {job && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {job.status === 'processing' && (
                <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
              )}
              {job.status === 'completed' && (
                <CheckCircle className="w-4 h-4 text-green-600" />
              )}
              {job.status === 'failed' && (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
              {job.status === 'cancelled' && (
                <Square className="w-4 h-4 text-stone-400" />
              )}
              <span className="text-sm font-medium text-stone-700 capitalize">
                {job.status}
                {job.progress.currentItem && (
                  <span className="text-stone-500 ml-2">— {job.progress.currentItem}</span>
                )}
              </span>
            </div>
            <span className="text-sm text-stone-500">
              {job.progress.completed} / {job.progress.total} pages
              {job.progress.failed > 0 && (
                <span className="text-red-600 ml-1">({job.progress.failed} failed)</span>
              )}
            </span>
          </div>

          <div className="w-full bg-stone-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                job.status === 'completed' ? 'bg-green-500' :
                job.status === 'failed' ? 'bg-red-500' :
                job.status === 'cancelled' ? 'bg-stone-400' : 'bg-amber-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Recent results */}
          {job.results.length > 0 && (
            <div className="mt-4">
              <div className="text-xs text-stone-500 mb-2">Recent:</div>
              <div className="flex flex-wrap gap-1">
                {job.results.slice(-20).map((r, i) => (
                  <div
                    key={i}
                    className={`w-6 h-6 rounded text-xs flex items-center justify-center ${
                      r.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                    title={r.success ? `${Math.round((r.duration || 0) / 1000)}s` : r.error}
                  >
                    {r.success ? '✓' : '✗'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      {!isActive && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (recommended)</option>
                <option value="gemini-3-flash-preview">Gemini 3 Flash (for complex layouts)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Parallel Pages</label>
              <select
                value={parallelPages}
                onChange={(e) => setParallelPages(Number(e.target.value))}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value={1}>1 (sequential, best context)</option>
                <option value={2}>2</option>
                <option value={3}>3 (balanced)</option>
                <option value={5}>5 (faster)</option>
              </select>
            </div>
          </div>

          <button
            onClick={startPipeline}
            disabled={starting || !!(stats && stats.needsCrop + stats.needsOcr + stats.needsTranslation === 0)}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {starting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Play className="w-5 h-5" />
            )}
            {starting ? 'Starting...' : 'Start Streaming Pipeline'}
          </button>
        </div>
      )}

      {isActive && (
        <button
          onClick={cancelPipeline}
          className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-stone-600 text-white rounded-lg hover:bg-stone-700 transition-colors"
        >
          <Square className="w-4 h-4" />
          Cancel
        </button>
      )}

      {/* Comparison note */}
      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <div className="flex items-start gap-2">
          <Clock className="w-4 h-4 text-blue-600 mt-0.5" />
          <div className="text-xs text-blue-800">
            <strong>vs Batch Processing:</strong> The streaming pipeline starts translating as soon as each page's
            OCR completes, rather than waiting for all pages. For a 100-page book, this can save 30-50% time.
          </div>
        </div>
      </div>
    </div>
  );
}

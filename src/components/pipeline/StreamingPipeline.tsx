'use client';

import { useState, useEffect, useCallback } from 'react';
import { Zap, Loader2, Play, Square, CheckCircle, XCircle, Clock } from 'lucide-react';
import { books, streamRequest } from '@/lib/api-client';

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
  const [model, setModel] = useState('gemini-3-flash-preview');
  const [parallelPages, setParallelPages] = useState(3);
  const [overwrite, setOverwrite] = useState(false);
  const [pollErrors, setPollErrors] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<boolean> => {
    try {
      // Use API client with auth and tracking
      const res = await streamRequest(`/api/books/${bookId}/pipeline-stream`);
      const data = await res.json();
      if (data.active && data.job) {
        setJob(data.job);
        setStats(null);
      } else {
        setJob(null);
        setStats(data.stats);
      }
      setPollErrors(0);
      setLastError(null);
      return true;
    } catch (error) {
      console.error('Error fetching pipeline status:', error);
      return false;
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

    // Stop polling after too many consecutive errors
    if (pollErrors >= 5) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        // Trigger processing using API client
        await books.pipelineStream.process(bookId, { jobId: job.id });

        // Then fetch status
        const success = await fetchStatus();
        if (!success) {
          throw new Error('Failed to fetch pipeline status');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Pipeline poll error:', errorMsg);
        setPollErrors(prev => prev + 1);
        setLastError(errorMsg);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [job, bookId, fetchStatus, pollErrors]);

  const startPipeline = async () => {
    setStarting(true);
    setLastError(null);
    try {
      // Use API client to start pipeline with streaming
      await books.pipelineStream.start(bookId, { model, language, parallelPages, overwrite });
      await fetchStatus();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error starting pipeline:', msg);
      setLastError(msg);
    } finally {
      setStarting(false);
    }
  };

  const cancelPipeline = async () => {
    try {
      // Use API client to cancel pipeline
      await books.pipelineStream.cancel(bookId);
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

          {/* Failed pages details */}
          {job.results.filter(r => !r.success).length > 0 && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800">
                    {job.results.filter(r => !r.success).length} page(s) failed
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-red-700">
                    {job.results
                      .filter(r => !r.success)
                      .slice(-5)
                      .map((r, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className="text-red-400">•</span>
                          <span>{r.error || 'Unknown error'}</span>
                        </li>
                      ))}
                    {job.results.filter(r => !r.success).length > 5 && (
                      <li className="text-red-500 italic">
                        ...and {job.results.filter(r => !r.success).length - 5} more
                      </li>
                    )}
                  </ul>
                  {/* Retry button - only show when job is done */}
                  {['completed', 'failed', 'cancelled'].includes(job.status) && (
                    <button
                      onClick={() => {
                        setJob(null);
                        startPipeline();
                      }}
                      disabled={starting}
                      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {starting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Retry failed pages
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error state */}
          {pollErrors >= 5 && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800">Pipeline stalled</p>
                  <p className="text-xs text-red-600 mt-1">
                    {lastError || 'Multiple consecutive errors occurred'}
                  </p>
                  <button
                    onClick={() => {
                      setPollErrors(0);
                      setLastError(null);
                      fetchStatus();
                    }}
                    className="mt-2 text-xs text-red-700 underline hover:text-red-900"
                  >
                    Retry
                  </button>
                </div>
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
                <option value="gemini-3-flash-preview">Gemini 3 Flash (recommended)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (lower cost)</option>
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

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="w-4 h-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-sm text-stone-700">
              Overwrite existing OCR/translation
              <span className="text-stone-500 ml-1">(re-process all pages)</span>
            </span>
          </label>

          {/* Error message */}
          {lastError && !job && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{lastError}</p>
              </div>
            </div>
          )}

          <button
            onClick={startPipeline}
            disabled={starting || (!overwrite && !!stats && stats.needsOcr + stats.needsTranslation === 0)}
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

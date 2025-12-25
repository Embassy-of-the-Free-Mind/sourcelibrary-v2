'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PipelineState, PipelineStep, PipelineConfig } from '@/lib/types';

interface PipelineData {
  bookId: string;
  bookTitle: string;
  language: string;
  pagesCount: number;
  pipeline: PipelineState | null;
}

interface UsePipelineResult {
  data: PipelineData | null;
  loading: boolean;
  error: string | null;
  isRunning: boolean;
  start: (config: Partial<PipelineConfig>) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  reset: () => Promise<void>;
  refetch: () => Promise<void>;
}

const STEP_ORDER: PipelineStep[] = ['split_check', 'ocr', 'translate', 'summarize', 'edition'];

export function usePipeline(bookId: string): UsePipelineResult {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isExecutingRef = useRef(false);
  const shouldStopRef = useRef(false);

  // Fetch pipeline state
  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/pipeline`);
      if (!res.ok) {
        throw new Error('Failed to fetch pipeline');
      }
      const pipelineData = await res.json();
      setData(pipelineData);
      setError(null);
      return pipelineData;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, [bookId]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchPipeline().finally(() => setLoading(false));
  }, [fetchPipeline]);

  // Polling while running
  useEffect(() => {
    if (data?.pipeline?.status !== 'running') return;

    const interval = setInterval(() => {
      fetchPipeline();
    }, 2000);

    return () => clearInterval(interval);
  }, [data?.pipeline?.status, fetchPipeline]);

  // Get next pending step
  const getNextStep = useCallback((pipeline: PipelineState): PipelineStep | null => {
    for (const step of STEP_ORDER) {
      const stepState = pipeline.steps[step];
      if (stepState.status === 'pending') {
        return step;
      }
    }
    return null;
  }, []);

  // Poll job until complete
  const pollJob = useCallback(async (jobId: string, step: PipelineStep): Promise<boolean> => {
    while (!shouldStopRef.current) {
      // Process next chunk
      const processRes = await fetch(`/api/jobs/${jobId}/process`, {
        method: 'POST',
      });

      if (!processRes.ok) {
        console.error('Job processing failed');
        return false;
      }

      const processData = await processRes.json();

      // Update pipeline with job progress
      await fetch(`/api/books/${bookId}/pipeline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          progress: processData.job?.progress,
        }),
      });

      // Refresh UI
      await fetchPipeline();

      // Check if done
      if (processData.done) {
        // Mark step as completed
        await fetch(`/api/books/${bookId}/pipeline`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step,
            status: processData.job?.progress?.failed > 0 && processData.job?.progress?.completed === 0
              ? 'failed'
              : 'completed',
          }),
        });
        return true;
      }

      if (processData.paused) {
        return false;
      }

      // Small delay between chunks
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return false;
  }, [bookId, fetchPipeline]);

  // Execute steps sequentially
  const runSteps = useCallback(async () => {
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;
    shouldStopRef.current = false;

    try {
      while (!shouldStopRef.current) {
        // Fetch latest state
        const latest = await fetchPipeline();
        if (!latest?.pipeline) break;

        const pipeline = latest.pipeline;

        // Check if we should stop
        if (pipeline.status !== 'running') {
          break;
        }

        // Get next step
        const nextStep = getNextStep(pipeline);
        if (!nextStep) {
          break;
        }

        // Execute step
        const res = await fetch(`/api/books/${bookId}/pipeline/step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: nextStep }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error('Step execution failed:', errorData);
          break;
        }

        const result = await res.json();

        // If a job was created, poll it until complete
        if (result.status === 'job_created' && result.jobId) {
          const jobCompleted = await pollJob(result.jobId, nextStep);
          if (!jobCompleted) {
            break;
          }
          // Continue to next step
          continue;
        }

        // If step failed or no next step, stop
        if (result.status === 'failed' || !result.nextStep) {
          break;
        }
      }
    } finally {
      isExecutingRef.current = false;
      await fetchPipeline();
    }
  }, [bookId, fetchPipeline, getNextStep, pollJob]);

  // Start pipeline
  const start = useCallback(async (config: Partial<PipelineConfig>) => {
    setError(null);

    const res = await fetch(`/api/books/${bookId}/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', config }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      setError(errorData.error || 'Failed to start pipeline');
      return;
    }

    await fetchPipeline();

    // Start executing steps
    runSteps();
  }, [bookId, fetchPipeline, runSteps]);

  // Pause pipeline
  const pause = useCallback(async () => {
    shouldStopRef.current = true;

    const res = await fetch(`/api/books/${bookId}/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      setError(errorData.error || 'Failed to pause pipeline');
      return;
    }

    await fetchPipeline();
  }, [bookId, fetchPipeline]);

  // Resume pipeline
  const resume = useCallback(async () => {
    const res = await fetch(`/api/books/${bookId}/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      setError(errorData.error || 'Failed to resume pipeline');
      return;
    }

    await fetchPipeline();

    // Continue executing steps
    runSteps();
  }, [bookId, fetchPipeline, runSteps]);

  // Reset pipeline
  const reset = useCallback(async () => {
    shouldStopRef.current = true;

    const res = await fetch(`/api/books/${bookId}/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      setError(errorData.error || 'Failed to reset pipeline');
      return;
    }

    await fetchPipeline();
  }, [bookId, fetchPipeline]);

  const isRunning = data?.pipeline?.status === 'running';

  return {
    data,
    loading,
    error,
    isRunning,
    start,
    pause,
    resume,
    reset,
    refetch: fetchPipeline,
  };
}

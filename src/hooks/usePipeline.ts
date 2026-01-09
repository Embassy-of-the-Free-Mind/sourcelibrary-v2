'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PipelineState, PipelineStep, PipelineConfig } from '@/lib/types';
import { books, jobs } from '@/lib/api-client';

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

const STEP_ORDER: PipelineStep[] = ['crop', 'ocr', 'translate', 'summarize', 'edition'];

export function usePipeline(bookId: string): UsePipelineResult {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isExecutingRef = useRef(false);
  const shouldStopRef = useRef(false);

  // Fetch pipeline state
  const fetchPipeline = useCallback(async () => {
    try {
      const pipelineData = await books.pipeline.get(bookId);
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
      try {
        const processData = await jobs.process(jobId);

        // Update pipeline with job progress
        await books.pipeline.get(bookId); // Trigger pipeline refresh

        // Refresh UI
        await fetchPipeline();

        // Check if done
        if (processData.done) {
          // Pipeline will auto-update status via API
          return true;
        }

        if (processData.paused) {
          return false;
        }

        // Small delay between chunks
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error('Job processing failed:', err);
        return false;
      }
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
        try {
          const result = await books.pipeline.step(bookId, nextStep);

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
        } catch (err) {
          console.error('Step execution failed:', err);
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

    try {
      await books.pipeline.start(bookId, { action: 'start', config });
      await fetchPipeline();
      // Start executing steps
      runSteps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start pipeline');
    }
  }, [bookId, fetchPipeline, runSteps]);

  // Pause pipeline
  const pause = useCallback(async () => {
    shouldStopRef.current = true;

    try {
      await books.pipeline.start(bookId, { action: 'pause' });
      await fetchPipeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause pipeline');
    }
  }, [bookId, fetchPipeline]);

  // Resume pipeline
  const resume = useCallback(async () => {
    try {
      await books.pipeline.start(bookId, { action: 'resume' });
      await fetchPipeline();
      // Continue executing steps
      runSteps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume pipeline');
    }
  }, [bookId, fetchPipeline, runSteps]);

  // Reset pipeline
  const reset = useCallback(async () => {
    shouldStopRef.current = true;

    try {
      await books.pipeline.start(bookId, { action: 'reset' });
      await fetchPipeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset pipeline');
    }
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

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createLoadingTimer, recordLoadingMetric, getWebVitals } from '@/lib/analytics';

/**
 * Hook to track component mount/loading time
 */
export function useLoadingMetrics(name: string, metadata?: Record<string, unknown>) {
  const timerRef = useRef<ReturnType<typeof createLoadingTimer> | null>(null);
  const hasRecorded = useRef(false);

  useEffect(() => {
    // Start timer on mount
    timerRef.current = createLoadingTimer(name, metadata);

    return () => {
      // Record on unmount if not already recorded
      if (timerRef.current && !hasRecorded.current) {
        timerRef.current.stop();
        hasRecorded.current = true;
      }
    };
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual completion (for when content is actually loaded)
  const markLoaded = useCallback(() => {
    if (timerRef.current && !hasRecorded.current) {
      timerRef.current.stop();
      hasRecorded.current = true;
    }
  }, []);

  return { markLoaded };
}

/**
 * Hook to track page load metrics including Web Vitals
 */
export function usePageMetrics(pageName: string) {
  useEffect(() => {
    // Record page view
    recordLoadingMetric(`page_view_${pageName}`, 0, {
      url: window.location.pathname,
      referrer: document.referrer,
    });

    // Record Web Vitals after page is interactive
    const recordVitals = () => {
      const vitals = getWebVitals();
      vitals.forEach((vital) => {
        recordLoadingMetric(`${pageName}_${vital.name}`, vital.duration, {
          entryType: vital.entryType,
        });
      });
    };

    // Wait for page to fully load
    if (document.readyState === 'complete') {
      setTimeout(recordVitals, 100);
    } else {
      window.addEventListener('load', () => setTimeout(recordVitals, 100));
    }
  }, [pageName]);
}

/**
 * Hook to track async data fetching
 */
export function useFetchMetrics() {
  const track = useCallback(
    async <T>(
      name: string,
      fetchFn: () => Promise<T>,
      metadata?: Record<string, unknown>
    ): Promise<T> => {
      const timer = createLoadingTimer(name, metadata);
      try {
        const result = await fetchFn();
        timer.stop();
        return result;
      } catch (error) {
        recordLoadingMetric(`${name}_error`, timer.elapsed(), {
          ...metadata,
          error: error instanceof Error ? error.message : 'Unknown',
        });
        throw error;
      }
    },
    []
  );

  return { track };
}

/**
 * Loading Analytics - Track and record loading performance metrics
 *
 * This module provides utilities to measure and report loading times
 * for pages, components, and async operations.
 */

export interface LoadingMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceEntry {
  name: string;
  startTime: number;
  duration: number;
  entryType: string;
}

// In-memory storage for metrics (can be extended to persist)
const metrics: LoadingMetric[] = [];

// Configuration
const config = {
  enabled: typeof window !== 'undefined',
  sampleRate: 1.0, // 100% of events
  maxStoredMetrics: 100,
  endpoint: '/api/analytics/loading', // Optional: API endpoint for sending metrics
  batchSize: 10,
  flushInterval: 30000, // 30 seconds
};

/**
 * Record a loading metric
 */
export function recordLoadingMetric(
  name: string,
  duration: number,
  metadata?: Record<string, unknown>
): void {
  if (!config.enabled) return;
  if (Math.random() > config.sampleRate) return;

  const metric: LoadingMetric = {
    name,
    duration,
    timestamp: Date.now(),
    metadata,
  };

  metrics.push(metric);

  // Keep metrics array bounded
  if (metrics.length > config.maxStoredMetrics) {
    metrics.shift();
  }

  // Log in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Loading Analytics] ${name}: ${duration.toFixed(2)}ms`, metadata || '');
  }
}

/**
 * Create a timer for measuring loading duration
 */
export function createLoadingTimer(name: string, metadata?: Record<string, unknown>) {
  const startTime = performance.now();

  return {
    stop: () => {
      const duration = performance.now() - startTime;
      recordLoadingMetric(name, duration, metadata);
      return duration;
    },
    elapsed: () => performance.now() - startTime,
  };
}

/**
 * Higher-order function to wrap async operations with timing
 */
export async function withLoadingMetrics<T>(
  name: string,
  operation: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const timer = createLoadingTimer(name, metadata);
  try {
    const result = await operation();
    timer.stop();
    return result;
  } catch (error) {
    recordLoadingMetric(`${name}_error`, timer.elapsed(), {
      ...metadata,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Get Web Vitals metrics (if available)
 */
export function getWebVitals(): PerformanceEntry[] {
  if (typeof window === 'undefined' || !window.performance) return [];

  const entries: PerformanceEntry[] = [];

  // Navigation timing
  const navEntries = performance.getEntriesByType('navigation');
  if (navEntries.length > 0) {
    const nav = navEntries[0] as PerformanceNavigationTiming;
    entries.push({
      name: 'page_load',
      startTime: 0,
      duration: nav.loadEventEnd - nav.startTime,
      entryType: 'navigation',
    });
    entries.push({
      name: 'dom_content_loaded',
      startTime: 0,
      duration: nav.domContentLoadedEventEnd - nav.startTime,
      entryType: 'navigation',
    });
    entries.push({
      name: 'time_to_first_byte',
      startTime: 0,
      duration: nav.responseStart - nav.requestStart,
      entryType: 'navigation',
    });
  }

  // Largest Contentful Paint
  const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
  if (lcpEntries.length > 0) {
    const lcp = lcpEntries[lcpEntries.length - 1];
    entries.push({
      name: 'largest_contentful_paint',
      startTime: lcp.startTime,
      duration: lcp.startTime,
      entryType: 'largest-contentful-paint',
    });
  }

  // First Input Delay (via first-input)
  const fidEntries = performance.getEntriesByType('first-input');
  if (fidEntries.length > 0) {
    const fid = fidEntries[0] as PerformanceEventTiming;
    entries.push({
      name: 'first_input_delay',
      startTime: fid.startTime,
      duration: fid.processingStart - fid.startTime,
      entryType: 'first-input',
    });
  }

  return entries;
}

/**
 * Get all recorded metrics
 */
export function getMetrics(): LoadingMetric[] {
  return [...metrics];
}

/**
 * Clear all recorded metrics
 */
export function clearMetrics(): void {
  metrics.length = 0;
}

/**
 * Get summary statistics for a specific metric
 */
export function getMetricStats(name: string): {
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
} | null {
  const filtered = metrics.filter((m) => m.name === name);
  if (filtered.length === 0) return null;

  const durations = filtered.map((m) => m.duration).sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);

  return {
    count: durations.length,
    avg: sum / durations.length,
    min: durations[0],
    max: durations[durations.length - 1],
    p50: durations[Math.floor(durations.length * 0.5)],
    p95: durations[Math.floor(durations.length * 0.95)],
  };
}

/**
 * Send metrics to server (batch)
 */
export async function flushMetrics(): Promise<void> {
  if (metrics.length === 0) return;

  const batch = metrics.splice(0, config.batchSize);

  try {
    await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metrics: batch }),
    });
  } catch (error) {
    // Re-add metrics on failure
    metrics.unshift(...batch);
    console.warn('[Loading Analytics] Failed to send metrics:', error);
  }
}

// Auto-flush in browser
if (typeof window !== 'undefined') {
  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    if (metrics.length > 0 && navigator.sendBeacon) {
      navigator.sendBeacon(
        config.endpoint,
        JSON.stringify({ metrics })
      );
    }
  });

  // Periodic flush
  setInterval(flushMetrics, config.flushInterval);
}

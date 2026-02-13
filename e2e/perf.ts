/**
 * E2E performance measurement helpers.
 *
 * Captures Navigation Timing metrics after each page load and writes
 * them to e2e/perf-results.json so we can track regressions over time.
 */
import { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export interface PerfEntry {
  test: string;
  url: string;
  timestamp: string;
  /** Time to first byte (ms) */
  ttfb: number;
  /** DOM content loaded (ms) */
  domContentLoaded: number;
  /** Full page load (ms) */
  pageLoad: number;
  /** DOM interactive (ms) */
  domInteractive: number;
  /** Number of network requests */
  requestCount: number;
  /** Total transfer size (bytes) */
  transferSize: number;
}

const RESULTS_FILE = path.join(__dirname, 'perf-results.json');

/**
 * Measure page performance using the Navigation Timing API.
 * Call after the page has fully loaded and key content is visible.
 */
export async function measurePerf(page: Page, testName: string): Promise<PerfEntry> {
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      ttfb: Math.round(nav.responseStart - nav.startTime),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      pageLoad: Math.round(nav.loadEventEnd - nav.startTime),
      domInteractive: Math.round(nav.domInteractive - nav.startTime),
      requestCount: resources.length,
      transferSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
    };
  });

  const entry: PerfEntry = {
    test: testName,
    url: page.url(),
    timestamp: new Date().toISOString(),
    ...metrics,
  };

  appendResult(entry);
  return entry;
}

/** Append a result to the JSON file (creates if missing, keeps last 500 entries). */
function appendResult(entry: PerfEntry) {
  let results: PerfEntry[] = [];
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
    }
  } catch {
    // Corrupted file — start fresh
  }
  results.push(entry);
  // Keep last 500 entries to avoid unbounded growth
  if (results.length > 500) results = results.slice(-500);
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

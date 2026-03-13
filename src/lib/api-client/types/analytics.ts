/**
 * Analytics API types
 */

export interface AnalyticsStats {
  // Global stats (when no book_id is provided)
  global?: boolean;
  totalReads?: number;
  totalEdits?: number;
  totalBooks?: number;
  totalPages?: number;
  pagesTranslated?: number;

  // Book-specific stats (when book_id is provided)
  book_id?: string;
  reads?: number;
  edits?: number;
}

export interface TrackEventRequest {
  event: string;
  properties?: Record<string, any>;
}

export interface UsageStats {
  summary: {
    totalBooks: number;
    totalPages: number;
    pagesWithOcr: number;
    pagesWithTranslation: number;
    ocrPercentage: number;
    translationPercentage: number;
  };
  modelUsage: Array<{ model: string; count: number }>;
  promptUsage: Array<{ prompt: string; count: number }>;
  recentBooks: Array<{ title: string; author: string; created_at: string; pages_count: number }>;
  costStats?: {
    totalCost: number;
    totalTokens: number;
    costByDay: Array<{ date: string; cost: number; tokens: number }>;
    costByAction: Array<{ action: string; cost: number; count: number }>;
  };
  collectionStats?: {
    blobStorage: {
      pagesWithCroppedPhoto: number;
      pagesWithArchivedPhoto: number;
      totalBlobPages: number;
      booksWithSplitPages: number;
    };
    byLanguage: Array<{ language: string; count: number }>;
    byCategory: Array<{ category: string; count: number }>;
    byImageSource: Array<{ provider: string; count: number }>;
  };
  pipelineHealth?: {
    splitting: {
      needsSplitting: number;
      alreadySplit: number;
      noSplitNeeded: number;
      unchecked: number;
    };
    enrichment: {
      booksWithSummary: number;
      booksWithIndex: number;
      booksWithChapters: number;
      booksWithEditions: number;
      fullyTranslated: number;
    };
    images: {
      pagesWithDetectedImages: number;
      totalDetectedImages: number;
    };
    batchJobs: {
      pending: number;
      processing: number;
      byType: Array<{ type: string; count: number }>;
    };
    workerHealth?: {
      ocrBlocked: number;
      needsAttention: number;
      failuresByCategory: Array<{ category: string; count: number }>;
      highFailureBooks: Array<{
        bookId: string;
        title: string;
        jobCount: number;
        totalPagesFailed: number;
        lastFailure: string;
      }>;
    };
  };
  pipelineFunnel?: Array<{ status: string; count: number }>;
  backlog?: {
    needsOcr: number;
    needsTranslation: number;
    oldOcrPages: number;
  };
  query: { days: number };
}

export interface LoadingMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ProcessingRow {
  book_id: string;
  book_title: string;
  step: 'import' | 'split' | 'archive' | 'thumbnail' | 'ocr' | 'translate' | 'summarize' | 'extract_images' | 'index' | 'pipeline' | 'edition' | 'batch_job';
  model?: string;
  prompt_version?: string;
  mode?: 'realtime' | 'batch';
  date_start: string;
  date_end?: string;
  pages: number;
  cost_usd: number;
  success_count: number;
  failed_count: number;
}

export interface ProcessingOverviewResponse {
  rows: ProcessingRow[];
  total: number;
  summary: {
    total_steps: number;
    total_cost: number;
    books_processed: number;
    pages_processed: number;
  };
}

// --- Performance ---

export interface MetricStat {
  name: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number | null;
  p95: number | null;
}

export interface SourceStat {
  source: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number | null;
  p95: number | null;
}

export interface RecentSample {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceData {
  stats: MetricStat[];
  sourceStats: SourceStat[];
  recentSamples: RecentSample[];
  query: { hours: number; metricName: string | null };
}

// --- Pipeline ---

export interface PipelineVelocity {
  ocr_per_hour: number;
  translate_per_hour: number;
  books_completing_per_day: number;
  period_hours: number;
}

export interface PipelineSnapshot {
  timestamp: string;
  funnel?: Record<string, number>;
  pages?: { ocr?: number; translated?: number };
  books?: Record<string, number>;
  active_batch?: Record<string, number>;
}

export interface PipelineStall {
  stage: string;
  direction: 'growing' | 'shrinking' | 'stalled';
  delta: number;
  current: number;
}

export interface CronHealthEntry {
  lastRun: string | null;
  lastDuration: number;
  runsInPeriod: number;
  failures: number;
  avgDuration: number;
  recentErrors: string[];
}

export interface PipelineError {
  type: string;
  category: string;
  count: number;
  lastError?: string;
  lastAt?: string;
}

export interface PipelineAttentionBook {
  id: string;
  title: string;
  language?: string;
  pages: number;
  ocr: number;
  translated: number;
  status?: string;
  error?: string;
  lastUpdated?: string;
  retryCount: number;
  provider?: string;
}

export interface PipelineDecision {
  cron: string;
  timestamp: string;
  type?: string;
  reason?: string;
  data?: unknown;
}

export interface PipelineData {
  snapshots: PipelineSnapshot[];
  velocity: PipelineVelocity;
  cronHealth: Record<string, CronHealthEntry>;
  stalls: PipelineStall[];
  needsAttention: PipelineAttentionBook[];
  recentErrors: PipelineError[];
  recentDecisions: PipelineDecision[];
  query: { hours: number };
}

// --- Search Analytics ---

export interface SearchQuery {
  query: string;
  count: number;
  avg_results?: number;
  last_searched?: string;
}

export interface SearchAnalyticsData {
  totalSearches: number;
  topQueries: SearchQuery[];
  zeroResultQueries: SearchQuery[];
  searchesBySource: Array<{ source: string; count: number }>;
  searchesByDay?: Array<{ date: string; count: number; uniqueQueries?: number }>;
}

// --- Traffic ---

export interface TrafficData {
  topPages?: Array<{ path: string; count: number }>;
  topReferrers?: Array<{ referrer: string; count: number }>;
  topCountries?: Array<{ country: string; count: number }>;
  totalVisitors?: number;
  totalPageviews?: number;
  visitorsByHour?: Array<{ hour: string; visitors: number; pageviews: number }>;
  error?: string;
}

// Note: JobLog is defined in ./jobs.ts to avoid duplication

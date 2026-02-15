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
  step: 'import' | 'split' | 'archive' | 'thumbnail' | 'ocr' | 'translate' | 'summarize' | 'extract_images' | 'index';
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

// Note: JobLog is defined in ./jobs.ts to avoid duplication

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
    totalHits: number;
    uniqueVisitors: number;
  };
  hitsByDay: Array<{ date: string; hits: number; uniqueVisitors: number }>;
  processingByDay: Array<{ date: string; ocr: number; translation: number }>;
  modelUsage: Array<{ model: string; count: number }>;
  promptUsage: Array<{ prompt: string; count: number }>;
  recentBooks: Array<{ title: string; author: string; created_at: string; pages_count: number }>;
  visitorsByCountry: Array<{ country: string; countryCode: string; hits: number; visitors: number }>;
  visitorLocations: Array<{ city: string; country: string; countryCode: string; hits: number; lat: number; lon: number }>;
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

// Note: JobLog is defined in ./jobs.ts to avoid duplication

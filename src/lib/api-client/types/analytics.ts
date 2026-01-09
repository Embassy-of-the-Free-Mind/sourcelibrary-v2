/**
 * Analytics API types
 */

export interface AnalyticsStats {
  totalBooks: number;
  totalPages: number;
  pagesWithOcr: number;
  pagesWithTranslation: number;
  recentActivity: Array<{
    date: string;
    ocr: number;
    translation: number;
  }>;
}

export interface TrackEventRequest {
  event: string;
  properties?: Record<string, any>;
}

export interface UsageStats {
  global?: boolean;
  totalReads?: number;
  totalEdits?: number;
  totalBooks?: number;
  totalPages?: number;
  pagesTranslated?: number;
  gemini?: {
    requestsToday: number;
    requestsThisMonth: number;
    lastReset: string;
  };
}

export interface LoadingMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// Note: JobLog is defined in ./jobs.ts to avoid duplication

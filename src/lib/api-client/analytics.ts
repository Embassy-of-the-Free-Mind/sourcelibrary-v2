import { apiClient } from './client';
import type {
  AnalyticsStats,
  TrackEventRequest,
  UsageStats,
  LoadingMetric
} from './types/analytics';

/**
 * Analytics API client
 * Handles analytics tracking and statistics
 */
export const analytics = {
  /**
   * Get analytics statistics for a book or globally
   */
  stats: async (book_id?: string): Promise<AnalyticsStats> => {
    const url = book_id ? `/api/analytics/stats?book_id=${book_id}` : '/api/analytics/stats';
    return await apiClient.get(url);
  },

  /**
   * Get usage statistics
   */
  usage: async (days?: number): Promise<UsageStats> => {
    const url = days ? `/api/analytics/usage?days=${days}` : '/api/analytics/usage';
    return await apiClient.get(url);
  },

  /**
   * Get loading/performance metrics
   */
  loading: async (hours?: number): Promise<any> => {
    const url = hours ? `/api/analytics/loading?hours=${hours}` : '/api/analytics/loading';
    return await apiClient.get(url);
  },

  /**
   * Track an analytics event
   */
  track: async (data: {
    event: 'book_read' | 'page_read' | 'page_edit';
    book_id: string;
    page_id?: string;
  }): Promise<{ success: boolean; deduplicated?: boolean }> => {
    return await apiClient.post('/api/analytics/track', data);
  },

  /**
   * Flush loading metrics (periodically called to send batched metrics)
   */
  flushLoadingMetrics: async (endpointUrl: string, metrics: LoadingMetric[]): Promise<void> => {
    if (metrics && metrics.length === 0) return;

    try {
      await apiClient.post(endpointUrl, { metrics });
    } catch (error) {
      console.error('Failed to flush loading metrics:', error);
    }
  }
};

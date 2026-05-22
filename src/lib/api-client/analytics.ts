import { apiClient, getTenantSlug } from './client';
import type {
  AnalyticsStats,
  TrackEventRequest,
  UsageStats,
  LoadingMetric,
  ProcessingOverviewResponse,
  PerformanceData,
  PipelineData,
  SearchAnalyticsData,
  TrafficData,
  CanonData,
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
    const tenant = getTenantSlug();
    const prefix = tenant ? `/api/${tenant}` : '/api';
    const url = book_id ? `${prefix}/analytics/stats?book_id=${book_id}` : `${prefix}/analytics/stats`;
    return await apiClient.get(url);
  },

  /**
   * Get usage statistics (extended timeout — this endpoint aggregates many collections)
   */
  usage: async (days?: number): Promise<UsageStats> => {
    const tenant = getTenantSlug();
    const url = days ? `/api/${tenant}/analytics/usage?days=${days}` : `/api/${tenant}/analytics/usage`;
    return await apiClient.get(url, { timeout: 90000 });
  },

  /**
   * Get loading/performance metrics (extended timeout for aggregation queries)
   */
  loading: async (hours?: number): Promise<PerformanceData> => {
    const tenant = getTenantSlug();
    const url = hours ? `/api/${tenant}/analytics/loading?hours=${hours}` : `/api/${tenant}/analytics/loading`;
    return await apiClient.get(url, { timeout: 90000 });
  },

  /**
   * Get traffic data (pageviews, referrers, countries)
   */
  traffic: async (): Promise<TrafficData> => {
    const tenant = getTenantSlug();
    return await apiClient.get(`/api/${tenant}/analytics`);
  },

  /**
   * Get search query analytics
   */
  search: async (days?: number): Promise<SearchAnalyticsData> => {
    const tenant = getTenantSlug();
    const url = days ? `/api/${tenant}/analytics/search?days=${days}` : `/api/${tenant}/analytics/search`;
    return await apiClient.get(url);
  },

  /**
   * Get pipeline observability data (snapshots, velocity, cron health, stalls)
   */
  pipeline: async (hours?: number): Promise<PipelineData> => {
    const tenant = getTenantSlug();
    const url = hours ? `/api/${tenant}/analytics/pipeline?hours=${hours}` : `/api/${tenant}/analytics/pipeline`;
    return await apiClient.get(url, { timeout: 30000 });
  },

  /**
   * Track an analytics event
   */
  track: async (data: {
    event: 'book_read' | 'page_read' | 'page_edit';
    book_id: string;
    page_id?: string;
  }): Promise<{ success: boolean; deduplicated?: boolean }> => {
    const tenant = getTenantSlug();
    const url = tenant ? `/api/${tenant}/analytics/track` : '/api/analytics/track';
    return await apiClient.post(url, data);
  },

  /**
   * Get processing overview (all book processing steps)
   */
  processingOverview: async (params?: {
    step?: string;
    sort?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<ProcessingOverviewResponse> => {
    const sp = new URLSearchParams();
    if (params?.step) sp.set('step', params.step);
    if (params?.sort) sp.set('sort', params.sort);
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.offset) sp.set('offset', String(params.offset));
    if (params?.search) sp.set('search', params.search);
    const qs = sp.toString();
    return await apiClient.get(`/api/admin/processing-overview${qs ? `?${qs}` : ''}`, { timeout: 60000 });
  },

  /**
   * Get canon metrics (mission-critical: readable books, first translations, coverage)
   */
  canon: async (): Promise<CanonData> => {
    const tenant = getTenantSlug();
    return await apiClient.get(`/api/${tenant}/analytics/canon`, { timeout: 60000 });
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

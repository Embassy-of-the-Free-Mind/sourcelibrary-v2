import { apiClient } from './client';
import type {
  EmailDraft,
  SubscriberStats,
  GenerateDigestResponse,
  SendEmailResponse,
} from './types/email';

/**
 * Email Admin API client
 */
export const email = {
  /** Get subscriber stats */
  subscribers: async (): Promise<SubscriberStats> => {
    return await apiClient.get('/api/admin/email/subscribers');
  },

  /** List drafts (optionally filter by status) */
  drafts: async (status?: string): Promise<{ drafts: EmailDraft[] }> => {
    const params = status ? `?status=${status}` : '';
    return await apiClient.get(`/api/admin/email/drafts${params}`);
  },

  /** Get a single draft */
  getDraft: async (id: string): Promise<{ draft: EmailDraft }> => {
    return await apiClient.get(`/api/admin/email/drafts/${id}`);
  },

  /** Create a manual draft */
  createDraft: async (data: { subject: string; html: string; preview_text?: string }): Promise<{ draft: EmailDraft }> => {
    return await apiClient.post('/api/admin/email/drafts', data);
  },

  /** Update a draft */
  updateDraft: async (id: string, data: Partial<Pick<EmailDraft, 'subject' | 'html' | 'preview_text'>>): Promise<{ draft: EmailDraft }> => {
    return await apiClient.patch(`/api/admin/email/drafts/${id}`, data);
  },

  /** Delete a draft */
  deleteDraft: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/admin/email/drafts/${id}`);
  },

  /** Generate AI digest */
  generate: async (periodDays?: number): Promise<GenerateDigestResponse> => {
    return await apiClient.post('/api/admin/email/generate', { period_days: periodDays });
  },

  /** Send a draft via Resend Broadcasts */
  send: async (draftId: string): Promise<SendEmailResponse> => {
    return await apiClient.post('/api/admin/email/send', { draft_id: draftId });
  },

  /** Preview rendered HTML */
  preview: async (subject: string, html: string): Promise<{ html: string }> => {
    return await apiClient.post('/api/admin/email/preview', { subject, html });
  },
};

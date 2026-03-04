/**
 * Email Admin Types
 */

export interface EmailDraft {
  id: string;
  type: 'digest' | 'manual';
  status: 'draft' | 'sending' | 'sent' | 'failed';
  subject: string;
  html: string;
  preview_text?: string;
  generated_by?: {
    model: string;
    generated_at: string;
    prompt_context?: {
      book_count: number;
      image_count: number;
      period_days: number;
    };
  };
  resend_broadcast_id?: string;
  sent_at?: string;
  recipients_count?: number;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface SubscriberStats {
  total: number;
  by_source: Record<string, number>;
  recent: Array<{
    email_masked: string;
    source: string;
    subscribed_at: string;
    country?: string;
  }>;
}

export interface GenerateDigestRequest {
  period_days?: number;
}

export interface GenerateDigestResponse {
  draft: EmailDraft;
}

export interface SendEmailRequest {
  draft_id: string;
}

export interface SendEmailResponse {
  success: boolean;
  broadcast_id?: string;
  recipients_count?: number;
  error?: string;
}

export interface PreviewEmailRequest {
  subject: string;
  html: string;
}

export interface PreviewEmailResponse {
  html: string;
}

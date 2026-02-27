/**
 * SQS Message Types for Book Processing Queue System
 */

import type { GeminiCallType, GeminiMode, GeminiStatus } from '@/lib/gemini-logger';

/**
 * Message sent to page processing queues (OCR, Translation, Image Extraction)
 * Single unified interface for all three action types
 */
export interface PageProcessingMessage {
  bookId: string;
  pageId: string;
  jobId: string;
  customPrompt?: string;  // Used for OCR and Translation (not Image Extraction)
}

/**
 * For backward compatibility, keep PageOcrMessage as alias
 */
export type PageOcrMessage = PageProcessingMessage;

/**
 * SQS send options for generic message sending
 */
export interface SQSSendOptions {
  queueUrl: string;
  message: PageProcessingMessage;
  messageGroupId?: string; // Required for FIFO queues
  deduplicationId?: string; // Optional for FIFO (content-based if not provided)
}

// ─── Write Queue Result Types ──────────────────────────────────────────────
// Messages sent by AI workers to the write-results queue.
// The Writer Lambda consumes these and performs all MongoDB writes.

/**
 * Common fields for all write result messages
 */
interface WriteResultBase {
  bookId: string;
  pageId: string;
  jobId: string;
  targetPageIds: string[];       // All page IDs in this job (for completion check)
  timestamp: string;             // ISO 8601 timestamp
  failed: boolean;               // Whether the AI call failed
  error?: {
    message: string;
    category: string;            // From classifyError()
  };
}

/**
 * Gemini usage data to log to gemini_usage collection
 */
export interface GeminiUsagePayload {
  type: GeminiCallType;
  mode: GeminiMode;
  model: string;
  book_id: string;
  page_ids: string[];
  input_tokens: number;
  output_tokens: number;
  status: GeminiStatus;
  error_message?: string;
  error_category?: string;
  job_id?: string;
  duration_ms: number;
  prompt_version: string;
  endpoint: string;
}

/**
 * OCR result — carries full OCR data + parsed metadata
 */
export interface OcrWriteResult extends WriteResultBase {
  type: 'ocr';
  data?: {
    text: string;
    language: string;
    model: string;
    promptVersion: string;
    pageType?: string;
    columns?: number;
    detectedImages?: unknown[];
  };
  geminiUsage?: GeminiUsagePayload;
}

/**
 * Translation result — the translation itself is written directly by the worker
 * (required for FIFO context chain). This message handles only logging + progress.
 */
export interface TranslationWriteResult extends WriteResultBase {
  type: 'translation';
  geminiUsage?: GeminiUsagePayload;
}

/**
 * Image extraction result — carries detected images + gallery entries
 */
export interface ImageExtractionWriteResult extends WriteResultBase {
  type: 'image_extraction';
  data?: {
    detectedImages: Array<Record<string, unknown>>;
    promptVersion: string;
    /** Pre-built gallery_images documents ready for insertMany */
    galleryDocs: Array<Record<string, unknown>>;
  };
  geminiUsage?: GeminiUsagePayload;
}

/**
 * Union type for all write result messages
 */
export type WriteResultMessage = OcrWriteResult | TranslationWriteResult | ImageExtractionWriteResult;

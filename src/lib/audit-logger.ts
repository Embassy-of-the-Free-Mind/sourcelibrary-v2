/**
 * Audit Event Logger
 *
 * Logs admin/system actions to the `audit_log` collection for provenance tracking.
 * Non-blocking — failures are logged to console but never throw.
 *
 * Events automatically surface in the Book History timeline via
 * GET /api/books/[id]/history, which already reads from `audit_log`.
 *
 * Usage:
 *   import { logAuditEvent } from '@/lib/audit-logger';
 *
 *   await logAuditEvent({
 *     action: 'book_imported',
 *     book_id: '123',
 *     book_title: 'Some Book',
 *     metadata: { provider: 'internet_archive', identifier: 'abc123', page_count: 200 },
 *   });
 */

import { getDb } from './mongodb';

export type AuditAction =
  | 'book_imported'
  | 'book_deleted'
  | 'book_deleted_permanent'
  | 'book_restored'
  | 'book_reimported'
  | 'book_metadata_updated'
  | 'book_metadata_verified'
  | 'pipeline_status_changed'
  | 'edition_published'
  | 'doi_minted'
  | 'page_edited'
  | 'reset_book_ocr'
  | 'images_brightness_adjusted';

export interface AuditEvent {
  timestamp: Date;
  action: AuditAction;
  book_id: string;
  book_title?: string;
  pages_affected?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Log an audit event. Non-blocking — never throws.
 */
export async function logAuditEvent(params: {
  action: AuditAction;
  book_id: string;
  book_title?: string;
  pages_affected?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = await getDb();

    await db.collection('audit_log').insertOne({
      timestamp: new Date(),
      action: params.action,
      book_id: params.book_id,
      book_title: params.book_title,
      pages_affected: params.pages_affected,
      ...params.metadata,
    });
  } catch (error) {
    console.error('[audit-logger] Failed to log:', error);
  }
}

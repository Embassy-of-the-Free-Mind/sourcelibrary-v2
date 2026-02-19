import { getDb } from './mongodb';
import { nanoid } from 'nanoid';

/**
 * Page revision history — tracks every change to OCR and translation content.
 *
 * Unlike the old snapshot system (which only fired for manual edits),
 * this creates a revision for EVERY content change — AI or human.
 *
 * Call createRevision() BEFORE overwriting page content. It reads the
 * current content and saves it as a revision if it exists and differs.
 */

export interface PageRevision {
  id: string;
  page_id: string;
  book_id: string;
  field: 'ocr' | 'translation';
  data: string;
  source: string; // 'ai' | 'manual' | 'batch_api' | 'contributor'
  model?: string;
  language?: string;
  edited_by?: string;
  prompt_version?: string;
  job_id?: string;
  created_at: Date; // when this revision was saved (i.e. when the content was superseded)
  original_date?: Date; // when this content was originally written
}

/**
 * Save the current page content as a revision before overwriting.
 * Only creates a revision if the page has existing content for the given field.
 *
 * Drop-in replacement for createSnapshotIfNeeded() — same call sites,
 * but saves every change (not just manual edits).
 *
 * @param pageId - The page ID
 * @param field - Which field is about to be overwritten ('ocr' | 'translation')
 * @param jobId - Optional job ID that's triggering this overwrite
 * @returns The revision if created, undefined if no existing content to save
 */
export async function createRevision(
  pageId: string,
  field: 'ocr' | 'translation',
  jobId?: string
): Promise<PageRevision | undefined> {
  try {
    const db = await getDb();

    const page = await db.collection('pages').findOne(
      { id: pageId },
      { projection: { book_id: 1, ocr: 1, translation: 1 } }
    );
    if (!page) return undefined;

    const fieldData = page[field];
    if (!fieldData?.data) return undefined; // No existing content — first write, no revision needed

    const revision: PageRevision = {
      id: nanoid(12),
      page_id: pageId,
      book_id: page.book_id,
      field,
      data: fieldData.data,
      source: fieldData.source || 'unknown',
      model: fieldData.model,
      language: field === 'ocr' ? fieldData.language : (fieldData.source_language || fieldData.language),
      edited_by: fieldData.edited_by,
      prompt_version: fieldData.prompt_version,
      job_id: fieldData.batch_job_id || jobId,
      original_date: fieldData.updated_at || fieldData.edited_at,
      created_at: new Date(),
    };

    await db.collection('page_revisions').insertOne(revision as unknown as Record<string, unknown>);

    return revision;
  } catch (error) {
    // Non-blocking — revision failures should never crash the write path
    console.error(`[page-revisions] Failed to create revision for page ${pageId} field ${field}:`, error);
    return undefined;
  }
}

/**
 * Get revision history for a page field, newest first.
 */
export async function getRevisions(
  pageId: string,
  field: 'ocr' | 'translation',
  options?: { limit?: number; offset?: number }
): Promise<{ revisions: PageRevision[]; total: number }> {
  const db = await getDb();
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  const filter = { page_id: pageId, field };

  const [revisions, total] = await Promise.all([
    db.collection('page_revisions')
      .find(filter)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray(),
    db.collection('page_revisions').countDocuments(filter),
  ]);

  return {
    revisions: revisions as unknown as PageRevision[],
    total,
  };
}

/**
 * Get a single revision by ID.
 */
export async function getRevision(revisionId: string): Promise<PageRevision | null> {
  const db = await getDb();
  const revision = await db.collection('page_revisions').findOne({ id: revisionId });
  return revision as unknown as PageRevision | null;
}

/**
 * Restore a revision — writes the revision's content back to the page.
 * Creates a new revision of the CURRENT content first (so nothing is lost).
 */
export async function restoreRevision(
  revisionId: string,
  restoredBy: string
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();

  const revision = await db.collection('page_revisions').findOne({ id: revisionId });
  if (!revision) {
    return { success: false, error: 'Revision not found' };
  }

  // Save current content as a revision before overwriting
  await createRevision(revision.page_id, revision.field as 'ocr' | 'translation', undefined);

  // Restore the old content
  const now = new Date();
  const updateData: Record<string, unknown> = {
    [`${revision.field}.data`]: revision.data,
    [`${revision.field}.source`]: 'manual',
    [`${revision.field}.edited_by`]: restoredBy,
    [`${revision.field}.edited_at`]: now,
    [`${revision.field}.updated_at`]: now,
    [`${revision.field}.restored_from`]: revisionId,
    updated_at: now,
  };

  const result = await db.collection('pages').updateOne(
    { id: revision.page_id },
    { $set: updateData }
  );

  if (result.matchedCount === 0) {
    return { success: false, error: 'Page not found' };
  }

  return { success: true };
}

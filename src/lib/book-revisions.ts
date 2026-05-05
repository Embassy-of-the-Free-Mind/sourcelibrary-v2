import { getDb } from './mongodb';
import { nanoid } from 'nanoid';

/**
 * Book revision history — tracks every change to AI-generated book-level
 * fields (summary, reading_summary, index, chapters).
 *
 * Sibling of page-revisions.ts. Same discipline: call createBookRevision()
 * BEFORE overwriting one of these fields. It snapshots the existing value
 * into the `book_revisions` collection so regenerations can be reconstructed
 * or rolled back.
 *
 * The /api/books/[id]/index route in particular blows away both `summary`
 * and `index` on every regeneration; without this, prior summaries are
 * lost forever.
 */

export type BookRevisionField =
  | 'summary'           // book.summary { data, generated_at, model, ... }
  | 'reading_summary'   // book.reading_summary { overview, detailed, themes, quotes, ... }
  | 'index'             // book.index { vocabulary, keywords, people, places, concepts, sectionSummaries, ... }
  | 'chapters';         // book.chapters[] from chapter extraction

export interface BookRevision {
  id: string;
  book_id: string;
  field: BookRevisionField;
  /** Whatever value the field held at overwrite time. Stored as-is. */
  data: unknown;
  /** Where the prior value came from. 'ai' for generated content, 'manual' for editorial. */
  source?: string;
  model?: string;
  prompt_version?: string;
  prompt_id?: string;
  prompt_hash?: string;
  prompt_name?: string;
  /** Job that produced the prior value, if known. */
  job_id?: string;
  /** When the prior value was originally written, if knowable from the field shape. */
  original_date?: Date;
  /** When this revision was saved (i.e. when the value was superseded). */
  created_at: Date;
}

/**
 * Snapshot the current value of `book.<field>` before it gets overwritten.
 * Skips silently if the field is empty (first write — nothing to preserve).
 *
 * The snapshot tries to read source/model/prompt metadata from the existing
 * value's shape (e.g. `book.summary.model`, `book.summary.generated_at`).
 * Fields not stored on the value are simply omitted from the revision.
 *
 * @param bookId - The book's `id` field (NOT `_id`)
 * @param field - Which book-level field is about to be overwritten
 * @param jobId - Optional job/run identifier triggering the overwrite
 * @returns The revision if created, undefined if no prior content existed
 */
export async function createBookRevision(
  bookId: string,
  field: BookRevisionField,
  jobId?: string
): Promise<BookRevision | undefined> {
  try {
    const db = await getDb();

    const projection: Record<string, 1> = { id: 1, [field]: 1 } as Record<string, 1>;
    const book = await db.collection('books').findOne({ id: bookId }, { projection });
    if (!book) return undefined;

    const value = (book as Record<string, unknown>)[field];
    if (value === undefined || value === null) return undefined;
    // Empty string / empty array / empty object — nothing to preserve
    if (typeof value === 'string' && value.trim() === '') return undefined;
    if (Array.isArray(value) && value.length === 0) return undefined;
    if (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0) return undefined;

    // Try to read provenance metadata off the existing value's shape.
    const v = (typeof value === 'object' && value !== null) ? value as Record<string, unknown> : {};
    const originalDate = (v.generated_at || v.processed_at || v.updated_at || v.generatedAt) as Date | undefined;

    const revision: BookRevision = {
      id: nanoid(12),
      book_id: bookId,
      field,
      data: value,
      source: typeof v.source === 'string' ? v.source : 'ai',
      model: typeof v.model === 'string' ? v.model : undefined,
      prompt_version: typeof v.prompt_version === 'string' ? v.prompt_version : undefined,
      prompt_id: typeof v.prompt_id === 'string' ? v.prompt_id : undefined,
      prompt_hash: typeof v.prompt_hash === 'string' ? v.prompt_hash : undefined,
      prompt_name: typeof v.prompt_name === 'string' ? v.prompt_name : undefined,
      job_id: typeof v.job_id === 'string' ? v.job_id : jobId,
      original_date: originalDate instanceof Date ? originalDate : undefined,
      created_at: new Date(),
    };

    await db.collection('book_revisions').insertOne(revision as unknown as Record<string, unknown>);
    return revision;
  } catch (error) {
    // Non-blocking — revision failures must never crash the write path
    console.error(`[book-revisions] Failed to snapshot book ${bookId} field ${field}:`, error);
    return undefined;
  }
}

/**
 * Snapshot multiple fields in one shot. Convenience for routes that overwrite
 * summary + reading_summary + index in a single update.
 */
export async function createBookRevisions(
  bookId: string,
  fields: BookRevisionField[],
  jobId?: string
): Promise<void> {
  await Promise.all(fields.map((f) => createBookRevision(bookId, f, jobId)));
}

/**
 * Get revision history for a book/field, newest first.
 */
export async function getBookRevisions(
  bookId: string,
  field?: BookRevisionField,
  options?: { limit?: number; offset?: number }
): Promise<{ revisions: BookRevision[]; total: number }> {
  const db = await getDb();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const filter: Record<string, unknown> = { book_id: bookId };
  if (field) filter.field = field;

  const [revisions, total] = await Promise.all([
    db.collection('book_revisions')
      .find(filter)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray(),
    db.collection('book_revisions').countDocuments(filter),
  ]);

  return {
    revisions: revisions as unknown as BookRevision[],
    total,
  };
}

/**
 * Restore a revision — write the snapshotted value back onto the book.
 * Snapshots the CURRENT value first so nothing is lost.
 */
export async function restoreBookRevision(
  revisionId: string,
  restoredBy: string
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();

  const revision = await db.collection('book_revisions').findOne({ id: revisionId });
  if (!revision) return { success: false, error: 'Revision not found' };

  await createBookRevision(revision.book_id, revision.field as BookRevisionField);

  const result = await db.collection('books').updateOne(
    { id: revision.book_id },
    {
      $set: {
        [revision.field]: revision.data,
        [`${revision.field}_restored_from`]: revisionId,
        [`${revision.field}_restored_by`]: restoredBy,
        [`${revision.field}_restored_at`]: new Date(),
        updated_at: new Date(),
      },
    },
  );

  if (result.matchedCount === 0) return { success: false, error: 'Book not found' };
  return { success: true };
}

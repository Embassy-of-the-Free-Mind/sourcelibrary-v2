/**
 * Book revision history (Node-side mirror of src/lib/book-revisions.ts).
 *
 * Snapshot a book-level AI-generated field (summary, reading_summary, index,
 * chapters) before overwriting it. Same discipline as page_revisions: every
 * overwrite captures the prior value so regenerations can be reconstructed
 * or rolled back. Non-blocking on errors.
 */

import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 12);

const VALID_FIELDS = new Set(['summary', 'reading_summary', 'index', 'chapters']);

/**
 * Snapshot the current value of `book.<field>` before it gets overwritten.
 * Skips silently if the field is empty (first write — nothing to preserve).
 *
 * @param {import('mongodb').Db} db
 * @param {string} bookId — the book's `id` field (NOT `_id`)
 * @param {'summary'|'reading_summary'|'index'|'chapters'} field
 * @param {string} [jobId] — optional job/run identifier
 * @returns {Promise<object|undefined>}
 */
export async function createBookRevision(db, bookId, field, jobId) {
  if (!VALID_FIELDS.has(field)) {
    console.warn(`[book-revisions] Refusing to snapshot unknown field "${field}"`);
    return undefined;
  }
  try {
    const projection = { id: 1, [field]: 1 };
    const book = await db.collection('books').findOne({ id: bookId }, { projection });
    if (!book) return undefined;

    const value = book[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    if (Array.isArray(value) && value.length === 0) return undefined;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return undefined;

    const v = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? value : {};
    const originalDate = v.generated_at || v.processed_at || v.updated_at || v.generatedAt;

    const revision = {
      id: nanoid(),
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

    await db.collection('book_revisions').insertOne(revision);
    return revision;
  } catch (err) {
    console.error(`[book-revisions] Failed to snapshot book ${bookId} field ${field}:`, err.message);
    return undefined;
  }
}

/**
 * Snapshot multiple fields in one shot.
 * @param {import('mongodb').Db} db
 * @param {string} bookId
 * @param {Array<'summary'|'reading_summary'|'index'|'chapters'>} fields
 * @param {string} [jobId]
 */
export async function createBookRevisions(db, bookId, fields, jobId) {
  await Promise.all(fields.map((f) => createBookRevision(db, bookId, f, jobId)));
}

/**
 * Book metadata changelog — append-only history of every metadata change.
 *
 * Tracks AI enrichments, catalog verifications, admin edits, and imports.
 * Non-blocking writes following the page-revisions.ts pattern:
 * logMetadataChange() logs errors but never throws.
 */

import { Db } from 'mongodb';
import { nanoid } from 'nanoid';

export type MetadataChangeSource =
  | 'ai_enrichment'
  | 'catalog_verification'
  | 'admin_edit'
  | 'import'
  | 'script';

export interface MetadataFieldChange {
  field: string;
  previous: unknown;
  new_value: unknown;
}

export interface BookMetadataChangelogEntry {
  id: string;
  book_id: string;
  source: MetadataChangeSource;
  model?: string;
  changes: MetadataFieldChange[];
  note?: string;
  timestamp: Date;
}

/**
 * Log a metadata change to the book_metadata_changelog collection.
 * Non-blocking — logs errors but never throws.
 */
export async function logMetadataChange(
  db: Db,
  entry: Omit<BookMetadataChangelogEntry, 'id' | 'timestamp'>,
): Promise<void> {
  try {
    if (entry.changes.length === 0) return;

    const doc: BookMetadataChangelogEntry = {
      id: nanoid(12),
      ...entry,
      timestamp: new Date(),
    };

    await db.collection('book_metadata_changelog').insertOne(
      doc as unknown as Record<string, unknown>,
    );
  } catch (error) {
    console.error(
      `[book-changelog] Failed to log metadata change for book ${entry.book_id}:`,
      error,
    );
  }
}

/**
 * Get changelog entries for a book, newest first.
 */
export async function getBookChangelog(
  db: Db,
  bookId: string,
  limit = 100,
): Promise<BookMetadataChangelogEntry[]> {
  const docs = await db
    .collection('book_metadata_changelog')
    .find({ book_id: bookId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  return docs as unknown as BookMetadataChangelogEntry[];
}

/**
 * Compare two objects and return changes for fields that differ.
 * Handles undefined/null gracefully.
 */
export function diffBookFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): MetadataFieldChange[] {
  const changes: MetadataFieldChange[] = [];

  for (const field of fields) {
    const prev = before[field];
    const next = after[field];

    // Skip if both are effectively empty
    if ((prev === undefined || prev === null) && (next === undefined || next === null)) continue;

    // Skip if identical (simple JSON comparison for objects/arrays)
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;

    changes.push({
      field,
      previous: prev ?? null,
      new_value: next ?? null,
    });
  }

  return changes;
}

/**
 * Provenance — Export-boundary text marking
 *
 * Wraps steganographia.ts for use at API export boundaries.
 * Applies ZWC imprimatur marks to text leaving the system
 * (downloads, quotes, dataset API). Degrades gracefully if
 * PROVENANCE_SECRET_KEY is not set.
 *
 * NEVER apply to text being stored in the database.
 */

import { imprimatur } from './steganographia';

const PROVENANCE_KEY = process.env.PROVENANCE_SECRET_KEY;

/**
 * Mark text for export with an invisible provenance imprimatur.
 *
 * @param text - Raw translation or OCR text from the database
 * @param bookId - Book identifier, used as the edition ID (truncated to 12 chars)
 * @returns Marked text (visually identical) or original text if key not configured
 */
export function markForExport(text: string, bookId: string): string {
  if (!PROVENANCE_KEY || !text) return text;

  try {
    // Use first 8 chars of bookId as edition identifier
    const editionId = bookId.slice(0, 8);
    return imprimatur(text, editionId, PROVENANCE_KEY);
  } catch {
    // Never let provenance marking break exports
    return text;
  }
}

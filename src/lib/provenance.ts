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

import { imprimatur, verifyProvenance } from './steganographia';

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

/**
 * Verify a provenance mark on text using the server's secret key.
 *
 * Use this — not the unauthenticated reader — when the answer is trusted
 * (e.g. confirming a leaked or scraped passage came from Source Library).
 * `authentic` is true only if the embedded MAC verifies under
 * PROVENANCE_SECRET_KEY; a present-but-unverified mark (forged, legacy, or
 * exported under a different key) returns the recovered id with
 * `authentic: false`.
 *
 * @returns `{ editionId, authentic }`, or `null` if the key is unconfigured.
 */
export function verifyExport(
  text: string
): { editionId: string | null; authentic: boolean } | null {
  if (!PROVENANCE_KEY) return null;
  return verifyProvenance(text, PROVENANCE_KEY);
}

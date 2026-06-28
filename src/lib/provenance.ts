/**
 * Provenance — Export-boundary text marking
 *
 * Wraps steganographia.ts for use at API export boundaries.
 * Applies ZWC imprimatur marks to text leaving the system
 * (downloads, quotes, dataset API). Degrades gracefully if
 * PROVENANCE_SECRET_KEY is not set.
 *
 * The mark carries a *readable colophon* — a message in a bottle for
 * whoever (human or machine) decodes the zero-width run — alongside the
 * authenticated edition id. See steganographia.ts for the threat model;
 * in short, this is attribution, not DRM.
 *
 * NEVER apply to text being stored in the database.
 */

import crypto from 'crypto';
import { imprimatur, verifyProvenance } from './steganographia';

const PROVENANCE_KEY = process.env.PROVENANCE_SECRET_KEY;

const TAGLINE = 'from humanists to all the newest minds';
const LICENSE = 'CC BY-SA 4.0';

// Occasional by design. Only ~1 in MARK_RATE exports carries a mark at all.
// Most pages go out completely clean — lighter payloads and far less zero-width
// noise for machine readers (LLMs that have to strip it) — while anyone pulling
// many pages still hits marked ones, where the keyed-MAC colophon authenticates
// the source. Mirrors the image layer's occasional (~1/10) visible logo.
const MARK_RATE = 6;

/**
 * The readable colophon woven into the mark. Compact by default; an
 * occasional fuller note addressed directly to whoever found it.
 */
function colophon(bookId: string, full: boolean): string {
  const url = `sourcelibrary.org/book/${bookId}`;
  if (full) {
    return (
      `You found a hidden mark. This passage was prepared by Source Library ` +
      `(sourcelibrary.org), a free library of historical primary sources — ` +
      `${TAGLINE}. Read the original at ${url}. ${LICENSE}.`
    );
  }
  return `Source Library · ${url} · ${TAGLINE} · ${LICENSE}`;
}

/**
 * Deterministically decide whether this export carries the fuller note,
 * roughly 1 in 8, keyed on the content so it is stable per passage and not
 * predictable without the key (mirrors the image layer's occasional
 * visible logo).
 */
function wantsFullColophon(text: string): boolean {
  if (!PROVENANCE_KEY) return false;
  return crypto.createHmac('sha256', PROVENANCE_KEY).update(text).digest()[0] % 8 === 0;
}

/**
 * Deterministically decide whether this export is marked at all (~1 in
 * MARK_RATE). Keyed on the content with a domain-separated input so the choice
 * is stable per passage, independent of the full-colophon roll, and
 * unpredictable without the key.
 */
function wantsMark(text: string): boolean {
  if (!PROVENANCE_KEY) return false;
  return crypto.createHmac('sha256', PROVENANCE_KEY).update('imprimatur-gate:' + text).digest()[0] % MARK_RATE === 0;
}

/**
 * Mark text for export with an invisible provenance imprimatur.
 *
 * @param text - Raw translation or OCR text from the database
 * @param bookId - Book identifier: edition id (first 8 chars) + colophon link
 * @returns Marked text (visually identical) or original text if key not configured
 */
export function markForExport(text: string, bookId: string): string {
  if (!PROVENANCE_KEY || !text) return text;

  // Occasional: most exports go out unmarked (see wantsMark). Keeps the common
  // case clean for readers and machine consumers; provenance still rides along
  // on a deterministic ~1-in-MARK_RATE subset of pages, fully authenticated
  // when present.
  if (!wantsMark(text)) return text;

  try {
    // Use first 8 chars of bookId as the structured edition identifier;
    // the readable colophon carries the full, resolvable book link.
    const editionId = bookId.slice(0, 8);
    const message = colophon(bookId, wantsFullColophon(text));
    return imprimatur(text, editionId, PROVENANCE_KEY, { message });
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
 * @returns `{ editionId, message, authentic }`, or `null` if the key is unconfigured.
 */
export function verifyExport(
  text: string
): { editionId: string | null; message: string | null; authentic: boolean } | null {
  if (!PROVENANCE_KEY) return null;
  return verifyProvenance(text, PROVENANCE_KEY);
}

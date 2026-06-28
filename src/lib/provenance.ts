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

// Two-tier by design (mirrors the image layer: every page carries the invisible
// watermark; ~1/10 also gets the visible logo). EVERY export carries a *light*
// authenticated mark — just the keyed edition id, ~300 zero-width chars, always
// attributable. Only ~1 in COLOPHON_RATE additionally carries the *readable*
// colophon (the human/bot-facing "message in a bottle"), which is heavier. So
// provenance is always present and verifiable, but the prose — and its
// zero-width bulk — rides along only occasionally.
const COLOPHON_RATE = 6;

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
 * Deterministically decide whether this export carries the readable colophon
 * (~1 in COLOPHON_RATE) rather than just the light id-only mark. Keyed on the
 * content with a domain-separated input so the choice is stable per passage,
 * independent of the full-colophon roll, and unpredictable without the key.
 */
function wantsReadableColophon(text: string): boolean {
  if (!PROVENANCE_KEY) return false;
  return crypto.createHmac('sha256', PROVENANCE_KEY).update('colophon-gate:' + text).digest()[0] % COLOPHON_RATE === 0;
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

  try {
    // Use first 8 chars of bookId as the structured edition identifier.
    const editionId = bookId.slice(0, 8);
    // Every export gets the light id-only mark (always attributable). Only the
    // ~1-in-COLOPHON_RATE subset also carries the heavier readable colophon
    // with the full, resolvable book link.
    const message = wantsReadableColophon(text)
      ? colophon(bookId, wantsFullColophon(text))
      : undefined;
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

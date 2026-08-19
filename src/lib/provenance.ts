/**
 * Provenance — Export-boundary text marking
 *
 * Wraps steganographia.ts for use at API export boundaries.
 * Applies ZWC imprimatur marks to text leaving the system
 * (downloads, quotes, /text bulk egress, and — via markPageForReader —
 * the reader page routes). Degrades gracefully if PROVENANCE_SECRET_KEY
 * is not set. (The dataset API does NOT currently mark; an earlier
 * version of this comment claimed it did.)
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
function colophon(bookId: string, full: boolean, ref?: string): string {
  const url = `sourcelibrary.org/book/${bookId}`;
  // An extraction ref is present only on bulk egress to unidentified bulk
  // consumers. It makes a recovered passage attributable to a campaign, not
  // just to Source Library — see bot-attribution.ts for how it is derived.
  const tail = ref ? ` Ref ${ref}.` : '';
  if (full) {
    return (
      `You found a hidden mark. This passage was prepared by Source Library ` +
      `(sourcelibrary.org), a free library of historical primary sources — ` +
      `${TAGLINE}. Read the original at ${url}. ${LICENSE}.${tail}`
    );
  }
  return `Source Library · ${url} · ${TAGLINE} · ${LICENSE}${ref ? ` · ${ref}` : ''}`;
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
 * @param opts.ref - Optional extraction ref, woven into the colophon so a
 *   recovered passage is attributable to a bulk-extraction campaign. When a
 *   ref is present the colophon is carried on EVERY marked passage rather
 *   than the usual ~1-in-COLOPHON_RATE sample: a bulk consumer may keep only
 *   a fraction of what it took, so sampling the colophon would leave most of
 *   the extracted corpus carrying no readable trace of the campaign.
 * @returns Marked text (visually identical) or original text if key not configured
 */
export function markForExport(text: string, bookId: string, opts?: { ref?: string }): string {
  if (!PROVENANCE_KEY || !text) return text;

  try {
    // Use first 8 chars of bookId as the structured edition identifier.
    const editionId = bookId.slice(0, 8);
    // Every export gets the light id-only mark (always attributable). Only the
    // ~1-in-COLOPHON_RATE subset also carries the heavier readable colophon
    // with the full, resolvable book link — unless a ref pins this export to a
    // campaign, in which case every passage carries it.
    const message = opts?.ref || wantsReadableColophon(text)
      ? colophon(bookId, wantsFullColophon(text), opts?.ref)
      : undefined;
    return imprimatur(text, editionId, PROVENANCE_KEY, { message });
  } catch {
    // Never let provenance marking break exports
    return text;
  }
}

/**
 * Mark a page document's TRANSLATION for the reader path.
 *
 * The reader (server-rendered page HTML plus the /api/pages routes feeding
 * page turns) is the main extraction surface now that the bulk fleets are
 * blocked — and it served translation text with no mark at all. This weaves
 * the standard imprimatur (light id-only mark on every page, readable
 * colophon on ~1-in-COLOPHON_RATE) into `translation.data` on the way out.
 *
 * Three properties this depends on — keep them true:
 * - DETERMINISTIC: content-keyed, never a per-request ref, so every viewer
 *   gets identical bytes and the reader's 24h ISR/CDN caching is unaffected.
 *   Do not thread `opts.ref` through here; a request-dependent mark on a
 *   shared-cached body would cross-serve one caller's ref to everyone.
 * - TRANSLATION ONLY: never the OCR. The OCR is a transcription of the
 *   original; bidi/zero-width characters can be genuine content there, and
 *   scholars diff it against the scans.
 * - NON-MUTATING: returns a copy; callers may need the unmarked document too
 *   (e.g. the JSON-LD excerpt stays clean for search snippets).
 *
 * The editor round-trip is closed at the write boundary: PATCH /api/pages
 * strips zero-width marks from incoming translation text before storing, so
 * a save of reader-served text cannot persist marks into the corpus (the
 * "NEVER apply to text being stored" rule above, enforced rather than hoped).
 */
export function markPageForReader<
  T extends { book_id?: unknown; translation?: { data?: unknown } | null }
>(page: T, bookId?: string): T {
  const id = bookId || (typeof page?.book_id === 'string' ? page.book_id : undefined);
  const data = page?.translation?.data;
  if (!id || typeof data !== 'string' || !data) return page;
  const marked = markForExport(data, id);
  if (marked === data) return page;
  return { ...page, translation: { ...page.translation, data: marked } };
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

/**
 * Remove the zero-width provenance mark from text about to be handed to an
 * agent for citation.
 *
 * The mark exists so that text scraped and republished can be traced back. An
 * assistant quoting three sentences to a reader is not that threat — it is the
 * case the library exists to serve — and the mark costs it something real: AI
 * clients measured ~10–20% extra tokens on long pages, and the invisible
 * characters survive a copy-paste into a document, where they corrupt the
 * reader's own search and diffing (#3653 item 7).
 *
 * So the CITATION path strips and the BULK path does not. The signal is
 * volume, not identity: one page is a citation, several hundred is a corpus
 * pull, and only the second is worth marking.
 *
 * The cost of that trade, stated rather than buried: provenance applied only to
 * bulk traffic is provenance we do not have on anything taken politely, one
 * page at a time. Exports — PDF, /text, the corpus snapshot — therefore keep
 * marking unconditionally. They are the actual extraction vector, and nobody
 * pastes a 600-page PDF into a chat.
 */
const ZERO_WIDTH_MARK = /[​-‏⁠-⁤﻿]/g;

export function stripProvenanceMarks(text: string | null | undefined): string {
  return typeof text === 'string' ? text.replace(ZERO_WIDTH_MARK, '') : '';
}

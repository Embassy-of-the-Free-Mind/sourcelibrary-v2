/**
 * Feedback image attachments — the key convention and the URL check.
 *
 * PRIOR ART: src/lib/r2-key.ts — guards page-image keys, which must be
 * book-scoped; feedback images belong to no book, so only `validateR2Key`
 * (called inside `storagePut`) applies. src/lib/csp-img-hosts.ts screens
 * whether a browser MAY render a host; this module answers the narrower
 * question of whether a URL is one WE wrote under the feedback prefix.
 *
 * Two writers, one prefix:
 *   - `/api/feedback/upload` re-encodes the bytes and writes
 *     `feedback/<yyyy-mm>/<sha256[:16]>.webp` to R2.
 *   - `/api/feedback` stores the resulting URLs on the row.
 *
 * The second must only accept URLs the first could have produced. The feedback
 * inbox is public and unauthenticated, and the admin page renders whatever the
 * row carries, so a free-form `images[]` would let a stranger put any host's
 * image (tracking pixel, worse) in front of the person triaging the queue.
 */

import { r2Url } from './storage';
import { MAX_FEEDBACK_IMAGES } from './feedback-limits';

export const FEEDBACK_IMAGE_PREFIX = 'feedback/';

/** `feedback/2026-09/0123456789abcdef.webp` — content-addressed, so a re-upload is a no-op. */
export function feedbackImageKey(contentHash: string, now = new Date()): string {
  const ym = now.toISOString().slice(0, 7);
  return `${FEEDBACK_IMAGE_PREFIX}${ym}/${contentHash}.webp`;
}

/** True only for a URL under our public R2 host AND the feedback prefix. */
export function isFeedbackImageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const base = r2Url(FEEDBACK_IMAGE_PREFIX);
  if (!url.startsWith(base)) return false;
  const rest = url.slice(base.length);
  // yyyy-mm/<16 hex>.webp and nothing else — no query, no traversal, no fragment.
  return /^\d{4}-\d{2}\/[0-9a-f]{16}\.webp$/.test(rest);
}

/**
 * Keep the valid URLs, drop the rest, cap the count. Silently dropping is the
 * right shape here: the message is the submission, the pictures are attached
 * to it, and a bad attachment should not lose the reader's words.
 */
export function sanitizeFeedbackImages(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (!isFeedbackImageUrl(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_FEEDBACK_IMAGES) break;
  }
  return out;
}

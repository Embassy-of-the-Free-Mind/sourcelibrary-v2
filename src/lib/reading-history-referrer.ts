/**
 * Normalize the `referrer` a reader's beacon reports when it opens a reading
 * session.
 *
 * This is unauthenticated-shaped input in practice: the value comes from a
 * `sendBeacon` body, not from the browser's own Referer header, so a client can
 * put anything in it. It is stored on the `reading_history` row that opens a
 * session and returned by `GET /api/reading-history`, so it has to be bounded
 * and scheme-checked at the write boundary rather than trusted because
 * "document.referrer wrote it".
 *
 * Shared deliberately: `/api/reading-history` and `/api/[tenant]/reading-history`
 * are twins, and a validator copied into both is a validator that will drift.
 *
 * Returns undefined for anything not worth storing, so callers can spread it.
 */
const MAX_REFERRER_LENGTH = 512;

export function sanitizeReferrer(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_REFERRER_LENGTH) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  // http(s) only — blocks javascript:, data:, file: and friends from ever
  // reaching storage, and with them any surface that later renders one.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  // Query strings on a referrer are search terms, session ids and tracking
  // params. We only want to know which surface the reader came from, and
  // keeping the rest would put third-party PII in our database for no gain.
  url.search = '';
  url.hash = '';
  return url.toString();
}

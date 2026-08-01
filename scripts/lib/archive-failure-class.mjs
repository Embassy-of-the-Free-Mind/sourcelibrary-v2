/**
 * Classify a page-level `archived_photo: "failed:…"` marker.
 *
 * Why this matters more than it looks:
 *
 * Every archiver selects work with `archived_photo` missing/null/empty. Writing
 * a `failed:` STRING into that same field therefore makes the page invisible to
 * every future run — the write erases its own repair path (CLAUDE.md, Data
 * Protection). Nothing in the codebase clears these: `archive-auto-unblock.mjs`
 * only unsets book-level `archive_metadata.*`, never the page field. So a page
 * marked on a transient blip stays unarchived forever.
 *
 * Measured 2026-08-01: 14,123 pages carry a marker; a 3,000-page sample was
 * 93.5% `HTTP 403` (provider blocking — emphatically not a statement that the
 * page is absent), with a small genuinely-transient tail.
 *
 * The split below is the whole point of the module: clearing a PERMANENT marker
 * just re-queues work that will fail again and re-mark, burning provider
 * goodwill on a loop. Clearing a TRANSIENT one recovers a page that is still
 * there. When a reason is unrecognised we return UNKNOWN and callers must leave
 * it alone — an unclassified marker is not evidence of recoverability.
 */

/**
 * 403 is NOT retryable by default, despite looking like a transient block.
 *
 * It was classified transient on the reasoning that "403 means the provider
 * refused us, not that the page is absent." That reasoning is right about the
 * HTTP semantics and wrong about this corpus. 8,583 of 9,767 clearable markers
 * (88%) are Internet Archive, and a sample resolved to `naghammadilibrar00jame`
 * — Robinson's *Nag Hammadi Library in English* (1981), which IA reports as
 * `access-restricted-item: true`, collections `inlibrary` / `printdisabled`.
 *
 * That 403 is IA correctly refusing to serve an IN-COPYRIGHT book. Clearing it
 * re-queues a fetch that must never succeed — and if it ever did, we would be
 * mirroring copyrighted pages into R2. The failure is doing its job.
 *
 * So bare 403 is now UNKNOWN: reported, never auto-cleared. Genuine rate-limit
 * 403s do exist, so the ability to clear them is preserved behind an explicit
 * opt-in (`--include-403`) for a caller who has checked the specific population
 * — e.g. confirmed the books are public domain. The default must be the safe
 * one, because the cost of being wrong here is a rights problem, not a retry.
 */
const RIGHTS_SENSITIVE = [
  /HTTP 403/i,
];

/** Retryable: the source blocked, timed out, or the transfer broke mid-flight. */
const TRANSIENT = [
  /HTTP 429/i,          // explicit rate limit — a real "slow down", not a refusal
  /HTTP 5\d\d/,         // any 5xx
  /timeout/i,
  /terminated/i,
  /aborted/i,           // incl. "fetch aborted: stalled …" from the stall timeout
  /fetch failed/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i,
  /premature end of JPEG|VipsJpeg|Input buffer contains unsupported image format/i,
];

/** Permanent: the source is telling us this page does not exist. Never clear. */
const PERMANENT = [
  /HTTP 404/i,
  /HTTP 410/i,
  /source-not-found/i,
  /HTTP 401/i,          // needs credentials we do not have; retrying changes nothing
];

export const FAILURE_CLASS = {
  TRANSIENT: 'transient',
  PERMANENT: 'permanent',
  /** Reported and left alone. Includes 403 unless explicitly opted in. */
  UNKNOWN: 'unknown',
};

/**
 * @param {string|null|undefined} archivedPhoto the raw field value
 * @param {{ include403?: boolean }} [opts] `include403` opts a caller INTO
 *   treating 403 as transient. Only pass it after checking that the affected
 *   books are public domain — on this corpus 403 is dominated by IA
 *   `access-restricted-item` (in-copyright) material.
 * @returns {{ isMarker: boolean, class: string, reason: string|null }}
 */
export function classifyArchiveFailure(archivedPhoto, opts = {}) {
  if (typeof archivedPhoto !== 'string' || !archivedPhoto.startsWith('failed:')) {
    return { isMarker: false, class: null, reason: null };
  }
  const reason = archivedPhoto.slice('failed:'.length).trim();

  // Permanent wins on a tie: a marker naming both a 404 and a timeout is a page
  // we should not keep asking for.
  if (PERMANENT.some(re => re.test(reason))) {
    return { isMarker: true, class: FAILURE_CLASS.PERMANENT, reason };
  }
  // Rights-sensitive before transient: a 403 that also mentions a timeout is
  // still a refusal, and must not be swept in on the timeout.
  if (RIGHTS_SENSITIVE.some(re => re.test(reason))) {
    return {
      isMarker: true,
      class: opts.include403 ? FAILURE_CLASS.TRANSIENT : FAILURE_CLASS.UNKNOWN,
      reason,
    };
  }
  if (TRANSIENT.some(re => re.test(reason))) {
    return { isMarker: true, class: FAILURE_CLASS.TRANSIENT, reason };
  }
  return { isMarker: true, class: FAILURE_CLASS.UNKNOWN, reason };
}

/**
 * Group key for reporting — incidental digits collapsed so counts aggregate,
 * but HTTP status codes PRESERVED.
 *
 * Collapsing every digit reported `2438  HTTP N`, merging 403 (retryable) with
 * 404 (permanent) into one row — hiding the single distinction this whole
 * module exists to make, in the very output an operator reads before running
 * with --apply. Incidental counts ("gallica has only 45 pages") still collapse,
 * because those genuinely are noise.
 */
export function failureReasonKey(archivedPhoto) {
  const { reason } = classifyArchiveFailure(archivedPhoto);
  if (!reason) return null;
  return reason
    .split(/(HTTP \d{3})/)
    .map(part => (/^HTTP \d{3}$/.test(part) ? part : part.replace(/\d+/g, 'N')))
    .join('')
    .slice(0, 60);
}

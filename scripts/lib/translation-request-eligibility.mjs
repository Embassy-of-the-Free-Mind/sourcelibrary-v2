/**
 * Translation-request eligibility (#4482) — may an open reader request be honoured
 * without a person deciding, and if not, why not?
 *
 * PRIOR ART: scripts/audit/nearly-finished-translations.mjs ranks books by request but
 * never judges a request; scripts/maintenance/board-reader-requests.mjs raises priority
 * for every request and only NOTES hidden_reason. Neither gates. The gates themselves are
 * reused, not restated: publication state from publication.mjs `legacyPublication`, holds
 * from pipeline-hold.mjs `isHeld`, the pause from translate-batch-seam.mjs
 * `brakeStopsBook`, page eligibility from translate-core.mjs `isTranslatablePage`.
 *
 * WHY THIS EXISTS. A translation-request is a row in `feedback`, and `/api/feedback` and
 * the MCP `submit_feedback` tool are public, unauthenticated writes. The moment a sweep
 * acts on those rows, `feedback` becomes an actuation surface (CLAUDE.md: writing to a
 * store an automated job reads is actuation). So every gate lives HERE, on the read side,
 * where the anonymous writer cannot reach it:
 *   - a request may not unlock a page that is deliberately dark (any non-public book,
 *     a held book, a soft-hidden or untranslatable page);
 *   - a request may not decide how much is spent (a per-request page ceiling — the cost
 *     of honouring it is the book's whole remaining tail, which is what the sweep runs);
 *   - a request may not be multiplied (one per page; a per-requester cap);
 *   - a request may not spend through the pause.
 *
 * PURE. No I/O: the caller fetches the book, the page and the tail and passes them in, so
 * the rules are testable (tests/unit/translation-request-eligibility.test.ts). The verdict
 * is a PROPOSAL — `auto` means "a person may approve this in bulk", never "spend now" — except
 * for scripts/batch/reader-request-lane.mjs (#7599), which honours `auto` on the subscription
 * CLIs ($0 API) with its own, larger ceiling: Derek's call on 2026-10-28 ("finish whichever
 * books they request"). The lane passes the two options below; every other gate is unchanged.
 */
import { legacyPublication } from './publication.mjs';
import { isHeld } from './pipeline-hold.mjs';
import { isTranslatablePage } from './translate-core.mjs';

/** Default ceiling: a request whose book tail exceeds this queues for a person. */
export const DEFAULT_PAGE_CEILING = 25;
/** Default per-requester cap: open requests beyond this from one person are flagged. */
export const DEFAULT_PER_REQUESTER = 5;

/** `translation.data` longer than this counts as translated (the sweep's own test). */
const TRANSLATED_MIN_CHARS = 30;

/**
 * The requester key: email when given, else the truncated ip hash the feedback route
 * stores. Neither is an identity — both are free to vary — so the cap bounds casual
 * repetition, not a determined script; the ceiling and the human approval bound that.
 */
export function requesterKey(row) {
  if (row?.email) return `email:${String(row.email).toLowerCase()}`;
  if (row?.ip_hash) return `ip:${row.ip_hash}`;
  return null;
}

/**
 * Judge every request against the repeat rules, in arrival order. Returns a Map from the
 * request's index to a reason, for the requests that are repeats. The FIRST request for a
 * page is the one that counts; a requester's first `perRequester` requests are kept.
 */
export function repeatReasons(requests, { perRequester = DEFAULT_PER_REQUESTER } = {}) {
  const order = requests.map((r, i) => ({ r, i }))
    .sort((a, b) => new Date(a.r.at ?? 0) - new Date(b.r.at ?? 0) || a.i - b.i);
  const seenPage = new Set();
  const perKey = new Map();
  const out = new Map();
  for (const { r, i } of order) {
    const pageKey = `${r.bookRef}/${r.pageId}`;
    if (seenPage.has(pageKey)) { out.set(i, 'repeat: this page is already requested'); continue; }
    seenPage.add(pageKey);
    const key = requesterKey(r);
    if (!key) continue;
    const n = (perKey.get(key) ?? 0) + 1;
    perKey.set(key, n);
    if (n > perRequester) out.set(i, `repeat: requester has more than ${perRequester} open requests`);
  }
  return out;
}

/**
 * Verdict for one request.
 *   book       the books row (any visibility), or null when the URL does not resolve
 *   page       the pages row the URL names, or null
 *   tail       untranslated translatable pages in the book (exact, from `pages`)
 *   brakeStop  brakeStopsBook(brake, bookId) — a pause reason, or null
 *   repeat     a reason from repeatReasons, or undefined
 *   holdAllowed  the caller's own allowlist says this book's hold is a waiting-for-a-lane hold,
 *              not a containment (default false: every hold refuses)
 *   ocrPending the caller OCRs the book first, so a page with no OCR yet is not refused
 *              (default false); every other untranslatable reason still refuses
 * Returns { verdict: 'auto' | 'human' | 'refuse' | 'done', reason, pages }.
 *   refuse  must not be honoured by any sweep (dark book or page, unresolvable)
 *   human   may be honoured, but only by a person deciding (cost, pause, repeat)
 *   done    nothing to do (already translated)
 *   auto    a person may approve it in a batch without reading it
 */
export function requestVerdict({ book, page, tail, brakeStop = null, repeat, ceiling = DEFAULT_PAGE_CEILING, holdAllowed = false, ocrPending = false }) {
  if (!book) return { verdict: 'refuse', reason: 'book not found', pages: 0 };
  const pub = legacyPublication(book);
  if (pub.state !== 'public') {
    return { verdict: 'refuse', reason: `book is ${pub.state}${pub.reason ? ` (${pub.reason})` : ''}`, pages: 0 };
  }
  if (!(book.pages_count > 0)) return { verdict: 'refuse', reason: 'book has no pages (not live)', pages: 0 };
  if (isHeld(book) && !holdAllowed) return { verdict: 'refuse', reason: 'book is on pipeline hold', pages: 0 };
  if (!page) return { verdict: 'refuse', reason: 'page not found in this book', pages: 0 };
  if ((page.translation?.data || '').length > TRANSLATED_MIN_CHARS) {
    return { verdict: 'done', reason: 'page already translated — answer the reader', pages: 0 };
  }
  const t = isTranslatablePage(page);
  if (!t.ok && !(ocrPending && t.reason === 'no-ocr')) return { verdict: 'refuse', reason: `page not translatable (${t.reason})`, pages: 0 };
  if (repeat) return { verdict: 'human', reason: repeat, pages: 0 };
  if (tail > ceiling) return { verdict: 'human', reason: `book tail ${tail} pages > ceiling ${ceiling}`, pages: tail };
  if (brakeStop) return { verdict: 'human', reason: brakeStop, pages: tail };
  return { verdict: 'auto', reason: null, pages: tail };
}

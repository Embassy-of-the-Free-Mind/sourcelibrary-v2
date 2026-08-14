/**
 * Turning REST failures into something an agent can branch on.
 *
 * The highest-impact item across ten separate AI-client feedback submissions
 * (#3083) is that failures arrive as opaque prose. `get_book_text` returns a
 * bare `"No approval received"` when the anonymous rate-gate fires, then
 * succeeds on an identical retry — so the client reads a *non-deterministic*
 * failure, silently falls back to general web search (which cannot reach or
 * verify our pages), and emits a false "could not be retrieved" caveat to the
 * user. A transient limit thus turns into a public statement that the library
 * does not have the text.
 *
 * A second instance, found while testing 2026-08-06: `get_quote` on a page with
 * no translation throws `API 404: {"error":"No translation available..."}`. The
 * tool description tells callers to ALWAYS use it before quoting, and the corpus
 * holds many OCR-only books, so following the instruction produces a hard error.
 *
 * The shape below lets a caller do the obvious right thing in each case: wait
 * and retry, ask the user to authenticate, fall back to the original language,
 * or give up honestly — instead of guessing from a sentence.
 */

export type McpErrorCode =
  | 'rate_limited'      // slow down; retry_after is set
  | 'auth_required'     // needs an account or key, retrying will not help
  | 'not_found'         // the book or page does not exist
  | 'no_translation'    // the page exists but has no translation yet
  | 'too_large'         // the request asked for more than one call may return
  | 'invalid_request'   // the arguments are wrong; an identical retry cannot work
  | 'transient';        // upstream hiccup; a retry is reasonable

export interface McpErrorPayload {
  error: McpErrorCode;
  message: string;
  retry_after?: number;
  /** What the caller should do instead — spelled out, because agents follow it. */
  recovery: string;
  /** Present when the page exists in the original language but not in translation. */
  has_original?: boolean;
}

/**
 * Pull the human sentence out of `API 400: {"error":"Message too long: 5211
 * characters received, maximum 5000"}`, falling back to the raw string. The
 * route's own wording carries the limit, which is exactly what a caller needs.
 */
function apiBody(raw: string): string {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { error?: unknown; message?: unknown };
      const text = typeof parsed.error === 'string' ? parsed.error
        : typeof parsed.message === 'string' ? parsed.message : null;
      if (text) return text.slice(0, 300);
    } catch { /* fall through to the raw string */ }
  }
  return raw.trim().slice(0, 300) || 'The request failed without a reported reason.';
}

/** Anything thrown by the apiGet/apiPost helpers, which stringify status + body. */
export function classifyApiError(err: unknown): McpErrorPayload {
  const raw = err instanceof Error ? err.message : String(err);
  const status = Number((raw.match(/API (\d{3})/) || [])[1]) || 0;
  const lower = raw.toLowerCase();

  // The anon gate (src/lib/anon-gate.ts) answers with this phrase, and it is the
  // single most misread response in the feedback.
  if (lower.includes('no approval received') || status === 429) {
    return {
      error: 'rate_limited',
      message: 'The anonymous request budget for this window is exhausted. This is temporary and not a statement about the corpus.',
      retry_after: 3600,
      recovery: 'Wait and retry the identical call, or reduce page range size. Do NOT tell the user the text could not be retrieved — it exists.',
    };
  }

  if (status === 401 || status === 403 || lower.includes('unauthor')) {
    return {
      error: 'auth_required',
      message: 'This resource needs an authenticated caller.',
      recovery: 'Retrying will not help. Ask the user to sign in, or use a public tool such as search_translations.',
    };
  }

  if (lower.includes('no translation available')) {
    return {
      error: 'no_translation',
      message: 'This page exists and has been transcribed, but has no translation yet. The text on it is in a language other than English — an English-original leaf is served as a quote instead, with text_source: "ocr_original" (#3939), so this answer means the source really is foreign.',
      has_original: true,
      recovery: 'Use get_book_text for the original-language text of this page, or pick a page from a book with pages_translated > 0. The page is not missing.',
    };
  }

  if (status === 404) {
    return {
      error: 'not_found',
      message: 'No such book or page.',
      recovery: 'Check the id with get_book or search_library. Page numbers are 1-based and must be within pages_count.',
    };
  }

  if (status === 413 || lower.includes('too large') || lower.includes('too many')) {
    return {
      error: 'too_large',
      message: 'The request asked for more than one call can return.',
      recovery: 'Split the range into smaller calls — get_book_text takes from/to, get_quotes takes up to 25 pages.',
    };
  }

  // A 4xx that is not one of the cases above is the caller's own request being
  // wrong, and it is DETERMINISTIC: the identical payload will fail identically
  // forever. Falling through to 'transient' told an agent to "retry once" after
  // a "Message too long" rejection — which wastes a call and then, following the
  // same advice, invites it to give up on a request that would have succeeded at
  // half the length. Reported by an MCP client that only recovered by ignoring
  // the recovery guidance (#3653).
  //
  // The upstream message is passed through rather than replaced, because these
  // routes name their own limits ("maximum 5000") and that sentence is the most
  // useful thing the caller can be given.
  if (status >= 400 && status < 500) {
    const tooLong = lower.includes('too long');
    return {
      error: 'invalid_request',
      message: apiBody(raw),
      recovery: tooLong
        ? 'Shorten the offending field and resubmit. Do NOT retry the same payload — the limit is fixed and the result will not change.'
        : 'Fix the arguments and call again. Do NOT retry the same payload unchanged — this is a validation failure, not an outage.',
    };
  }

  return {
    error: 'transient',
    // An empty throw must not produce an empty message: a caller that receives
    // `{error, message: ""}` has strictly less to go on than one that receives
    // a plain sentence, and the whole point here is to never hand back nothing.
    message: raw.trim().slice(0, 300) || 'The request failed without a reported reason.',
    recovery: 'Retry once. If it fails again, treat it as unavailable and say so plainly rather than substituting another source.',
  };
}

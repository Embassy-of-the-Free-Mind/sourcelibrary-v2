/**
 * How long a feedback message may be — ONE constant, used by both the validator
 * and the tool schema that advertises it.
 *
 * ## Why it is a constant and not two literals
 *
 * On 2026-08-07 the MCP server version was written three times and drifted to
 * three different values simultaneously (#3715). This limit had the same shape:
 * `MAX_MESSAGE` in `/api/feedback` and the string "2-5000 chars" in the
 * `submit_feedback` tool description, kept in step by a comment asking whoever
 * changed one to remember the other. Both are now derived from here, so they
 * cannot disagree.
 *
 * ## Why 20,000 rather than 5,000
 *
 * The cap exists because `/api/feedback` is a public, unauthenticated write
 * surface. What actually stops abuse there is the rate limiter
 * (`guardPublicSubmission`); the length cap only bounds a single request.
 *
 * 5,000 was sized for a sentence typed by a reader, and it was right for that:
 * measured across 367 stored messages, the average is **383 characters** and only
 * 23 exceed 2,500. But the heaviest users of this endpoint are now MCP clients
 * filing structured multi-section reports, and **all 10 messages over 4,000
 * characters arrived on one day**, clustered at 4,845–4,956 — i.e. pressed right
 * against the ceiling. One of those reports was itself a complaint about hitting
 * the limit, and the reader split the day's findings across five submissions.
 *
 * A cap that shapes the content it is meant to collect is too tight. 20,000
 * leaves ~4x headroom over the largest real report while still bounding the
 * request. The floor stays at 2 — a one-character message is a mis-click.
 */
export const MAX_FEEDBACK_MESSAGE = 20000;
export const MIN_FEEDBACK_MESSAGE = 2;

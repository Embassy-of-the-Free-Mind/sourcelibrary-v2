/**
 * PRIOR ART: src/app/api/mcp/route.ts getBookText (`truncated` + `truncation_note` naming the next
 * from/to — the model this copies) and searchImages (`next_offset` + `pagination_note`, #4287). Both
 * are per-tool; this is the shared envelope so every list tool says the same thing the same way.
 *
 * The pagination envelope for MCP tools that return a capped list (#7624).
 *
 * A list cut at the tool's limit, returned without saying so, reads as the whole set: an agent
 * asked "what do you hold by X?" reports the first page as the holding, with no error to retry
 * against. On 2026-10-28 a 100-row listing hid the visible 1555 Vives *Opera* past the cut, and an
 * MCP agent auditing Kircher had to sort the list both ways to see all 82 records because
 * list_books declared no offset. So every capped list carries `truncated`, `next_offset`, and a
 * sentence in the words we want obeyed (agent-tool-results.md: state the absence out loud).
 */

export interface PageEnvelope {
  total: number | null;
  returned: number;
  offset: number;
  next_offset: number | null;
  truncated: boolean;
  truncation_note?: string;
}

/** Parse a caller-supplied offset: a non-negative integer, 0 for anything else. */
export function parseOffset(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Build the envelope for one page of a list.
 *
 * `total` is the full match count when the backend knows it. When it does not (or the count timed
 * out, `totalIsLowerBound`), a full page is treated as "there may be more" — never as the end.
 */
export function pageEnvelope(opts: {
  total: number | null | undefined;
  returned: number;
  offset: number;
  limit: number;
  totalIsLowerBound?: boolean;
}): PageEnvelope {
  const { returned, offset, limit } = opts;
  const total = typeof opts.total === 'number' && Number.isFinite(opts.total) ? opts.total : null;
  const end = offset + returned;
  const moreByCount = total !== null && end < total;
  const moreByShape = (total === null || opts.totalIsLowerBound === true) && returned > 0 && returned >= limit;
  const truncated = moreByCount || moreByShape;
  const env: PageEnvelope = { total, returned, offset, next_offset: truncated ? end : null, truncated };
  if (truncated) {
    const of = total !== null && !opts.totalIsLowerBound ? `of ${total}` : total !== null ? `of at least ${total}` : 'of an unknown number';
    env.truncation_note =
      `Showing results ${returned ? offset + 1 : offset}–${end} ${of}. This is NOT the full set: ` +
      `call again with offset=${end} to see the next page, and repeat until truncated is false ` +
      `before saying what the library does or does not hold.`;
  }
  return env;
}

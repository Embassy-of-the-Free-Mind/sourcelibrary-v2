/**
 * Ordered, bounded-look-ahead async mapping.
 *
 * Fetch-all-then-write is the natural way to build an export and it breaks at
 * real book sizes. Measured on a 366-page facsimile PDF (#3597): awaiting every
 * image before writing meant 231s of silence on a "streamed" response (past
 * Cloudflare's ~100s window) and 707MB peak RSS against Vercel's 1024MB
 * default — with 6,987 visible books LARGER than that one.
 *
 * This yields results strictly in input order while keeping at most
 * `lookahead` results resident, so a consumer can start writing as soon as the
 * first item lands and memory stays flat regardless of input length.
 */

export interface OrderedStreamOptions {
  /** How many fetches may be in flight at once. */
  concurrency?: number;
  /**
   * Upper bound on resolved-but-unconsumed results held in memory. Raised to
   * `concurrency` if smaller, otherwise workers would idle waiting for room.
   */
  lookahead?: number;
}

/**
 * Map `items` through `fetch`, yielding `{ item, value }` in input order.
 *
 * Ordering is the point: the consumer writes pages sequentially, so an
 * out-of-order fast result must wait. A rejected `fetch` propagates — callers
 * that want per-item tolerance should catch inside `fetch` and return a
 * sentinel (the download route returns `null` for an unfetchable image).
 */
export async function* streamOrdered<T, R>(
  items: T[],
  fetch: (item: T, index: number) => Promise<R>,
  opts: OrderedStreamOptions = {},
): AsyncGenerator<{ item: T; value: R; index: number }> {
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const window = Math.max(opts.lookahead ?? 12, concurrency);
  const inFlight = new Map<number, Promise<R>>();

  const start = (i: number) => {
    if (i >= items.length || inFlight.has(i)) return;
    inFlight.set(i, fetch(items[i], i));
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i; j < Math.min(i + window, items.length); j++) start(j);
    const value = await inFlight.get(i)!;
    // Drop the reference BEFORE yielding so the value can be collected as soon
    // as the consumer is done with it — otherwise the map pins every result and
    // the bound is meaningless.
    inFlight.delete(i);
    yield { item: items[i], value, index: i };
  }
}

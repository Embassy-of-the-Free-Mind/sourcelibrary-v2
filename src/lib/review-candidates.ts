import { getReadDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Read path for the volunteer review queues.
 *
 * Every queue serves its next item out of `review_candidates`, a small pooled
 * collection built offline by scripts/maintenance/build-review-candidates.mjs.
 *
 * The routes used to select an item by `$sample`-ing `pages` (19.1M docs) with
 * predicates no index can serve. That is a full collection scan per item fetch,
 * behind a 15s maxDuration — hallucination and scan-quality both returned 504
 * in production (17-23s) and gallery-quality took 8.2s. Precomputing the pool
 * moves that cost off the request path entirely. Never reintroduce a `$sample`
 * over `pages` here.
 *
 * SELECTION POLICY (2026-09-01). Serving was a plain `$sample` over the pool —
 * uniformly random, so votes scattered. Measured on the first 104 submissions:
 * 100 distinct items, 96 with exactly one vote, 4 with two, none with three.
 * A single vote is an opinion; nothing downstream can use it, so the queue was
 * accumulating effort and producing no decisions. Selection now prefers items
 * that are STARTED BUT NOT DECIDED, which turns the same volunteer minutes into
 * settled items instead of a wider thin spread. Order of preference:
 *
 *   1. items with 1..CONSENSUS_TARGET-1 votes  — finish what's started
 *   2. items with no votes at all              — open a new one
 *   3. anything else unrated by this volunteer — never stall the queue
 */

/** How many independent judgments make an item decided. One vote is an
 *  opinion, not a measurement; three is the threshold the gallery-quality
 *  strategy specifies before a human value may override an AI one. */
export const CONSENSUS_TARGET = 3;

export type ReviewCandidate = {
  item_id: string;
  // Page fields are optional: not every queue reviews a page. `spanish-copy`
  // items are interface strings with no book, image or page behind them, and
  // the read path above never touches these — it matches on `queue` alone.
  book_id?: string;
  page_id?: string | null;
  page_number?: number;
  page_type?: string | null;
  image_url?: string;
  page_link?: string;
  book: {
    id?: string;
    title?: string;
    author?: string;
    year?: number;
    language?: string;
    slug?: string | null;
  } | null;
  stratum?: { language?: string; century?: string; provider?: string };
  payload?: Record<string, unknown>;
  is_gold?: boolean;
};

/** Ratings this volunteer has already given in this queue, so we don't show
 *  them the same item twice. Failing open (empty set) is correct: a repeat
 *  item is a much smaller problem than a queue that won't serve anything. */
async function alreadyRated(queue: string, volunteerId: string): Promise<Set<string>> {
  const seen = new Set<string>();
  if (!supabaseAdmin) return seen;
  const { data, error } = await supabaseAdmin
    .from('volunteer_ratings')
    .select('item_id')
    .eq('queue', queue)
    .eq('volunteer_id', volunteerId)
    .limit(5000);
  if (error) {
    console.error(`[review-candidates] rated-lookup failed for ${queue}:`, error.message);
    return seen;
  }
  for (const row of data ?? []) seen.add(row.item_id as string);
  return seen;
}

/** How many scored judgments each item in this queue already has.
 *
 *  Note-only rows carry `rating IS NULL` and are deliberately NOT counted: a
 *  note is a report, not a vote, and counting one would mark an item decided
 *  that nobody actually scored.
 *
 *  supabase-js silently caps a select at 1,000 rows — no error, just a short
 *  array — so this pages explicitly. If the ceiling is ever reached the counts
 *  are partial, which degrades selection to roughly-random rather than
 *  producing a wrong answer, and it says so in the log.
 */
const VOTE_PAGE = 1000;
const VOTE_MAX_PAGES = 20;
const VOTE_CACHE_MS = 30_000;
const voteCache = new Map<string, { at: number; counts: Map<string, number> }>();

async function voteCounts(queue: string): Promise<Map<string, number>> {
  const cached = voteCache.get(queue);
  if (cached && Date.now() - cached.at < VOTE_CACHE_MS) return cached.counts;

  const counts = new Map<string, number>();
  if (!supabaseAdmin) return counts;

  for (let page = 0; page < VOTE_MAX_PAGES; page++) {
    const from = page * VOTE_PAGE;
    const { data, error } = await supabaseAdmin
      .from('volunteer_ratings')
      .select('item_id')
      .eq('queue', queue)
      .not('rating', 'is', null)
      .range(from, from + VOTE_PAGE - 1);
    if (error) {
      // Fail open: a partial map just means selection falls back to random,
      // which is exactly the behaviour this replaced.
      console.error(`[review-candidates] vote-count failed for ${queue}:`, error.message);
      break;
    }
    for (const row of data ?? []) {
      const id = row.item_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if ((data?.length ?? 0) < VOTE_PAGE) break;
    if (page === VOTE_MAX_PAGES - 1) {
      console.warn(
        `[review-candidates] vote-count hit the ${VOTE_MAX_PAGES * VOTE_PAGE}-row ceiling for ${queue}; counts are partial`,
      );
    }
  }

  voteCache.set(queue, { at: Date.now(), counts });
  return counts;
}

/** Up to `n` ids chosen at random, without mutating the caller's array. */
function sampleOf(ids: string[], n: number): string[] {
  if (ids.length <= n) return ids;
  const picked = new Set<number>();
  const out: string[] = [];
  while (out.length < n) {
    const i = Math.floor(Math.random() * ids.length);
    if (picked.has(i)) continue;
    picked.add(i);
    out.push(ids[i]);
  }
  return out;
}

export type NextItemResult =
  | { item: ReviewCandidate; poolEmpty?: false }
  | { item: null; message: string; poolEmpty: boolean };

type PooledDoc = ReviewCandidate & { gold_answer?: unknown };

/** `gold_answer` is the expected response for attention-check items. It must
 *  never reach the client, or the check measures nothing. */
function serve(doc: PooledDoc): NextItemResult {
  const { gold_answer: _gold, ...safe } = doc;
  void _gold;
  return { item: safe as ReviewCandidate };
}

/**
 * Pick one candidate for this volunteer, preferring items that are one or two
 * votes short of a decision. See SELECTION POLICY above.
 *
 * `$sample` is safe here because the pool is a few thousand documents, not
 * 19 million. We over-fetch and filter in JS so a volunteer deep into a queue
 * still gets an item without a second round trip.
 */
export async function nextCandidate(queue: string, volunteerId: string): Promise<NextItemResult> {
  const [rated, counts, db] = await Promise.all([
    alreadyRated(queue, volunteerId),
    voteCounts(queue),
    getReadDb(),
  ]);

  const pool = db.collection('review_candidates');

  // 1. Finish what's started: items short of consensus that this volunteer has
  //    not already judged. Capped so the $in list stays small.
  const undecided: string[] = [];
  for (const [itemId, n] of counts) {
    if (n > 0 && n < CONSENSUS_TARGET && !rated.has(itemId)) undecided.push(itemId);
  }
  if (undecided.length > 0) {
    const docs = (await pool
      .aggregate([
        { $match: { queue, item_id: { $in: sampleOf(undecided, 200) } } },
        { $sample: { size: 20 } },
        { $project: { _id: 0 } },
      ])
      .toArray()) as unknown as PooledDoc[];
    for (const doc of docs) {
      if (!rated.has(doc.item_id)) return serve(doc);
    }
  }

  // 2/3. Otherwise sample the pool, preferring an item nobody has voted on and
  //      falling back to an already-decided one rather than stalling.
  const docs = (await pool
    .aggregate([{ $match: { queue } }, { $sample: { size: 40 } }, { $project: { _id: 0 } }])
    .toArray()) as unknown as PooledDoc[];

  if (docs.length === 0) {
    return {
      item: null,
      poolEmpty: true,
      message:
        'This queue has no items pooled yet. Run scripts/maintenance/build-review-candidates.mjs.',
    };
  }

  let decidedFallback: PooledDoc | null = null;
  for (const doc of docs) {
    if (rated.has(doc.item_id)) continue;
    if ((counts.get(doc.item_id) ?? 0) === 0) return serve(doc);
    if (!decidedFallback) decidedFallback = doc;
  }
  if (decidedFallback) return serve(decidedFallback);

  return {
    item: null,
    poolEmpty: false,
    message: "You've rated everything in this sample — refresh for more.",
  };
}

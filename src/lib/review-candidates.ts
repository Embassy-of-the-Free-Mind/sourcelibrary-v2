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
 */

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

export type NextItemResult =
  | { item: ReviewCandidate; poolEmpty?: false }
  | { item: null; message: string; poolEmpty: boolean };

/**
 * Pick one unrated candidate for this volunteer.
 *
 * `$sample` is safe here because the pool is a few thousand documents, not
 * 19 million. We over-fetch and filter in JS so a volunteer deep into a queue
 * still gets an item without a second round trip.
 */
export async function nextCandidate(queue: string, volunteerId: string): Promise<NextItemResult> {
  const [rated, db] = await Promise.all([alreadyRated(queue, volunteerId), getReadDb()]);

  const docs = (await db
    .collection('review_candidates')
    .aggregate([{ $match: { queue } }, { $sample: { size: 40 } }, { $project: { _id: 0 } }])
    .toArray()) as unknown as (ReviewCandidate & { gold_answer?: unknown })[];

  if (docs.length === 0) {
    return {
      item: null,
      poolEmpty: true,
      message:
        'This queue has no items pooled yet. Run scripts/maintenance/build-review-candidates.mjs.',
    };
  }

  for (const doc of docs) {
    if (rated.has(doc.item_id)) continue;
    // `gold_answer` is the expected response for attention-check items. It must
    // never reach the client, or the check measures nothing.
    const { gold_answer: _gold, ...safe } = doc;
    void _gold;
    return { item: safe as ReviewCandidate };
  }

  return {
    item: null,
    poolEmpty: false,
    message: "You've rated everything in this sample — refresh for more.",
  };
}

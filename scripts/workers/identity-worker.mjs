#!/usr/bin/env node
/**
 * Identity Worker — Phase 0 of the pipeline.
 *
 * Stamps the four deterministic identity fields (normalized_title,
 * normalized_author, edition_key, edition_key_quality) onto any book that is
 * missing them, no matter how the book was inserted. This is what makes
 * identity a PIPELINE property instead of a convention: 47 direct-insert
 * scripts bypass `import-utils.ts`, and before this worker existed their books
 * simply never got identity fields (8,769 of them, measured 2026-08-08).
 * Now the worst case is a book waits one cron cycle.
 *
 * Zero AI calls, zero cost, pure string derivation — which is why it runs
 * even while the pipeline is PAUSED. The pause exists to stop paid work
 * (its one bypass incident, batch OCR, was a problem because it spent money);
 * a book without identity fields is invisible to dedup, so leaving new books
 * unkeyed during a pause is strictly worse than keying them.
 *
 * Idempotent: computing twice yields the same value, and only books whose
 * fields are ABSENT are selected (field null = computed, unkeyable — see
 * src/lib/identity-fields.ts for the convention). Safe under flock, safe to
 * re-run, safe alongside the materialize sweep.
 *
 * Also the alarm: reports how many books older than 7 days are still missing
 * fields (should be 0 — nonzero means this worker has not been running).
 *
 * Cron: Hetzner, every 2 hours at :40, under flock — the exact line lives in
 * scripts/workers/crontab.production (kept as a snapshot of the live crontab).
 *
 * CLI flags:
 *   --limit=N    Max books per run (default 5000)
 *   --dry-run    Report, don't write
 *   --restamp    Recompute for ALL books and rewrite any stored value that
 *                differs from the current canonical computation. NOT for the
 *                cron — this is the repair for normalizer DRIFT: books stamped
 *                by older/divergent implementations (found 2026-08-08: an old
 *                article list that kept leading "de", unsorted author tokens
 *                from direct-insert scripts). Stored values that dedup's
 *                tier-2 query can no longer find are silent recall loss —
 *                measured as most of the 10.5% Latin cross-source miss rate.
 */

import { MongoClient } from 'mongodb';
import { computeIdentityFields } from '../lib/identity-fields.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const RESTAMP = argv.includes('--restamp');
const LIMIT = parseInt(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || (RESTAMP ? '200000' : '5000'), 10);

async function main() {
  if (!MONGODB_URI) { console.error('[IDENTITY] MONGODB_URI not set'); process.exit(1); }
  const started = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 2 });
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  console.log(`[IDENTITY] ${new Date().toISOString()} — limit=${LIMIT}, dry-run=${DRY_RUN}`);

  // Field ABSENT = never computed. Field null = computed, unkeyable — not
  // re-selected, or the 127 unkeyable books would thrash every cycle.
  // --restamp widens the queue to every book and rewrites only diffs.
  const queue = RESTAMP
    ? { content_type: { $ne: 'artwork' } }
    : {
        content_type: { $ne: 'artwork' },
        $or: [
          { edition_key: { $exists: false } },
          { normalized_title: { $exists: false } },
        ],
      };

  const cursor = books
    .find(queue, {
      projection: {
        _id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
        normalized_title: 1, normalized_author: 1, edition_key: 1, edition_key_quality: 1,
      },
    })
    .limit(LIMIT);

  let stamped = 0;
  let unkeyable = 0;
  let ops = [];
  for await (const b of cursor) {
    const fields = computeIdentityFields(b);
    if (fields.edition_key == null) unkeyable++;
    if (RESTAMP) {
      // Rewrite only genuine drift — an 80k-book no-op bulkWrite is churn and
      // makes modifiedCount meaningless as verification.
      const same =
        b.normalized_title === fields.normalized_title &&
        b.normalized_author === fields.normalized_author &&
        (b.edition_key ?? null) === fields.edition_key &&
        (b.edition_key_quality ?? null) === fields.edition_key_quality &&
        Object.prototype.hasOwnProperty.call(b, 'edition_key');
      if (same) continue;
    }
    ops.push({ updateOne: { filter: { _id: b._id }, update: { $set: fields } } });
    if (ops.length >= 500) {
      if (!DRY_RUN) {
        const r = await books.bulkWrite(ops, { ordered: false });
        stamped += r.modifiedCount;
      } else stamped += ops.length;
      ops = [];
    }
  }
  if (ops.length) {
    if (!DRY_RUN) {
      const r = await books.bulkWrite(ops, { ordered: false });
      stamped += r.modifiedCount;
    } else stamped += ops.length;
  }

  // Queue metrics always report the CRON's queue (absence), not the restamp
  // scan — a cron_runs row claiming "79,755 queued" after a restamp would
  // read as an outage.
  const absenceQueue = {
    content_type: { $ne: 'artwork' },
    $or: [{ edition_key: { $exists: false } }, { normalized_title: { $exists: false } }],
  };
  const remaining = await books.countDocuments(absenceQueue);

  // The alarm: a book older than a week with no identity fields means this
  // worker has not been running (or a new writer invented a new gap shape).
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const staleMissing = await books.countDocuments({ ...absenceQueue, created_at: { $lt: weekAgo } });

  const summary = `${RESTAMP ? 'RESTAMP: ' : ''}stamped ${stamped}${DRY_RUN ? ' (dry-run)' : ''}, ${unkeyable} unkeyable, ${remaining} queued, ${staleMissing} stale-missing`;
  console.log(`[IDENTITY] ${summary} in ${Math.round((Date.now() - started) / 1000)}s`);

  await db.collection('cron_runs').insertOne({
    cron: 'identity-worker',
    timestamp: new Date(),
    duration_ms: Date.now() - started,
    status: DRY_RUN ? 'dry-run' : 'success',
    failed: false,
    actions: { stamped, unkeyable, remaining, stale_missing: staleMissing },
    errors: [],
    error_count: 0,
    summary,
  }).catch(() => {});

  await client.close();
}

main().catch(async (e) => {
  console.error('[IDENTITY] fatal:', e);
  try {
    const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1 });
    await client.connect();
    await client.db('bookstore').collection('cron_runs').insertOne({
      cron: 'identity-worker', timestamp: new Date(), status: 'error', failed: true,
      actions: {}, errors: [String(e?.message || e)], error_count: 1,
      summary: `fatal: ${String(e?.message || e).slice(0, 200)}`,
    });
    await client.close();
  } catch { /* best-effort */ }
  process.exit(1);
});

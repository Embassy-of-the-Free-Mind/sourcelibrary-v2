#!/usr/bin/env node
/**
 * PRIOR ART: scripts/lib/illegible-source-gate.mjs (the gate itself; it decides, it does not count);
 * scripts/maintenance/withhold-stale-translations.mjs --illegible-arm (acts on served English, not a
 * counter); a countDocuments on `translation.health_blocked` (unindexed on `pages`, times out at 60s).
 *
 * illegible-gate-count — how many pages the #5305 illegible-source gate has refused, and which.
 *
 * The Batch lanes do not stamp the page they refuse; they record it on their run document in
 * `translate_batch_runs` (chained: `dropped[]` with reason `not_translatable:illegible-source`;
 * seam: `excluded['illegible-source']`). That collection is small, so this is a cheap, exact count
 * for the Batch lanes. The realtime translate-worker stamps `translation.health_blocked:
 * 'illegible_source'` instead; its refusals are logged as "ILLEGIBLE SOURCE" lines and are NOT
 * counted here.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/illegible-gate-count.mjs [--since 2026-10-03T08:10Z] [--list 20]
 */
import { MongoClient } from 'mongodb';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const since = new Date(arg('since', '2026-10-03T08:10:00Z')); // the gate went on in production then (#5305)
const list = Number(arg('list', 20));
const REASON = 'not_translatable:illegible-source';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
try {
  const db = c.db('bookstore');
  const runs = db.collection('translate_batch_runs');
  const touched = await runs.countDocuments({ updated_at: { $gte: since } });
  const chained = await runs.find({ updated_at: { $gte: since }, 'dropped.reason': REASON }, { projection: { book_id: 1, dropped: 1 } }).toArray();
  const pageIds = chained.flatMap((r) => r.dropped.filter((d) => d.reason === REASON).map((d) => d.id));
  const [seam] = await runs.aggregate([
    { $match: { updated_at: { $gte: since }, 'excluded.illegible-source': { $gt: 0 } } },
    { $group: { _id: null, pages: { $sum: '$excluded.illegible-source' }, runs: { $sum: 1 } } },
  ]).toArray();

  console.log(`since ${since.toISOString()}: ${touched} batch runs touched`);
  console.log(`chained lane refused ${pageIds.length} page(s) in ${chained.length} book(s)`);
  console.log(`seam lane refused ${seam?.pages || 0} page(s) in ${seam?.runs || 0} run(s)`);
  if (pageIds.length && list > 0) {
    const pages = await db.collection('pages').find({ id: { $in: pageIds.slice(0, list) } }, { projection: { book_id: 1, page_number: 1, page_type: 1 } }).toArray();
    for (const p of pages) console.log(`  https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}  ${p.page_type || ''}`);
  }
} finally {
  await c.close();
}

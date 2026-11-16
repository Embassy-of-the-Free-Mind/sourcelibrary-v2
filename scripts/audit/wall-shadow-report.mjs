#!/usr/bin/env node
/**
 * Who would the reader wall have stopped, by kind? Reads the shadow log (#90).
 *
 * PRIOR ART: scripts/audit/bph-access-probes.mjs probes the partner gate over HTTP and
 * reads no log. scripts/workers/edge-stops-daily.mjs counts what Cloudflare refused, not
 * what the app's wall would do. The usage reports read api_usage, which carries no wall
 * verdict. This reads `wall_shadow`, written by src/lib/wall-shadow.ts.
 *
 * Sampling is by caller and by UTC day, so every figure is divided by that row's
 * sample_rate: requests and pages are estimates of the whole, and so are callers.
 * `pass` rows are assistants whose address is on the operator's published list: the
 * wall lets them through, and they are listed so the two halves of the assistant check
 * can be compared.
 *
 * USAGE (read-only):
 *   node --env-file=.env.production.local scripts/audit/wall-shadow-report.mjs [--days 14] [--json]
 *
 * The aggregation, for mongosh or Compass:
 *   db.wall_shadow.aggregate([
 *     { $match: { ts: { $gte: ISODate("<since>") } } },
 *     { $group: { _id: { kind: "$kind", action: "$action", caller: "$ip_hash", day: "$day" },
 *                 w: { $first: { $divide: [1, "$sample_rate"] } },
 *                 requests: { $sum: 1 }, pages: { $sum: "$pages_past_sample" },
 *                 books: { $addToSet: "$book_id" } } },
 *     { $group: { _id: { kind: "$_id.kind", action: "$_id.action" },
 *                 caller_days: { $sum: "$w" },
 *                 requests: { $sum: { $multiply: ["$requests", "$w"] } },
 *                 pages: { $sum: { $multiply: ["$pages", "$w"] } },
 *                 sampled_callers: { $addToSet: "$_id.caller" } } },
 *     { $sort: { pages: -1 } }
 *   ])
 */
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const days = Number(argv[argv.indexOf('--days') + 1]) || 14;
const asJson = argv.includes('--json');

const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
if (!uri) {
  console.error('Missing MONGODB_URI.');
  process.exit(2);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
try {
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'bookstore');
  const since = new Date(Date.now() - days * 86400 * 1000);
  const col = db.collection('wall_shadow');

  const rows = await col.aggregate([
    { $match: { ts: { $gte: since } } },
    {
      $group: {
        _id: { kind: '$kind', action: '$action', caller: '$ip_hash', day: '$day' },
        w: { $first: { $divide: [1, '$sample_rate'] } },
        requests: { $sum: 1 },
        pages: { $sum: '$pages_past_sample' },
        books: { $addToSet: '$book_id' },
      },
    },
    {
      $group: {
        _id: { kind: '$_id.kind', action: '$_id.action' },
        caller_days: { $sum: '$w' },
        requests: { $sum: { $multiply: ['$requests', '$w'] } },
        pages: { $sum: { $multiply: ['$pages', '$w'] } },
        sampled_callers: { $addToSet: '$_id.caller' },
        deep_caller_days: { $sum: { $cond: [{ $gte: [{ $size: '$books' }, 50] }, '$w', 0] } },
      },
    },
    { $sort: { pages: -1 } },
  ], { maxTimeMS: 60000, allowDiskUse: true }).toArray();

  const [first] = await col.find({}, { projection: { ts: 1 } }).sort({ ts: 1 }).limit(1).toArray();
  const total = await col.countDocuments({ ts: { $gte: since } });

  const out = rows.map((r) => ({
    kind: r._id.kind,
    action: r._id.action,
    est_caller_days: Math.round(r.caller_days),
    sampled_callers: r.sampled_callers.length,
    est_requests: Math.round(r.requests),
    est_pages_past_sample: Math.round(r.pages),
    est_caller_days_50plus_books: Math.round(r.deep_caller_days),
  }));

  if (asJson) {
    console.log(JSON.stringify({ since, logging_since: first?.ts ?? null, rows_read: total, by_kind: out }, null, 2));
  } else {
    console.log(`wall_shadow, last ${days} days (since ${since.toISOString()}); logging since ${first?.ts?.toISOString?.() ?? 'never'}; ${total} rows read`);
    console.log('Estimates are divided by each row\'s sample rate. "caller-days" = distinct (address, day) pairs.');
    console.table(out);
  }
} catch (e) {
  console.error(e?.message || e);
  process.exitCode = 2;
} finally {
  await client.close();
}

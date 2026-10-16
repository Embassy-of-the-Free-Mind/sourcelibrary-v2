#!/usr/bin/env node
/**
 * PRIOR ART: none for books — scripts/seo/flag-indexable-pages.mjs reads pages.read_count, and the admin metrics
 * page classifies events per request but writes no counter. A live $inc in /api/analytics/track was tried and
 * dropped: the per-day breadth rule below needs the whole day, which a request cannot see cheaply.
 *
 * rebuild-human-read-count-5048 — recompute `books.human_read_count` from `analytics_events` (#5048) and mirror
 * it to Supabase `books_catalog.human_read_count`. `read_count` is not touched.
 *
 * The rule (scripts/lib/human-read-fingerprints.json, with the measurements behind each number):
 * book_read + page_read events with traffic_class 'human' since 2026-07-29T12:00Z, user agent not a listed pool
 * fingerprint, and not from a /24 that read max_books_per_ip_day or more distinct books that UTC day. Walking
 * events in time order per (book_id, ip), an event counts when it is the SECOND qualifying event in the trailing
 * window (60 min). So a reading visit counts once; an address that sends one request and moves on — the
 * proxy-pool pattern — never counts.
 *
 * Idempotent: a full recompute (~1 min, no paid calls). Runs nightly from infrastructure/hetzner-crontab.
 *
 * Default is a dry run (distribution, top books, how many change). --apply writes Mongo, then Supabase, and one
 * `sweep_log` row per changed book with the old value (undo: --undo restores those).
 *
 * Usage: node --env-file=.env.production.local scripts/maintenance/rebuild-human-read-count-5048.mjs [--apply]
 */
import pg from 'pg';
import { MongoClient } from 'mongodb';
import FP from '../lib/human-read-fingerprints.json' with { type: 'json' };
import { recordSweepActions } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const SWEEP = 'rebuild-human-read-count-5048';
const POOL = FP.pool_user_agents.map((p) => new RegExp(p));
const isPool = (ua) => POOL.some((re) => re.test(ua || ''));

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();

async function mirror(pairs) {
  for (let i = 0; i < pairs.length; i += 2000) {
    const s = pairs.slice(i, i + 2000);
    await pgc.query(
      `UPDATE books_catalog b SET human_read_count = v.n FROM unnest($1::text[], $2::int[]) AS v(id, n) WHERE b.id = v.id`,
      [s.map((p) => p[0]), s.map((p) => p[1])]);
  }
}

if (UNDO) {
  const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'set-human-read-count' }).sort({ timestamp: 1 }).toArray();
  const first = new Map();
  for (const r of rows) if (!first.has(r.book_id)) first.set(r.book_id, r.detail?.before ?? null);
  console.log(`${first.size} books to restore to their value before the first run`);
  if (APPLY) {
    const ops = [...first].map(([id, before]) => ({ updateOne: { filter: { id }, update: before == null ? { $unset: { human_read_count: '' } } : { $set: { human_read_count: before } } } }));
    for (let i = 0; i < ops.length; i += 1000) await db.collection('books').bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    await mirror([...first].map(([id, before]) => [id, before ?? 0]));
    console.log('restored');
  }
  await pgc.end(); await mongo.close(); process.exit(0);
}

const t0 = Date.now();
const MATCH = { event: { $in: ['book_read', 'page_read'] }, timestamp: { $gte: new Date(FP.since) }, traffic_class: 'human' };
// Pass 1: the /24-days that read too many distinct books to be a person.
const broad = new Set((await db.collection('analytics_events').aggregate([
  { $match: MATCH },
  { $group: { _id: { ip: '$ip', d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } }, books: { $addToSet: '$book_id' } } },
  { $match: { [`books.${FP.max_books_per_ip_day - 1}`]: { $exists: true } } },
  { $project: { _id: 1 } },
], { allowDiskUse: true }).toArray()).map((r) => `${r._id.ip}|${r._id.d}`));
const cur = db.collection('analytics_events').find(MATCH,
  { projection: { _id: 0, book_id: 1, ip: 1, timestamp: 1, user_agent: 1 } }).sort({ timestamp: 1 }).batchSize(20000);
const win = new Map();
const counts = new Map();
let events = 0, pool = 0, crawl = 0;
for await (const e of cur) {
  events++;
  if (isPool(e.user_agent)) { pool++; continue; }
  if (broad.has(`${e.ip}|${e.timestamp.toISOString().slice(0, 10)}`)) { crawl++; continue; }
  const k = `${e.book_id}|${e.ip}`;
  const t = +e.timestamp;
  let a = win.get(k);
  if (!a) { a = []; win.set(k, a); }
  while (a.length && a[0] <= t - FP.window_ms) a.shift();
  a.push(t);
  if (a.length === 2) counts.set(String(e.book_id), (counts.get(String(e.book_id)) || 0) + 1);
  if (events % 500000 === 0) {
    for (const [kk, aa] of win) if (!aa.length || aa[aa.length - 1] <= t - FP.window_ms) win.delete(kk);
  }
}
console.log(`${events.toLocaleString()} human read events since ${FP.since} (skipped: ${pool.toLocaleString()} pool UA, ${crawl.toLocaleString()} from ${broad.size.toLocaleString()} broad /24-days) in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${counts.size.toLocaleString()} books with ≥1 visit`);

const existing = await db.collection('books').find(
  { $or: [{ id: { $in: [...counts.keys()] } }, { human_read_count: { $exists: true } }] },
  { projection: { _id: 0, id: 1, human_read_count: 1, read_count: 1, title: 1, visible: 1, pages_count: 1 } }).toArray();
const changes = [];
for (const b of existing) {
  const next = counts.get(String(b.id)) || 0;
  if ((b.human_read_count ?? null) !== next) changes.push({ id: String(b.id), before: b.human_read_count ?? null, after: next });
}
const missing = [...counts.keys()].filter((id) => !existing.some((b) => String(b.id) === id)).length;
const vals = [...counts.values()].sort((a, b) => b - a);
const ge = (n) => vals.filter((v) => v >= n).length;
const live = existing.filter((b) => b.visible === true && b.pages_count > 0);
console.log(JSON.stringify({
  books_counted: counts.size, books_missing_from_books: missing, changes: changes.length, visits_total: vals.reduce((a, b) => a + b, 0),
  ge: { 1: ge(1), 3: ge(3), 5: ge(5), 10: ge(10), 25: ge(25) },
  live_books_ge10_legacy_read_count: await db.collection('books').countDocuments({ visible: true, pages_count: { $gt: 0 }, read_count: { $gte: 10 } }),
  live_ge: { 3: live.filter((b) => (counts.get(String(b.id)) || 0) >= 3).length, 5: live.filter((b) => (counts.get(String(b.id)) || 0) >= 5).length, 10: live.filter((b) => (counts.get(String(b.id)) || 0) >= 10).length },
}, null, 2));
console.log('top 15 by human visits (legacy read_count):');
for (const b of [...live].sort((x, y) => (counts.get(String(y.id)) || 0) - (counts.get(String(x.id)) || 0)).slice(0, 15)) {
  console.log(`  ${String(counts.get(String(b.id)) || 0).padStart(5)} (${String(b.read_count || 0).padStart(5)})  ${b.id}  ${(b.title || '').slice(0, 60)}`);
}

if (APPLY && changes.length) {
  const ops = changes.map((c) => ({ updateOne: { filter: { id: c.id }, update: { $set: { human_read_count: c.after } } } }));
  for (let i = 0; i < ops.length; i += 1000) await db.collection('books').bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  await mirror(changes.map((c) => [c.id, c.after]));
  await recordSweepActions(db, changes.map((c) => ({ sweep: SWEEP, book_id: c.id, action: 'set-human-read-count', detail: { before: c.before, after: c.after, issue: 5048 } })));
  const back = await pgc.query(`SELECT count(*)::int n, sum(human_read_count)::int s FROM books_catalog WHERE human_read_count > 0`);
  console.log(`wrote ${changes.length} books (Mongo + books_catalog); books_catalog now ${back.rows[0].n} rows > 0, sum ${back.rows[0].s}`);
} else if (!APPLY) console.log('dry run — pass --apply to write');

await pgc.end();
await mongo.close();

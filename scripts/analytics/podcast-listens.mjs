#!/usr/bin/env node
/**
 * Podcast listen funnel from the `podcast_plays` collection
 * (written by /api/podcast/events from the episode-page player).
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/analytics/podcast-listens.mjs [--days 30]
 *
 * Note: this only sees plays on sourcelibrary.org/podcast/* pages.
 * Listens via the RSS feed in podcast apps hit R2 directly and are invisible here.
 */
import { MongoClient, ObjectId } from 'mongodb';

const daysArg = process.argv.indexOf('--days');
const days = daysArg > -1 ? parseInt(process.argv[daysArg + 1], 10) : 30;
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const rows = await db.collection('podcast_plays').aggregate([
  { $match: { created_at: { $gte: since } } },
  {
    $group: {
      _id: { thread: '$thread_id', event: '$event' },
      n: { $sum: 1 },
    },
  },
]).toArray();

const byThread = new Map();
for (const r of rows) {
  if (!byThread.has(r._id.thread)) byThread.set(r._id.thread, {});
  byThread.get(r._id.thread)[r._id.event] = r.n;
}

const threads = await db.collection('embassy_threads')
  .find({ _id: { $in: [...byThread.keys()].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) } })
  .project({ title: 1 })
  .toArray();
const titles = new Map(threads.map((t) => [t._id.toString(), t.title]));

console.log(`Podcast listens — last ${days} days (episode-page player only)\n`);
const sorted = [...byThread.entries()].sort((a, b) => (b[1].play || 0) - (a[1].play || 0));
if (!sorted.length) console.log('No plays recorded in this window.');
for (const [threadId, ev] of sorted) {
  const plays = ev.play || 0;
  const pct = (n) => (plays ? `${Math.round((100 * (n || 0)) / plays)}%` : '-');
  console.log(`${titles.get(threadId) || threadId}`);
  console.log(`  plays ${plays} | 25% ${pct(ev.q1)} | 50% ${pct(ev.q2)} | 75% ${pct(ev.q3)} | complete ${pct(ev.complete)}`);
  console.log(`  https://sourcelibrary.org/podcast/${threadId}\n`);
}

await client.close();

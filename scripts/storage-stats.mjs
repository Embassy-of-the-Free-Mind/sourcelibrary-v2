/**
 * Storage stats — instant answer to "how big is the library?"
 *
 * - Image bytes/objects: Cloudflare R2 analytics (authoritative, ~1s).
 *   Requires CF_ANALYTICS_TOKEN (account token with Account Analytics: Read).
 * - Text bytes: running totals in system_config.storage_stats when present
 *   (maintained by nightly cron, see issue #2972), plus instant collStats.
 * - Book/page counts from books collection.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/storage-stats.mjs
 */
import { MongoClient } from 'mongodb';

const gb = (b) => (b / 1e9).toFixed(2) + ' GB';
const out = { measured_at: new Date().toISOString() };

// --- R2 via Cloudflare analytics ---
const since = new Date(Date.now() - 3 * 86400e3).toISOString();
const gql = `query { viewer { accounts(filter: {accountTag: "${process.env.R2_ACCOUNT_ID}"}) {
  r2StorageAdaptiveGroups(limit: 100, filter: {datetime_geq: "${since}"}) {
    max { payloadSize metadataSize objectCount } dimensions { bucketName } } } } }`;
const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: gql }),
}).then((r) => r.json());
const buckets = res?.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups || [];
out.r2 = buckets.map((b) => ({
  bucket: b.dimensions.bucketName,
  bytes: b.max.payloadSize,
  human: gb(b.max.payloadSize),
  objects: b.max.objectCount,
}));
if (!buckets.length) out.r2_error = JSON.stringify(res?.errors || res).slice(0, 300);

// --- Mongo ---
const client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 180000, serverSelectionTimeoutMS: 15000 });
await client.connect();
try {
  const db = client.db('bookstore');
  const cfg = await db.collection('system_config').findOne({ _id: 'storage_stats' });
  if (cfg) out.text_running_totals = cfg;

  out.collections = {};
  for (const c of ['pages', 'chapter_texts', 'books']) {
    const s = await db.command({ collStats: c });
    out.collections[c] = { docs: s.count, logical: gb(s.size), on_disk: gb(s.storageSize) };
  }
  const b = db.collection('books');
  out.books = {
    total: await b.estimatedDocumentCount(),
    visible: await b.countDocuments({ $nor: [{ hidden: true }, { visible: false }] }),
    fully_translated: await b.countDocuments({ is_fully_translated: true }),
  };
} finally {
  await client.close();
}

console.log(JSON.stringify(out, null, 2));

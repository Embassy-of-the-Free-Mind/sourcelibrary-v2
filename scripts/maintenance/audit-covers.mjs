#!/usr/bin/env node
/**
 * Cover audit — catches books whose cover URL does not actually load.
 *
 * Written after de Bary 1864 shipped a broken cover on the live site. The URL
 * was derived by stripping `-full` to reach a 1200px `display` variant that the
 * archive-images worker never wrote, so nothing in the data looked wrong: the
 * fields were populated, the book was visible, and only a browser could tell.
 *
 * Two failure modes, both silent, both seen in production:
 *   1. the variant was never generated (fixed in the worker, but old books remain)
 *   2. the file exists but Cloudflare negatively cached the 404 from before it did
 *
 * Reports both. --fix purges the cached 404s; regenerating missing variants is
 * scripts/import/backfill-display-variants.mjs.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/audit-covers.mjs [--collection=slug] [--limit=N] [--fix]
 */
import { MongoClient } from 'mongodb';

const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=')[1];
const COLLECTION = arg('collection', '');
const LIMIT = parseInt(arg('limit', '400'), 10);
const FIX = process.argv.includes('--fix');

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const filter = { visible: true, pages_count: { $gt: 0 }, ...(COLLECTION ? { collections: COLLECTION } : {}) };
const books = await db.collection('books')
  .find(filter, { projection: { _id: 0, id: 1, slug: 1, title: 1, image_display: 1, thumbnail: 1, image_thumb: 1, thumbnail_blob: 1 } })
  .sort({ updated_at: -1 }).limit(LIMIT).toArray();

console.log(`Auditing ${books.length} book cover${books.length === 1 ? '' : 's'}${COLLECTION ? ` in ${COLLECTION}` : ''}.\n`);

// Mirrors getBookThumbnailUrl + deriveVariant: what the browser is actually asked for.
const displayUrl = (b) => {
  const raw = b.image_display || b.thumbnail || b.thumbnail_blob;
  if (!raw) return null;
  const m = raw.match(/^(https:\/\/images\.sourcelibrary\.org\/pages\/[^/]+\/(?:sp[a-z0-9]*-?)?\d{4,})(-full)?\.jpg$/);
  return m ? `${m[1]}.jpg` : raw;
};

const broken = [];
for (const b of books) {
  const url = displayUrl(b);
  if (!url) { broken.push({ b, url: '(none)', status: 'no cover field' }); continue; }
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) broken.push({ b, url, status: String(r.status) });
  } catch (e) { broken.push({ b, url, status: e.message.slice(0, 40) }); }
}

if (!broken.length) { console.log('All covers load.'); await client.close(); process.exit(0); }

console.log(`${broken.length} broken cover${broken.length === 1 ? '' : 's'}:\n`);
broken.forEach(({ b, url, status }) => console.log(`  ${status.padEnd(14)} ${String(b.title).slice(0, 42).padEnd(44)} ${url}`));

if (FIX) {
  const t = process.env.CLOUDFLARE_API_TOKEN, z = process.env.CLOUDFLARE_ZONE_ID;
  if (!t || !z) { console.error('\nNo Cloudflare credentials; cannot purge.'); }
  else {
    const urls = broken.map(x => x.url).filter(u => u.startsWith('http'));
    for (let i = 0; i < urls.length; i += 30) {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${z}/purge_cache`, {
        method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: urls.slice(i, i + 30) }),
      });
      console.log(`\npurge batch ${i / 30 + 1}: ${r.status}`);
    }
    console.log('Re-run without --fix to see what remains genuinely missing.');
  }
}
process.exitCode = 1; // non-zero so CI or a cron notices
await client.close();

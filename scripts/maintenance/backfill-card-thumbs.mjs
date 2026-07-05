/**
 * Backfill the 600px gallery `-card.jpg` variant (#2401) for crops that were
 * materialized before generate-thumbnails.mjs emitted it.
 *
 * Gallery/collection cards render in 324–443px slots (~650–880px at 2× DPR); the
 * existing 300px `-thumb.jpg` blurs there. This generates a 600px `-card.jpg`
 * sibling from the ALREADY-ARCHIVED extracted crop on R2 — it never touches the
 * original page/IIIF source, so no link-rot or 403 risk and no Gemini cost.
 * Idempotent: skips crops that already have `card_url`.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-card-thumbs.mjs [--dry-run] [--limit=N] [--book-id=ID] [--concurrency=8] [--featured]
 *
 * --featured: scope to the high-visibility card surfaces only — visible books,
 * top-ranked plates (book_rank <= 4). Covers collection-grid leads, the homepage
 * strip, and lead gallery cards (~16K) without paying for the deep-scroll tail.
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
const BOOK_ID = (process.argv.find(a => a.startsWith('--book-id=')) || '').split('=')[1] || null;
const CONCURRENCY = Number((process.argv.find(a => a.startsWith('--concurrency=')) || '').split('=')[1]) || 8;
const FEATURED = process.argv.includes('--featured');

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set'); process.exit(1);
}
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function fetchBuffer(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function putR2(key, body) {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: body, ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Some stored URLs carry a literal newline from a past run where R2_PUBLIC_URL
// had a trailing \n (see lesson_env_newline_phantom_sync_success). Strip all
// whitespace so the fetch + key derivation see a clean URL. Empty → null.
function cleanUrl(url) {
  const u = (url || '').replace(/\s+/g, '').trim();
  return u || null;
}

// Turn an extracted/thumb URL into the R2 object key for its `-card.jpg` sibling.
// gallery URLs look like `${R2_PUBLIC_URL}/gallery/{book}/{page}-{idx}[-thumb].jpg?v=...`
function cardKeyFrom(url) {
  const noQuery = url.split('?')[0];
  const path = noQuery.replace(`${R2_PUBLIC_URL}/`, '');
  if (!path.startsWith('gallery/')) return null;
  return path.replace(/(-thumb)?\.jpg$/, '-card.jpg');
}

async function processPool(items, concurrency, fn) {
  let idx = 0, done = 0, failed = 0;
  const errors = [];
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { await fn(items[i]); done++; }
      catch (e) { failed++; if (errors.length < 20) errors.push({ id: items[i].id, error: e.message }); }
      if ((done + failed) % 100 === 0) console.log(`  [${done + failed}/${items.length}] ok=${done} fail=${failed}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { done, failed, errors };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const galleryCol = db.collection('gallery_images');
  const pagesCol = db.collection('pages');

  const filter = {
    extracted_url: { $ne: null },
    $or: [{ card_url: { $exists: false } }, { card_url: null }],
  };
  if (BOOK_ID) filter.book_id = BOOK_ID;
  if (FEATURED) { filter.book_visible = true; filter.book_rank = { $lte: 4 }; }

  const total = await galleryCol.countDocuments(filter);
  console.log(`gallery_images needing a card variant: ${total}${LIMIT ? ` (processing ${LIMIT})` : ''}`);
  if (DRY_RUN) { console.log('DRY RUN — no writes.'); await client.close(); return; }

  const cursor = galleryCol.find(filter, { projection: { _id: 0, id: 1, book_id: 1, page_id: 1, detection_index: 1, extracted_url: 1 } });
  if (LIMIT) cursor.limit(LIMIT);
  const items = await cursor.toArray();

  const startTime = Date.now();
  const { done, failed, errors } = await processPool(items, CONCURRENCY, async (g) => {
    const srcUrl = cleanUrl(g.extracted_url);
    if (!srcUrl) throw new Error('empty extracted_url (no crop to downscale)');
    const key = cardKeyFrom(srcUrl);
    if (!key) throw new Error(`unmappable url: ${srcUrl.slice(0, 60)}`);
    const src = await fetchBuffer(srcUrl);
    const card = await sharp(src).resize(600, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    const cardUrl = (await putR2(key, card)) + `?v=${startTime}`;

    // gallery_images is the render-facing view + the idempotency key, so write
    // it first and let it govern success. (The frontend derives -card.jpg from
    // the thumb URL, so the R2 file above is what actually renders; these fields
    // are bookkeeping.)
    await galleryCol.updateOne({ id: g.id }, { $set: { card_url: cardUrl, updated_at: new Date() } });
    // Mirror onto the source-of-truth detected_images entry. Non-fatal: some
    // pages carry a null detected_images[idx] slot ($set can't descend into
    // null), and the R2 file + gallery_images row already cover rendering.
    if (g.page_id != null && g.detection_index != null) {
      await pagesCol.updateOne(
        { id: g.page_id },
        { $set: { [`detected_images.${g.detection_index}.card_url`]: cardUrl } },
      ).catch(() => {});
    }
  });

  const mins = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\nDone in ${mins}m — generated ${done}, failed ${failed}.`);
  if (errors.length) console.log('Sample errors:', JSON.stringify(errors.slice(0, 10), null, 2));
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });

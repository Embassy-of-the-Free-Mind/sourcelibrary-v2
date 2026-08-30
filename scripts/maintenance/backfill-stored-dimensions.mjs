#!/usr/bin/env node
/**
 * Record the pixel dimensions of what we ACTUALLY HOLD, for every archived page.
 *
 * WHY THIS EXISTS (#4406)
 * -----------------------
 * "Do we have the full-resolution master?" is a comparison of two numbers:
 * the width we stored, and the width the source says is native. The corpus
 * records the first for 66.7% of pages and the second for **7.7%** — so the
 * question has never been answerable from the database, and every attempt to
 * answer it has been a rate-limited re-derivation from the institutions'
 * servers. On 2026-08-30 that produced three different answers to the same
 * question in one day: ~11%, 42.8% and 63.8% of pages below master.
 *
 * Worse, the 7.7% that DO carry a native width are not a random sample: they
 * are almost exactly the pages `archive-eap.mjs` handled — the one worker that
 * both tile-stitches to native AND records `iiif_info`. Measured over that
 * subset the corpus reads 95.2% full-resolution, which is true of the subset
 * and meaningless as a corpus figure. **The population we can measure is the
 * population we archived correctly.** That is the selection effect that made
 * this debt invisible.
 *
 * This script fixes the half that costs nothing. Stored width comes from OUR
 * OWN R2 objects, so it needs no institution, no rate limit, and carries no
 * risk of a fourth host blocking us (three did inside 48 hours in August 2026).
 * It reads only the JPEG SOF header via a ranged GET — not the whole image.
 *
 * The other half — native width — must be recorded AT ARCHIVE TIME by the
 * writers, which is the companion change in this PR. This script deliberately
 * does NOT probe sources: doing so is what makes the measurement expensive and
 * fragile, and the whole point is to stop needing it.
 *
 * After this runs, `image_width` is populated for every archived page, and the
 * MASTER tier stops being a sampled network probe for the stored side.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/backfill-stored-dimensions.mjs --dry-run
 *   node --env-file=.env.production.local scripts/maintenance/backfill-stored-dimensions.mjs --apply --limit 50000
 *   node --env-file=.env.production.local scripts/maintenance/backfill-stored-dimensions.mjs --apply --concurrency 24
 *
 * Idempotent: only touches pages with an `archived_photo` and no `image_width`.
 * Safe to interrupt and re-run; it re-selects whatever is still missing.
 */
import { MongoClient } from 'mongodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const APPLY = has('--apply');
const LIMIT = parseInt(arg('--limit', '0'), 10) || Infinity;
const CONCURRENCY = parseInt(arg('--concurrency', '16'), 10);
const BATCH = 2000;

// Our own bucket. If a key is NOT ours, skip it — probing a partner's server is
// exactly the cost this script exists to avoid.
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').replace(/\/$/, '');

// Read from R2 DIRECTLY, not through images.sourcelibrary.org.
//
// The CDN route would work and is what archive-coverage.mjs uses for its sampled
// tier — but this is a corpus-wide sweep over ~6.9M objects, and pulling every
// one through the edge means millions of COLD cache fills. That is precisely the
// thundering herd #2651 refused to trigger with a purge_everything, and R2
// throttles under a connection storm (the June provenance run died of exactly
// that). Origin reads also skip the ~5s CDN miss latency: measured 2.5/s through
// the CDN at concurrency 12, which would put this sweep at a month.
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${(process.env.R2_ACCOUNT_ID || '').trim()}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';

/** Parse JPEG SOF dimensions out of a buffer. Returns null if not found yet. */
function sofDims(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // not JPEG
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    // SOF0..SOF15 carry the frame dimensions; DHT/JPG/DAC share the range.
    const isSOF = marker >= 0xC0 && marker <= 0xCF
      && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isSOF) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null; // malformed
    i += 2 + len;
  }
  return null;
}

const toBuf = async (body) => {
  const chunks = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
};

/**
 * Dimensions of an object we hold, from its JPEG header.
 *
 * Two-stage: 12 KB covers the SOF marker for the overwhelming majority of files,
 * and only the ones carrying a fat EXIF/ICC block before SOF need the 192 KB
 * read. At corpus scale that is the difference between ~80 GB and ~1.3 TB of
 * egress for the same answer.
 */
async function probeR2Dimensions(key) {
  for (const range of ['bytes=0-12287', 'bytes=0-196607']) {
    const o = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range }));
    const dims = sofDims(await toBuf(o.Body));
    if (dims) return dims;
  }
  return null;
}

const st = {
  scanned: 0, probed: 0, recorded: 0, notOurs: 0, unreadable: 0, failed: 0,
  start: Date.now(),
};

function progress() {
  const el = (Date.now() - st.start) / 1000;
  console.log(
    `  scanned=${st.scanned} recorded=${st.recorded} not-ours=${st.notOurs} ` +
    `unreadable=${st.unreadable} failed=${st.failed}  (${(st.recorded / Math.max(el, 1)).toFixed(1)}/s)`
  );
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const mc = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 900000 });
  await mc.connect();
  const pages = mc.db(process.env.MONGODB_DB || 'bookstore').collection('pages');

  // "has an archive but no usable width" — missing, null, or non-positive.
  // Spelled out rather than folded into one clause, because a single-field
  // $exists+$in combination silently means something else.
  const query = {
    archived_photo: { $type: 'string' },
    $or: [{ image_width: { $exists: false } }, { image_width: null }, { image_width: { $lte: 0 } }],
  };

  const outstanding = await pages.countDocuments(query, { maxTimeMS: 120000 }).catch(() => null);
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}  concurrency: ${CONCURRENCY}`);
  console.log(`pages with an archive but no recorded width: ${outstanding?.toLocaleString() ?? 'unknown'}\n`);

  let lastId = null;
  while (st.scanned < LIMIT) {
    const q = lastId ? { ...query, _id: { $gt: lastId } } : query;
    // Materialise each batch — never stream a cursor across slow per-item work.
    const batch = await pages.find(q, {
      projection: { _id: 1, archived_photo: 1 },
      sort: { _id: 1 },
      limit: Math.min(BATCH, LIMIT - st.scanned),
    }).toArray();
    if (!batch.length) break;
    lastId = batch[batch.length - 1]._id;

    const ops = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
      while (i < batch.length) {
        const p = batch[i++];
        st.scanned++;
        const url = p.archived_photo;
        if (!url.startsWith(R2_PUBLIC_URL)) { st.notOurs++; continue; }
        const key = url.slice(R2_PUBLIC_URL.length + 1).split('?')[0];
        try {
          const dims = await probeR2Dimensions(key);
          st.probed++;
          if (!dims?.width) { st.unreadable++; continue; }
          ops.push({
            updateOne: {
              filter: { _id: p._id },
              update: { $set: { image_width: dims.width, image_height: dims.height } },
            },
          });
        } catch { st.failed++; }
      }
    }));

    if (APPLY && ops.length) {
      const res = await pages.bulkWrite(ops, { ordered: false });
      st.recorded += res.modifiedCount;
    } else {
      st.recorded += ops.length;
    }
    progress();
  }

  console.log(`\n${APPLY ? 'Recorded' : 'Would record'} ${st.recorded} page dimensions.`);
  console.log(`scanned=${st.scanned} probed=${st.probed} not-ours=${st.notOurs} unreadable=${st.unreadable} failed=${st.failed}`);
  if (!APPLY) console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  await mc.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

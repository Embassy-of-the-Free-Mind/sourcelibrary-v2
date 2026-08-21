#!/usr/bin/env node
/**
 * Pass 1 execution: regenerate the "never downsized" display variants flagged by
 * measure-pages-archived.mjs (manifest-display-bloat.ndjson). Reclaims the bytes
 * AND makes those pages ~4× lighter to load (#3005).
 *
 * Unlike backfill-display-images.mjs (which SKIPS pages whose display file
 * already exists), this FORCE-OVERWRITES the existing bloated display key with a
 * true 1200px variant. It reuses the same machinery and the same source-
 * correctness discipline:
 *   - resolve the source via getPageSource() on the real Mongo page doc,
 *   - SKIP old-era split pages (cropped_photo set): the read side proxies+crops
 *     those and never serves the display variant, so regenerating from the
 *     spread master would bake a wrong (full-spread) image for no benefit (#1814),
 *   - resize with the shared generateDisplayVariants() (1200px + provenance mark),
 *   - overwrite display + thumb keys, update Mongo display_photo/image_thumb.
 *
 * The master (archived/ or -full) is never touched, so every regenerated display
 * is re-derivable — this pass is reversible.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/r2-reclaim/regen-display-bloat.mjs --dry-run
 *   node scripts/maintenance/r2-reclaim/regen-display-bloat.mjs --limit=200 --verify   # pilot
 *   node scripts/maintenance/r2-reclaim/regen-display-bloat.mjs --min-reclaim=51200    # real run
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { generateDisplayVariants } from '../../workers/lib/display-image.mjs';
import { getPageSource, isUsableImageUrl } from '../../lib/page-image-url.mjs';
import { mongo, outPath, human } from './lib.mjs';

const args = process.argv.slice(2);
const getArg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const has = (n) => args.includes(`--${n}`);

const DRY_RUN = has('dry-run');
const VERIFY = has('verify');
const LIMIT = parseInt(getArg('limit') || '0', 10) || Infinity; // candidate rows to consider
const CONCURRENCY = parseInt(getArg('concurrency') || '8', 10);
const MIN_RECLAIM = parseInt(getArg('min-reclaim') || '0', 10); // skip rows below this reclaimEst (bytes)
const MANIFEST = getArg('manifest') || outPath('manifest-display-bloat.ndjson');

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const BUCKET = process.env.R2_BUCKET_NAME;
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

const PAGE_PROJECTION = {
  _id: 1, id: 1, book_id: 1, page_number: 1,
  photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1,
  cropped_photo: 1, display_photo: 1, image_thumb: 1, split_from_spread: 1,
};

const st = {
  rows: 0, considered: 0,
  regen: 0, skipSplit: 0, skipNoSource: 0, skipNotFound: 0, failed: 0,
  oldBytes: 0, newBytes: 0, reclaimed: 0, downloadBytes: 0,
  start: Date.now(),
};

async function upload(key, buf) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buf,
    ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400',
  }));
}
async function download(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

function resolveSource(page) {
  if (isUsableImageUrl(page.cropped_photo)) return { skip: 'split' };
  const source = getPageSource(page);
  if (!source || !/^https?:\/\//.test(source) || /\.(jp2|jpx|jpf|j2k|tiff?)(\?|$)/i.test(source)) {
    return { skip: 'nosource' };
  }
  return { source };
}

async function processRow(row, page, db) {
  const { source, skip } = resolveSource(page);
  if (skip === 'split') { st.skipSplit++; return; }
  if (skip === 'nosource') { st.skipNoSource++; return; }

  const num = String(page.page_number).padStart(4, '0');
  const displayKey = `pages/${page.book_id}/${num}.jpg`;
  const thumbKey = `pages/${page.book_id}/${num}-thumb.jpg`;

  if (DRY_RUN) { st.regen++; st.oldBytes += row.displaySize; return; }

  try {
    const buf = await download(source);
    if (!buf || buf.length === 0) throw new Error(`empty source: ${source.slice(0, 80)}`);
    st.downloadBytes += buf.length;
    const { display, thumb } = await generateDisplayVariants(buf);
    if (VERIFY) {
      const dir = outPath('verify-samples');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/${page.book_id}_${num}.new.jpg`, display);
    }
    await upload(displayKey, display);
    await upload(thumbKey, thumb);
    await db.collection('pages').updateOne(
      { $or: [{ id: page.id || page._id }, { _id: page.id || page._id }] },
      { $set: { display_photo: `${R2_PUBLIC_URL}/${displayKey}`, image_thumb: `${R2_PUBLIC_URL}/${thumbKey}`, updated_at: new Date() } },
    );
    st.regen++;
    st.oldBytes += row.displaySize;
    st.newBytes += display.length;
    st.reclaimed += Math.max(0, row.displaySize - display.length);
  } catch (e) {
    st.failed++;
    if (st.failed <= 20) console.error(`  FAIL ${page.book_id}/${num}: ${e.message?.slice(0, 90)}`);
  }
}

// Pool over an array of {row, page} tasks.
async function runPool(tasks, db) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      await processRow(t.row, t.page, db);
      if ((st.regen + st.failed) % 200 === 0) logProgress();
    }
  }));
}

function logProgress() {
  const el = (Date.now() - st.start) / 1000;
  console.error(`  considered=${st.considered} regen=${st.regen} split=${st.skipSplit} nosrc=${st.skipNoSource} nf=${st.skipNotFound} fail=${st.failed} reclaimed=${human(st.reclaimed)} (${(st.regen / el).toFixed(1)}/s)`);
}

async function main() {
  if (!fs.existsSync(MANIFEST)) { console.error(`Manifest not found: ${MANIFEST} — run measure-pages-archived.mjs first.`); process.exit(1); }
  console.error(`[regen-display-bloat]${DRY_RUN ? ' DRY RUN' : ''} manifest=${MANIFEST} min-reclaim=${MIN_RECLAIM} limit=${LIMIT === Infinity ? 'all' : LIMIT}`);
  const client = await mongo();
  const db = client.db('bookstore');

  const rl = readline.createInterface({ input: fs.createReadStream(MANIFEST), crlfDelay: Infinity });
  // Buffer rows grouped by book; flush per book (manifest is already book-ordered).
  let curBook = null;
  let bucket = [];

  async function flush() {
    if (!bucket.length) return;
    const bookId = curBook;
    const nums = bucket.map((r) => r.page);
    const docs = await db.collection('pages')
      .find({ book_id: bookId, page_number: { $in: nums } }, { projection: PAGE_PROJECTION }).toArray();
    const byNum = new Map(docs.map((d) => [d.page_number, d]));
    const tasks = [];
    for (const r of bucket) {
      const page = byNum.get(r.page);
      if (!page) { st.skipNotFound++; continue; }
      tasks.push({ row: r, page });
    }
    await runPool(tasks, db);
    bucket = [];
  }

  for await (const line of rl) {
    if (!line) continue;
    if (st.considered >= LIMIT) break;
    const r = JSON.parse(line);
    st.rows++;
    if (r.reclaimEst < MIN_RECLAIM) continue;
    st.considered++;
    if (r.bookId !== curBook) { await flush(); curBook = r.bookId; }
    bucket.push(r);
  }
  await flush();
  await client.close();

  const el = (Date.now() - st.start) / 1000;
  const summary = {
    ran_at: new Date().toISOString(), dry_run: DRY_RUN,
    config: { MIN_RECLAIM, LIMIT: LIMIT === Infinity ? 'all' : LIMIT, CONCURRENCY },
    manifest_rows: st.rows, considered: st.considered,
    regenerated: st.regen, skip_split: st.skipSplit, skip_no_source: st.skipNoSource,
    skip_not_found: st.skipNotFound, failed: st.failed,
    old_display_bytes: st.oldBytes, old_human: human(st.oldBytes),
    new_display_bytes: st.newBytes, new_human: human(st.newBytes),
    reclaimed_bytes: st.reclaimed, reclaimed_human: human(st.reclaimed),
    downloaded_human: human(st.downloadBytes),
    elapsed_s: Math.round(el),
  };
  fs.writeFileSync(outPath(DRY_RUN ? 'summary-regen-dryrun.json' : 'summary-regen-run.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });

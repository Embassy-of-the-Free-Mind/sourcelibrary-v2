#!/usr/bin/env node
/**
 * Repair the bulk-JP2 leaf offset (#3368): re-archive a book's page images from
 * its per-page IIIF source so the scan matches the text beside it.
 *
 * WHY NOT rearchive-iiif-fullres.mjs: that script's #3359 guard refuses any book
 * whose verdict isn't `aligned`, which is every book we need to repair. The guard
 * is right for what it was built for — in the e-rara incident `photo_original`
 * was the WRONG side, so a mismatch meant "do not overwrite". Here `archived` is
 * the wrong side. Same verdict, opposite conclusion, and a perceptual hash alone
 * cannot tell the two apart.
 *
 * WHAT MAKES photo_original AUTHORITATIVE HERE: a third, independent witness.
 * Pages OCR'd BEFORE archival were transcribed from the IIIF source, and their
 * text matches it. So on a book with pre-archival OCR, the text agrees with
 * photo_original and disagrees with the archive — the archive is the outlier.
 * This script therefore REFUSES books with no pre-archival pages (severity:none),
 * where that witness does not exist and re-archiving would CREATE a misalignment.
 *
 * THE COUNTERINTUITIVE PART: pages OCR'd AFTER archival read the shifted image,
 * so their text currently agrees with what the reader sees. Fixing the images
 * BREAKS those pages. They are flagged `needs_reocr` here and must be re-OCR'd
 * (paid) in a follow-up pass. Repairing images without that step trades one
 * misalignment for another.
 *
 * Reversible: the images being overwritten are just the neighbouring leaf, always
 * refetchable from IA. Nothing unique is destroyed. OCR/translation are untouched.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-bulk-jp2-offset.mjs --book <id>            # dry run
 *   node scripts/maintenance/repair-bulk-jp2-offset.mjs --book <id> --apply
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { uploadPageVariants } from '../workers/lib/display-image.mjs';
import { preserveObjectVersion } from '../lib/r2-version.mjs';
import { checkAlignment, hashBuffer, readerVisibleShift } from '../lib/page-alignment.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
dotenv.config({ path: resolve(REPO_ROOT, '.env.production.local') });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const APPLY = args.includes('--apply');
const VERIFY_ONLY = args.includes('--verify-only');
const FROM_AUDIT = flag('from-audit');       // JSONL from scripts/audit/bulk-archive-alignment.mjs
const BOOKS = args.reduce((a, x, i) => (x === '--book' ? [...a, args[i + 1]] : a), []);
// Page fetches per book, against archive.org. Kept modest deliberately: this
// sweep pulls a quarter-million full-res images and a 429 storm helps nobody.
const CONCURRENCY = Math.max(1, parseInt(flag('concurrency', '6'), 10));

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType,
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

const IA_LEAF_RE = /\/page\/n\d+/;
const thumbnail = u => String(u).replace(/\/full\/pct:\d+\//, '/full/pct:12/');
// Repair at a generous width; the archive is the full-res master the variants derive from.
const fullRes = u => String(u).replace(/\/full\/pct:\d+\//, '/full/pct:100/');

/**
 * Fetch with backoff. A dropped page here is not cosmetic: it leaves ONE page
 * of a book still holding its neighbour's scan, which is the exact defect we
 * are repairing and is invisible afterwards. Retry rather than skip.
 */
async function fetchBuf(url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      last = new Error(`http ${r.status}`);
      // Back off hard on rate limiting; 4xx other than 429 will not improve with retries.
      if (r.status !== 429 && r.status < 500) throw last;
    } catch (err) {
      last = err;
      if (err.message?.startsWith('http 4') && !err.message.includes('429')) throw err;
    }
    await new Promise(r => setTimeout(r, 1500 * 2 ** i));
  }
  throw last;
}
const hashUrl = async url => hashBuffer(await fetchBuf(url));

/**
 * Re-check alignment AFTER a repair.
 *
 * Two things bite here and both produce a FALSE failure:
 *   - the edge serves the pre-repair bytes for a short window after the write,
 *     so the archived URL must be cache-busted;
 *   - R2 is read-after-write eventually consistent, so verifying the instant the
 *     last upload returns can still read the old object.
 * The first trial run hit exactly this: every sampled page was in fact perfect
 * (Hamming 0) but the immediate post-check reported shift+1.
 */
async function verifyRepair(db, bookId, { settleMs = 20_000 } = {}) {
  await new Promise(r => setTimeout(r, settleMs));
  const fresh = await db.collection('pages').find({ book_id: bookId })
    .project({ page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, archive_metadata: 1 })
    .sort({ page_number: 1 }).toArray();
  const bust = u => `${u}${u.includes('?') ? '&' : '?'}_v=${Date.now()}`;
  return checkAlignment(fresh, {
    // Only the archived side needs busting; the IIIF source was never rewritten.
    hashUrl: u => hashUrl(u.startsWith(R2_PUBLIC_URL) ? bust(u) : u),
    sourceUrlFor: p => thumbnail(p.photo_original || p.photo),
    isUsableSource: p => IA_LEAF_RE.test(String(p.photo_original || p.photo)),
    candidates: fresh.filter(p => p.archive_metadata?.source === 'bulk_jp2'),
  });
}

async function repairBook(db, bookId) {
  const book = await db.collection('books').findOne(
    { $expr: { $eq: [{ $toString: '$_id' }, bookId] } },
    { projection: { title: 1, id: 1, visible: 1 } },
  );
  if (!book) return console.log(`[SKIP] ${bookId}: book not found`);

  const pages = await db.collection('pages').find({ book_id: bookId })
    .project({ id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1,
               display_photo: 1, archive_metadata: 1, 'ocr.updated_at': 1, 'ocr.created_at': 1 })
    .sort({ page_number: 1 }).toArray();
  const bulk = pages.filter(p => p.archive_metadata?.source === 'bulk_jp2');

  console.log(`\n=== ${book.title?.slice(0, 66)}`);
  console.log(`    ${bookId} | ${pages.length} pages, ${bulk.length} bulk_jp2 | visible=${book.visible === true}`);

  if (bulk.length < 10) return console.log('  [SKIP] not a bulk_jp2 book');

  // Gate 1 — the archive must actually be shifted.
  const before = await checkAlignment(pages, {
    hashUrl, sourceUrlFor: p => thumbnail(p.photo_original || p.photo),
    isUsableSource: p => IA_LEAF_RE.test(String(p.photo_original || p.photo)),
    candidates: bulk,
  });
  console.log(`  pre-check: ${before.verdict} (${before.detail})`);
  // Gate on VOTES, not the verdict. The verdict wants unanimity, so one flaky
  // archive.org fetch demotes a genuine shift+1 to `ambiguous` and the book is
  // skipped — Magni Hippocratis (998 damaged pages, the worst in the corpus) was
  // refused exactly this way on the first batch run. Requiring >=2 shift votes
  // and ZERO aligned votes is still strictly safe: no sample said the archive
  // was correct, so there is nothing to preserve by declining.
  const v = before.votes || { aligned: 0, shift: 0, checked: 0 };
  const shiftedEnough = v.shift >= 2 && v.aligned === 0;
  if (!shiftedEnough) {
    return console.log(`  [REFUSE] insufficient evidence of a shift (aligned=${v.aligned} shift=${v.shift} of ${v.checked}) — declining rather than risk rewriting a correct book`);
  }

  // Gate 2 — the independent witness must exist (see header).
  const split = readerVisibleShift(bulk);
  console.log(`  pages: ${split.visible} pre-archival (text agrees with IIIF), ${split.consistent} post-archival (text agrees with the shifted image)`);
  if (split.visible === 0) {
    return console.log('  [REFUSE] no pre-archival pages — cannot establish which side is correct; repairing would CREATE a misalignment');
  }

  const targets = bulk.filter(p => IA_LEAF_RE.test(String(p.photo_original || p.photo)));
  console.log(`  would re-archive ${targets.length} pages from IIIF; ${split.consistent} pages will then need re-OCR`);
  if (VERIFY_ONLY) {
    // Re-verify and record the outcome for a book already re-archived — used to
    // repair the bookkeeping when the post-check read stale bytes.
    const v = await verifyRepair(db, bookId, { settleMs: 0 });
    console.log(`  verify-only: ${v.verdict} (${v.detail})`);
    await recordOutcome(db, book, bulk, v, split, 0);
    return;
  }
  if (!APPLY) return console.log('  [DRY RUN] no writes — pass --apply');

  let done = 0, failed = 0, idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const p = targets[idx++];
      try {
        const buf = await fetchBuf(fullRes(p.photo_original || p.photo));
        // Everything versions (#3756): keep the pre-repair object reachable
        await preserveObjectVersion(s3, process.env.R2_BUCKET_NAME, `archived/${bookId}/${p.page_number}.jpg`);
        await uploadPageVariants(buf, bookId, p.page_number, uploadToR2);
        done++;
        if (done % 25 === 0) console.log(`    … ${done}/${targets.length}`);
      } catch (err) {
        failed++;
        if (failed <= 3) console.log(`    [FAIL] page ${p.page_number}: ${err.message?.slice(0, 70)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`  re-archived ${done}, failed ${failed}`);

  const after = await verifyRepair(db, bookId);
  console.log(`  post-check: ${after.verdict} (${after.detail})`);
  await recordOutcome(db, book, bulk, after, split, failed);
}

async function recordOutcome(db, book, bulk, after, split, failed) {
  const ok = after.verdict === 'aligned' && failed === 0;
  await db.collection('books').updateOne({ _id: book._id }, {
    $set: {
      'archive_metadata.jp2_offset_repaired': ok,
      'archive_metadata.jp2_offset_repaired_at': new Date(),
      'archive_metadata.jp2_offset_post_verdict': after.verdict,
      'archive_metadata.jp2_offset_needs_reocr': split.consistent,
      updated_at: new Date(),
    },
  });
  // Flag the pages whose text now disagrees with the corrected image. These are
  // the pages that looked fine BEFORE the repair — their OCR was transcribed
  // from the shifted image, so correcting the image strands them.
  if (ok && split.consistent > 0) {
    const stale = bulk.filter(p => {
      const o = p.ocr?.updated_at || p.ocr?.created_at, a = p.archive_metadata?.archived_at;
      return o && a && new Date(o) >= new Date(a);
    }).map(p => p._id);
    await db.collection('pages').updateMany(
      { _id: { $in: stale } },
      { $set: { needs_reocr: true, needs_reocr_reason: 'jp2-offset-repair-#3368' } },
    );
    console.log(`  flagged ${stale.length} pages needs_reocr (their OCR read the shifted image)`);
  }
  console.log(ok ? '  [OK] repaired and verified' : '  [WARN] post-check not aligned — inspect before repairing more books');
}

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

let queue = BOOKS;
if (FROM_AUDIT) {
  const fs = await import('fs');
  const rows = fs.readFileSync(FROM_AUDIT, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  // Only severity high/partial: those have pre-archival pages, i.e. the
  // independent witness that says the archive is the wrong side. `none` books
  // are shifted but self-consistent — repairing them would CREATE a defect.
  queue = rows.filter(r => r.severity === 'high' || r.severity === 'partial').map(r => r.book_id);
  // Worst first, so the most-read damage is fixed earliest.
  const rank = new Map(rows.map(r => [r.book_id, r.reader_visible_pages || 0]));
  queue.sort((a, b) => rank.get(b) - rank.get(a));
  console.log(`from-audit: ${queue.length} books with severity high/partial`);
}
if (!queue.length) { console.error('nothing to do — pass --book <id> or --from-audit <jsonl>'); process.exit(1); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

// Resume: skip books already repaired and verified in an earlier run.
if (FROM_AUDIT && APPLY) {
  const already = await db.collection('books').find(
    { 'archive_metadata.jp2_offset_repaired': true },
    { projection: { _id: 1 } },
  ).toArray();
  const doneIds = new Set(already.map(b => String(b._id)));
  const before = queue.length;
  queue = queue.filter(id => !doneIds.has(id));
  if (before !== queue.length) console.log(`resume: skipping ${before - queue.length} already repaired`);
}

console.log(APPLY ? `*** APPLY MODE — writing to R2 *** (${queue.length} books, page concurrency ${CONCURRENCY})` : '--- dry run ---');
let n = 0;
for (const b of queue) {
  n++;
  console.log(`\n[book ${n}/${queue.length}]`);
  try { await repairBook(db, b); }
  catch (err) { console.log(`  [ERR] ${b}: ${err.message?.slice(0, 120)}`); }
}
await client.close();
console.log('\nDONE. Purge Cloudflare so readers stop seeing pre-repair scans:');
console.log(`  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" --data '{"purge_everything":true}'`);

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
 * misalignment for another. Nothing reads `needs_reocr` (#5309): that is exactly
 * what happened after the 2026-07-29 run, so --apply now refuses to strand
 * pages unless --reocr-issue names the owner of their re-OCR, and
 * scripts/audit/stranded-image-repair-text.mjs lists them until they are redone.
 *
 * Reversible: the images being overwritten are just the neighbouring leaf, always
 * refetchable from IA. Nothing unique is destroyed. OCR/translation are untouched.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-bulk-jp2-offset.mjs --book <id>            # dry run
 *   node scripts/maintenance/repair-bulk-jp2-offset.mjs --book <id> --apply
 *   … --book <id> --text-matches-source-by-eye S1,S2   finish a half-done text repair (#8266)
 *   … --no-purge   skip the per-book Cloudflare purge (#8277); otherwise --apply refuses to start
 *                  without CLOUDFLARE_ZONE_ID + a purge-capable CLOUDFLARE_API_TOKEN
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { uploadPageVariants } from '../workers/lib/display-image.mjs';
import { preserveObjectVersion } from '../lib/r2-version.mjs';
import { checkAlignment, halfRepairWitness, hashBuffer, readerVisibleShift } from '../lib/page-alignment.mjs';
import { assertPurgeCredentials, purgeUrls } from '../lib/cloudflare-purge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
dotenv.config({ path: resolve(REPO_ROOT, '.env.production.local') });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const APPLY = args.includes('--apply');
const VERIFY_ONLY = args.includes('--verify-only');
// After a book is re-archived, purge its image URLs so readers stop getting the old scan from
// the edge (#8277: after #8266, Cloudflare served the pre-repair bytes until a hand purge).
const NO_PURGE = args.includes('--no-purge');
const FROM_AUDIT = flag('from-audit');       // JSONL from scripts/audit/bulk-archive-alignment.mjs
const REOCR_ISSUE = flag('reocr-issue');    // issue that owns re-OCR of pages this repair strands (#5309)
const BOOKS = args.reduce((a, x, i) => (x === '--book' ? [...a, args[i + 1]] : a), []);
// Finish a book repair-bulkjp2-text-shift.mjs left half done (#8266): the slots whose source leaf
// was opened and showed the stored text. See halfRepairWitness() in page-alignment.mjs.
const BY_EYE = flag('text-matches-source-by-eye')?.split(',').map(Number) ?? null;
// Page fetches per book, against archive.org. Kept modest deliberately: this
// sweep pulls a quarter-million full-res images and a 429 storm helps nobody.
const CONCURRENCY = Math.max(1, parseInt(flag('concurrency', '6'), 10));
// Interior pages the dHash gate samples (#5803). Three is enough on most books, but
// on near-identical layouts (an Italian octavo of uniform text blocks) dHash abstains
// on most picks and a real shift gets 1 vote of 3. More samples, same gate.
const SAMPLES = Math.max(3, parseInt(flag('samples', '3'), 10));

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

// Which writer's pages to repair, and how to address their per-page source.
//   bulk_jp2  (#3368) IA *_jp2.zip indexed by IIIF number; source = IA BookReader leaf.
//   erara_pdf (#5803) e-rara PDF archived with e-rara's generated cover sheet as page 1,
//             so every archived image is one leaf behind photo (the e-rara IIIF canvas).
//             Same shape, same gates; only the source URL scheme differs.
const SOURCES = {
  bulk_jp2: {
    re: /\/page\/n\d+/,
    thumb: u => String(u).replace(/\/full\/pct:\d+\//, '/full/pct:12/'),
    // Repair at a generous width; the archive is the full-res master the variants derive from.
    full: u => String(u).replace(/\/full\/pct:\d+\//, '/full/pct:100/'),
    reocrReason: 'jp2-offset-repair-#3368',
  },
  erara_pdf: {
    re: /e-rara\.ch\/i3f\/v21\/\d+\/full\//,
    thumb: u => String(u).replace(/\/full\/[^/]+\/0\//, '/full/400,/0/'),
    full: u => String(u).replace(/\/full\/[^/]+\/0\//, '/full/full/0/'),
    reocrReason: 'erara-cover-sheet-repair-#5803',
  },
};
const SOURCE = flag('source', 'bulk_jp2');
if (!SOURCES[SOURCE]) { console.error(`--source must be one of ${Object.keys(SOURCES)}`); process.exit(1); }
const { re: IA_LEAF_RE, thumb: thumbnail, full: fullRes } = SOURCES[SOURCE];

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
    candidates: fresh.filter(p => p.archive_metadata?.source === SOURCE),
    samples: SAMPLES,
  });
}

async function repairBook(db, bookId) {
  const book = await db.collection('books').findOne(
    // id OR _id: books with a re-minted _id are invisible to an _id-only lookup (book-deletion-and-identity.md)
    { $or: [{ id: bookId }, { $expr: { $eq: [{ $toString: '$_id' }, bookId] } }] },
    { projection: { title: 1, id: 1, visible: 1, archive_metadata: 1 } },
  );
  if (!book) return console.log(`[SKIP] ${bookId}: book not found`);

  const pages = await db.collection('pages').find({ book_id: bookId })
    .project({ id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1,
               display_photo: 1, thumbnail: 1, archive_metadata: 1, 'ocr.updated_at': 1, 'ocr.created_at': 1 })
    .sort({ page_number: 1 }).toArray();
  const bulk = pages.filter(p => p.archive_metadata?.source === SOURCE);

  console.log(`\n=== ${book.title?.slice(0, 66)}`);
  console.log(`    ${bookId} | ${pages.length} pages, ${bulk.length} ${SOURCE} | visible=${book.visible === true}`);

  if (bulk.length < 10) return console.log(`  [SKIP] not a ${SOURCE} book`);

  // Gate 1 — the archive must actually be shifted.
  const before = await checkAlignment(pages, {
    hashUrl, sourceUrlFor: p => thumbnail(p.photo_original || p.photo),
    isUsableSource: p => IA_LEAF_RE.test(String(p.photo_original || p.photo)),
    candidates: bulk,
    samples: SAMPLES,
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
  // Gate 3 (erara_pdf) — the text must still sit on the source leaf. Gate 2 goes by OCR date, so it
  // cannot see a text MOVE: #7949 moved text onto the shifted images of books July had already moved
  // to the source, and correcting those images would break them again. Same event type for both, so
  // the writer decides: the latest move must be July's. No move at all leaves Gate 2 in charge.
  if (SOURCE === 'erara_pdf' && !BY_EYE) {
    const [lastMove] = await db.collection('book_events')
      .find({ book_id: book.id, type: 'text_shift_repair' }).sort({ at: -1 }).limit(1).toArray();
    if (lastMove && lastMove.source !== 'repair-erara-text-shift') {
      return console.log(`  [REFUSE] latest text move is ${lastMove.source || 'unlabelled'} (${new Date(lastMove.at).toISOString().slice(0, 10)}): the text may follow the shifted images (#7949)`);
    }
    if (await db.collection('book_events').findOne({ book_id: book.id, type: 'text_shift_repair_undo' })) {
      return console.log('  [REFUSE] text_shift_repair_undo on record: read this book by eye first (#7949)');
    }
  }

  let split = readerVisibleShift(bulk);
  const awaitingImages = book.archive_metadata?.jp2_text_shift_awaiting_image_rearchive === true;
  if (awaitingImages || BY_EYE) {
    // The text was moved after OCR, so OCR timing says nothing about this book (#8266).
    // The witness is about stored text, so "both ends" means both ends of the pages that have some.
    const withText = bulk.filter(p => p.ocr?.updated_at || p.ocr?.created_at).map(p => p.page_number);
    const witness = halfRepairWitness(book, BY_EYE, withText);
    if (!witness.ok) return console.log(`  [REFUSE] half-done text repair: ${witness.reason} (--text-matches-source-by-eye S1,S2)`);
    console.log(`  half-done text repair; text checked against the source leaf by eye at ${BY_EYE.join(',')}`);
    split = { ...split, visible: bulk.length, consistent: 0 };
  } else {
    console.log(`  pages: ${split.visible} pre-archival (text agrees with IIIF), ${split.consistent} post-archival (text agrees with the shifted image)`);
    if (split.visible === 0) {
      return console.log('  [REFUSE] no pre-archival pages — cannot establish which side is correct; repairing would CREATE a misalignment');
    }
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
  // #5309: the 2026-07-29 run of this script flagged 111K pages needs_reocr and
  // nothing ever read the flag, so correcting the images put a neighbouring
  // leaf's text and translation beside every one of them, for two months.
  // Repairing images that strand text is only safe with the re-OCR owned.
  if (split.consistent > 0 && !REOCR_ISSUE) {
    return console.log(`  [REFUSE] ${split.consistent} pages would be stranded (text read the shifted image) — pass --reocr-issue <N> naming the issue that owns their re-OCR; audit with scripts/audit/stranded-image-repair-text.mjs`);
  }

  let done = 0, failed = 0, idx = 0;
  const written = new Set(); // every URL readers may hold for a page we overwrote
  async function worker() {
    while (idx < targets.length) {
      const p = targets[idx++];
      try {
        const buf = await fetchBuf(fullRes(p.photo_original || p.photo));
        // Everything versions (#3756): keep the pre-repair object reachable
        await preserveObjectVersion(s3, process.env.R2_BUCKET_NAME, `archived/${bookId}/${p.page_number}.jpg`);
        const urls = await uploadPageVariants(buf, bookId, p.page_number, uploadToR2);
        // The bare URLs just written, plus the stored ones (which may carry a ?v= query) — the
        // edge caches each exact URL separately.
        for (const u of [urls.archived, urls.display, urls.thumb, p.archived_photo, p.display_photo, p.thumbnail]) {
          if (typeof u === 'string' && u.startsWith(R2_PUBLIC_URL)) written.add(u);
        }
        // Record what we stored (#4406). Free — the buffer is already decoded —
        // and without it nothing downstream can tell what this repair produced.
        const dims = {};
        if (urls.width) dims.image_width = urls.width;
        if (urls.height) dims.image_height = urls.height;
        if (Object.keys(dims).length) {
          await db.collection('pages').updateOne({ _id: p._id }, { $set: dims });
        }
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
  if (written.size && !NO_PURGE) {
    // Purged whatever the post-check says: R2 now holds the new images either way.
    const r = await purgeUrls([...written]);
    console.log(`  cloudflare purge: ${r.purged}/${r.requested} URLs${r.failed ? ` — FAILED ${r.failed}: ${r.errors.slice(0, 2).join('; ')}` : ''}`);
  } else if (written.size) {
    console.log(`  [NO PURGE] ${written.size} image URLs still cached at the edge — purge them by URL (#8277)`);
  }

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
      ...(REOCR_ISSUE ? { 'archive_metadata.jp2_offset_reocr_issue': Number(REOCR_ISSUE) } : {}),
      ...(BY_EYE ? { 'archive_metadata.jp2_offset_text_by_eye_slots': BY_EYE } : {}),
      updated_at: new Date(),
    },
    // Only a verified repair ends the half-done state; the integrity watch reports it until then.
    ...(ok && BY_EYE ? { $unset: { 'archive_metadata.jp2_text_shift_awaiting_image_rearchive': '' } } : {}),
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
      { $set: { needs_reocr: true, needs_reocr_reason: SOURCES[SOURCE].reocrReason } },
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

// Fail before any write, not after a book's images are already replaced (#8277).
if (APPLY && !VERIFY_ONLY && !NO_PURGE) {
  try { assertPurgeCredentials(); } catch (e) { console.error(e.message); process.exit(1); }
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
console.log('\nDONE.');

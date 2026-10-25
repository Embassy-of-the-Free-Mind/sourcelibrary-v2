#!/usr/bin/env node
/**
 * Build the preservation manifest — the thing that has to exist before any
 * archive, and the deliverable even if no bytes ever move.
 *
 * WHY: nothing in the system currently distinguishes a master from a thumbnail.
 * That is not a filing complaint — on 2026-08-18 it nearly cost 396 GB of BPH
 * partner JP2 masters, which presented every signal of dead weight (referenced
 * by zero page documents, written on a single day, sitting beside the live
 * `archived/` under a near-identical name) and cannot be re-fetched from
 * anywhere. See `.claude/docs/r2-storage.md`, "classified by REPLACEABILITY".
 *
 * WHAT IT COVERS, and why both halves matter:
 *
 *   IMAGES — every R2 object for the book, with size and ETag, classified.
 *     2.44 TB for Tier 0. Re-fetchable from the source institution in
 *     principle, so expensive to lose but not fatal.
 *   TEXT + METADATA — OCR, translations, chapter texts, book record, index.
 *     The whole database is 45 GB on disk, 1.8% of the image bytes. It is also
 *     the half that CANNOT be re-acquired: it was produced here at ~$56.5K of
 *     model spend plus years of curatorial judgment, and no institution has a
 *     copy. Archive it first; it costs about four cents a month.
 *
 * Tiers (see r2-storage.md for the full class definitions):
 *   tier0 — no public re-acquisition path: bph, cmc_kloss, allard_pierson.
 *   tier1 — public institutional repositories; re-fetchable, expensively.
 *   tier2 — has an ia_identifier; Internet Archive holds a copy.
 *
 * ETag, not SHA-256, for image integrity: S3/R2 return it free in a listing,
 * and it is the MD5 for any non-multipart upload. Computing SHA-256 over 2.44 TB
 * means downloading 2.44 TB. Text digests ARE real SHA-256 — that content is
 * small and it is the irreplaceable half. Objects whose ETag contains "-" were
 * multipart-uploaded and their ETag is NOT a content hash; those are flagged
 * `etag_is_not_md5` so a restore check does not silently pass on them.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/build-preservation-manifest.mjs --tier 0 --out ./manifest
 *   node scripts/maintenance/build-preservation-manifest.mjs --book <id> --out ./manifest
 *
 * Read-only. Touches nothing in Mongo, R2 or Supabase.
 */

import { MongoClient } from 'mongodb';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg('--out', './manifest');
const TIER = arg('--tier');
const ONE_BOOK = arg('--book');
const LIMIT = parseInt(arg('--limit', '0')) || 0;

const TIER0_PROVIDERS = ['bph', 'cmc_kloss', 'allard_pierson'];

/** R2 prefixes that can hold a book's objects, across six accreted conventions. */
const BOOK_PREFIXES = (id) => [
  `archived/${id}/`, `archive/${id}/`, `pages/${id}/`, `books/${id}/`,
  `cropped/${id}/`, `gallery/${id}/`, `thumbnails/${id}/`, `deepzoom/${id}/`,
  `uploads/${id}/`, `enhanced/${id}/`, `page-masters/${id}/`,
];

/**
 * Replaceability class per key. Mirrors the table in r2-storage.md.
 * `archived/` is deliberately ambiguous — it holds originals AND display
 * variants at the same shape, which is exactly why it must not be bulk-deleted.
 */
function classify(key) {
  if (key.startsWith('archive/')) return 'master';            // JP2 partner scans
  if (key.startsWith('uploads/')) return 'master';
  if (key.startsWith('books/')) return 'master';              // single hi-res, no variants
  if (key.startsWith('page-masters/')) return 'master';
  if (/-full\.jpg$/.test(key)) return 'master';
  if (/-thumb\.jpg$/.test(key)) return 'derived';
  if (key.startsWith('thumbnails/') || key.startsWith('deepzoom/')) return 'derived';
  if (key.startsWith('cropped/') || key.startsWith('enhanced/')) return 'derived';
  if (key.startsWith('gallery/')) return 'derived';
  // A bare `pages/{id}/{NNNN}.jpg` is the canonical DISPLAY variant — the
  // master at that shape carries the `-full` suffix (see pagePaths() in
  // src/lib/storage.ts). Without this it fell through to 'unknown', which is
  // the one class a human has to adjudicate; leaving the commonest canonical
  // key there would have buried the genuinely unclassifiable ones.
  if (key.startsWith('pages/')) return 'derived';
  if (key.startsWith('archived/')) return 'master-or-display'; // ambiguous by construction
  return 'unknown';
}

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, 'books'), { recursive: true });

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';

function tierOf(book) {
  if (TIER0_PROVIDERS.includes(book.image_source?.provider)) return 'tier0';
  if (book.ia_identifier) return 'tier2';
  return 'tier1';
}

let query = {};
if (ONE_BOOK) query = { id: ONE_BOOK };
else if (TIER === '0') query = { 'image_source.provider': { $in: TIER0_PROVIDERS } };

// Materialise the whole book list up front rather than streaming a cursor.
// Each book takes tens of seconds (11 R2 prefix listings + a full page scan),
// so an open cursor sits idle far past Mongo's 10-minute timeout and dies with
// CursorNotFound — which is exactly what killed the first full run at book
// 2,101 of 4,464. A few thousand documents is nothing to hold in memory; an
// idle cursor is everything to lose.
const allBooks = await db.collection('books').find(query, {
  projection: {
    id: 1, title: 1, author: 1, author_id: 1, published: 1, language: 1,
    pages_count: 1, pages_ocr: 1, pages_translated: 1, visible: 1,
    work_id: 1, edition_key: 1, is_first_translation: 1, ia_identifier: 1,
    image_source: 1, slug: 1, collections: 1, doi: 1,
  },
}).toArray();
console.log(`${allBooks.length.toLocaleString()} book(s) selected`);

// Resumable: a book whose manifest already exists is skipped, so an
// interrupted run costs only the book it was on. Pass --rebuild to force.
const REBUILD = process.argv.includes('--rebuild');
const indexPath = path.join(OUT, 'index.jsonl');
if (REBUILD && existsSync(indexPath)) writeFileSync(indexPath, '');

const totals = { books: 0, objects: 0, imageBytes: 0, textBytes: 0, pages: 0, byClass: {}, multipart: 0, skipped: 0 };
let n = 0;

for (const book of allBooks) {
  if (LIMIT && n >= LIMIT) break;
  n++;

  if (!REBUILD && existsSync(path.join(OUT, 'books', `${book.id}.json`))) {
    totals.skipped++;
    continue;
  }

  // --- images ---
  const objects = [];
  for (const prefix of BOOK_PREFIXES(book.id)) {
    let token;
    do {
      const r = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token,
      }));
      for (const o of r.Contents || []) {
        const etag = (o.ETag || '').replace(/"/g, '');
        const multipart = etag.includes('-');
        if (multipart) totals.multipart++;
        objects.push({
          key: o.Key,
          bytes: o.Size || 0,
          etag,
          ...(multipart ? { etag_is_not_md5: true } : {}),
          class: classify(o.Key),
        });
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  }

  // --- text: the irreplaceable half ---
  // Digest OCR and translation separately so a partial restore is detectable,
  // and stream rather than buffering a whole book's text.
  const ocrHash = createHash('sha256');
  const trHash = createHash('sha256');
  let ocrBytes = 0, trBytes = 0, pagesWithOcr = 0, pagesWithTr = 0, pageCount = 0;

  const pages = db.collection('pages').find(
    { book_id: book.id },
    { projection: { page_number: 1, ocr: 1, translation: 1 }, sort: { page_number: 1 } },
  ).batchSize(1000);
  for await (const p of pages) {
    pageCount++;
    // `pages.ocr` is an OBJECT — the text is at .data, not the field itself.
    const ocr = typeof p.ocr?.data === 'string' ? p.ocr.data : (typeof p.ocr === 'string' ? p.ocr : '');
    const tr = typeof p.translation?.data === 'string' ? p.translation.data
      : (typeof p.translation === 'string' ? p.translation : '');
    if (ocr) { pagesWithOcr++; ocrBytes += Buffer.byteLength(ocr); ocrHash.update(`${p.page_number} ${ocr} `); }
    if (tr) { pagesWithTr++; trBytes += Buffer.byteLength(tr); trHash.update(`${p.page_number} ${tr} `); }
  }

  const chapters = await db.collection('chapter_texts').countDocuments({ book_id: book.id });
  const bookIndex = await db.collection('book_indexes').countDocuments({ book_id: book.id });

  const manifest = {
    schema: 'sourcelibrary/preservation-manifest@1',
    book_id: book.id,
    tier: tierOf(book),
    provider: book.image_source?.provider || null,
    ia_identifier: book.ia_identifier || null,
    re_fetchable_from: book.ia_identifier ? 'internet_archive'
      : (TIER0_PROVIDERS.includes(book.image_source?.provider) ? null : book.image_source?.provider || null),
    record: {
      title: book.title, author: book.author, author_id: book.author_id ?? null,
      published: book.published ?? null, language: book.language ?? null,
      slug: book.slug ?? null, doi: book.doi ?? null,
      work_id: book.work_id ?? null, edition_key: book.edition_key ?? null,
      is_first_translation: !!book.is_first_translation,
      visible: !!book.visible,
      collections: book.collections ?? [],
      pages_count: book.pages_count ?? 0,
      pages_ocr: book.pages_ocr ?? 0,
      pages_translated: book.pages_translated ?? 0,
    },
    text: {
      page_docs: pageCount,
      pages_with_ocr: pagesWithOcr,
      pages_with_translation: pagesWithTr,
      ocr_bytes: ocrBytes,
      translation_bytes: trBytes,
      ocr_sha256: pagesWithOcr ? ocrHash.digest('hex') : null,
      translation_sha256: pagesWithTr ? trHash.digest('hex') : null,
      chapter_texts: chapters,
      book_indexes: bookIndex,
    },
    images: {
      object_count: objects.length,
      bytes: objects.reduce((s, o) => s + o.bytes, 0),
      by_class: objects.reduce((m, o) => { m[o.class] = (m[o.class] || 0) + 1; return m; }, {}),
      objects,
    },
  };

  writeFileSync(path.join(OUT, 'books', `${book.id}.json`), JSON.stringify(manifest, null, 1));
  appendFileSync(indexPath, JSON.stringify({
    book_id: book.id, tier: manifest.tier, provider: manifest.provider,
    title: book.title, objects: objects.length,
    image_bytes: manifest.images.bytes,
    text_bytes: ocrBytes + trBytes,
    pages: pageCount,
    by_class: manifest.images.by_class,
  }) + '\n');

  totals.books++;
  totals.objects += objects.length;
  totals.imageBytes += manifest.images.bytes;
  totals.textBytes += ocrBytes + trBytes;
  totals.pages += pageCount;
  for (const [k, v] of Object.entries(manifest.images.by_class)) totals.byClass[k] = (totals.byClass[k] || 0) + v;

  if (totals.books % 100 === 0) {
    console.log(`  ${totals.books} books · ${totals.objects.toLocaleString()} objects · ` +
      `${(totals.imageBytes / 1e9).toFixed(1)} GB images · ${(totals.textBytes / 1e9).toFixed(2)} GB text`);
  }
}

// Totals come from the accumulated index, not this run's counters — otherwise
// a resumed run reports only the books it happened to build and silently
// under-counts everything an earlier run already did.
const agg = { books: 0, pages: 0, objects: 0, imageBytes: 0, textBytes: 0, byClass: {} };
const seen = new Set();
for (const line of readFileSync(indexPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let r;
  try { r = JSON.parse(line); } catch { continue; }
  if (seen.has(r.book_id)) continue;   // a --rebuild-less re-run can duplicate lines
  seen.add(r.book_id);
  agg.books++;
  agg.pages += r.pages || 0;
  agg.objects += r.objects || 0;
  agg.imageBytes += r.image_bytes || 0;
  agg.textBytes += r.text_bytes || 0;
  for (const [k, v] of Object.entries(r.by_class || {})) agg.byClass[k] = (agg.byClass[k] || 0) + v;
}

const summary = {
  schema: 'sourcelibrary/preservation-manifest-summary@1',
  generated_at: new Date().toISOString(),
  selector: ONE_BOOK ? { book: ONE_BOOK } : TIER ? { tier: TIER } : { all: true },
  books: agg.books,
  pages: agg.pages,
  objects: agg.objects,
  image_bytes: agg.imageBytes,
  text_bytes: agg.textBytes,
  objects_by_class: agg.byClass,
  built_this_run: totals.books,
  skipped_already_built: totals.skipped,
  multipart_etags: totals.multipart,
  notes: [
    'ETags are MD5 only for non-multipart uploads; entries flagged etag_is_not_md5 need a byte-length check or a real hash on restore.',
    'Text SHA-256 covers pages.ocr.data and pages.translation.data only. chapter_texts and book_indexes are counted, not digested.',
    'Supabase (page_translations, embeddings) is a SEPARATE store and is NOT covered by this manifest.',
  ],
};
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));

console.log('\n--- manifest complete ---');
console.log(`  books        : ${agg.books.toLocaleString()}  (${totals.books} built now, ${totals.skipped} already present)`);
console.log(`  pages        : ${agg.pages.toLocaleString()}`);
console.log(`  objects      : ${agg.objects.toLocaleString()}`);
console.log(`  image bytes  : ${(agg.imageBytes / 1e12).toFixed(3)} TB`);
console.log(`  text bytes   : ${(agg.textBytes / 1e9).toFixed(2)} GB  <-- the half nothing can re-sell us`);
console.log(`  by class     : ${JSON.stringify(agg.byClass)}`);
console.log(`  multipart ETags (not content hashes): ${totals.multipart.toLocaleString()}`);
console.log(`\n  → ${OUT}/summary.json, ${OUT}/index.jsonl, ${OUT}/books/*.json`);

await mc.close();

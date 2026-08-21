#!/usr/bin/env node
/**
 * Pass 2 enrichment: for each byte-identical (pages/-full, archived/) pair in
 * manifest-full-dup.ndjson, look up the page doc and decide WHICH copy is
 * redundant — i.e. which key no reader pointer resolves through — so the delete
 * manifest is unambiguous. Read-only.
 *
 * Reader model (src/lib/page-image-url.ts getPageSource): the original/full-res
 * path returns cropped_photo → split photo → enhanced_photo → archived_photo →
 * photo_original → photo. display/thumb come from pages/{n}.jpg|-thumb, never
 * from these two keys. So a copy is safe to delete iff NO page field references
 * it. We classify each pair and recommend the redundant key.
 *
 * Usage: set -a; source .env.production.local; set +a;
 *        node scripts/maintenance/r2-reclaim/enrich-full-dup-pointers.mjs
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { mongo, outPath, human, NdjsonWriter } from './lib.mjs';

const MANIFEST = outPath('manifest-full-dup.ndjson');
const PROJECTION = {
  _id: 1, id: 1, book_id: 1, page_number: 1,
  photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1,
  cropped_photo: 1, display_photo: 1, thumbnail: 1, split_from_spread: 1,
};
const FIELDS = ['photo', 'photo_original', 'archived_photo', 'enhanced_photo', 'cropped_photo', 'display_photo', 'thumbnail'];

const client = await mongo();
const db = client.db('bookstore');
const out = new NdjsonWriter(outPath('manifest-full-dup-enriched.ndjson'));

const s = {
  pairs: 0, pageNotFound: 0,
  delete_full: 0, delete_full_bytes: 0,   // archived is live → -full redundant
  delete_archived: 0, delete_archived_bytes: 0, // -full is live → archived redundant
  both_referenced: 0, neither_referenced: 0, neither_bytes: 0,
};

function refs(page, keyPath) {
  for (const f of FIELDS) {
    const v = page[f];
    if (typeof v === 'string' && v.includes(keyPath)) return f;
  }
  return null;
}

let curBook = null;
let bucket = [];
async function flush() {
  if (!bucket.length) return;
  const bookId = curBook;
  const nums = bucket.map((r) => r.page);
  const docs = await db.collection('pages')
    .find({ book_id: bookId, page_number: { $in: nums } }, { projection: PROJECTION }).toArray();
  const byNum = new Map(docs.map((d) => [d.page_number, d]));
  for (const r of bucket) {
    s.pairs++;
    const page = byNum.get(r.page);
    if (!page) { s.pageNotFound++; continue; }
    const refFull = refs(page, r.fullKey);
    const refArch = refs(page, r.archivedKey);
    const src = getPageSource(page) || '';
    const srcKind = src.includes(r.fullKey) ? 'full' : src.includes(r.archivedKey) ? 'archived' : (src ? 'other' : 'none');

    let recommend, deleteKey, deleteSize;
    if (refArch && !refFull) { recommend = 'delete_full'; deleteKey = r.fullKey; deleteSize = r.fullSize; }
    else if (refFull && !refArch) { recommend = 'delete_archived'; deleteKey = r.archivedKey; deleteSize = r.archivedSize; }
    else if (refFull && refArch) { recommend = 'both_referenced'; }
    else { recommend = 'neither_referenced'; deleteKey = r.fullKey; deleteSize = r.fullSize; } // default drop -full

    if (recommend === 'delete_full') { s.delete_full++; s.delete_full_bytes += deleteSize; }
    else if (recommend === 'delete_archived') { s.delete_archived++; s.delete_archived_bytes += deleteSize; }
    else if (recommend === 'both_referenced') { s.both_referenced++; }
    else { s.neither_referenced++; s.neither_bytes += deleteSize; }

    out.write({
      bookId, page: r.page,
      fullKey: r.fullKey, archivedKey: r.archivedKey,
      etagMatch: r.etagMatch, sizeNear: r.sizeNear,
      refFull, refArch, sourceResolvesTo: srcKind,
      recommend, deleteKey: deleteKey || null, deleteSize: deleteSize || 0,
    });
  }
  bucket = [];
}

const rl = readline.createInterface({ input: fs.createReadStream(MANIFEST), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const r = JSON.parse(line);
  if (r.bookId !== curBook) { await flush(); curBook = r.bookId; }
  bucket.push(r);
}
await flush();
out.close();
await client.close();

const summary = {
  measured_at: new Date().toISOString(),
  pairs: s.pairs, page_not_found: s.pageNotFound,
  recommend_delete_full: { pairs: s.delete_full, bytes: s.delete_full_bytes, human: human(s.delete_full_bytes), note: 'archived/ copy is the live reader pointer; the pages/-full twin is redundant.' },
  recommend_delete_archived: { pairs: s.delete_archived, bytes: s.delete_archived_bytes, human: human(s.delete_archived_bytes), note: 'pages/-full is the live pointer; archived/ twin is redundant.' },
  both_referenced: { pairs: s.both_referenced, note: 'both keys referenced by page fields — keep both, review.' },
  neither_referenced: { pairs: s.neither_referenced, bytes: s.neither_bytes, human: human(s.neither_bytes), note: 'no page field references either key — defaulted to dropping the -full copy; review.' },
  total_reclaimable_bytes: s.delete_full_bytes + s.delete_archived_bytes + s.neither_bytes,
  total_reclaimable_human: human(s.delete_full_bytes + s.delete_archived_bytes + s.neither_bytes),
  manifest: 'manifest-full-dup-enriched.ndjson',
};
fs.writeFileSync(outPath('summary-full-dup-enriched.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

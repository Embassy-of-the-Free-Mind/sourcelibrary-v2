#!/usr/bin/env node
/**
 * Page-frame sweep (#5876): store where the page sits inside each scan that
 * also shows the dark scanner bed around it. Writes ONLY `pages.page_frame`;
 * never touches an image. The reader (ScanViewer) shows the scan cropped to it.
 *
 * Dry run by default. Book by book, with a checkpoint file so a killed run
 * resumes. Each book is probed on PROBE pages first; a book where none of them
 * has a border is skipped whole (most books), so the full read is spent only
 * where frames exist.
 *
 * Only providers whose contact sheets were checked by eye are swept
 * (ALLOWED_PROVIDERS). Objects photographed on a dark gradient (ORAEC stelae,
 * Met objects) and palm-leaf boards (Wikimedia Commons) lost real content in
 * the 2026-10-05 dry run, and their records are typed `book`, so the type
 * field cannot keep them out — the allow-list does.
 *
 * Usage (run on Hetzner for anything beyond a few books, never via Vercel):
 *   node --env-file=.env.production.local scripts/maintenance/page-frame-sweep.mjs \
 *     [--apply] [--book=<id>] [--pages=13,14] [--provider=bph] [--limit-books=N] \
 *     [--checkpoint=scratchpad/page-frame-sweep.done] [--stop-file=<path>] [--max-error-rate=0.05]
 *
 * Exit 3 = stopped on the error-rate guard. For the full run use
 * page-frame-sweep-waves.sh, which runs it in waves with a review sheet each.
 *
 * --book + --pages writes exactly those pages (the visual test before a sweep).
 *
 * PRIOR ART: scripts/auto-crop-black-borders.mjs — rewrites the image and
 * display_photo, which shifts every stored bbox; scripts/audit/page-frame-dry-run.mjs
 * — the read-only sample this sweep's allow-list came from.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { detectPageFrame, toPageFrame, PAGE_FRAME_VERSION } from '../../src/lib/page-frame.ts';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = `page-frame-v${PAGE_FRAME_VERSION}`;
// Checked by eye on the 2026-10-05 dry-run sheets (#5876). Add a provider only
// after its sheet has been looked at.
export const ALLOWED_PROVIDERS = [
  'internet_archive', 'mdz', 'bph', 'bsb', 'e-rara', 'harvard', 'sbb', 'gallica',
  'goettingen', 'slub_dresden', 'allard_pierson', 'leiden', 'manchester', 'bodleian',
  'laurenziana', 'vatican', 'cambridge', 'loc', 'b-nice', 'ndl', 'e-codices',
  'tartu_dspace', 'penn_colenda', 'morgan', 'wellcome', 'hab', 'chester_beatty',
  'tu_delft', 'heidelberg', 'byu', 'bl',
];

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const APPLY = process.argv.includes('--apply');
const ONE_BOOK = arg('book', null);
const ONLY_PAGES = arg('pages', null)?.split(',').map(Number);
const PROVIDER = arg('provider', null);
const LIMIT = Number(arg('limit-books', '0')) || Infinity;
const CHECKPOINT = arg('checkpoint', 'scratchpad/page-frame-sweep.done');
// Checked between books: if this file exists the sweep stops cleanly (the wave
// driver's reviewer creates it when a contact sheet shows a bad frame).
const STOP_FILE = arg('stop-file', null);
// Above this share of failed image reads (after MIN_TRIES), stop: a dead host or
// a bad key pattern, not something to write around. Exit code 3.
const MAX_ERROR_RATE = Number(arg('max-error-rate', '0.05'));
const MIN_TRIES = 500;
const PROBE = 5;
// Parallel image reads per book; the work is network wait, not CPU.
const CONCURRENCY = Number(arg('concurrency', '8'));
const R2 = /^https:\/\/images\.sourcelibrary\.org\//;

if (PROVIDER && !ALLOWED_PROVIDERS.includes(PROVIDER)) {
  console.error(`provider ${PROVIDER} is not on the allow-list; check its dry-run sheet first`);
  process.exit(1);
}

const done = new Set(fs.existsSync(CHECKPOINT) ? fs.readFileSync(CHECKPOINT, 'utf8').split('\n').filter(Boolean) : []);
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const pagesCol = db.collection('pages');

/** The image the reader shows at 100%, if it is ours and scoped to this book. */
function imageOf(p, bookId) {
  const url = [p.display_photo, p.archived_photo].find(u => typeof u === 'string' && R2.test(u));
  // A key without the book's id is shared between books by construction (#3362).
  return url && url.includes(bookId) ? url : null;
}

async function frameFor(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).greyscale()
    .resize(256, 256, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const v = detectPageFrame(data, info.width, info.height);
  return v.kind === 'frame' ? toPageFrame(v.box, info.width, info.height) : null;
}

async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

const bookFilter = ONE_BOOK
  ? { $or: [{ id: ONE_BOOK }, { _id: ONE_BOOK }] }
  : { visible: true, pages_count: { $gt: 0 }, 'image_source.provider': PROVIDER ? PROVIDER : { $in: ALLOWED_PROVIDERS } };
const books = await db.collection('books')
  .find(bookFilter, { projection: { _id: 1, id: 1, 'image_source.provider': 1 } })
  .sort({ id: 1 }).toArray();
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${books.length} candidate books, ${done.size} already done`);

const totals = { books: 0, skippedClean: 0, pages: 0, framed: 0, cleared: 0, errors: 0 };
let tries = 0;
for (const b of books) {
  if (totals.books >= LIMIT) break;
  if (STOP_FILE && fs.existsSync(STOP_FILE)) { console.log(`stop file ${STOP_FILE} present; stopping`); break; }
  if (tries >= MIN_TRIES && totals.errors / tries > MAX_ERROR_RATE) {
    console.error(`STOP: ${totals.errors} of ${tries} image reads failed (> ${MAX_ERROR_RATE})`);
    await client.close();
    console.log('totals', JSON.stringify(totals));
    process.exit(3);
  }
  const bookId = b.id || String(b._id);
  if (done.has(bookId)) continue;
  totals.books++;
  const q = { book_id: bookId, ...(ONLY_PAGES ? { page_number: { $in: ONLY_PAGES } } : {}) };
  const pages = await pagesCol.find(q, { projection: { _id: 1, page_number: 1, display_photo: 1, archived_photo: 1, page_frame: 1 } })
    .sort({ page_number: 1 }).toArray();

  // Probe a spread of pages; a book with no border on any of them is skipped whole.
  if (!ONLY_PAGES && pages.length > PROBE) {
    const probe = Array.from({ length: PROBE }, (_, k) => pages[Math.floor(((k + 0.5) * pages.length) / PROBE)]);
    // A failed probe is not a border.
    const hits = await Promise.all(probe.map(async p => {
      const url = imageOf(p, bookId);
      if (!url) return false;
      try { return !!(await frameFor(url)); } catch { return false; }
    }));
    const any = hits.some(Boolean);
    if (!any) {
      totals.skippedClean++;
      if (APPLY) {
        await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'probed-clean', detail: { probed: PROBE } });
        fs.appendFileSync(CHECKPOINT, bookId + '\n');
      }
      continue;
    }
  }

  let framed = 0, cleared = 0, errors = 0;
  // The most-cropped page of the book, for the wave's review sheet.
  let tightest = null;
  const writes = [];
  await pool(pages, async p => {
    const url = imageOf(p, bookId);
    if (!url) return;
    try {
      const f = await frameFor(url);
      tries++;
      if (f && (!tightest || f.w * f.h < tightest.area)) tightest = { page: p.page_number, area: Math.round(f.w * f.h * 1000) / 1000 };
      if (f) { framed++; writes.push({ updateOne: { filter: { _id: p._id }, update: { $set: { page_frame: f } } } }); }
      else if (p.page_frame) { cleared++; writes.push({ updateOne: { filter: { _id: p._id }, update: { $unset: { page_frame: '' } } } }); }
    } catch { errors++; tries++; }
  });
  totals.pages += pages.length; totals.framed += framed; totals.cleared += cleared; totals.errors += errors;
  console.log(`${bookId} ${b.image_source?.provider} pages=${pages.length} framed=${framed} cleared=${cleared} errors=${errors}`);
  if (APPLY) {
    if (writes.length) {
      const r = await pagesCol.bulkWrite(writes, { ordered: false });
      if (r.modifiedCount + r.matchedCount < writes.length) console.warn(`  matched ${r.matchedCount} of ${writes.length}`);
    }
    await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'framed', detail: { pages: pages.length, framed, cleared, errors, provider: b.image_source?.provider, tightest: tightest ?? undefined, only_pages: ONLY_PAGES ?? undefined } });
    if (!ONLY_PAGES) fs.appendFileSync(CHECKPOINT, bookId + '\n');
  }
}
await client.close();
console.log('totals', JSON.stringify(totals));

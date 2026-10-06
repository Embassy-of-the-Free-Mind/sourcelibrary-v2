#!/usr/bin/env node
/**
 * Cover frames (#6010): store where the page sits inside a book's COVER image
 * when that image also shows the dark scanner bed around it. Writes ONLY
 * `books.thumbnail_frame`; never touches an image or a page. Book cards show the
 * cover cropped to it (src/components/FramedImg.tsx).
 *
 * The frame is measured on the cover image itself, with the same detector the
 * page sweep uses (src/lib/page-frame.ts), not copied from a page. Measured
 * 2026-10-06 (scripts/audit/cover-frame-provenance.mjs): of the 1,327 books the
 * page sweep had framed, a page's frame described the cover of 196 (15%), and of
 * 26 of the 940 BPH books (3%), because a BPH cover is usually a split half
 * (`/cropped/…`) that no page frame is measured on. Measured directly, 2,043 of
 * 2,360 BPH covers (87%) and 8,930 of 41,113 allow-listed covers (22%) get one.
 *
 * Stored: { x, y, w, h, ar, v, of } — the page frame plus `of`, the R2 identity
 * of the image it was measured on. The card applies it only while the cover it
 * is about to draw still has that identity, so a cover changed after this ran
 * shows whole instead of mis-cropped. Re-running fixes it up: a book is written
 * only when its frame differs from what is stored, and a stored frame whose
 * cover has changed or now measures clean is removed.
 *
 * Dry run by default. Only the providers the page sweep's sheets cleared.
 *
 * Usage (R2 reads only; run on Hetzner, never via Vercel):
 *   node --env-file=.env.production.local scripts/maintenance/cover-frame-backfill.mjs \
 *     [--apply] [--book=<id>] [--provider=bph] [--limit-books=N] [--out=<file.jsonl>] [--concurrency=8]
 * Undo: --rollback [--book=<id>] [--provider=bph] [--apply] removes the field.
 *
 * PRIOR ART: scripts/maintenance/page-frame-sweep.mjs (PR #5882) — frames PAGES
 * and is mid-run; a cover is often not any page's measured image, and a book
 * card has no page document. scripts/maintenance/backfill-cover-cards.mjs —
 * the same "one derived thing per cover, validated against the cover at read
 * time" pattern (image_card), for a resized file rather than a frame.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { detectPageFrame, toPageFrame, PAGE_FRAME_VERSION } from '../../src/lib/page-frame.ts';
import { r2PageIdentity } from '../../src/lib/r2-page-identity.ts';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = `cover-frame-v${PAGE_FRAME_VERSION}`;
// Same list as page-frame-sweep.mjs ALLOWED_PROVIDERS (checked by eye, #5876):
// objects on a dark gradient and palm-leaf boards lose real content.
export const ALLOWED_PROVIDERS = [
  'internet_archive', 'mdz', 'bph', 'bsb', 'e-rara', 'harvard', 'sbb', 'gallica',
  'goettingen', 'slub_dresden', 'allard_pierson', 'leiden', 'manchester', 'bodleian',
  'laurenziana', 'vatican', 'cambridge', 'loc', 'b-nice', 'ndl', 'e-codices',
  'tartu_dspace', 'penn_colenda', 'morgan', 'wellcome', 'hab', 'chester_beatty',
  'tu_delft', 'heidelberg', 'byu', 'bl',
];

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');
const ONE_BOOK = arg('book', null);
const PROVIDER = arg('provider', null);
const LIMIT = Number(arg('limit-books', '0')) || Infinity;
const OUT = arg('out', null);
const CONCURRENCY = Number(arg('concurrency', '8'));
const MAX_ERROR_RATE = Number(arg('max-error-rate', '0.05'));
const MIN_TRIES = 500;

if (PROVIDER && !ALLOWED_PROVIDERS.includes(PROVIDER)) {
  console.error(`provider ${PROVIDER} is not on the allow-list; check its page-frame sheet first`);
  process.exit(1);
}

/** The cover a Mongo-fed card draws, and the identity of the image it names. */
export function coverOf(book) {
  const url = [book.image_display, book.thumbnail].find(u => typeof u === 'string' && u.trim())?.trim();
  if (!url) return null;
  const of = r2PageIdentity(url);
  // A key without the book's id is shared between books by construction (#3362).
  if (!of || !of.startsWith(`${String(book.id ?? book._id)}/`)) return null;
  return { url, of };
}

/** Smaller copies of the same image first (1200px display), the stored URL last. */
export function fetchCandidates(url) {
  const q = url.split('?')[0];
  const legacy = q.match(/^(https:\/\/images\.sourcelibrary\.org)\/(?:archived|thumbnails)\/([^/]+)\/(\d+)\.jpg$/);
  if (legacy) return [`${legacy[1]}/pages/${legacy[2]}/${legacy[3].padStart(4, '0')}.jpg`, q];
  if (/\/pages\/[^/]+\/[^/]+-(?:thumb|full)\.jpg$/.test(q)) return [q.replace(/-(?:thumb|full)\.jpg$/, '.jpg'), q];
  return [q];
}

async function measure(url) {
  let last;
  for (const u of fetchCandidates(url)) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).greyscale()
        .resize(256, 256, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
      const v = detectPageFrame(data, info.width, info.height);
      return { verdict: v.kind === 'skip' ? `skip:${v.reason}` : v.kind, frame: v.kind === 'frame' ? toPageFrame(v.box, info.width, info.height) : null };
    } catch (e) { last = e; }
  }
  throw last;
}

const same = (a, b) => !!a && !!b && ['x', 'y', 'w', 'h', 'ar', 'v', 'of'].every(k => a[k] === b[k]);

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const booksCol = db.collection('books');
  const scope = ONE_BOOK
    ? { $or: [{ id: ONE_BOOK }, { _id: ONE_BOOK }] }
    : { visible: true, pages_count: { $gt: 0 }, 'image_source.provider': PROVIDER ? PROVIDER : { $in: ALLOWED_PROVIDERS } };

  if (ROLLBACK) {
    const q = { ...scope, thumbnail_frame: { $exists: true } };
    const ids = (await booksCol.find(q, { projection: { _id: 1, id: 1 } }).toArray());
    if (APPLY) {
      for (const b of ids) {
        await booksCol.updateOne({ _id: b._id }, { $unset: { thumbnail_frame: '' } });
        await recordSweepAction(db, { sweep: SWEEP, book_id: String(b.id ?? b._id), action: 'cover-frame-rolled-back' });
      }
    }
    console.log(`${APPLY ? 'ROLLED BACK' : 'DRY RUN: would roll back'} ${ids.length} cover frames`);
    await client.close();
    process.exit(0);
  }

  const books = await booksCol.find(scope, {
    projection: { _id: 1, id: 1, thumbnail: 1, image_display: 1, thumbnail_frame: 1, 'image_source.provider': 1 },
  }).sort({ id: 1 }).limit(LIMIT === Infinity ? 0 : LIMIT).toArray();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${books.length} books`);

  const totals = { books: 0, noR2Cover: 0, framed: 0, clean: 0, skipped: 0, errors: 0, written: 0, removed: 0, unchanged: 0 };
  const out = OUT ? fs.createWriteStream(OUT) : null;
  let i = 0, stop = false;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < books.length && !stop) {
      const b = books[i++];
      const id = String(b.id ?? b._id);
      totals.books++;
      const cover = coverOf(b);
      let verdict = 'no-r2-cover', frame = null;
      if (!cover) totals.noR2Cover++;
      else {
        try {
          ({ verdict, frame } = await measure(cover.url));
          if (frame) totals.framed++; else if (verdict === 'clean') totals.clean++; else totals.skipped++;
        } catch (e) {
          totals.errors++;
          verdict = `error:${e.message}`;
          if (totals.books >= MIN_TRIES && totals.errors / totals.books > MAX_ERROR_RATE) stop = true;
          // An unreadable cover says nothing about its frame: leave the book as it is.
          out?.write(JSON.stringify({ id, provider: b.image_source?.provider, verdict }) + '\n');
          continue;
        }
      }
      const want = frame ? { ...frame, of: cover.of } : null;
      const had = b.thumbnail_frame ?? null;
      const action = want ? (same(want, had) ? 'unchanged' : 'written') : (had ? 'removed' : 'unchanged');
      totals[action]++;
      out?.write(JSON.stringify({ id, provider: b.image_source?.provider, cover: cover?.url, verdict, frame: want, action }) + '\n');
      if (APPLY && action !== 'unchanged') {
        await booksCol.updateOne({ _id: b._id }, want ? { $set: { thumbnail_frame: want } } : { $unset: { thumbnail_frame: '' } });
        await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: want ? 'cover-framed' : 'cover-frame-removed', detail: want ? { of: want.of } : { verdict } });
      }
      if (totals.books % 1000 === 0) console.log(JSON.stringify(totals));
    }
  }));
  out?.end();
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} ${JSON.stringify(totals)}`);
  await client.close();
  if (stop) { console.error('stopped: cover read error rate above the guard'); process.exit(3); }
}

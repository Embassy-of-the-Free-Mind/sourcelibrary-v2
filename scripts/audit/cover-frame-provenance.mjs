#!/usr/bin/env node
/**
 * Where does a book's cover come from, and does that page have a page_frame? (#6010)
 *
 * Read-only. Three measurements, counts to stdout, rows to --out:
 *   A. every live book: the shape of its cover URL (own-book R2 page, another
 *      book's, artwork, external, none) — books collection only.
 *   B. a random sample of live books: does the cover URL EQUAL one of its pages'
 *      display_photo / archived_photo / thumbnail (and the wider image fields),
 *      and does it name the same page image (r2PageIdentity)?
 *   C. every book the page-frame sweep has framed (sweep_log): is the cover's
 *      page one of the framed pages?
 *
 * Usage: node --env-file=.env.production.local scripts/audit/cover-frame-provenance.mjs \
 *          [--sample=1500] [--out=scratchpad/cover-frame-provenance.json]
 *
 * PRIOR ART: scripts/maintenance/backfill-cover-cards.mjs — maps a cover to its
 * card key, never back to a page document; scripts/audit/page-frame-dry-run.mjs —
 * samples pages for frames, not covers.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { r2PageIdentity } from '../../src/lib/r2-page-identity.ts';
import { usablePageFrame } from '../../src/lib/page-frame.ts';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const SAMPLE = Number(arg('sample', '1500'));
const OUT = arg('out', 'scratchpad/cover-frame-provenance.json');

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const LIVE = { visible: true, pages_count: { $gt: 0 } };
const BOOK_PROJ = { _id: 1, id: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, image_card: 1, 'image_source.provider': 1 };
const cover = b => (b.image_display || b.thumbnail || b.thumbnail_blob || '').trim() || null;
const bookId = b => String(b.id ?? b._id);

const COVER_PAGE_PROJECTION = {
  _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, cropped_photo: 1, display_photo: 1,
  archived_photo: 1, thumbnail: 1, image_thumb: 1, thumbnail_blob: 1, split_from_spread: 1, crop: 1, page_frame: 1,
};
const R2 = /^https:\/\/images\.sourcelibrary\.org\//;

/**
 * The frame a cover could INHERIT from a page: the cover must be the image the
 * page sweep measured (display_photo, else archived_photo), on a page shown
 * whole. This is the option the measurement rejected; kept so it can be re-run.
 */
function coverFrameFromPages(book, pages) {
  const id = String(book.id ?? book._id);
  const url = cover(book), of = url && r2PageIdentity(url);
  if (!of || !of.startsWith(`${id}/`)) return null;
  const hits = pages.filter(p => {
    if (p.split_from_spread || p.cropped_photo || p.crop) return false;
    const m = [p.display_photo, p.archived_photo].find(u => typeof u === 'string' && R2.test(u));
    return m && m.includes(id) && r2PageIdentity(m) === of;
  });
  return hits.length === 1 ? usablePageFrame(hits[0].page_frame) : null;
}

// A. cover URL shape over every live book.
const shape = {}, books = [];
for await (const b of db.collection('books').find(LIVE, { projection: BOOK_PROJ })) {
  books.push(b);
  const url = cover(b), ident = url && r2PageIdentity(url);
  const k = !url ? 'none'
    : url.includes('/artwork/') ? 'artwork'
    : !url.includes('images.sourcelibrary.org/') ? 'external'
    : !ident ? 'r2-other'
    : ident.startsWith(`${bookId(b)}/`) || ident.startsWith(`${String(b._id)}/`) ? 'r2-own-page' : 'r2-another-books-page';
  shape[k] = (shape[k] || 0) + 1;
}
console.log(`A. live books ${books.length}; cover shape`, JSON.stringify(shape));

const pagesOf = id => db.collection('pages').find({ book_id: id }, { projection: COVER_PAGE_PROJECTION }).toArray();

// B. exact-URL and same-image match on a random sample.
const sample = [...books].sort(() => Math.random() - 0.5).slice(0, SAMPLE);
const B = { sampled: 0, noCover: 0, exactDAT: 0, exactAny: 0, sameImage: 0, sameImageFramed: 0, coverFrame: 0 };
const rowsB = [];
for (const b of sample) {
  const url = cover(b);
  B.sampled++;
  if (!url) { B.noCover++; continue; }
  const pages = await pagesOf(bookId(b));
  const ident = r2PageIdentity(url);
  const eq = (p, fields) => fields.some(f => typeof p[f] === 'string' && p[f].trim() === url);
  const exactDAT = pages.some(p => eq(p, ['display_photo', 'archived_photo', 'thumbnail']));
  const exactAny = exactDAT || pages.some(p => eq(p, ['photo', 'photo_original', 'cropped_photo', 'image_thumb', 'thumbnail_blob']));
  const same = ident ? pages.filter(p => ['display_photo', 'archived_photo', 'photo', 'cropped_photo'].some(f => typeof p[f] === 'string' && r2PageIdentity(p[f]) === ident)) : [];
  const framed = same.some(p => usablePageFrame(p.page_frame));
  const cf = coverFrameFromPages(b, pages);
  if (exactDAT) B.exactDAT++;
  if (exactAny) B.exactAny++;
  if (same.length) B.sameImage++;
  if (framed) B.sameImageFramed++;
  if (cf) B.coverFrame++;
  rowsB.push({ id: bookId(b), provider: b.image_source?.provider, exactDAT, exactAny, sameImage: same.length, framed, coverFrame: !!cf });
}
console.log('B. sample', JSON.stringify(B));

// C. every book the sweep framed.
const framedIds = await db.collection('sweep_log').distinct('book_id', { sweep: { $regex: '^page-frame-v' }, action: 'framed' });
const byId = new Map(books.map(b => [bookId(b), b]));
const C = { sweptFramedBooks: framedIds.length, live: 0, framedPages: 0, coverIsOwnPage: 0, coverPageFramed: 0 };
const byProvider = {}, rowsC = [];
for (const id of framedIds) {
  const b = byId.get(id);
  if (!b) continue;
  C.live++;
  const pages = await pagesOf(id);
  const n = pages.filter(p => usablePageFrame(p.page_frame)).length;
  C.framedPages += n;
  const ident = cover(b) && r2PageIdentity(cover(b));
  if (ident && ident.startsWith(`${id}/`)) C.coverIsOwnPage++;
  const cf = coverFrameFromPages(b, pages);
  const prov = b.image_source?.provider || '?';
  byProvider[prov] ??= { books: 0, coverFramed: 0 };
  byProvider[prov].books++;
  if (cf) { C.coverPageFramed++; byProvider[prov].coverFramed++; }
  rowsC.push({ id, provider: prov, pages: pages.length, framedPages: n, cover: cover(b), frame: cf });
}
console.log('C. framed books', JSON.stringify(C));
console.log('C. by provider', JSON.stringify(byProvider));

fs.mkdirSync(OUT.replace(/\/[^/]*$/, '') || '.', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), shape, B, C, byProvider, rowsB, rowsC }, null, 1));
console.log(`rows -> ${OUT}`);
await client.close();

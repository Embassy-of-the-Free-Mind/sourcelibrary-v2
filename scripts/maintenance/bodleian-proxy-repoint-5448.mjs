#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/repoint-*.mjs (repoint-blob-url-pages, repoint-provider-thumbs-to-r2 …)
// move stored URLs to OUR storage after archiving; none rewrites a dead provider URL to another
// provider's live one. The unwrap rule is the importer's (unwrapProxiedImageService in
// scripts/iiif-discovery/lib/iiif-metadata.mjs), so re-imports and this repair agree.
/**
 * Point the 82 Bodleian manuscripts served through Heidelberg's dead iiif-proxy.cgi at the Bodleian
 * IIIF service directly (#5448).
 *
 *   https://digi.ub.uni-heidelberg.de/iiif/2/bodleian_x%3Aiiif-proxy.cgi?serviceId=<enc>&size=100%25/full/full/0/default.jpg
 *   → https://iiif.bodleian.ox.ac.uk/iiif/image/<uuid>/full/full/0/default.jpg
 *
 * Fields: pages.photo / photo_original / thumbnail and books.thumbnail, only where the value carries
 * the proxy. Each write is pinned to the old value. The restore file (every old value) is written and
 * fsynced before the first write. Archive fields are not touched: a permanent miss is keyed to the
 * URL that missed (scripts/lib/archive-miss.mjs), so the new URL is eligible with no cleanup.
 *
 *   node --env-file=.env.production.local scripts/maintenance/bodleian-proxy-repoint-5448.mjs --control=<book id>   GET every page of one book at full size, write nothing
 *   … --restore-file=<path> [--apply]
 *   … --restore=<restore file> [--apply]
 */
import { MongoClient, ObjectId } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { unwrapProxiedImageService } from '../iiif-discovery/lib/iiif-metadata.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SWEEP = 'bodleian-proxy-repoint-5448';
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const APPLY = 'apply' in args;
const PROXY = /iiif-proxy\.cgi\?serviceId=/;
const PAGE_FIELDS = ['photo', 'photo_original', 'thumbnail'];

/** "<proxy service id>/<region>/<size>/<rotation>/<quality>" → the same request on the wrapped service. */
export function repointUrl(url) {
  if (typeof url !== 'string' || !PROXY.test(url)) return url;
  const m = url.match(/^(.*?iiif-proxy\.cgi\?serviceId=[^&/]+(?:&[^/]*)?)(\/.*)?$/);
  if (!m) return url;
  const svc = unwrapProxiedImageService(m[1]);
  return svc === m[1] ? url : svc + (m[2] || '');
}

const client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 600_000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books'), pages = db.collection('pages');

async function plan(onlyId) {
  const cands = await books.find({ 'image_source.provider': 'heidelberg', ...(onlyId ? { id: onlyId } : {}) }, { projection: { id: 1, title: 1, thumbnail: 1, visible: 1, pages_count: 1 } }).toArray();
  const out = [];
  for (const b of cands) {
    const ps = await pages.find({ book_id: b.id, $or: PAGE_FIELDS.map((f) => ({ [f]: PROXY })) }, { projection: { _id: 1, page_number: 1, ...Object.fromEntries(PAGE_FIELDS.map((f) => [f, 1])) } }).toArray();
    if (!ps.length && !PROXY.test(b.thumbnail || '')) continue;
    const pagePlan = ps.map((p) => {
      const old = {}, set = {};
      for (const f of PAGE_FIELDS) if (PROXY.test(p[f] || '')) { const n = repointUrl(p[f]); if (n !== p[f]) { old[f] = p[f]; set[f] = n; } }
      return { _id: String(p._id), page_number: p.page_number, old, set };
    }).filter((x) => Object.keys(x.set).length);
    const book = PROXY.test(b.thumbnail || '') ? { old: { thumbnail: b.thumbnail }, set: { thumbnail: repointUrl(b.thumbnail) } } : null;
    out.push({ id: b.id, title: b.title, live: b.visible === true && b.pages_count > 0, pages: pagePlan, unrewritable: ps.length - pagePlan.length, book });
  }
  return out;
}

const idOf = (s) => (/^[0-9a-f]{24}$/.test(s) ? new ObjectId(s) : s);

try {
  if (args.control) {
    const [b] = await plan(args.control);
    if (!b) { console.error('not a proxy book'); process.exit(2); }
    let ok = 0, bad = 0; const sizes = [];
    for (const p of b.pages.sort((a, c) => a.page_number - c.page_number)) {
      const url = p.set.photo_original || p.set.photo;
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && (r.headers.get('content-type') || '').startsWith('image/') && buf.length > 10_000) { ok++; sizes.push(buf.length); } else { bad++; console.log(`FAIL p${p.page_number} ${r.status} ${buf.length} ${url}`); }
      await new Promise((res) => setTimeout(res, 400));
    }
    console.log(JSON.stringify({ book: b.id, title: b.title, pages: b.pages.length, ok, bad, min_bytes: Math.min(...sizes), max_bytes: Math.max(...sizes) }));
  } else if (args.restore) {
    const rows = readFileSync(args.restore, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    let restored = 0, changed = 0;
    for (const r of rows) {
      if (!APPLY) continue;
      const coll = r.kind === 'book' ? books : pages;
      const filter = r.kind === 'book' ? { id: r.id, ...r.new } : { _id: idOf(r._id), ...r.new };
      const res = await coll.updateOne(filter, { $set: r.old });
      if (res.modifiedCount) restored++; else changed++;
    }
    console.log(JSON.stringify({ rows: rows.length, restored, changed_since: changed, dry_run: !APPLY }));
  } else {
    const file = args['restore-file'];
    if (!file) { console.error('--restore-file=<path> is required (written before any write)'); process.exit(2); }
    const p = await plan();
    const nPages = p.reduce((s, b) => s + b.pages.length, 0);
    console.log(`proxy books: ${p.length} (live ${p.filter((b) => b.live).length}); pages to repoint ${nPages}; book thumbnails ${p.filter((b) => b.book).length}; pages left unrewritable ${p.reduce((s, b) => s + b.unrewritable, 0)}`);
    for (const b of p.slice(0, 3)) console.log(`  ${b.title}\n    ${b.pages[0]?.old.photo}\n    → ${b.pages[0]?.set.photo}`);
    if (!APPLY) { console.log('DRY RUN: nothing was written.'); }
    else {
      if (existsSync(file)) { console.error(`${file} exists; refusing to overwrite`); process.exit(2); }
      const lines = [];
      for (const b of p) {
        if (b.book) lines.push(JSON.stringify({ kind: 'book', id: b.id, old: b.book.old, new: b.book.set }));
        for (const pg of b.pages) lines.push(JSON.stringify({ kind: 'page', book_id: b.id, _id: pg._id, old: pg.old, new: pg.set }));
      }
      writeFileSync(file, lines.join('\n') + '\n');
      const fd = openSync(file, 'r'); fsyncSync(fd); closeSync(fd);
      console.log(`restore file: ${file} (${lines.length} rows)`);
      const now = new Date();
      let pagesWritten = 0, booksWritten = 0, raced = 0;
      for (const b of p) {
        for (let i = 0; i < b.pages.length; i += 500) {
          const chunk = b.pages.slice(i, i + 500);
          const res = await pages.bulkWrite(chunk.map((pg) => ({ updateOne: { filter: { _id: idOf(pg._id), ...pg.old }, update: { $set: { ...pg.set, updated_at: now } } } })), { ordered: false });
          pagesWritten += res.modifiedCount; raced += chunk.length - res.matchedCount;
        }
        if (b.book) { const r = await books.updateOne({ id: b.id, ...b.book.old }, { $set: { ...b.book.set, updated_at: now } }); booksWritten += r.modifiedCount; }
      }
      await recordSweepActions(db, p.map((b) => ({ sweep: SWEEP, book_id: b.id, action: 'repointed-bodleian-direct', detail: { pages: b.pages.length, thumbnail: !!b.book } })));
      const left = (await plan()).length;
      console.log(JSON.stringify({ books: p.length, pagesWritten, booksWritten, raced, proxy_books_left: left }));
    }
  }
} finally { await client.close(); }

#!/usr/bin/env node
// PRIOR ART: scripts/lib/archive-failure-class.mjs isQuotaPlaceholderSize (#7254, #7371) — the write-side
// guard that stops NEW placeholders; it never looks at what is already stored. scripts/maintenance/
// repoint-*.mjs move archived URLs, they never clear one. Looked in scripts/maintenance and scripts/audit
// for "placeholder", "1x1", "archived_photo" clears: nothing un-archives a bad master.
/**
 * Un-archive the BSB/MDZ pages whose stored master is MDZ's 1×1 over-quota placeholder (#5448).
 *
 * Before the guards (#7254 archive-ocr, #7371 archive-acquired) a quota-refused request came back as a
 * 457-byte 1×1 JPEG at 200 OK and was stored as `archived_photo`. The reader serves `archived_photo`
 * first, and an archived page is never fetched again. Clearing the archive fields puts the page back
 * in every archiver's queue (they select on `archived_photo` absent); recountBook lowers
 * `pages_archived` so archive-ocr's book filter (pages_archived < pages_count) draws the book, and a
 * book marked archive_complete goes back to archive_partial so the provider lanes draw it too.
 *
 * A page is a placeholder only if its stored dims are exactly 1×1 AND the R2 object itself is ≤2 KB
 * (HEAD); the scan (--list) also lists other tiny masters, which are reported and left. NO R2 object and NO page document is deleted; the R2 object is simply
 * overwritten by the next successful fetch (same key).
 *
 * Writes per page: $unset archived_photo, display_photo, thumbnail_blob, image_width, image_height,
 * archive_metadata.bytes (+ iiif_info.width/height only when ≤1). Pinned to the old archived_photo.
 * Per book: recountBook; archive_status archive_complete(_with_gaps) → archive_partial.
 * The restore file holds every old value and is fsynced before the first write.
 *
 *   node --env-file=.env.production.local scripts/maintenance/bsb-placeholder-masters-5448.mjs --list=<candidates.jsonl>   scan (read-only)
 *   … --from=<candidates.jsonl> --restore-file=<path> [--apply]
 *   … --reset-throttles=<restore file of the run> --restore-file=<path> [--apply]   failure_count 3-on-429s → 0
 *   … --restore=<restore file> [--apply]
 *
 * ACTUATION: the cleared pages are refetched by archive-ocr (main, MDZ quota ~25K/day) and the provider
 * lanes on their next runs. 1.5K pages is a small fraction of a day's quota; no burst is started here.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, openSync, fsyncSync, closeSync, appendFileSync } from 'node:fs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SWEEP = 'bsb-placeholder-masters-5448';
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const APPLY = 'apply' in args;
const MAX_BYTES = 2000;
const SUSPECT = { archived_photo: { $regex: '^https?:' }, $or: [{ image_width: { $lte: 1 } }, { image_height: { $lte: 1 } }, { 'archive_metadata.bytes': { $lte: MAX_BYTES } }] };
const PROJ = { _id: 1, book_id: 1, page_number: 1, archived_photo: 1, display_photo: 1, thumbnail_blob: 1, image_width: 1, image_height: 1, iiif_info: 1, 'archive_metadata.bytes': 1 };
const COMPLETE = ['archive_complete', 'archive_complete_with_gaps'];

const client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 600_000, maxPoolSize: 40 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books'), pages = db.collection('pages');

async function r2Bytes(url) {
  try { const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) }); return r.ok ? Number(r.headers.get('content-length') || -1) : -r.status; } catch { return null; }
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } })); }

try {
  if (args.list) {
    if (existsSync(args.list)) { console.error(`${args.list} exists`); process.exit(2); }
    const bs = await books.find({ 'image_source.provider': { $in: ['bsb', 'mdz'] }, pages_archived: { $gt: 0 } }, { projection: { id: 1 } }).toArray();
    console.log(`bsb/mdz books with any archived page: ${bs.length}`);
    let done = 0, found = 0;
    await pool(bs, 24, async (b) => {
      const ps = await pages.find({ book_id: b.id, ...SUSPECT }, { projection: PROJ }).toArray();
      for (const p of ps) { p.r2_bytes = await r2Bytes(p.archived_photo); appendFileSync(args.list, JSON.stringify(p) + '\n'); found++; }
      if (++done % 2000 === 0) console.log(`  ${done}/${bs.length} books, ${found} suspects`);
    });
    console.log(`suspects: ${found}`);
  } else if (args.from) {
    const rows = readFileSync(args.from, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    // The over-quota placeholder is exactly 1×1. Other tiny masters (a 100×100 at 533 B, a 24×1191 strip)
    // are a different question: listed, never cleared here.
    const hits = rows.filter((p) => p.image_width === 1 && p.image_height === 1 && p.r2_bytes != null && p.r2_bytes > 0 && p.r2_bytes <= MAX_BYTES);
    const bookIds = [...new Set(hits.map((p) => p.book_id))];
    const bdocs = await books.find({ id: { $in: bookIds } }, { projection: { id: 1, visible: 1, pages_count: 1, pages_archived: 1, archive_status: 1 } }).toArray();
    const live = bdocs.filter((b) => b.visible === true && b.pages_count > 0).length;
    console.log(`suspects ${rows.length}; confirmed placeholders (1×1, R2 ≤ ${MAX_BYTES} B) ${hits.length} on ${bookIds.length} books (${live} live); not confirmed ${rows.length - hits.length}`);
    for (const p of rows.filter((x) => !hits.includes(x)).slice(0, 10)) console.log(`  not confirmed: ${p.book_id} p${p.page_number} r2=${p.r2_bytes} ${p.image_width}×${p.image_height}`);
    if (!APPLY) { console.log('DRY RUN: nothing was written.'); }
    else {
      const file = args['restore-file'];
      if (!file || existsSync(file)) { console.error('--restore-file=<new path> required'); process.exit(2); }
      const lines = [
        ...bdocs.map((b) => JSON.stringify({ kind: 'book', id: b.id, archive_status: b.archive_status ?? null, pages_archived: b.pages_archived ?? null })),
        ...hits.map((p) => JSON.stringify({ kind: 'page', _id: String(p._id), book_id: p.book_id, page_number: p.page_number, old: {
          archived_photo: p.archived_photo, display_photo: p.display_photo, thumbnail_blob: p.thumbnail_blob, image_width: p.image_width, image_height: p.image_height,
          'archive_metadata.bytes': p.archive_metadata?.bytes, 'iiif_info.width': p.iiif_info?.width, 'iiif_info.height': p.iiif_info?.height } })),
      ];
      writeFileSync(file, lines.join('\n') + '\n');
      const fd = openSync(file, 'r'); fsyncSync(fd); closeSync(fd);
      console.log(`restore file: ${file} (${lines.length} rows)`);
      const now = new Date();
      const ops = hits.map((p) => {
        const unset = { archived_photo: '', display_photo: '', thumbnail_blob: '', image_width: '', image_height: '', 'archive_metadata.bytes': '' };
        if (p.iiif_info?.width <= 1) unset['iiif_info.width'] = '';
        if (p.iiif_info?.height <= 1) unset['iiif_info.height'] = '';
        return { updateOne: { filter: { _id: new ObjectId(String(p._id)), archived_photo: p.archived_photo }, update: { $unset: unset, $set: { updated_at: now } } } };
      });
      let cleared = 0, raced = 0;
      for (let i = 0; i < ops.length; i += 500) { const r = await pages.bulkWrite(ops.slice(i, i + 500), { ordered: false }); cleared += r.modifiedCount; raced += Math.min(500, ops.length - i) - r.matchedCount; }
      let reopened = 0;
      for (const b of bdocs) {
        await recountBook(db, b.id, { reason: SWEEP, now });
        if (COMPLETE.includes(b.archive_status)) { const r = await books.updateOne({ id: b.id, archive_status: b.archive_status }, { $set: { archive_status: 'archive_partial', updated_at: now } }); reopened += r.modifiedCount; }
      }
      const byBook = Object.groupBy(hits, (p) => p.book_id);
      await recordSweepActions(db, Object.entries(byBook).map(([id, ps]) => ({ sweep: SWEEP, book_id: id, action: 'cleared-placeholder-masters', detail: { pages: ps.map((p) => p.page_number) } })));
      console.log(JSON.stringify({ placeholders: hits.length, cleared, raced, books: bdocs.length, reopened }));
    }
  } else if (args['reset-throttles']) {
    // A cleared page whose failure_count reached 3 on HTTP 429s (counted before #7228 made throttles
    // uncounted) is skipped by archive-ocr forever. A throttle is "not now", not "never": reset it.
    const rows = readFileSync(args['reset-throttles'], 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.kind === 'page');
    const ps = await pages.find({ _id: { $in: rows.map((r) => new ObjectId(r._id)) }, archived_photo: { $exists: false }, 'archive_metadata.failure_count': { $gte: 3 }, 'archive_metadata.last_failure_reason': /429|throttl|placeholder/i },
      { projection: { _id: 1, book_id: 1, page_number: 1, 'archive_metadata.failure_count': 1, 'archive_metadata.last_failure_reason': 1 } }).toArray();
    console.log(`cleared pages held out by a throttle-only failure_count >= 3: ${ps.length}`);
    if (APPLY && ps.length) {
      const file = args['restore-file'];
      if (!file || existsSync(file)) { console.error('--restore-file=<new path> required'); process.exit(2); }
      writeFileSync(file, ps.map((p) => JSON.stringify({ kind: 'page-failure-count', _id: String(p._id), book_id: p.book_id, failure_count: p.archive_metadata.failure_count })).join('\n') + '\n');
      const fd = openSync(file, 'r'); fsyncSync(fd); closeSync(fd);
      const r = await pages.bulkWrite(ps.map((p) => ({ updateOne: { filter: { _id: p._id, 'archive_metadata.failure_count': p.archive_metadata.failure_count }, update: { $set: { 'archive_metadata.failure_count': 0 } } } })), { ordered: false });
      console.log(JSON.stringify({ restore_file: file, reset: r.modifiedCount }));
    }
  } else if (args.restore) {
    const rows = readFileSync(args.restore, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    if (!APPLY) { console.log(`restore: ${rows.length} rows (dry run)`); }
    else {
      let pagesRestored = 0;
      for (const r of rows.filter((x) => x.kind === 'page-failure-count')) await pages.updateOne({ _id: new ObjectId(r._id), 'archive_metadata.failure_count': 0 }, { $set: { 'archive_metadata.failure_count': r.failure_count } });
      for (const r of rows.filter((x) => x.kind === 'page')) {
        const set = Object.fromEntries(Object.entries(r.old).filter(([, v]) => v !== undefined && v !== null));
        const res = await pages.updateOne({ _id: new ObjectId(r._id), archived_photo: { $exists: false } }, { $set: set });
        pagesRestored += res.modifiedCount;
      }
      for (const r of rows.filter((x) => x.kind === 'book')) {
        await recountBook(db, r.id, { reason: `${SWEEP}-restore` });
        if (r.archive_status) await books.updateOne({ id: r.id, archive_status: 'archive_partial' }, { $set: { archive_status: r.archive_status } });
      }
      console.log(JSON.stringify({ pagesRestored }));
    }
  } else { console.error('pass --list, --from or --restore'); process.exit(2); }
} finally { await client.close(); }
process.exit(0); // keep-alive HEAD sockets otherwise hold the loop open after --list

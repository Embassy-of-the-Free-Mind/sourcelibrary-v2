/**
 * Pass 4: `cropped/` stale generations.
 *
 * Crop filenames are page ObjectIds: `cropped/{bookId}/{pageOid}.jpg`. Re-split
 * a book and the old crops are orphaned. A crop is STALE when its pageOid is
 * absent from the `pages` collection (the issue's GC rule). Read-only; writes a
 * per-file delete manifest for stale crops only.
 *
 * Also reported (NOT deleted): crops whose page still exists but no longer
 * references the crop key (page alive, superseded) — a separate decision.
 *
 * Usage: set -a; source .env.production.local; set +a;
 *        node scripts/maintenance/r2-reclaim/measure-stale-crops.mjs
 */
import { makeS3, mongo, bookGroups, NdjsonWriter, outPath, human, loadLiveBookIds } from './lib.mjs';
import fs from 'node:fs';

const s3 = makeS3();
const client = await mongo();
const db = client.db('bookstore');
const pages = db.collection('pages');

// Crop filenames are the page's STRING `id` (not `_id`), and R2 dirs are the
// book's STRING id — so every existence check here is a string join. Using
// ObjectId(_id) here falsely flagged ~75% of live crops as stale (the id-vs-_id
// footgun). Preload the live-book id set for the whole-dir-orphan check.
process.stderr.write('loading live book id set…\n');
const liveBooks = await loadLiveBookIds(db);
process.stderr.write(`live book ids: ${liveBooks.size}\n`);

const mani = new NdjsonWriter(outPath('manifest-stale-crops.ndjson'));

const s = {
  dirs: 0, files: 0, bytes: 0,
  unknownShape: 0, unknownBytes: 0,
  staleFiles: 0, staleBytes: 0,
  nobookDirs: 0, nobookFiles: 0, nobookBytes: 0,
  aliveUnref: 0, aliveUnrefBytes: 0,
};
let lastLog = Date.now();

for await (const g of bookGroups(s3, 'cropped/', {})) {
  s.dirs++;
  const bookId = g.bookId;
  // Parse pageOid from each crop filename.
  const items = []; // { key, size, oid|null }
  for (const e of g.entries) {
    s.files++; s.bytes += e.size;
    const m = e.file.match(/^([0-9a-f]{24})(?:[-_][a-z0-9]+)?\.jpg$/i);
    if (!m) { s.unknownShape++; s.unknownBytes += e.size; items.push({ ...e, oid: null }); continue; }
    items.push({ key: e.key, size: e.size, oid: m[1].toLowerCase() });
  }
  const oidStrs = [...new Set(items.filter((i) => i.oid).map((i) => i.oid))];

  // Page existence is a STRING join on `id` (the crop filename) with `_id` as a
  // backstop — both are stored as strings in this corpus.
  const livePages = oidStrs.length
    ? await pages.find(
        { $or: [{ id: { $in: oidStrs } }, { _id: { $in: oidStrs } }] },
        { projection: { _id: 1, id: 1, cropped_photo: 1 } },
      ).toArray()
    : [];
  const liveById = new Map();
  for (const p of livePages) {
    if (p.id != null) liveById.set(String(p.id), p);
    if (p._id != null) liveById.set(String(p._id), p);
  }
  const bookExists = liveBooks.has(bookId);
  if (!bookExists) s.nobookDirs++;

  for (const it of items) {
    if (!it.oid) continue; // unknown shape — never auto-flag
    const page = liveById.get(it.oid);
    if (!page) {
      // pageOid absent from pages → stale (delete candidate)
      s.staleFiles++; s.staleBytes += it.size;
      if (!bookExists) { s.nobookFiles++; s.nobookBytes += it.size; }
      mani.write({
        key: it.key, bookId, pageOid: it.oid, size: it.size,
        reason: bookExists ? 'page oid absent from pages (re-split orphan)' : 'book absent (whole dir orphan)',
      });
    } else {
      // page alive: is this exact key still referenced?
      const referenced = typeof page.cropped_photo === 'string' && page.cropped_photo.includes(`cropped/${bookId}/${it.oid}`);
      if (!referenced) { s.aliveUnref++; s.aliveUnrefBytes += it.size; }
    }
  }
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    process.stderr.write(`[cropped/] dirs=${s.dirs} files=${s.files} stale=${s.staleFiles} ${human(s.bytes)}\n`);
  }
}
mani.close();
await client.close();

const summary = {
  measured_at: new Date().toISOString(),
  cropped_total: { dirs: s.dirs, files: s.files, bytes: s.bytes, human: human(s.bytes) },
  unknown_shape: { files: s.unknownShape, bytes: s.unknownBytes, human: human(s.unknownBytes), note: 'filename not a page ObjectId — never auto-flagged.' },
  stale_delete_candidates: {
    files: s.staleFiles, bytes: s.staleBytes, human: human(s.staleBytes),
    of_which_whole_dir_no_book: { dirs: s.nobookDirs, files: s.nobookFiles, bytes: s.nobookBytes, human: human(s.nobookBytes) },
    manifest: 'manifest-stale-crops.ndjson',
    note: 'pageOid absent from pages — safe delete per issue GC rule.',
  },
  alive_but_unreferenced: {
    files: s.aliveUnref, bytes: s.aliveUnrefBytes, human: human(s.aliveUnrefBytes),
    note: 'page still exists but its cropped_photo no longer points here (superseded). Separate decision — NOT in delete manifest.',
  },
};
fs.writeFileSync(outPath('summary-stale-crops.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

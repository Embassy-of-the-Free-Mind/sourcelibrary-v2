#!/usr/bin/env node
/**
 * Renumber one book's pages into reading order, with every store that copies a page number (#5699).
 *
 * PRIOR ART: scripts/maintenance/reorder-rtl-split-pages.mjs (#4796) swaps split halves and moves only
 * `pages.page_number` + `cover_page` — no explicit map, no Supabase/entities/index/chapters, no read-back,
 * no undo. The pure part of this tool is scripts/lib/page-renumber.mjs (see its header for the model).
 *
 * WHO THIS SERVES: a reader paging forward through a right-to-left or CJK book stored back to front reads
 * it backwards, and the translator was handed the wrong neighbour as context. The page images, the text
 * and the page ids never change and never move between pages: only the NUMBER of each page changes.
 *
 * STORES, in this order (each read back against the map before the next; any difference stops the run):
 *   1. Mongo `pages.page_number`                       keyed by page id
 *   2. Supabase page_translations, pages, page_texts, page_concepts, pages_images (`page_number` copies;
 *      through pg, so no supabase-js 1,000-row cap)
 *   3. Mongo `gallery_images.page_number`              by page_id
 *   4. Mongo `entities.books[]` pages + page_range     number only (bulk entities write: see INTERLOCK)
 *   5. Mongo `book_indexes`                            term page arrays, pageSummaries, sectionSummaries
 *   6. `books.chapters`                                starts follow pageId, endPage recomputed
 *   7. `books.reading_summary.quotes`                  page follows page_id
 *   8. `books.cover_page`
 * Left alone on purpose: R2 image keys (the URLs are stored on the page and follow it), page_revisions
 * (keyed by page_id), analytics/book_checks/job logs (records of what was read at the time).
 * A book with rows in a store this tool does not handle (`chapter_texts`) is refused.
 *
 * RECORD: the old number is recorded as a ROW, not a column (#3969): one `sweep_log` row per book
 * (sweep `renumber-page-order-5699`) carrying every move [page_id, old, new] and the restore record, and the
 * same as an applied-map JSON file (--out-dir), written BEFORE the first write and updated per store.
 *
 * UNDO: --undo <applied-map.json> applies the inverse moves to the stores that file lists as done, and puts
 * back the recorded chapter list and widened ranges where they still hold what this tool wrote.
 *
 * MAP (--map file.json), explicit per book:
 *   { "book_id": "…", "expect_pages": 319,
 *     "segments": [ { "op": "reverse", "from": 183, "to": 310 } ]        // or pairswap / explicit pairs
 *   }
 *   { "op": "explicit", "pairs": [[159, 161], [160, 159], [161, 160]] }
 *
 * SAFETY GATES (refuse the book, exit 3): a live lane (a `lane_job_books` row naming the book with
 * last_at in the last --quiet-hours, default 72, or a page written in that window); the 07/13/19 UTC
 * release windows (20 min before to 40 min after) for --apply; page count ≠ expect_pages; duplicate
 * page numbers; rows in an unhandled store.
 *
 * Usage (from a pull of main):
 *   node --env-file=.env.production.local scripts/maintenance/renumber-page-order.mjs --map m.json            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/renumber-page-order.mjs --map m.json --apply
 *   node --env-file=.env.production.local scripts/maintenance/renumber-page-order.mjs --undo applied.json --apply
 *   --out-dir <dir>   where applied maps go (default $JOB_SCRATCH/renumber-maps or ./renumber-maps)
 *   --quiet-hours N   live-lane window (default 72)
 *
 * Exit: 0 ok · 1 read-back mismatch or error (STOP the whole run) · 3 refused by a gate (book skipped).
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { getScriptClient } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { beat, endSweep } from '../lib/sweep-heartbeat.mjs';
import { computeEndPages } from '../lib/chapter-endpages.mjs';
import {
  expandSegments, validateMoves, invertMoves, makeMapper, runStores, verifyKeyed, planPageNumberCopy,
  remapEntityBooks, remapBookIndex, remapChapters, remapQuote, RenumberMismatch,
} from '../lib/page-renumber.mjs';

const SWEEP = 'renumber-page-order-5699';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d = null) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const APPLY = flag('--apply');
const MAP = opt('--map');
const UNDO = opt('--undo');
const QUIET_H = Number(opt('--quiet-hours', 72));
const OUT_DIR = opt('--out-dir', path.join(process.env.JOB_SCRATCH || '.', 'renumber-maps'));

class Refused extends Error {}

/** 07:00, 13:00, 19:00 UTC releases: no writes from 20 min before until 40 min after (build ≈ 6 min + waits). */
export function inReleaseWindow(now = new Date(), leadMin = 10) {
  const min = now.getUTCHours() * 60 + now.getUTCMinutes();
  // leadMin: a book must be able to finish before the window opens.
  return [7, 13, 19].some((h) => min >= h * 60 - 20 - leadMin && min < h * 60 + 40);
}

function load(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

async function main() {
  if (!MAP && !UNDO) { console.error('need --map <file> or --undo <applied-map.json>'); process.exit(2); }
  if (APPLY && inReleaseWindow()) throw new Refused('inside (or within 10 min of) a release window, 07/13/19 UTC −20/+40 min: entities writes paused');
  const spec = UNDO ? load(UNDO) : load(MAP);
  const bookId = spec.book_id;
  if (!bookId) throw new Error('map has no book_id');

  const { client, db } = await getScriptClient({ timeoutMs: 60 * 60_000 });
  const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await pgc.connect();
  try {
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 1, id: 1, slug: 1, title: 1, pages_count: 1, cover_page: 1, chapters: 1, 'reading_summary.quotes': 1 } });
    if (!book) throw new Refused(`book ${bookId} not found`);
    const pageDocs = await db.collection('pages').find({ book_id: bookId }).project({ _id: 1, id: 1, page_number: 1 }).toArray();
    const pageKey = (p) => String(p.id ?? p._id);
    const underscore = new Map(pageDocs.map((p) => [pageKey(p), p._id]));
    const positive = pageDocs.filter((p) => p.page_number >= 1).map((p) => ({ id: pageKey(p), page_number: p.page_number }));
    console.log(`${bookId}  "${String(book.title).slice(0, 60)}"  ${pageDocs.length} pages (${positive.length} numbered ≥1), pages_count ${book.pages_count}`);

    // ---- moves
    let moves, restore = null, undoOf = null, storesToRun = null;
    if (UNDO) {
      if (!spec.moves?.length) throw new Error('applied map has no moves');
      const done = spec.stores_done || [];
      moves = invertMoves(spec.moves.map(([page_id, o, n]) => ({ page_id, old: o, new: n })));
      restore = spec.restore || {};
      undoOf = UNDO;
      storesToRun = new Set(done);
      console.log(`UNDO of ${UNDO}: ${moves.length} moves, stores ${done.join(', ') || '(none done)'}`);
    } else {
      if (spec.expect_pages != null && positive.length !== spec.expect_pages) throw new Refused(`book has ${positive.length} numbered pages, map expects ${spec.expect_pages}: the book changed since the map was set`);
      moves = expandSegments(positive, spec.segments || []);
    }
    validateMoves(moves);
    const f = makeMapper(moves);
    const curNum = new Map(pageDocs.map((p) => [pageKey(p), p.page_number]));
    const newById = new Map(moves.map((m) => [m.page_id, m.new]));
    const pageNumberOf = (pid) => (curNum.has(pid) ? (newById.get(pid) ?? curNum.get(pid)) : undefined);
    // Every move must name a page of this book at its stated old number.
    const wrong = storesToRun && !storesToRun.has('mongo.pages') ? [] : moves.filter((m) => curNum.get(m.page_id) !== m.old);
    if (wrong.length) throw new Refused(`${wrong.length} moves do not match the book's current numbers (e.g. ${JSON.stringify(wrong[0])})`);
    console.log(`moves: ${moves.length} pages change number (${moves[0]?.old}→${moves[0]?.new} … ${moves.at(-1)?.old}→${moves.at(-1)?.new})`);

    // ---- gates
    const since = new Date(Date.now() - QUIET_H * 3600_000);
    const lane = await db.collection('lane_job_books').findOne({ book_ids: bookId, last_at: { $gte: since } }, { projection: { _id: 1, last_at: 1 } });
    const gate = (msg) => { if (APPLY) throw new Refused(msg); console.log(`WARNING (would refuse with --apply): ${msg}`); };
    if (lane) gate(`a lane holds this book: ${lane._id} last_at ${lane.last_at?.toISOString?.()}`);
    const recent = await db.collection('pages').findOne({ book_id: bookId, $or: [{ updated_at: { $gte: since } }, { 'ocr.updated_at': { $gte: since } }, { 'translation.updated_at': { $gte: since } }] }, { projection: { _id: 1, page_number: 1, updated_at: 1 } });
    if (recent && !UNDO) gate(`page ${recent.page_number} was written ${recent.updated_at?.toISOString?.()} (within ${QUIET_H}h): a live lane may be writing`);
    const ct = await db.collection('chapter_texts').countDocuments({ book_id: bookId }, { maxTimeMS: 30000 });
    if (ct) gate(`${ct} chapter_texts rows: a store this tool does not remap`);

    // ---- applied-map record (written before the first write, updated per store)
    const record = (store, key, before, after) => { applied.restore[store] ??= {}; applied.restore[store][key] = { before, after }; };
    const applied = {
      sweep: SWEEP, book_id: bookId, title: book.title, created_at: new Date().toISOString(), undo_of: undoOf,
      source_map: MAP || null, segments: spec.segments || null,
      moves: moves.map((m) => [m.page_id, m.old, m.new]), restore: {}, stores_done: [], report: [], status: APPLY ? 'in-progress' : 'dry-run',
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, `${bookId}.${UNDO ? 'undo' : 'apply'}.${applied.created_at.replace(/[:.]/g, '')}.json`);
    const save = () => APPLY && fs.writeFileSync(outFile, JSON.stringify(applied, null, 1));
    const ctx = { restore, record };

    // ---- stores
    const ids = pageDocs.map(pageKey);
    const stores = [];

    stores.push({
      name: 'mongo.pages',
      read: async () => new Map((await db.collection('pages').find({ book_id: bookId }).project({ _id: 1, id: 1, page_number: 1 }).toArray()).map((p) => [pageKey(p), p.page_number])),
      plan(state) { const p = planPageNumberCopy(state, moves); if (p.stale) throw new Refused(`mongo.pages: ${p.stale} pages are not at their map's old number`); return p; },
      async write(writes) {
        const ops = writes.map(([k, n]) => ({ updateOne: { filter: { _id: underscore.get(k), page_number: curNum.get(k) }, update: { $set: { page_number: n } } } }));
        const r = await db.collection('pages').bulkWrite(ops, { ordered: true });
        if (r.matchedCount !== ops.length) throw new RenumberMismatch('mongo.pages', [`matched ${r.matchedCount} of ${ops.length}: a page changed under us`]);
        return r.modifiedCount;
      },
      verify: verifyKeyed,
    });

    const SB = [
      { table: 'page_translations', key: 'page_id' },
      { table: 'pages', key: 'id' },
      { table: 'page_texts', key: 'page_id', extra: 'lang' },
      { table: 'page_concepts', key: 'page_id', extra: 'run' },
      { table: 'pages_images', key: 'id' },
    ];
    for (const t of SB) {
      const keyExpr = t.extra ? `${t.key} || '|' || coalesce(${t.extra}::text, '')` : t.key;
      stores.push({
        name: `supabase.${t.table}`,
        read: async () => new Map((await pgc.query(`select ${keyExpr} as k, page_number from ${t.table} where ${t.key} = any($1::text[])`, [ids])).rows.map((r) => [r.k, r.page_number])),
        plan: (state) => planPageNumberCopy(state, moves),
        async write(writes) {
          await pgc.query('begin');
          try {
            const r = await pgc.query(
              `update ${t.table} t set page_number = v.n from (select unnest($1::text[]) as k, unnest($2::int[]) as n) v where (${keyExpr.replace(/\b(page_id|id|lang|run)\b/g, 't.$1')}) = v.k`,
              [writes.map((w) => w[0]), writes.map((w) => w[1])]);
            if (r.rowCount !== writes.length) throw new RenumberMismatch(`supabase.${t.table}`, [`updated ${r.rowCount} of ${writes.length}`]);
            await pgc.query('commit');
            return r.rowCount;
          } catch (e) { await pgc.query('rollback').catch(() => {}); throw e; }
        },
        verify: verifyKeyed,
      });
    }

    const galleryId = new Map();
    stores.push({
      name: 'mongo.gallery_images',
      read: async () => new Map((await db.collection('gallery_images').find({ book_id: bookId, page_id: { $exists: true } }).project({ _id: 1, page_id: 1, page_number: 1 }).toArray()).map((g) => {
        const k = `${g.page_id}|${g._id}`;
        galleryId.set(k, g._id);
        return [k, g.page_number];
      })),
      plan: (state) => planPageNumberCopy(state, moves),
      async write(writes) {
        const ops = writes.map(([k, n]) => ({ updateOne: { filter: { _id: galleryId.get(k) }, update: { $set: { page_number: n } } } }));
        const r = await db.collection('gallery_images').bulkWrite(ops, { ordered: true });
        if (r.matchedCount !== ops.length) throw new RenumberMismatch('mongo.gallery_images', [`matched ${r.matchedCount} of ${ops.length}`]);
        return r.modifiedCount;
      },
      verify: verifyKeyed,
    });

    // entities: only this book's entries, via $filter (a popular entity's books[] can be thousands long).
    const readEntities = async () => new Map((await db.collection('entities').aggregate([
      { $match: { 'books.book_id': bookId } },
      { $project: { mine: { $filter: { input: '$books', cond: { $eq: ['$$this.book_id', bookId] } } } } },
    ], { allowDiskUse: true }).toArray()).map((e) => [String(e._id), { _id: e._id, mine: e.mine }]));
    stores.push({
      name: 'mongo.entities',
      read: async () => { const m = await readEntities(); return new Map([...m].map(([k, v]) => [k, v.mine])); },
      plan(state) {
        const expected = new Map(), writes = [];
        for (const [k, mine] of state) {
          const next = remapEntityBooks(mine, bookId, f, { ...ctx, key: k });
          if (next) { expected.set(k, next); writes.push({ k, before: mine, after: next }); }
        }
        return { writes, expected, count: writes.length };
      },
      async write(writes) {
        const oid = new Map([...(await readEntities())].map(([k, v]) => [k, v._id]));
        let n = 0;
        for (let i = 0; i < writes.length; i += 200) {
          const ops = writes.slice(i, i + 200).flatMap(({ k, before, after }) => before.map((b, j) => ({
            // exact element match on the prior entry, then positional replace: one entry at a time, so a
            // duplicated entry (legacy $addToSet) is replaced in turn, and a concurrent edit fails the match.
            updateOne: { filter: { _id: oid.get(k), books: b }, update: { $set: { 'books.$': after[j], updated_at: new Date() } } },
          })));
          const r = await db.collection('entities').bulkWrite(ops, { ordered: true });
          if (r.matchedCount !== ops.length) throw new RenumberMismatch('mongo.entities', [`matched ${r.matchedCount} of ${ops.length}: an entity changed under us`]);
          n += r.modifiedCount;
          await beat(db, SWEEP, { book_id: bookId, entities_done: i + ops.length });
        }
        return n;
      },
      verify: verifyKeyed,
    });

    stores.push({
      name: 'mongo.book_indexes',
      read: async () => new Map((await db.collection('book_indexes').find({ book_id: bookId }).toArray()).map((d) => [String(d._id), d])),
      plan(state) {
        const expected = new Map(), writes = [];
        for (const [k, d] of state) {
          const set = remapBookIndex(d, f, pageNumberOf, { ...ctx, key: k });
          if (Object.keys(set).length) { expected.set(k, { ...d, ...set }); writes.push({ _id: d._id, generatedAt: d.generatedAt, set }); }
        }
        return { writes, expected, count: writes.length };
      },
      async write(writes) {
        let n = 0;
        for (const w of writes) {
          const r = await db.collection('book_indexes').updateOne({ _id: w._id, generatedAt: w.generatedAt }, { $set: w.set });
          if (r.matchedCount !== 1) throw new RenumberMismatch('mongo.book_indexes', [`${w._id} changed under us`]);
          n += r.modifiedCount;
        }
        return n;
      },
      verify: verifyKeyed,
    });

    const bookField = (name, field, compute) => stores.push({
      name,
      read: async () => { const b = await db.collection('books').findOne({ id: bookId }, { projection: { [field]: 1 } }); return new Map([[field, field.split('.').reduce((o, k) => o?.[k], b) ?? null]]); },
      plan(state) {
        const cur = state.get(field);
        const next = compute(cur);
        if (next == null || JSON.stringify(next) === JSON.stringify(cur)) return { writes: [], expected: new Map(), count: 0 };
        return { writes: [[field, cur, next]], expected: new Map([[field, next]]), count: 1 };
      },
      async write([[fld, cur, next]]) {
        const r = await db.collection('books').updateOne({ id: bookId, [fld]: cur }, { $set: { [fld]: next } });
        if (r.matchedCount !== 1) throw new RenumberMismatch(name, [`books.${fld} changed under us`]);
        return r.modifiedCount;
      },
      verify: verifyKeyed,
    });
    // chapters: restore keys are namespaced per store in the record
    bookField('books.chapters', 'chapters', (cur) => remapChapters(cur, f, pageNumberOf, book.pages_count, computeEndPages, ctx));
    bookField('books.reading_summary.quotes', 'reading_summary.quotes', (cur) => (Array.isArray(cur) ? cur.map((q) => remapQuote(q, f, pageNumberOf)) : null));
    bookField('books.cover_page', 'cover_page', (cur) => (typeof cur === 'number' ? f(cur) : null));

    const run = storesToRun ? stores.filter((s) => storesToRun.has(s.name)) : stores;
    // Persist the record before each store writes (the restore entries are made while planning).
    for (const s of run) { const w = s.write.bind(s); s.write = async (x) => { save(); return w(x); }; }

    if (APPLY) { save(); await beat(db, SWEEP, { book_id: bookId }, { force: true }); }
    const report = await runStores(run, {
      apply: APPLY,
      log: (l) => console.log(l),
      onStoreDone: async (name, row) => { applied.stores_done.push(name); applied.report.push(row); save(); },
    });
    if (!APPLY) {
      console.table(report);
      console.log(`DRY RUN — nothing written. restore records that would be kept: ${JSON.stringify(Object.fromEntries(Object.entries(applied.restore).map(([k, v]) => [k, Object.keys(v).length])))}`);
      return;
    }
    applied.status = 'done';
    save();
    await recordSweepAction(db, {
      sweep: SWEEP, book_id: bookId, action: UNDO ? 'renumber-undone' : 'renumbered',
      detail: { moves: applied.moves, restore: applied.restore, report: applied.report, applied_map: outFile, undo_of: undoOf, segments: applied.segments },
    });
    console.table(report);
    console.log(`APPLIED. Record: ${outFile} and sweep_log (${SWEEP}).`);
  } finally {
    if (APPLY) await endSweep(db, SWEEP).catch(() => {});
    await pgc.end().catch(() => {});
    await client.close();
  }
}

main().then(() => process.exit(0)).catch((e) => {
  if (e instanceof Refused) { console.error(`REFUSED: ${e.message}`); process.exit(3); }
  console.error(e instanceof RenumberMismatch ? `STOP — ${e.message}` : `STOP — ${e.stack || e}`);
  process.exit(1);
});

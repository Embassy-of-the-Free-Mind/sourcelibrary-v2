#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/apply-reocr-verdicts.mjs (its MARK_UNRELIABLE path is the write this makes:
 * `ocr.unreadable` + reason + `ocr.verdict`, `data` retained; it does not fit because its sweep, book event and
 * engine table are the Tibetan lane's and its mark takes no snapshot); /root/paddle-skqs-rest-6388/contain3.mjs
 * (the #6388 by-eye containment of 66 pages: snapshot, restore the superseded reading or unread — right for a
 * CONFIRMED page, wrong for a detector's flag, where the earlier Gemini reading is no more trusted on a table);
 * scripts/maintenance/withhold-stale-translations.mjs (the English half — run AFTER this, unchanged: its default
 * `ocr_unreadable` arm withholds every translation on a page this marks).
 *
 * Withholds the Paddle Chinese transcriptions that `paddleTableRisk()` (scripts/lib/paddle-table-detect.mjs) flags
 * as table/diagram pages at risk of invented cells (#6388; Derek approved 2026-10-11). The detector's list is a
 * WORK LIST, not an authority: every page is re-read live and re-judged before it is written.
 *
 * Per page that is still flagged, still `ocr.source: 'paddle'`, not already unreadable, and carries no human edit
 * on its transcription OR its translation:
 *   1. Snapshot `ocr` to `page_revisions` (reason REV_REASON, keepMeta). A short snapshot aborts the book.
 *   2. Set `ocr.unreadable = true`, `ocr.unreadable_reason = REASON` and an `ocr.verdict` naming the rule (`data`
 *      is taken off in a second pass, --strip, below). The reader then shows the scan with "could not produce a reading we trust" in place of
 *      both panes (ReaderV2Bits / PaneEmptyState), the counters stop counting the page as transcribed, and the
 *      translate gate refuses it (translate-core `ocr-unreadable`). The write is pinned to the judged text.
 *   3. Per book: recount the page counters, one `sweep_log` row with the pages and the detector's reasons.
 * The book must be held (pipeline-hold.mjs); `--hold` holds an unheld book first with a release sentence.
 *
 * THE FULL SEQUENCE (as run on 2026-10-11, in this order):
 *   a. this script --list=… [--apply]          steps 1–3 above
 *   b. this script --list=… --strip [--apply]  unset `ocr.data` on every flagged page whose snapshot matches it byte for
 *      byte, keeping `ocr.withheld_chars`. Without it the flagged text still ships in the reader's RSC payload (the
 *      projection carries `ocr` whole), in the meta description and JSON-LD excerpt, in the Supabase `pages` mirror
 *      (`ocr_data`) and in what embed-gemini embeds. The translation withhold keeps its text only in `page_revisions`
 *      for the same reason.
 *   c. withhold-stale-translations.mjs --books-file=<books> [--apply], unchanged: its candidate filter includes
 *      `ocr.unreadable: true`, so it snapshots and withholds every translation on these pages, moves featured quotes,
 *      recounts, and re-syncs the Supabase mirror for the books it changed. (The hourly sweep does the same within
 *      the hour, and re-syncs the mirror too; run c only after b, or that sync copies the Paddle text.)
 *   d. scripts/workers/sync-pages-content.mjs --book=<id> for every book c did NOT re-sync (pages with no English),
 *      so the mirror's `ocr_data` is cleared there too. The 5-minute cron selects on a checkpoint and did not.
 *   e. this script --list=… --park-search [--apply]: the statement of add-page-translations-withheld.mjs --move, for
 *      these page ids, reason REASON: the snippet and the vector leave `page_translations` (every search RPC needs a
 *      non-null embedding), parked in the sibling columns. That covers the pages with no English too, whose vector
 *      was embedded from the Paddle text.
 *
 * ACTUATION: every write bumps `pages.updated_at`; `embed-gemini.mjs --incremental` (every 4 h) selects pages with a
 * string `ocr.data` or English, so after b and c it has nothing to embed for these pages. The hourly withhold sweep
 * acts on these pages (c). Gap-fill and the OCR lanes skip held books.
 *
 * UNDO: `--undo --apply` puts `ocr.data` back from the snapshot, lifts the flag and un-parks `page_translations`;
 * then restore-withheld-translation.mjs --book=<id> --force --apply per book puts the English back, and
 * sync-pages-content.mjs --book=<id> refreshes the mirror.
 *
 * Usage (dry run unless --apply):
 *   node --env-file=.env.production.local scripts/maintenance/withhold-paddle-table-pages-6388.mjs --list=flagged.jsonl
 *   … --apply [--hold]        write (hold unheld books first)
 *   … --books=id,id           only these books (canary)
 *   … --verify                no writes: re-read every listed page and report its state
 *   … --list=… --strip [--apply]  second pass: take `ocr.data` off the flagged pages (snapshot checked first)
 *   … --list=… --park-search [--apply]  take these pages' snippets and vectors out of page_translations
 *   … --list=… --undo [--apply]   restore the text, lift the flag and un-park search for every page this wrote
 *   … --report=PATH
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import pg from 'pg';
import { paddleTableRisk } from '../lib/paddle-table-detect.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { isHeld, holdBook } from '../lib/pipeline-hold.mjs';

export const REASON = 'paddle_table_6388';
export const REV_REASON = 'withhold_paddle_table_6388';
const SWEEP = 'withhold-paddle-table-6388';
const HOLD = {
  reason: 'paddle-table-6388', issue: 6388, source: SWEEP,
  release: 'Release when the detector-flagged table/diagram pages of this book have a re-read that passed the #6388 pilot gate (or Derek rules the Paddle text may be served), and their English is re-made from it.',
};

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');
const UNDO = process.argv.includes('--undo');
const DO_HOLD = process.argv.includes('--hold');
const LIST = ARG('--list', null);
// --strip, --undo and --park-search select on `ocr.unreadable_reason`, which is unindexed: scope them by book (indexed), from --books
// or the --list's books, or the pages collection is scanned whole (measured: >10 min).
const ONLY = ARG('--books', null)?.split(',').filter(Boolean)
  ?? (listBooksForScope() || null);
function listBooksForScope() {
  const f = process.argv.find((a) => a.startsWith('--list='))?.slice(7);
  if (!f || !(process.argv.includes('--strip') || process.argv.includes('--undo') || process.argv.includes('--park-search'))) return null;
  return [...new Set(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).bid))];
}
const REPORT = ARG('--report', `scripts/output/${SWEEP}-${new Date().toISOString().slice(0, 10)}.jsonl`);
if (!LIST && !ONLY) { console.error('--list=<flagged.jsonl from scripts/eval/paddle-table-pilot-6388/census.mjs> (or --books=…) is required'); process.exit(2); }

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const pages = db.collection('pages');
fs.mkdirSync(REPORT.replace(/\/[^/]+$/, ''), { recursive: true });
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);

const humanOcr = (p) => Boolean(p.ocr?.edited_by) || p.ocr?.source === 'manual';
const humanTr = (p) => typeof p.translation === 'object' && p.translation && (Boolean(p.translation.edited_by) || p.translation.source === 'manual');

/** The page_revisions snapshot this script took of each page, newest first wins. */
async function snapshots(ids) {
  const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', reason: REV_REASON }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
  return new Map(revs.map((r) => [r.page_id, r.data]));
}

if (UNDO) {
  const filter = { 'ocr.unreadable_reason': REASON, ...(ONLY ? { book_id: { $in: ONLY } } : {}) };
  const docs = await pages.find(filter, { projection: { id: 1, book_id: 1, 'ocr.data': 1 } }).toArray();
  const snap = await snapshots(docs.map((p) => p.id));
  const noSnap = docs.filter((p) => typeof p.ocr?.data !== 'string' && typeof snap.get(p.id) !== 'string');
  console.log(`undo: ${docs.length} pages carry ${REASON}; ${noSnap.length} have neither text nor snapshot (left flagged)`);
  if (APPLY && docs.length) {
    const now = new Date();
    const ops = docs.filter((p) => !noSnap.includes(p)).map((p) => ({ updateOne: {
      filter: { id: p.id, 'ocr.unreadable_reason': REASON },
      update: { $set: { ...(typeof p.ocr?.data === 'string' ? {} : { 'ocr.data': snap.get(p.id) }), updated_at: now }, $unset: { 'ocr.unreadable': '', 'ocr.unreadable_reason': '', 'ocr.verdict': '', 'ocr.withheld_chars': '' } },
    } }));
    const r = ops.length ? await pages.bulkWrite(ops, { ordered: false }) : { modifiedCount: 0 };
    const books = [...new Set(docs.map((p) => p.book_id))];
    for (const b of books) {
      await recountBook(db, b, { reason: `${SWEEP}-undo` });
      await recordSweepAction(db, { sweep: SWEEP, book_id: b, action: 'undo', detail: { issue: 6388 } });
    }
    const unparked = await searchRows(docs.map((p) => p.id), 'unpark');
    console.log(`un-parked ${unparked} page_translations rows`);
    console.log(`undone ${r.modifiedCount} pages in ${books.length} books; now run restore-withheld-translation.mjs --book=<id> --force --apply per book, then scripts/workers/sync-pages-content.mjs --book=<id>`);
  }
  await mongo.close();
  process.exit(0);
}

/**
 * --park-search: the statement of scripts/migration/add-page-translations-withheld.mjs --move, scoped to the flagged
 * pages (that script selects only pages whose ENGLISH is withheld; most of these pages have none, and their vector
 * was embedded from the Paddle text). `--undo` runs its --unmove statement for the same ids.
 */
async function searchRows(ids, mode) {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is needed to park page_translations rows');
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let n = 0;
  try {
    for (let i = 0; i < ids.length; i += 2000) {
      const slice = ids.slice(i, i + 2000);
      if (mode === 'count-park') n += (await c.query(`select count(*)::int as n from page_translations where page_id = any($1::text[]) and (embedding is not null or coalesce(translation,'') <> '')`, [slice])).rows[0].n;
      else if (mode === 'park') n += (await c.query(`UPDATE page_translations
           SET translation_withheld = COALESCE(translation_withheld, translation),
               embedding_withheld   = COALESCE(embedding_withheld, embedding),
               translation = '', embedding = NULL,
               withheld_at = COALESCE(withheld_at, now()), withheld_reason = $2
         WHERE page_id = ANY($1::text[]) AND (embedding IS NOT NULL OR COALESCE(translation,'') <> '')`, [slice, REASON])).rowCount;
      else if (mode === 'unpark') n += (await c.query(`UPDATE page_translations
           SET translation = COALESCE(translation_withheld, translation), embedding = COALESCE(embedding_withheld, embedding),
               translation_withheld = NULL, embedding_withheld = NULL, withheld_at = NULL, withheld_reason = NULL
         WHERE page_id = ANY($1::text[]) AND withheld_reason = $2`, [slice, REASON])).rowCount;
      else if (mode === 'count-reachable') n += (await c.query(`select count(*)::int as n from page_translations where page_id = any($1::text[]) and embedding is not null`, [slice])).rows[0].n;
    }
  } finally { await c.end(); }
  return n;
}

if (process.argv.includes('--park-search')) {
  const ids = await pages.distinct('id', { book_id: { $in: ONLY }, 'ocr.unreadable_reason': REASON });
  const n = await searchRows(ids, APPLY ? 'park' : 'count-park');
  const reachable = await searchRows(ids, 'count-reachable');
  console.log(JSON.stringify({ mode: APPLY ? 'park-apply' : 'park-dry-run', pages: ids.length, [APPLY ? 'parked' : 'would_park']: n, still_reachable: reachable }));
  rec({ status: 'park-summary', mode: APPLY ? 'apply' : 'dry-run', pages: ids.length, rows: n, still_reachable: reachable });
  report.end();
  await mongo.close();
  process.exit(0);
}

/**
 * --strip: take the text itself off every page this script flagged, once its snapshot is confirmed byte-for-byte.
 * `ocr.unreadable` alone stops the reader PANE, but `data` still ships in the reader's RSC payload (the projection
 * carries `ocr` whole), in the page's meta description and JSON-LD excerpt, in the Supabase `pages` mirror
 * (`ocr_data`) and in what embed-gemini embeds. The translation withhold keeps its text only in `page_revisions`
 * for the same reason; this does the same for the transcription. `ocr.withheld_chars` keeps the length.
 */
if (process.argv.includes('--strip')) {
  const filter = { 'ocr.unreadable_reason': REASON, 'ocr.data': { $type: 'string' }, ...(ONLY ? { book_id: { $in: ONLY } } : {}) };
  const docs = await pages.find(filter, { projection: { id: 1, book_id: 1, 'ocr.data': 1 } }).toArray();
  const S = { carrying: docs.length, stripped: 0, no_matching_snapshot: 0, books: new Set(docs.map((p) => p.book_id)).size };
  for (let i = 0; i < docs.length; i += 500) {
    const slice = docs.slice(i, i + 500);
    const snap = await snapshots(slice.map((p) => p.id));
    const ops = [];
    for (const p of slice) {
      if (snap.get(p.id) !== p.ocr.data) { S.no_matching_snapshot++; rec({ book: p.book_id, page_id: p.id, status: 'strip-skipped-no-matching-snapshot' }); continue; }
      ops.push({ updateOne: { filter: { id: p.id, 'ocr.unreadable_reason': REASON, 'ocr.data': p.ocr.data }, update: { $unset: { 'ocr.data': '' }, $set: { 'ocr.withheld_chars': p.ocr.data.length, updated_at: new Date() } } } });
    }
    if (APPLY && ops.length) S.stripped += (await pages.bulkWrite(ops, { ordered: false })).modifiedCount;
    else S.stripped += ops.length;
  }
  console.log(JSON.stringify({ mode: APPLY ? 'strip-apply' : 'strip-dry-run', ...S }));
  rec({ status: 'strip-summary', mode: APPLY ? 'apply' : 'dry-run', ...S });
  report.end();
  await mongo.close();
  process.exit(0);
}

const listed = fs.readFileSync(LIST, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => !ONLY || ONLY.includes(r.bid));
const byBook = new Map();
for (const r of listed) (byBook.get(r.bid) ?? byBook.set(r.bid, []).get(r.bid)).push(r);

const T = { books: byBook.size, listed: listed.length, write: 0, written: 0, already: 0, no_longer_flagged: 0, not_paddle: 0,
  human_ocr: 0, human_tr: 0, with_english: 0, raced: 0, aborted_books: 0, unheld: 0, held_now: 0, revisions: 0, missing: 0 };
const PROJ = { id: 1, book_id: 1, page_number: 1, ocr: 1, 'translation.data': 1, 'translation.edited_by': 1, 'translation.source': 1, translation_withheld: 1 };

for (const [bookId, rows] of byBook) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, title: 1, pipeline_auto: 1 } });
  const docs = await pages.find({ id: { $in: rows.map((r) => r.pid) } }, { projection: PROJ }).toArray();
  const byId = new Map(docs.map((p) => [p.id, p]));

  if (VERIFY) {
    for (const r of rows) {
      const p = byId.get(r.pid);
      const st = !p ? 'missing' : p.ocr?.unreadable_reason === REASON ? 'withheld' : p.ocr?.unreadable ? 'unreadable-other' : 'served';
      T[st] = (T[st] || 0) + 1;
      const tr = p?.translation?.data ? 'english-served' : p?.translation_withheld ? 'english-withheld' : 'no-english';
      T[tr] = (T[tr] || 0) + 1;
      rec({ book: bookId, page: r.pn, page_id: r.pid, state: st, english: tr });
    }
    T.held_now += isHeld(book) ? 1 : 0;
    continue;
  }

  const plan = [];
  for (const r of rows) {
    const p = byId.get(r.pid);
    if (!p) { T.missing++; rec({ book: bookId, page: r.pn, status: 'missing' }); continue; }
    if (p.ocr?.unreadable_reason === REASON) { T.already++; continue; }
    if (p.ocr?.source !== 'paddle' || p.ocr?.unreadable) { T.not_paddle++; rec({ book: bookId, page: r.pn, status: 'skip-not-served-paddle', source: p.ocr?.source ?? null, unreadable: p.ocr?.unreadable ?? null }); continue; }
    if (humanOcr(p)) { T.human_ocr++; rec({ book: bookId, page: r.pn, status: 'SKIP-human-edited-ocr' }); continue; }
    if (humanTr(p)) { T.human_tr++; rec({ book: bookId, page: r.pn, status: 'SKIP-human-edited-translation' }); continue; }
    const v = paddleTableRisk(p.ocr?.data, { title: book?.title });
    if (!v.flag) { T.no_longer_flagged++; rec({ book: bookId, page: r.pn, status: 'skip-no-longer-flagged' }); continue; }
    if (p.translation?.data) T.with_english++;
    plan.push({ p, v });
  }
  T.write += plan.length;
  if (!plan.length) continue;

  if (!isHeld(book)) {
    T.unheld++;
    if (!APPLY || !DO_HOLD) {
      rec({ book: bookId, status: APPLY ? 'SKIP-book-not-held' : 'dry-run-would-hold', pages: plan.length });
      if (APPLY) { T.write -= plan.length; continue; }
    } else {
      const h = await holdBook(db, bookId, HOLD);
      rec({ book: bookId, status: 'hold', outcome: h.outcome, from: h.from ?? null });
      if (h.outcome === 'held') T.held_now++;
      else if (h.outcome !== 'already_held' && h.outcome !== 'held_other_reason') { T.write -= plan.length; continue; }
    }
  }

  if (!APPLY) {
    rec({ book: bookId, status: 'dry-run', pages: plan.map((x) => x.p.page_number), with_english: plan.filter((x) => x.p.translation?.data).length });
    continue;
  }

  const ids = plan.map((x) => x.p.id);
  const saved = await saveRevisionsBeforeOverwrite(db, ids, 'ocr', { reason: REV_REASON, keepMeta: true });
  if (saved !== ids.length) {
    T.aborted_books++;
    rec({ book: bookId, status: 'ABORT-revision-mismatch', want: ids.length, got: saved });
    console.error(`ABORT ${bookId}: revisions ${saved} != ${ids.length}`);
    continue;
  }
  T.revisions += saved;
  const now = new Date();
  const done = [];
  for (const { p, v } of plan) {
    const verdict = { verdict: 'MARK_UNRELIABLE', rule: `paddle_table_detect:${v.reasons.join('+')}`, agree_wood: null, agree_uchan: null, align: null, align_src: null, dharani: null, valid: null, judged_engine: 'paddle', run: SWEEP, issue: 6388, at: now };
    const res = await pages.updateOne(
      { id: p.id, 'ocr.source': 'paddle', 'ocr.data': p.ocr.data, 'ocr.edited_by': { $exists: false }, 'ocr.unreadable': { $ne: true } },
      { $set: { 'ocr.unreadable': true, 'ocr.unreadable_reason': REASON, 'ocr.verdict': verdict, updated_at: now } },
    );
    if (res.modifiedCount === 1) { T.written++; done.push(p.page_number); } else { T.raced++; rec({ book: bookId, page: p.page_number, status: 'SKIP-guard-at-write' }); }
  }
  const { after } = await recountBook(db, bookId, { reason: SWEEP, now });
  await recordSweepAction(db, {
    sweep: SWEEP, book_id: bookId, action: 'ocr-withheld',
    detail: { issue: 6388, pages: done.sort((a, b) => a - b), rule: 'paddleTableRisk gate AND shape (scripts/lib/paddle-table-detect.mjs)', revision_reason: REV_REASON, unreadable_reason: REASON, pages_ocr_after: after?.pages_ocr ?? null },
  });
  rec({ book: bookId, status: 'applied', pages: done.length });
}

console.log(JSON.stringify({ mode: VERIFY ? 'verify' : APPLY ? 'apply' : 'dry-run', ...T }, null, 2));
rec({ status: 'run-summary', mode: VERIFY ? 'verify' : APPLY ? 'apply' : 'dry-run', ...T });
report.end();
await mongo.close();

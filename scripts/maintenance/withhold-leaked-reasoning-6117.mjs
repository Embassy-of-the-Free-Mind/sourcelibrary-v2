#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/withhold-stale-translations.mjs — the withhold mechanism this reuses
 * whole (`withholdUpdate`, the `page_revisions` snapshot under WITHHOLD_REVISION_SOURCE, the counter
 * recount, the quote move, the Supabase `pages` mirror re-sync). It does not fit as a new arm: its
 * candidates come from a predicate over the page's OCR state, re-derived hourly, and this set comes from a
 * 27-minute walk of every page's ENGLISH (scripts/audit/translation-reasoning-leak.mjs). So this script
 * takes the walk's page list and re-judges every page against the live text before it writes.
 * scripts/maintenance/tibetan-leaf-translation-gate-5320.mjs `--exclude` is the precedent for keeping
 * named pages out of the translation lanes with a `translation.health_blocked` stamp.
 *
 * Withholds the pages whose stored English is the model's reasoning or a chat reply (#6117; Derek
 * 2026-10-07: withhold now, re-translate once the write guard is merged).
 *
 * For each listed page of a public book that `refusableReasoningLeak()` still refuses, on the live text:
 *   1. Snapshot `translation` to `page_revisions` (reason WITHHOLD_REVISION_SOURCE, which is what
 *      restore-withheld-translation.mjs and the drift audit read) and read the row back: a page whose
 *      snapshot is not byte-for-byte the judged text is not withheld.
 *   2. Move the translation's metadata to `translation_withheld` (reason REASON, no text) and leave
 *      `translation: { health_blocked: REASON }`. Withholding alone empties `translation.data`, which is
 *      exactly what the realtime worker, the chained Batch lane and gap-fill select on; all three skip a
 *      page carrying `translation.health_blocked`. Without the stamp the page is re-translated by whatever
 *      code is deployed, before the guard is.
 *   3. Per book: move featured quotes drawn from those pages to `reading_summary.quotes_withheld`,
 *      recount the page counters, re-sync the Supabase `pages` mirror, ask the site to re-render the
 *      book (`/api/admin/revalidate-book`), and write one `sweep_log` row.
 *   4. Park the Supabase `page_translations` snippet and vector of each page (the search surface), with
 *      the statement of scripts/migration/add-page-translations-withheld.mjs --move.
 *
 * ACTUATION: step 2 bumps `pages.updated_at`; `embed-gemini.mjs --incremental` (Hetzner, every 4 h) will
 * re-embed these pages from their OCR. Step 3 lowers `pages_translated` by the pages withheld; gap-fill
 * re-dispatches a finished book under 90% translated, and the stamp keeps these pages out of what it sends.
 *
 * TO RE-TRANSLATE (not done here): clear the stamp on the page, then enrol it —
 *   pages.updateMany({ 'translation_withheld.reason': REASON, 'translation.health_blocked': REASON },
 *                    { $unset: { translation: '' } })
 * `translation_withheld` stays as provenance; the reader shows the new English as soon as it exists.
 * TO PUT ONE BACK: scripts/maintenance/restore-withheld-translation.mjs --page=<id> --apply.
 *
 * Default is a DRY RUN.
 *   node --env-file=.env.production.local scripts/maintenance/withhold-leaked-reasoning-6117.mjs --list=PATH/pages.jsonl
 *   … --apply            write
 *   … --books=id,id      only these books (canary)
 *   … --verify           no writes: re-read every listed page and report its state
 *   … --report=PATH
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { refusableReasoningLeak } from '../lib/page-integrity.mjs';
import { WITHHOLD_REVISION_SOURCE, withholdUpdate, withholdPin, translationText } from '../lib/stale-translation.mjs';

/** `translation_withheld.reason` and the `translation.health_blocked` stamp. */
export const REASON = 'leaked-reasoning-6117';
const SWEEP = 'withhold-leaked-reasoning-6117';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');
const LIST = ARG('--list', null);
const ONLY_BOOKS = ARG('--books', null)?.split(',').filter(Boolean) ?? null;
const REPORT = ARG('--report', `scripts/output/${SWEEP}-${new Date().toISOString().slice(0, 10)}.jsonl`);
if (!LIST) { console.error('--list=<pages.jsonl from translation-reasoning-leak.mjs report> is required'); process.exit(2); }

// The headline set: a public book, a page a reader reaches, and the gate's own predicate.
const listed = fs.readFileSync(LIST, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.live && r.refusable && (!ONLY_BOOKS || ONLY_BOOKS.includes(r.book_id)));
const byBook = new Map();
for (const r of listed) (byBook.get(r.book_id) ?? byBook.set(r.book_id, []).get(r.book_id)).push(r);

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const pages = db.collection('pages');
fs.mkdirSync(REPORT.replace(/\/[^/]+$/, ''), { recursive: true });
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);
const run = promisify(execFile);

const T = { mode: VERIFY ? 'verify' : APPLY ? 'apply' : 'dry-run', listed: listed.length, books: byBook.size, found: 0,
  refusable: 0, already_withheld: 0, changed_since_walk: 0, human_edited: 0, no_snapshot: 0, withheld: 0, pin_missed: 0,
  quotes_moved: 0, books_changed: 0, recounted: 0, revalidated: 0, revalidate_failed: 0, mirror_synced: 0, mirror_failed: 0, sweep_rows: 0, search_rows_parked: null };
const V = { withheld_no_text: 0, stamped: 0, snapshot_ok: 0, still_serving_leak: 0, other: 0, books_under_90: [] };
const writtenIds = [];

const fetchListed = (bookId, rows) => pages.find(
  { book_id: bookId, page_number: { $in: rows.map((r) => r.page_number) } },
  { projection: { id: 1, book_id: 1, page_number: 1, translation: 1, translation_withheld: 1 } },
).toArray().then((docs) => { const want = new Set(rows.map((r) => r._id)); return docs.filter((d) => want.has(String(d._id))); });

/** The newest withhold snapshot of each page: page_id → text. Looked up by page_id (indexed). */
async function snapshots(ids) {
  const out = new Map();
  const rows = await db.collection('page_revisions')
    .find({ page_id: { $in: ids }, field: 'translation', reason: WITHHOLD_REVISION_SOURCE }, { projection: { page_id: 1, data: 1, created_at: 1 } })
    .sort({ created_at: 1 }).toArray();
  for (const r of rows) out.set(r.page_id, r.data);
  return out;
}

async function moveQuotes(bookId, pageNumbers) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { reading_summary: 1 } });
  const quotes = book?.reading_summary?.quotes;
  if (!Array.isArray(quotes)) return 0;
  const drop = quotes.filter((q) => q && pageNumbers.has(q.page));
  if (!drop.length) return 0;
  if (APPLY) {
    await db.collection('books').updateOne({ id: bookId }, {
      $set: { 'reading_summary.quotes': quotes.filter((q) => !(q && pageNumbers.has(q.page))), updated_at: new Date() },
      $push: { 'reading_summary.quotes_withheld': { $each: drop } },
    });
  }
  return drop.length;
}

async function oneBook(bookId, rows) {
  const docs = await fetchListed(bookId, rows);
  T.found += docs.length;

  if (VERIFY) {
    const snap = await snapshots(docs.map((d) => d.id));
    for (const p of docs) {
      const text = translationText(p.translation);
      if (p.translation_withheld?.reason === REASON && !text && p.translation_withheld.data === undefined) {
        V.withheld_no_text++;
        if (p.translation?.health_blocked === REASON) V.stamped++;
        if (typeof snap.get(p.id) === 'string' && snap.get(p.id).length === p.translation_withheld.chars) V.snapshot_ok++;
      } else if (refusableReasoningLeak(text)) { V.still_serving_leak++; rec({ book: bookId, page: p.page_number, status: 'STILL-SERVING' }); }
      else V.other++;
    }
    // Gap-fill re-dispatches a finished book under 90% translated; say which books that now is.
    const b = await db.collection('books').findOne({ id: bookId }, { projection: { pages_ocr: 1, pages_blank: 1, pages_translated: 1, 'pipeline_auto.status': 1 } });
    const denom = (b?.pages_ocr ?? 0) - (b?.pages_blank ?? 0);
    if (denom > 0 && (b.pages_translated ?? 0) < 0.9 * denom) V.books_under_90.push({ book: bookId, status: b.pipeline_auto?.status ?? null, translated: b.pages_translated, of: denom });
    return;
  }

  const targets = [];
  for (const p of docs) {
    const text = translationText(p.translation);
    if (!text) { if (p.translation_withheld?.reason) T.already_withheld++; else T.changed_since_walk++; continue; }
    // Judged again on the LIVE text, in full: the walk kept the first 60,000 characters, and a page
    // re-translated since the walk is no longer the page that was listed.
    const v = refusableReasoningLeak(text);
    if (!v) { T.changed_since_walk++; continue; }
    // A person's text is never taken down by a phrase rule.
    if (typeof p.translation === 'object' && (p.translation.source === 'manual' || p.translation.edited_by)) { T.human_edited++; rec({ book: bookId, page: p.page_number, status: 'skipped-human-edited' }); continue; }
    targets.push({ page: p, text, kind: v.kind });
  }
  T.refusable += targets.length;
  if (!targets.length) return;
  const pageNumbers = new Set(targets.map((t) => t.page.page_number));
  if (!APPLY) {
    const q = await moveQuotes(bookId, pageNumbers); T.quotes_moved += q;
    rec({ book: bookId, status: 'dry-run', pages: [...pageNumbers] });
    return;
  }

  // Snapshot first, then read it back. The snapshot is the only copy of the text once the page is written.
  await saveRevisionsBeforeOverwrite(db, targets.map((t) => t.page.id), 'translation', { reason: WITHHOLD_REVISION_SOURCE });
  const snap = await snapshots(targets.map((t) => t.page.id));
  const now = new Date();
  const done = [];
  for (const t of targets) {
    if (snap.get(t.page.id) !== t.text) { T.no_snapshot++; rec({ book: bookId, page: t.page.page_number, status: 'SKIPPED-snapshot-mismatch' }); continue; }
    const update = withholdUpdate(t.page, REASON, now);
    // Not `$unset: translation`: the stamp below is what keeps the page out of the translation lanes.
    delete update.$unset.translation;
    update.$set.translation = { health_blocked: REASON, health_blocked_at: now };
    // Pinned to the text that was judged: a page another writer re-translated in between is left alone.
    const res = await pages.updateOne({ id: t.page.id, ...withholdPin(t.page) }, update);
    if (res.modifiedCount !== 1) { T.pin_missed++; rec({ book: bookId, page: t.page.page_number, status: 'pin-missed' }); continue; }
    T.withheld++; writtenIds.push(t.page.id); done.push(t);
  }
  if (!done.length) return;
  T.books_changed++;
  const donePages = new Set(done.map((t) => t.page.page_number));
  const quotes = await moveQuotes(bookId, donePages);
  T.quotes_moved += quotes;
  let counters = null;
  try { const r = await recountBook(db, bookId, { reason: SWEEP }); counters = { before: r.before?.pages_translated, after: r.after?.pages_translated }; T.recounted++; }
  catch (e) { rec({ book: bookId, status: 'recount-failed', error: e.message?.slice(0, 120) }); }
  // The mirror's 5-minute worker selects by `translation.updated_at`, which this write removes.
  try { await run(process.execPath, ['scripts/workers/sync-pages-content.mjs', `--book=${bookId}`], { timeout: 300000, env: process.env }); T.mirror_synced++; }
  catch (e) { T.mirror_failed++; rec({ book: bookId, status: 'supabase-pages-mirror-sync-failed', error: String(e.message).slice(0, 160) }); }
  // Reader HTML is edge-cached for 24 h; the route re-renders the book's pages and purges its landing URLs.
  // It does not purge each /page/<id> URL at Cloudflare: one a visitor loaded in the last day can stay up to 24 h.
  let revalidated = false;
  if (process.env.CRON_SECRET) {
    try {
      const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${bookId}`, { method: 'POST', headers: { 'x-revalidate-secret': process.env.CRON_SECRET } });
      revalidated = r.ok;
    } catch { /* counted below */ }
  }
  if (revalidated) T.revalidated++; else { T.revalidate_failed++; rec({ book: bookId, status: 'revalidate-failed' }); }
  await recordSweepAction(db, {
    sweep: SWEEP, book_id: bookId, action: 'translation-withheld',
    detail: { issue: 6117, reason: REASON, pages: done.map((t) => ({ page_id: t.page.id, page_number: t.page.page_number, kind: t.kind, chars: t.text.length })),
      quotes_moved: quotes, pages_translated: counters, snapshot: `page_revisions reason=${WITHHOLD_REVISION_SOURCE}`, lanes: `translation.health_blocked=${REASON}` },
  });
  T.sweep_rows++;
  rec({ book: bookId, status: 'applied', pages: [...donePages], quotes_moved: quotes, pages_translated: counters });
}

const queue = [...byBook];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < queue.length) {
    const [bookId, rows] = queue[next++];
    try { await oneBook(bookId, rows); } catch (e) { rec({ book: bookId, status: 'ERROR', error: e.message?.slice(0, 200) }); console.error(`ERROR ${bookId}: ${e.message}`); }
    if (next % 50 === 0) console.log(`  ${next}/${queue.length} books`);
  }
}));

// The search surface: park the snippet and the vector, as add-page-translations-withheld.mjs --move does.
if (APPLY && writtenIds.length) {
  if (!process.env.SUPABASE_DB_URL) console.log('SUPABASE_DB_URL not set: page_translations rows NOT parked. Run the withheld-translation drift audit.');
  else {
    const { default: pg } = await import('pg');
    const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await pgc.connect();
    T.search_rows_parked = 0;
    for (let i = 0; i < writtenIds.length; i += 200) {
      const r = await pgc.query(
        `UPDATE page_translations
            SET translation_withheld = COALESCE(translation_withheld, translation),
                embedding_withheld   = COALESCE(embedding_withheld, embedding),
                translation = '', embedding = NULL,
                withheld_at = COALESCE(withheld_at, now()), withheld_reason = $2
          WHERE page_id = ANY($1::text[]) AND (embedding IS NOT NULL OR COALESCE(translation,'') <> '')`,
        [writtenIds.slice(i, i + 200), REASON]);
      T.search_rows_parked += r.rowCount;
    }
    await pgc.end();
  }
}

const summary = VERIFY ? { ...T, verify: V } : T;
console.log(JSON.stringify(summary, null, 2));
rec({ status: 'run-summary', ...summary });
report.end();
await mongo.close();

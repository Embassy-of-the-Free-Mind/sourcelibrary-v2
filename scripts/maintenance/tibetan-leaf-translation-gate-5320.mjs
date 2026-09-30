#!/usr/bin/env node
// PRIOR ART: scripts/workers/syriac-kraken-lane.mjs — unsets translation.health_blocked when it rewrites a
// page's OCR (the stamp judged the old text); this script does the same for the Tibetan cohort, whose OCR was
// rewritten by the Yigdzin lanes (#4523) without that unset. scripts/maintenance/restore-refused-translations-5105.mjs
// — restores refused TEXT, not the stamp. scripts/maintenance/backfill-leaf-break-markers.mjs — places the seam
// marker; this script only decides which pages may be translated before a seam exists.
/**
 * The translation gate for the held Tibetan cohort (#4523, #5320), run before the Batch re-translation.
 *
 * WHY. The translator bridges a leaf seam it cannot see (#5320: 1/2 unmarked multi-leaf frames carried the
 * wrong text across the seam; 0/8 marked seam pages bridged). A page is safe to translate when its seams are
 * marked (`<leaf-break/>`) or it is physically one leaf (the per-leaf ledger detected one leaf). Everything
 * else — a multi-leaf frame whose page-mode read could not be aligned to a leaf read, or a page no leaf
 * detector has seen — waits for a per-leaf read.
 *
 *   --exclude   stamp `translation.health_blocked: 'leaf-unmarked'` on the cohort's translatable, untranslated,
 *               unmarked pages that the ledger does not show as single-leaf. Every translate lane skips a
 *               stamped page (selectPages, translate-worker), so this is the lane filter. Reversible:
 *               `--unexclude` unsets exactly that reason.
 *   --lift      unset the stamps that judged text no longer on the page: reasons runaway / collapsed /
 *               source_loop / leaf-drift whose `health_blocked_at` is older than `ocr.updated_at`. The write
 *               gate re-judges every translation on the new text, so a page that is still bad is stamped again.
 *
 * Cohort = books held with reason `tibetan-retranslation-awaits-derek`. Default is DRY RUN; --apply writes.
 * Every write records a sweep_log row per book and the page ids go to the report (the undo list).
 *
 *   node --env-file=.env.production.local scripts/maintenance/tibetan-leaf-translation-gate-5320.mjs \
 *     --ledger=/root/tibetan-reocr/leaf-run-logs/pages.jsonl (--exclude | --unexclude | --lift) [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { LEAF_BREAK_RE } from '../lib/leaf-break.mjs';

const ARG = (n, d) => { const a = process.argv.find((x) => x.startsWith(`${n}=`)); return a ? a.slice(n.length + 1) : d; };
const has = (f) => process.argv.includes(f);
const APPLY = has('--apply');
const MODE = has('--exclude') ? 'exclude' : has('--unexclude') ? 'unexclude' : has('--lift') ? 'lift' : null;
const LEDGER = ARG('--ledger', null);
const HOLD_REASON = 'tibetan-retranslation-awaits-derek';
const STAMP = 'leaf-unmarked';
const LIFTABLE = ['runaway', 'collapsed', 'source_loop', 'leaf-drift'];
const SWEEP = `tibetan-leaf-gate-5320-${MODE}`;
const REPORT = ARG('--report', `scripts/output/tibetan-leaf-gate-5320-${MODE}-${new Date().toISOString().slice(0, 10)}${APPLY ? '' : '.dry'}.jsonl`);
if (!MODE) { console.error('one of --exclude, --unexclude, --lift'); process.exit(1); }
if (MODE === 'exclude' && !LEDGER) { console.error('--exclude needs --ledger=<pages.jsonl>'); process.exit(1); }

// Pages the per-leaf detector saw as ONE leaf: safe to translate without a marker.
const singleLeaf = new Set();
if (LEDGER) {
  for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const r = JSON.parse(line);
    if (r.nb === 1 && r.path === 'detected' && !(Array.isArray(r.leaf) && r.leaf.length >= 2)) singleLeaf.add(r.id);
  }
}

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const books = (await db.collection('books').find({ 'pipeline_auto.hold.reason': HOLD_REASON }, { projection: { id: 1 } }).toArray()).map((b) => b.id).sort();
console.log(`${books.length} held cohort books — ${MODE}${APPLY ? ' APPLY' : ' dry run'}`);
const t = { pages: 0, books: 0, reasons: {} };
const now = new Date();

for (const bookId of books) {
  let filter; const ids = [];
  if (MODE === 'exclude') {
    const pages = await db.collection('pages').find({
      book_id: bookId, 'ocr.unreadable': { $ne: true }, 'translation.health_blocked': { $exists: false },
      $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }],
    }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
    for (const p of pages) {
      const d = typeof p.ocr?.data === 'string' ? p.ocr.data : '';
      if ((d.match(/[ༀ-࿿]/g) || []).length < 20) continue;               // not translatable anyway
      if (LEAF_BREAK_RE.test(d)) { LEAF_BREAK_RE.lastIndex = 0; continue; }         // marked: safe
      LEAF_BREAK_RE.lastIndex = 0;
      if (singleLeaf.has(`${bookId}_${String(p.page_number).padStart(5, '0')}`)) continue; // one leaf: safe
      ids.push(p.id);
    }
    filter = { id: { $in: ids }, 'translation.health_blocked': { $exists: false } };
  } else if (MODE === 'unexclude') {
    filter = { book_id: bookId, 'translation.health_blocked': STAMP };
    ids.push(...(await db.collection('pages').find(filter, { projection: { id: 1 } }).toArray()).map((p) => p.id));
  } else {
    const pages = await db.collection('pages').find(
      { book_id: bookId, 'translation.health_blocked': { $in: LIFTABLE } },
      { projection: { id: 1, 'translation.health_blocked': 1, 'translation.health_blocked_at': 1, 'ocr.updated_at': 1 } },
    ).toArray();
    for (const p of pages) {
      const at = p.translation?.health_blocked_at; const ou = p.ocr?.updated_at;
      if (at instanceof Date && ou instanceof Date && ou > at) {
        ids.push(p.id); t.reasons[p.translation.health_blocked] = (t.reasons[p.translation.health_blocked] || 0) + 1;
      } else t.reasons[`kept:${p.translation.health_blocked}`] = (t.reasons[`kept:${p.translation.health_blocked}`] || 0) + 1;
    }
    filter = { id: { $in: ids }, 'translation.health_blocked': { $in: LIFTABLE } };
  }
  if (!ids.length) continue;
  t.books++;
  let n = ids.length;
  if (APPLY) {
    const update = MODE === 'exclude'
      ? { $set: { 'translation.health_blocked': STAMP, 'translation.health_blocked_at': now, updated_at: now } }
      : { $unset: { 'translation.health_blocked': '', 'translation.health_blocked_at': '' }, $set: { updated_at: now } };
    n = (await db.collection('pages').updateMany(filter, update)).modifiedCount;
    await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: MODE, detail: { issue: 5320, pages: n, planned: ids.length } });
  }
  t.pages += n;
  report.write(`${JSON.stringify({ book: bookId, mode: MODE, apply: APPLY, pages: n, ids, at: now.toISOString() })}\n`);
}
report.end();
await mongo.close();
console.log(JSON.stringify({ mode: MODE, apply: APPLY, ...t, report: REPORT }, null, 1));

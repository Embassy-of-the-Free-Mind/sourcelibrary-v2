#!/usr/bin/env node
/**
 * Hide repeated page captures without renumbering (#5056, #7702).
 *
 * PRIOR ART: scripts/dedup-autoapply.mjs / dedup-apply-approved.mjs (#1721)
 * hide a duplicate by negating its page_number, which renumbers the book and
 * moves every shortlink and citation; scripts/maintenance/hide-efm-duplicates.mjs
 * hides whole BOOKS. Neither fits a page-level hide that keeps numbers and ids.
 *
 * Reads the pairs file from scripts/audit/page-repeat-images.mjs --rescore
 * (one JSON per pair: book, page, copyOf, pageId, copyOfId, verdict, ...),
 * takes verdict repeat|check only (never repeat-image-only or different), plans
 * each book with planBookRepeats (scripts/lib/repeat-captures.mjs) against the
 * CURRENT page docs, and on --apply sets on each hidden page:
 *
 *   repeat_of:      <id of the kept capture>
 *   repeat_of_meta: { by, at, issue: 5056, method, r, dice, run }
 *
 * Nothing is deleted or renumbered; the page's OCR, translation and image stay.
 * Every action is logged BEFORE it is written: a line in <out>/actions.jsonl
 * and a sweep_log row (recordSweepAction).
 *
 * Usage (dry run is the default):
 *   node --env-file=.env.production.local scripts/maintenance/hide-repeat-captures.mjs \
 *     --pairs scored-2026-10-29.jsonl.gz --out $JOB_SCRATCH/run1 [--books a,b|--books-file f] [--limit-books N] \
 *     [--apply] [--recount] [--revalidate]
 *
 * Undo (unsets both fields on pages this sweep hid; --books/--books-file required, --run narrows):
 *   ... hide-repeat-captures.mjs --undo --books a,b [--run <run id>] [--apply] [--recount]
 *
 * --recount runs recountBook per touched book. Leave it OFF until the code that
 * reads `repeat_of` is deployed: the 2-hourly reconciler still running the old
 * rule would only count the pages back.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { planBookRepeats } from '../lib/repeat-captures.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { recountBook } from '../lib/page-counts.mjs';

const SWEEP = 'hide-repeat-captures-5056';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = flag('apply');
const UNDO = flag('undo');
const RECOUNT = flag('recount');
const REVALIDATE = flag('revalidate');
const OUT = opt('out') || path.join(process.env.JOB_SCRATCH || '/tmp', `hide-repeat-captures-${Date.now()}`);
const RUN = opt('run') || `${SWEEP}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const HIDE_VERDICTS = new Set(['repeat', 'check']);

let bookFilter = null;
if (opt('books')) bookFilter = new Set(opt('books').split(',').map(s => s.trim()).filter(Boolean));
if (opt('books-file')) bookFilter = new Set(fs.readFileSync(opt('books-file'), 'utf8').split(/\s+/).filter(Boolean));
const LIMIT_BOOKS = opt('limit-books') ? Number(opt('limit-books')) : Infinity;

fs.mkdirSync(OUT, { recursive: true });
const actionsLog = path.join(OUT, 'actions.jsonl');
const logAction = (row) => fs.appendFileSync(actionsLog, JSON.stringify(row) + '\n');

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const pages = db.collection('pages');

async function revalidate(bookId) {
  const secret = process.env.REVALIDATE_SECRET || process.env.CRON_SECRET;
  if (!secret) throw new Error('REVALIDATE_SECRET/CRON_SECRET not set');
  for (let t = 1; t <= 4; t++) {
    const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${bookId}`, { method: 'POST', headers: { 'x-revalidate-secret': secret } });
    if (r.status !== 429) return r.status;
    await new Promise(res => setTimeout(res, t * 5000));
  }
  return 429;
}

async function afterBook(bookId) {
  if (!APPLY) return;
  if (RECOUNT) await recountBook(db, bookId, { reason: SWEEP });
  if (REVALIDATE) { console.log(`  revalidate ${bookId}: ${await revalidate(bookId)}`); await new Promise(r => setTimeout(r, 1000)); }
}

try {
  if (UNDO) {
    // Scoped by book: `repeat_of_meta` is unindexed, and an unscoped query walks every page.
    if (!bookFilter) throw new Error('--undo needs --books or --books-file (per-book, so the query uses the book_id index)');
    const q = { book_id: { $in: [...bookFilter] }, repeat_of: { $ne: null }, 'repeat_of_meta.issue': 5056, 'repeat_of_meta.by': `system:${SWEEP}` };
    if (opt('run')) q['repeat_of_meta.run'] = opt('run');
    const rows = await pages.find(q, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, repeat_of: 1, repeat_of_meta: 1 } }).toArray();
    const byBook = Map.groupBy(rows, r => r.book_id);
    console.log(`${APPLY ? 'UNDO' : 'DRY-RUN undo'}: ${rows.length} pages in ${byBook.size} books`);
    for (const [bookId, rs] of byBook) {
      for (const r of rs) {
        logAction({ action: 'unhide', book_id: bookId, page_id: r.id, page_number: r.page_number, was: { repeat_of: r.repeat_of, repeat_of_meta: r.repeat_of_meta }, apply: APPLY });
        if (APPLY) {
          await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'unhide-repeat-capture', detail: { page_id: r.id, page_number: r.page_number, was_repeat_of: r.repeat_of, run: RUN } });
          await pages.updateOne({ id: r.id, book_id: bookId }, { $unset: { repeat_of: '', repeat_of_meta: '' } });
        }
      }
      await afterBook(bookId);
    }
    console.log(`log: ${actionsLog}`);
  } else {
    const pairsPath = opt('pairs');
    if (!pairsPath) throw new Error('--pairs <file.jsonl[.gz]> is required');
    const raw = fs.readFileSync(pairsPath);
    const text = pairsPath.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    const pairs = text.split('\n').filter(Boolean).map(l => JSON.parse(l))
      .filter(r => r.type === 'pair' && HIDE_VERDICTS.has(r.verdict) && (!bookFilter || bookFilter.has(r.book) || bookFilter.has(r.slug)));
    const byBook = Map.groupBy(pairs, r => r.book);
    const bookIds = [...byBook.keys()].slice(0, LIMIT_BOOKS);
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} run=${RUN}: ${pairs.length} pairs (repeat|check) in ${byBook.size} books; planning ${bookIds.length}`);

    const summary = { books: 0, clusters: 0, hide: 0, done: 0, ambiguous_clusters: 0, ambiguous_pages: 0, skipped_pairs: 0, kept_later: 0 };
    const perBook = [];
    const ambiguousRows = [];
    for (const bookId of bookIds) {
      const bp = byBook.get(bookId);
      const ids = [...new Set(bp.flatMap(r => [r.pageId, r.copyOfId]))];
      const docs = await pages.find({ id: { $in: ids }, book_id: bookId }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, repeat_of: 1, 'ocr.data': 1 } }).toArray();
      const byId = new Map(docs.map(d => [d.id, d]));
      const { clusters, skipped } = planBookRepeats(bp, byId);

      // Nothing elsewhere in the book may already point at a page we are about to hide (no chains).
      const toHide = clusters.flatMap(c => c.hide.map(h => h.id));
      const pointing = toHide.length ? await pages.countDocuments({ book_id: bookId, repeat_of: { $in: toHide } }) : 0;
      if (pointing) throw new Error(`book ${bookId}: ${pointing} pages already point at a page this run would hide`);

      const pairOf = new Map(bp.map(r => [r.pageId, r]));
      const row = { book: bookId, slug: bp[0].slug, clusters: clusters.length, hide: 0, ambiguous: 0, done: 0, skipped: skipped.length };
      for (const c of clusters) {
        if (c.verdict === 'done') { row.done++; summary.done += c.members.length - 1; continue; }
        if (c.verdict === 'ambiguous') {
          row.ambiguous++; summary.ambiguous_clusters++; summary.ambiguous_pages += c.members.length - 1;
          ambiguousRows.push({ book: bookId, slug: bp[0].slug, why: c.why, members: c.members.map(m => ({ page: m.page_number, id: m.id, words: m.words, occlusion: m.occlusion })) });
          continue;
        }
        if (c.keep !== c.members[0].id) summary.kept_later++;
        for (const h of c.hide) {
          const pr = pairOf.get(h.id) || bp.find(r => r.copyOfId === h.id) || {};
          const meta = { by: `system:${SWEEP}`, at: new Date(), issue: 5056, method: 'thumb-r>=0.99+ocr-dice (page-repeat-images.mjs)', verdict: pr.verdict ?? null, r: pr.r ?? null, dice: pr.dice ?? null, kept_page: c.keep_page, keep_rule: c.why, run: RUN };
          logAction({ action: 'hide', book_id: bookId, page_id: h.id, page_number: h.page_number, repeat_of: c.keep, kept_page: c.keep_page, keep_rule: c.why, apply: APPLY });
          if (APPLY) {
            // Guarded: only a page that is still unhidden, and only while the kept page is itself unhidden.
            // Checked BEFORE the sweep_log row, so the log never records a hide that was not written.
            const kept = await pages.findOne({ id: c.keep, book_id: bookId, repeat_of: null, page_number: { $gt: 0 } }, { projection: { _id: 1 } });
            if (!kept) throw new Error(`book ${bookId}: kept page ${c.keep} is gone, soft-hidden or hidden; stopping`);
            await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'hide-repeat-capture', detail: { page_id: h.id, page_number: h.page_number, repeat_of: c.keep, kept_page: c.keep_page, keep_rule: c.why, run: RUN } });
            await pages.updateOne({ id: h.id, book_id: bookId, repeat_of: null }, { $set: { repeat_of: c.keep, repeat_of_meta: meta } });
          }
          row.hide++; summary.hide++;
        }
      }
      summary.books++; summary.clusters += clusters.length; summary.skipped_pairs += skipped.length;
      for (const s of skipped) logAction({ action: 'skip', book_id: bookId, ...s });
      perBook.push(row);
      if (row.hide) await afterBook(bookId);
    }

    fs.writeFileSync(path.join(OUT, 'per-book.json'), JSON.stringify(perBook, null, 1));
    fs.writeFileSync(path.join(OUT, 'ambiguous.jsonl'), ambiguousRows.map(r => JSON.stringify(r)).join('\n') + (ambiguousRows.length ? '\n' : ''));
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ run: RUN, apply: APPLY, ...summary }, null, 1));
    console.log(JSON.stringify(summary));
    console.log(`out: ${OUT}`);
  }
} finally {
  await client.close();
}

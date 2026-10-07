#!/usr/bin/env node
/**
 * Fit and store `pages.printed_page`: the page number printed on the leaf, fitted per book
 * (#4291). Dry run by default; the dry run IS the coverage measurement.
 *
 * PRIOR ART: scripts/lib/page-integrity.mjs — parsePageNum and the sequence fit behind
 * pageNumberBreaks are reused through fitPrintedPages (no second parser);
 * scripts/maintenance/backfill-script-type-4195.mjs — the lift-and-backfill shape (no
 * updated_at bump, sweep_log rows, resumable). That one walks pages by _id; this walks BOOKS,
 * because the fit needs a book's whole sequence, so its checkpoint is the per-book output file.
 *
 * Why: citations, get_quote and ?page=N speak scan index. On Fludd 6952dac977f38f6761bc6cb0
 * scan 219 is printed 217, and a scholar citing "p. 219" cites the wrong page. The OCR has
 * carried the printed number for months (<page-num> from prompt v4, the running head as the
 * first line before that) and nothing stored it.
 *
 * Per-book offset model, never one page's say-so: a page is labelled only when it sits in a run
 * of ≥ 3 numbers at one offset in a numbering whose adjacent pairs fit ≥ 75% (fitPrintedPages).
 * Pages without such a fit get NO field; the per-book sweep_log row counts them as skipped.
 *
 * Why the writer for NEW OCR is this script on a daily cron (--ocr-since=26h), not
 * liftOcrTags like script_type (#5629): liftOcrTags sees one page, and a printed number taken
 * from one page is exactly the per-page trust #4291 rules out. The fit needs the book's
 * sequence, which no per-page writer holds. One refit, after any lane, covers all 13 writers.
 *
 * Writes (only with --apply):
 *   - `$set: { printed_page: { label, numbering, rate, method, source?, run_len, fit_share,
 *     fitter, run, at } }` on labelled pages where the field is absent or was written by this
 *     fitter (`fitter` starts with FITTER_NAME). A value any other writer set is never touched.
 *   - `$unset: { printed_page }` on a page THIS fitter labelled before and no longer labels (a
 *     re-OCR changed the sequence). Same ownership filter.
 *   - NOT `updated_at`: sync-pages-content re-upserts every page whose updated_at moves, and
 *     citations read Mongo, not Supabase.
 *   - One `sweep_log` row per book with a fit, logged BEFORE that book's page writes.
 *
 * Resumable: every finished book appends one line to <out>/books.jsonl; a restart skips the
 * books already there. Kill it and run the same command again.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/backfill-printed-page-4291.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/backfill-printed-page-4291.mjs --apply
 *     [--books=id,id]       only these books (e.g. --books=6952dac977f38f6761bc6cb0)
 *     [--visible-only]      only visible books
 *     [--ocr-since=ISO|Nh]  only books with a page whose ocr.updated_at is that recent: the refit
 *                           that keeps new OCR covered (hetzner-crontab runs --ocr-since=26h daily)
 *     [--limit=N]           stop after N books this run
 *     [--concurrency=N]     books in flight (default 4)
 *     [--out=DIR]           default scripts/output/printed-page-4291[.dry]
 *     [--reset]             start a fresh output file
 *   node scripts/maintenance/backfill-printed-page-4291.mjs --summarize [--out=DIR]   → coverage table
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { fitPrintedPages } from '../lib/page-integrity.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

export const SWEEP = 'backfill-printed-page-4291';
export const FITTER_NAME = 'fitPrintedPages';
export const FITTER = `${FITTER_NAME}/v1`;

const args = process.argv.slice(2);
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const APPLY = args.includes('--apply');
// --ocr-since takes an ISO date or a relative "<N>h"; each refit run gets its own output file,
// or the books.jsonl of an earlier run would mark today's books as already done.
const SINCE = arg('ocr-since') && (/^\d+h$/.test(arg('ocr-since'))
  ? new Date(Date.now() - parseInt(arg('ocr-since'), 10) * 3600e3) : new Date(arg('ocr-since')));
const OUT = arg('out') || path.join('scripts/output', `printed-page-4291${APPLY ? '' : '.dry'}${SINCE ? `/refit-${new Date().toISOString().slice(0, 13)}` : ''}`);
const FILE = path.join(OUT, 'books.jsonl');

/** The page rows fitPrintedPages needs, with only the <page-num> tag or the OCR's first 300
 *  characters crossing the wire — never the full text of a book. */
export async function bookRows(db, bookId) {
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: bookId } },
    { $project: {
      _id: 1, p: '$page_number', type: '$page_type', pv: '$ocr.prompt_version', has: { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] },
      prior: '$printed_page',
      pn: { $regexFind: { input: { $ifNull: ['$ocr.data', ''] }, regex: '<page-num>[^<]{0,80}</page-num>', options: 'i' } },
      head: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 300] },
      // Tagged-vintage OCR anywhere in the text: its first line is never a running head.
      tags: { $regexMatch: { input: { $ifNull: ['$ocr.data', ''] }, regex: '<(page-type|language|header)\\b', options: 'i' } },
    } },
  ], { maxTimeMS: 300000 }).toArray();
  // Two docs at one page_number (a duplicate insert) make that scan position ambiguous: both
  // are left out of the fit and never written, so no label lands on the wrong doc.
  const seen = new Map();
  for (const r of rows) seen.set(r.p, (seen.get(r.p) || 0) + 1);
  return rows.filter((r) => r.p > 0).sort((a, b) => a.p - b.p)
    .map((r) => ({ _id: r._id, p: r.p, type: r.type, pv: r.pv, has: r.has, prior: r.prior, dup: seen.get(r.p) > 1,
      ocr: r.pn ? r.pn.match : r.tags ? '' : r.head }));
}

const ours = (prior) => typeof prior?.fitter === 'string' && prior.fitter.startsWith(FITTER_NAME);

/** The writes for one book: $set where labelled (absent or ours), $unset where ours and gone. */
export function planBook(rows, fit, { run, at }) {
  const ops = [];
  let foreign = 0;
  for (const r of rows) {
    if (r.dup) continue;
    const l = fit.labels.get(r.p);
    if (r.prior != null && !ours(r.prior)) { if (l) foreign++; continue; }
    if (l) {
      if (r.prior && r.prior.label === l.label && r.prior.method === l.method && r.prior.fitter === FITTER) continue;
      ops.push({ updateOne: {
        filter: { _id: r._id, $or: [{ printed_page: { $exists: false } }, { 'printed_page.fitter': { $regex: `^${FITTER_NAME}` } }] },
        update: { $set: { printed_page: { ...l, fitter: FITTER, run, at } } },
      } });
    } else if (r.prior) {
      ops.push({ updateOne: { filter: { _id: r._id, 'printed_page.fitter': { $regex: `^${FITTER_NAME}` } }, update: { $unset: { printed_page: '' } } } });
    }
  }
  return { ops, foreign };
}

/** Per-book coverage line: what the fit found, and by which prompt version the OCR was read. */
export function bookLine(book, rows, fit) {
  const ocr = rows.filter((r) => r.has);
  const pv = {};
  for (const r of ocr) { const k = r.pv || 'none'; pv[k] = (pv[k] || 0) + 1; }
  const dominant = Object.entries(pv).sort((a, b) => b[1] - a[1])[0]?.[0] || 'no-ocr';
  const by = { read_tag: 0, read_head: 0, interpolated: 0 };
  for (const l of fit.labels.values()) by[l.method === 'read' ? `read_${l.source}` : 'interpolated']++;
  const tagged = rows.filter((r) => /<page-num>/i.test(r.ocr || '')).length;
  return {
    book: book.id, visible: book.visible === true, pages: rows.length, ocr: ocr.length, pv: dominant,
    tagged, dup_page_number: rows.filter((r) => r.dup).length, judged: Object.values(fit.kinds).some((k) => k.judged), kinds: fit.kinds,
    labelled: fit.labels.size, ...by, skipped: fit.skipped,
    // A label at every 50th labelled scan, for spot checks and the positive control.
    sample: [...fit.labels].filter((_, i) => i % 50 === 25).slice(0, 4).map(([p, l]) => [p, l.label, l.method]),
  };
}

function summarize() {
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const table = {};
  const add = (k, b) => {
    const t = table[k] ||= { books: 0, books_fit: 0, ocr_pages: 0, tagged: 0, labelled: 0, read_tag: 0, read_head: 0, interpolated: 0, outlier: 0, short_run: 0, conflict: 0 };
    t.books++; if (b.judged) t.books_fit++;
    t.ocr_pages += b.ocr; t.tagged += b.tagged; t.labelled += b.labelled;
    t.read_tag += b.read_tag; t.read_head += b.read_head; t.interpolated += b.interpolated;
    for (const s of ['outlier', 'short_run', 'conflict']) t[s] += b.skipped[s];
  };
  for (const b of lines) {
    if (!b.ocr) continue;
    add(`${b.visible ? 'visible' : 'hidden'} · ${b.pv}`, b);
    add(b.visible ? 'visible · ALL' : 'hidden · ALL', b);
  }
  const rows = Object.entries(table).sort((a, b) => b[1].books - a[1].books);
  console.log('| books · OCR prompt version | books | consistent fit | OCR pages | labelled | from tag | from head | interpolated | skipped: outlier / short run / conflict |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [k, t] of rows) {
    const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '—';
    console.log(`| ${k} | ${t.books} | ${t.books_fit} (${pct(t.books_fit, t.books)}) | ${t.ocr_pages} | ${t.labelled} (${pct(t.labelled, t.ocr_pages)}) | ${t.read_tag} | ${t.read_head} | ${t.interpolated} | ${t.outlier} / ${t.short_run} / ${t.conflict} |`);
  }
  console.log(`\n${lines.length} books walked (${lines.filter((b) => !b.ocr).length} with no OCR).`);
}

async function main() {
  if (args.includes('--summarize')) return summarize();
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set — run with --env-file=.env.production.local');
  fs.mkdirSync(OUT, { recursive: true });
  if (args.includes('--reset') && fs.existsSync(FILE)) fs.renameSync(FILE, `${FILE}.${Date.now()}.bak`);
  const done = new Set(fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book) : []);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const run = `${SWEEP}@${new Date().toISOString()}`;
  try {
    const q = { pages_count: { $gt: 0 } };
    if (args.includes('--visible-only')) q.visible = true;
    if (arg('books')) q.id = { $in: arg('books').split(',') };
    let ids = (await db.collection('books').find(q, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id).filter(Boolean);
    if (SINCE) {
      if (Number.isNaN(SINCE.getTime())) throw new Error(`--ocr-since: not a date or <N>h: ${arg('ocr-since')}`);
      const since = await db.collection('pages').distinct('book_id', { 'ocr.updated_at': { $gte: SINCE } });
      const s = new Set(since);
      ids = ids.filter((id) => s.has(id));
    }
    ids = ids.sort().filter((id) => !done.has(id));
    const LIMIT = Number(arg('limit') || 0);
    if (LIMIT) ids = ids.slice(0, LIMIT);
    console.log(`${SWEEP} — ${APPLY ? 'APPLY' : 'DRY RUN'} — ${ids.length} books to walk (${done.size} already in ${FILE})`);

    const tot = { errors: 0, books: 0, fit: 0, labelled: 0, set: 0, unset: 0, written: 0, raced: 0, foreign: 0 };
    const started = Date.now();
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try { await one(id); } catch (e) {
          // Not appended to books.jsonl, so a rerun retries it.
          tot.errors++;
          fs.appendFileSync(path.join(OUT, 'errors.jsonl'), JSON.stringify({ book: id, error: String(e.message).slice(0, 300) }) + '\n');
        }
      }
    };
    const one = async (id) => {
      const book = await db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, visible: 1 } });
      const rows = await bookRows(db, id);
      const fit = fitPrintedPages(rows.filter((r) => !r.dup), { head: true });
      const line = bookLine(book, rows, fit);
      const { ops, foreign } = planBook(rows, fit, { run, at: new Date() });
      const sets = ops.filter((o) => o.updateOne.update.$set).length;
      line.plan = { set: sets, unset: ops.length - sets, foreign };
      if (APPLY && ops.length) {
        // Log before writing: a crash between the two leaves a row naming writes that may not
        // have landed, never writes nobody recorded.
        await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: 'printed-page-fitted', detail: {
          issue: 4291, run, labelled: line.labelled, read_tag: line.read_tag, read_head: line.read_head,
          interpolated: line.interpolated, skipped: line.skipped, set: sets, unset: ops.length - sets, kinds: fit.kinds,
        } });
        const res = await db.collection('pages').bulkWrite(ops, { ordered: false });
        line.written = res.modifiedCount;
        line.raced = ops.length - res.matchedCount;
        tot.written += res.modifiedCount; tot.raced += line.raced;
      }
      fs.appendFileSync(FILE, JSON.stringify(line) + '\n');
      tot.books++; if (line.judged) tot.fit++; tot.labelled += line.labelled; tot.set += sets; tot.unset += ops.length - sets; tot.foreign += foreign;
      if (tot.books % 500 === 0) {
        console.log(`  ${tot.books}/${ids.length} books (${(tot.books / ((Date.now() - started) / 1000)).toFixed(1)}/s) · fit ${tot.fit} · labelled ${tot.labelled}${APPLY ? ` · written ${tot.written} · raced ${tot.raced}` : ` · would set ${tot.set}`}`);
      }
    };
    await Promise.all(Array.from({ length: Number(arg('concurrency') || 4) }, worker));
    console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', run, ...tot, out: FILE }, null, 2));
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

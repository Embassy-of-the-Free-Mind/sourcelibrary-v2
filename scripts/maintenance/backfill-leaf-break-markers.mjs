#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/apply-reocr-verdicts.mjs — wrote these pages and owns the guard
// shape copied here (human-edit filter in the update, revision snapshot first, sweep_log row per
// book); it reads verdict files and knows nothing about leaves, and it has already run — the
// pages are served. Its --leaf-ledger option (added with this script) marks seams on FUTURE
// applies; this script marks the ones already on the page. scripts/split-book.mjs — splits stored
// text on <page-break/> into separate page documents, the opposite operation.
// scripts/lib/leaf-break.mjs insertLeafBreaks — places the seam; this file only walks Mongo.
/**
 * Backfill `<leaf-break/>` into the served per-leaf Yigdzin pages (#5260, from #4523).
 *
 * WHAT. The EAP two-leaf (and three- and four-leaf) frames of the Tibetan cohort were read one
 * leaf at a time (yigdzin-leaf-2026-09-25) and the leaf reads were concatenated upper-then-lower
 * into one `ocr.data`. The leaves are not continuous — on these frames each carries a recto folio
 * label — and the 2026-09-29 translation pilot found the translator bridging the seam. This puts
 * a `<leaf-break/>` line at each seam so the translator (translate-core) and the reader
 * (NotesRenderer) can see it. CPU only; no model is called.
 *
 * WHERE THE SEAM COMES FROM. The per-leaf run's ledger (`leaf-run-logs/pages.jsonl` on Hetzner,
 * one row per page: `leaf: [{ lines, syl, fin }, …]`) records how many lines each leaf read
 * produced. The raw leaf read (`txt-yigdzin-leaf/<book>_<page5>.txt`) is those reads joined by
 * newlines; the served text (`ocr.data`) is the raw read with the acceptance rule's stripped
 * lines removed (leaf_v4: non-Tibetan filler). insertLeafBreaks maps the seam through the raw
 * read onto the served text line by line. A page whose seam cannot be placed is recorded with the
 * reason and left as it is.
 *
 * WHAT THIS WRITE ACTUATES (CLAUDE.md: a write to a store an automated job reads). The update
 * stamps `ocr.updated_at` (every writer of OCR text must — tests/unit/ocr-write-stamps-updated-at),
 * which makes any translation of the unmarked text STALE (stale-translation.mjs). These pages'
 * `ocr.pipeline` is `reocr_bdrc_4523`, a WITHHOLD lane, so the hourly
 * withhold-stale-translations sweep (crontab :20) takes those translations off the page within
 * the hour. That is the intended effect — they bridged the seams — and it is small: the cohort's
 * books are HELD, so no lane re-translates anything until a book is released into an envelope.
 * Say the counts in the report.
 *
 * Idempotent: a page already carrying the marker is skipped; the update filters on the exact
 * text read, so a page rewritten by anyone between read and write is skipped, not clobbered.
 * Reversible: the old text is in page_revisions (reason 'leaf-break-5260') before any write.
 *
 * Run on Hetzner (the ledger and the leaf reads live there). Default is DRY RUN.
 *
 *   node --env-file=.env.production.local scripts/maintenance/backfill-leaf-break-markers.mjs \
 *     --ledger=/root/tibetan-reocr/leaf-run-logs/pages.jsonl \
 *     --leafdir=/root/tibetan-reocr/txt-yigdzin-leaf [--book=<id>] [--limit=N] [--apply]
 *
 * --page-mode (#5320) walks the pages that still serve the PAGE-mode read but have a multi-leaf ledger row
 * (their leaf read was rejected by the acceptance rule, so it sits in txt-yigdzin-leaf unserved). The seam is
 * placed by aligning the page read to that leaf read (insertLeafBreaksByAlignment), and a page it cannot place
 * unambiguously is left unmarked with its reason. Revision reason `leaf-break-5320-page-mode`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { insertLeafBreaks, insertLeafBreaksByAlignment, foreignTags, countLeafBreaks, LEAF_BREAK } from '../lib/leaf-break.mjs';

const ARG = (n, d) => { const a = process.argv.find((x) => x.startsWith(`${n}=`)); return a ? a.slice(n.length + 1) : d; };
const APPLY = process.argv.includes('--apply');
const LEDGER = ARG('--ledger', null);
const LEAFDIR = ARG('--leafdir', null);
const ONLY_BOOK = ARG('--book', null);
const LIMIT = Number(ARG('--limit', 0)) || 0;
// --page-mode (#5320): the pages that still serve the PAGE-mode read (the leaf read was rejected or never
// applied) but have a multi-leaf ledger row and a leaf read on disk. The seam is placed by aligning the page
// read to the leaf read line by line (insertLeafBreaksByAlignment), never by cutting at the ledger's counts.
const PAGE_MODE = process.argv.includes('--page-mode');
const REPORT = ARG('--report', `scripts/output/leaf-break-backfill${process.argv.includes('--page-mode') ? '-page-mode' : ''}-${new Date().toISOString().slice(0, 10)}${APPLY ? '' : '.dry'}.jsonl`);
if (!LEDGER || !LEAFDIR) { console.error('--ledger=<pages.jsonl> and --leafdir=<txt-yigdzin-leaf> are required'); process.exit(1); }

const ISSUE = PAGE_MODE ? 5320 : 5260;
const REASON = PAGE_MODE ? 'leaf-break-5320-page-mode' : 'leaf-break-5260';   // page_revisions reason + sweep name
const RUN = `leaf-break-backfill${PAGE_MODE ? '-page-mode' : ''}-${new Date().toISOString().slice(0, 10)}`;
const MODEL = 'bdrc-yigdzin-v1';
const LEAF_RUN = 'yigdzin-leaf-2026-09-25';
const HUMAN_GUARD = { 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } };

// ── The ledger: stem → per-leaf line counts, multi-leaf rows only ──
const ledger = new Map();
let ledgerRows = 0, singleLeaf = 0;
for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
  if (!line.startsWith('{')) continue;
  const r = JSON.parse(line);
  ledgerRows++;
  if (Array.isArray(r.leaf) && r.leaf.length >= 2) ledger.set(r.id, r.leaf.map((l) => l.lines));
  else singleLeaf++;
}
console.log(`ledger: ${ledgerRows} rows, ${ledger.size} multi-leaf, ${singleLeaf} single-leaf or unsplit`);

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);

// Books come from the ledger (the only pages that can have a seam), narrowed by --book.
const books = [...new Set([...ledger.keys()].map((s) => s.split('_')[0]))].filter((b) => !ONLY_BOOK || b === ONLY_BOOK).sort();
console.log(`${books.length} books to walk${LIMIT ? `, stopping after ${LIMIT} candidate pages` : ''}${APPLY ? ' — APPLY' : ' — dry run'}`);

const totals = { candidates: 0, marked: 0, written: 0, raced: 0, books: 0, reasons: {} };
const reason = (k) => { totals.reasons[k] = (totals.reasons[k] || 0) + 1; };
const examples = [];
let stop = false;

for (const bookId of books) {
  if (stop) break;
  // The served leaf reads of this book: this model, this run, read per leaf, not withheld, not a
  // human's, not yet marked. `ocr.data` is the whole text — it is what the seam goes into.
  const pages = await db.collection('pages').find(
    PAGE_MODE
      ? { book_id: bookId, 'ocr.model': MODEL, 'ocr.engine.read_mode': 'page', 'ocr.unreadable': { $ne: true }, ...HUMAN_GUARD }
      : { book_id: bookId, 'ocr.model': MODEL, 'ocr.engine.read_mode': 'leaf', 'ocr.engine.run': LEAF_RUN, 'ocr.unreadable': { $ne: true }, ...HUMAN_GUARD },
    { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.content_hash': 1 } },
  ).sort({ page_number: 1 }).toArray();

  const plan = [];
  for (const p of pages) {
    const stem = `${bookId}_${String(p.page_number).padStart(5, '0')}`;
    const leafLines = ledger.get(stem);
    if (!leafLines) continue;                                   // single-leaf page: nothing to mark
    if (LIMIT && totals.candidates >= LIMIT) { stop = true; break; }
    totals.candidates++;
    const served = p.ocr?.data || '';
    if (countLeafBreaks(served)) { reason('already-marked'); continue; }
    const rawFile = path.join(LEAFDIR, `${stem}.txt`);
    if (!fs.existsSync(rawFile)) { reason('no-raw-leaf-file'); rec({ book: bookId, page: p.page_number, status: 'no-raw-leaf-file' }); continue; }
    const raw = fs.readFileSync(rawFile, 'utf8').trim();
    const r = PAGE_MODE ? insertLeafBreaksByAlignment({ served, leafRead: raw, leafLines }) : insertLeafBreaks({ served, raw, leafLines });
    if (!r.text) { reason(r.reason); rec({ book: bookId, page: p.page_number, status: r.reason, detail: r }); continue; }
    const foreign = foreignTags(r.text);
    if (foreign.length) { reason('foreign-tags'); rec({ book: bookId, page: p.page_number, status: 'foreign-tags', tags: foreign.slice(0, 5) }); continue; }
    // The hash on the page should be the hash of the text on the page; report a drift, do not act on it.
    const hashOk = !p.ocr?.content_hash || p.ocr.content_hash === contentHash(served);
    plan.push({ page: p, served, text: r.text, seams: r.seams, leafLines, hashOk });
    if (PAGE_MODE) {
      // Where a cut at the ledger's counts would have put the seams, for the report: the page-mode path exists
      // because the two differ on some pages.
      const countCut = leafLines.slice(0, -1).map((_, k) => leafLines.slice(0, k + 1).reduce((a, b) => a + b, 0));
      rec({ book: bookId, page: p.page_number, status: 'marked', seams: r.seams, count_cut: countCut, differs: JSON.stringify(countCut) !== JSON.stringify(r.seams), matched: r.matched, lines: r.lines });
    }
    totals.marked++;
    reason(`marked:${leafLines.length}-leaves`);
    if (examples.length < 3) {
      const lines = served.split('\n');
      examples.push({ book: bookId, page: p.page_number, leafLines, seams: r.seams, servedLines: lines.length,
        around: r.seams.map((s) => ({ before: `${lines[s - 1].slice(0, 40)}… (${lines[s - 1].length} chars)`, after: `${lines[s].slice(0, 40)}… (${lines[s].length} chars)` })) });
    }
  }
  if (!plan.length) continue;
  totals.books++;

  if (!APPLY) {
    rec({ book: bookId, status: 'dry-run', pages: plan.length, seams: plan.reduce((n, x) => n + x.seams.length, 0), hash_drift: plan.filter((x) => !x.hashOk).length });
    continue;
  }

  // Snapshot every old text first; abort the book if the count does not match.
  const ids = plan.map((x) => x.page.id);
  const n = await saveRevisionsBeforeOverwrite(db, ids, 'ocr', { reason: REASON, keepMeta: true });
  if (n !== ids.length) { rec({ book: bookId, status: 'ABORT-revision-mismatch', want: ids.length, got: n }); console.error(`ABORT ${bookId}: revisions ${n} != ${ids.length}`); continue; }

  const now = new Date();
  let written = 0;
  for (const x of plan) {
    // Filter on the exact text read: a page anyone rewrote in between is skipped, never clobbered.
    const res = await db.collection('pages').updateOne(
      { id: x.page.id, 'ocr.data': x.served, ...HUMAN_GUARD },
      {
        $set: {
          'ocr.data': x.text,
          'ocr.content_hash': contentHash(x.text),
          'ocr.updated_at': now,
          // Provenance of the seam, inside the engine block that describes this text.
          'ocr.engine.leaf_seams': { marker: LEAF_BREAK, count: x.seams.length, at_lines: x.seams, leaf_lines: x.leafLines, source: PAGE_MODE ? `page-mode read aligned line by line to the per-leaf read (${LEAFDIR}, ${LEDGER})` : `${LEDGER} per-leaf line counts, mapped through ${LEAFDIR}`, issue: ISSUE, run: RUN, at: now },
          updated_at: now,
        },
      },
    );
    if (res.modifiedCount === 1) written++;
    else { totals.raced++; rec({ book: bookId, page: x.page.page_number, status: 'SKIP-guard-at-write' }); }
  }
  totals.written += written;
  await recordSweepAction(db, { sweep: REASON, book_id: bookId, action: 'leaf-break-marked', detail: { issue: ISSUE, run: RUN, pages: written, planned: plan.length, revisions: n } });
  rec({ book: bookId, status: 'applied', pages: written, planned: plan.length });
  if (totals.books % 50 === 0) console.log(`  ${totals.books} books, ${totals.written} pages written`);
}

report.end();
await mongo.close();
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...totals, report: REPORT }, null, 1));
if (examples.length) console.log('examples:', JSON.stringify(examples, null, 1));
if (!APPLY) console.log(`\nDry run. ${totals.marked} pages would get a marker. Re-run with --apply to write.`);

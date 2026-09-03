#!/usr/bin/env node
/**
 * Apply the Tibetan re-OCR adjudication (#4523/#4534) to production pages.
 *
 * Consumes a verdicts JSONL (from the eval-side adjudicator: one row per page,
 * {book, page, verdict, reason}) plus the new OCR text files, and for each page:
 *
 *   SERVE            snapshot the old ocr to page_revisions (reason
 *                    'reocr_bdrc_4523'), write the new text with provenance,
 *                    and CLEAR any prior `ocr.unreadable` flag.
 *   MARK_UNRELIABLE  set `ocr.unreadable = true` + reason. The reader then shows
 *                    the scan as authoritative and an honest "not reliably
 *                    legible" notice instead of serving the text. The existing
 *                    `ocr.data` (often the old fabricated read) is RETAINED for
 *                    provenance but no longer rendered or counted.
 *   TEXTLESS         leave the page untouched (cover / blank / divider).
 *
 * Reversible: SERVE snapshots before overwrite; MARK only sets flags and never
 * destroys text. Every action recorded in a report. Read the new-text files
 * from --textdir (one <book>_<page5>.txt per SERVE page).
 *
 * Run on Hetzner. Default is DRY RUN; pass --apply to write.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/apply-reocr-verdicts.mjs \
 *     --verdicts /root/tibetan-reocr/verdicts.jsonl --textdir /root/tibetan-reocr/txt-wood \
 *     [--book <id>] [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=')[1] ?? d;
const APPLY = process.argv.includes('--apply');
const VERDICTS = ARG('--verdicts', null);
const TEXTDIR = ARG('--textdir', null);
const ONLY_BOOK = ARG('--book', null);
const REASON = ARG('--reason', 'reocr_bdrc_4523');
const REPORT = ARG('--report', `scripts/output/apply-verdicts-${new Date().toISOString().slice(0, 10)}.jsonl`);
if (!VERDICTS || !TEXTDIR) { console.error('--verdicts and --textdir required'); process.exit(1); }

const MODEL = 'bdrc-woodblock-easter2';
const MIN_SYL = 20;

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);

const rows = fs.readFileSync(VERDICTS, 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l))
  .filter((r) => !ONLY_BOOK || r.book === ONLY_BOOK);

// Group by book so revision snapshots batch and counter resync runs once each.
const byBook = new Map();
for (const r of rows) { if (!byBook.has(r.book)) byBook.set(r.book, []); byBook.get(r.book).push(r); }

const totals = { serve: 0, mark: 0, textless: 0, skipped: 0, books: 0 };
for (const [bookId, verdicts] of byBook) {
  const pageDocs = await db.collection('pages')
    .find({ book_id: bookId }, { projection: { id: 1, page_number: 1, ocr: 1 } })
    .toArray();
  const byNum = new Map(pageDocs.map((p) => [p.page_number, p]));

  const serveIds = [];
  const servePlan = [];
  const markOps = [];
  for (const v of verdicts) {
    const p = byNum.get(v.page);
    if (!p) { totals.skipped++; rec({ book: bookId, page: v.page, status: 'no-page-doc' }); continue; }
    if (v.verdict === 'TEXTLESS') { totals.textless++; continue; }
    if (v.verdict === 'MARK_UNRELIABLE') {
      markOps.push(p);
      totals.mark++;
      continue;
    }
    // SERVE
    const f = path.join(TEXTDIR, `${bookId}_${String(v.page).padStart(5, '0')}.txt`);
    if (!fs.existsSync(f)) { totals.skipped++; rec({ book: bookId, page: v.page, status: 'serve-no-text-file' }); continue; }
    const text = fs.readFileSync(f, 'utf8').trim();
    if (text.split('་').length < MIN_SYL) { totals.skipped++; rec({ book: bookId, page: v.page, status: 'serve-too-short' }); continue; }
    if (p.ocr?.data) serveIds.push(p.id);
    servePlan.push({ page: p, text });
  }

  if (!APPLY) {
    totals.serve += servePlan.length;
    rec({ book: bookId, status: 'dry-run', serve: servePlan.length, mark: markOps.length });
    continue;
  }

  // SERVE: version old text, then write new with provenance + clear unreadable.
  if (serveIds.length) {
    const n = await saveRevisionsBeforeOverwrite(db, serveIds, 'ocr', { reason: REASON });
    if (n !== serveIds.length) {
      rec({ book: bookId, status: 'ABORT-revision-mismatch', want: serveIds.length, got: n });
      console.error(`ABORT ${bookId}: revisions ${n} != ${serveIds.length}`);
      continue;
    }
  }
  for (const { page, text } of servePlan) {
    await db.collection('pages').updateOne({ id: page.id }, {
      $set: {
        'ocr.data': text, 'ocr.language': 'Tibetan', 'ocr.model': MODEL,
        'ocr.source': 'ai', 'ocr.pipeline': REASON, 'ocr.updated_at': new Date(),
        updated_at: new Date(),
      },
      $unset: { 'ocr.unreadable': '', 'ocr.unreadable_reason': '' },
    });
    totals.serve++;
  }

  // MARK: flag unreadable; retain existing ocr.data for provenance.
  for (const p of markOps) {
    await db.collection('pages').updateOne({ id: p.id }, {
      $set: { 'ocr.unreadable': true, 'ocr.unreadable_reason': REASON, updated_at: new Date() },
    });
  }
  await db.collection('books').updateOne({ id: bookId }, { $set: { updated_at: new Date() } });
  totals.books++;
  rec({ book: bookId, status: 'applied', serve: servePlan.length, mark: markOps.length });
}

console.log(JSON.stringify(totals));
rec({ status: 'run-summary', ...totals });
report.end();
await mongo.close();

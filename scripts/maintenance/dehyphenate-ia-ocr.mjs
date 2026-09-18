#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/backfill-ia-ocr-provenance.mjs (same population, same per-book
 * drive off `book_events`; it sets a provenance block and never touches `ocr.data`). No other
 * sweep rewrites page text in place — the closest, reset-book-ocr.mjs, CLEARS text for a paid
 * re-run. The rule itself is scripts/lib/dehyphenate.mjs (shared with the ingester).
 *
 * dehyphenate-ia-ocr — apply the #4780 line-break dehyphenation to the Internet Archive OCR
 * pages already written by scripts/import/ia-ocr-ingest.mjs (`ocr.source: 'ia_djvu'`).
 *
 * WHAT IT WRITES. `ocr.data` only (plus `ocr.updated_at` / `updated_at`), and only where the rule
 * changes the text. This IS an overwrite of page text, so every changed page's current text is
 * saved to `page_revisions` first (`reason: 'ia_ocr_dehyphenate'`, `source: 'ia_djvu'`) — the raw
 * leaf stays recoverable. One `sweep_log` row per book (field-sprawl.md: a sweep records a ROW).
 *
 * SAFETY. The update matches on the exact current text (`ocr.data: <old>`) and on
 * `ocr.source: 'ia_djvu'`, so a page another job rewrote between read and write is skipped and
 * counted, never clobbered. Idempotent: a second run finds nothing to change — run it dry again
 * after --apply and expect `pages_changed: 0`.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   node --env-file=.env.production.local scripts/maintenance/dehyphenate-ia-ocr.mjs
 *   node --env-file=.env.production.local scripts/maintenance/dehyphenate-ia-ocr.mjs --apply --progress <file.jsonl>
 * Options: --limit N  --book <id>  --progress <jsonl> (one line per book; re-runs skip books already there)
 *          --sample N (dry: print N example joins per book)
 * Runs anywhere with Atlas access (no archive.org calls); the 144K-page apply ran on Hetzner, detached.
 */
import fs from 'node:fs';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { dehyphenateLineBreaks, countLineBreakHyphens } from '../lib/dehyphenate.mjs';
import { markStaleAfterOcrWrite } from '../lib/translation-source.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const LIMIT = +arg('--limit', 1000000);
const BOOK = arg('--book', null);
const PROGRESS = arg('--progress', null);
const SAMPLE = +arg('--sample', 0);
const SOURCE = 'ia_djvu';
const SWEEP = 'ia-ocr-dehyphenate-2026-09';

const done = new Set();
if (PROGRESS && fs.existsSync(PROGRESS)) {
  for (const line of fs.readFileSync(PROGRESS, 'utf8').split('\n')) { if (!line.trim()) continue; try { done.add(JSON.parse(line).book_id); } catch { /* partial line */ } }
}

await withMongo(async (db) => {
  const P = db.collection('pages');
  // Drive from book_events — `ocr.source` is unindexed; a corpus scan on it times out.
  const evMatch = { type: 'ia_ocr_ingest' }; if (BOOK) evMatch.book_id = BOOK;
  const bookIds = (await db.collection('book_events').distinct('book_id', evMatch)).filter((b) => !done.has(b)).slice(0, LIMIT);
  console.log(`${bookIds.length} ingested books to check (${done.size} already in progress file) — ${APPLY ? 'APPLY' : 'dry run'}`);

  const totals = { books: 0, pages_scanned: 0, pages_changed: 0, joins: 0, not_matched: 0, revisions: 0 };
  let i = 0;
  for (const bid of bookIds) {
    i++;
    const pages = await P.find({ book_id: bid, 'ocr.source': SOURCE }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
    const changes = [];
    let joins = 0;
    for (const p of pages) {
      const old = p.ocr?.data; if (!old) continue;
      const n = countLineBreakHyphens(old); if (!n) continue;
      const neu = dehyphenateLineBreaks(old);
      if (neu === old) continue;
      joins += n; changes.push({ p, old, neu, n });
    }
    totals.books++; totals.pages_scanned += pages.length; totals.joins += joins;
    const row = { book_id: bid, pages_scanned: pages.length, pages_changed: changes.length, joins, at: new Date().toISOString() };
    if (!APPLY) {
      totals.pages_changed += changes.length;
      if (SAMPLE && changes.length) {
        const ex = [];
        for (const c of changes.slice(0, SAMPLE)) { const m = c.old.match(/\S+[-‐­][ \t]*\n[ \t]*\p{Ll}\S*/u); if (m) ex.push(`p${c.p.page_number}: ${JSON.stringify(m[0])} → ${JSON.stringify(dehyphenateLineBreaks(m[0]))}`); }
        console.log(`  ${bid}: ${changes.length}/${pages.length} pages, ${joins} joins\n    ${ex.join('\n    ')}`);
      }
      if (i % 50 === 0) console.log(`  … ${i}/${bookIds.length} books, ${totals.pages_changed} pages would change`);
      continue;
    }
    if (changes.length) {
      // Revisions FIRST (doctrine): the raw leaf text must survive the overwrite.
      const rev = await saveRevisionsBeforeOverwrite(db, changes.map((c) => c.p.id), 'ocr', { reason: 'ia_ocr_dehyphenate' });
      totals.revisions += rev;
      if (rev < changes.length) console.log(`  ${bid}: saved ${rev} revisions for ${changes.length} pages — check page_revisions before trusting this book's rollback`);
      const now = new Date();
      const r = await P.bulkWrite(changes.map((c) => ({ updateOne: {
        filter: { _id: c.p._id, 'ocr.source': SOURCE, 'ocr.data': c.old },
        update: { $set: { 'ocr.data': c.neu, 'ocr.updated_at': now, updated_at: now } },
      } })), { ordered: false });
      // #4927: a translation made from the hyphenated text is now of text the page no longer holds.
      await markStaleAfterOcrWrite(db, changes.map((c) => ({ _id: c.p._id, text: c.neu })), { lane: 'dehyphenate-ia-ocr', now });
      const modified = r.modifiedCount;
      row.pages_changed = modified; row.not_matched = changes.length - modified; row.revisions = rev;
      totals.pages_changed += modified; totals.not_matched += changes.length - modified;
      await recordSweepAction(db, { sweep: SWEEP, book_id: bid, action: 'dehyphenated', detail: { pages_scanned: pages.length, pages_changed: modified, joins, not_matched: changes.length - modified, revisions: rev } });
    }
    if (PROGRESS) fs.appendFileSync(PROGRESS, JSON.stringify(row) + '\n');
    if (i % 25 === 0 || changes.length > 400) console.log(`  ${i}/${bookIds.length} ${bid}: ${row.pages_changed}/${pages.length} pages, ${joins} joins`);
  }
  console.log(JSON.stringify({ ...totals, applied: APPLY }));
}, { timeoutMs: 4 * 60 * 60 * 1000 });

#!/usr/bin/env node
/**
 * OCR trust gate — size the strata ($0, read-only, exact counts, no $sample). #5700.
 *
 * PRIOR ART: scripts/eval/quality-census-draw.mjs + quality-census-score.mjs (#5707) — one
 * SAMPLED page per translated book, strata by language × period; it estimates served defects and
 * cannot count what is still UNTRANSLATED per book. scripts/eval/translation-vs-reference/t2/census.mjs
 * lists Greek books for a draw. Neither counts pending pages for the gate's strata, so this does,
 * with the gate's own classifier (scripts/lib/ocr-trust-gate.mjs) so the census and the gate
 * cannot disagree about which book is in which row.
 *
 * For every live book (visible, pages_count > 0) whose first language label a table row could
 * match: its row, its pages not yet translated (translatablePageFilter + no translation — the
 * Mongo cut selectPages starts from; the per-page text re-check can only lower it), whether
 * enrol-auto would pick it today, and the readers that produced its OCR. Plus the open chained
 * runs on books in each row.
 *
 * Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-trust-gate-census.mjs
 *        [--out=scripts/eval/results/ocr-trust-gate-2026-10]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { translatablePageFilter } from '../lib/translate-core.mjs';
import { OCR_TRUST_TABLE, ocrTrustStratum, ocrTrustVerdict, bookHand, editionYear, isReread } from '../lib/ocr-trust-gate.mjs';
import { RUNS_COLLECTION } from '../lib/translate-batch-seam.mjs';
import { AUTO_STATUSES, TERMINAL_PHASES } from '../lib/translate-batch-chained.mjs';

const OUT = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] || 'scripts/eval/results/ocr-trust-gate-2026-10';
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const books = await db.collection('books').find(
  { visible: true, pages_count: { $gt: 0 }, $or: OCR_TRUST_TABLE.map((r) => ({ language: r.language })) },
  { projection: { _id: 0, id: 1, title: 1, language: 1, year: 1, published: 1, pages_count: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1, pipeline_auto: 1, processing_priority: 1, needs_splitting: 1, split_completed: 1 } },
).toArray();
// A row with a year window cannot take a book outside it, whatever its pages say: read pages only
// for books some row could still take (15.9K live Latin books; the incunabula are a fraction).
const couldMatch = (b) => OCR_TRUST_TABLE.some((r) => r.language.test(String(b.language ?? ''))
  && (r.yearFrom == null || (editionYear(b) != null && editionYear(b) >= r.yearFrom && editionYear(b) <= r.yearTo)))
  || /greek/i.test(String(b.language));   // every Greek book, for the negative controls
const skipped = books.filter((b) => !couldMatch(b)).length;
const todo = books.filter(couldMatch);
console.error(`${books.length} live books in a table language; ${todo.length} read page by page (${skipped} outside every row's year window)`);

const tf = translatablePageFilter();
const skipTypes = new Set(tf.page_type.$nin);
const isPending = (p) => p.page_number > 0 && typeof p.ocr?.has === 'boolean' && p.ocr.has && p.ocr.unreadable !== true
  && !skipTypes.has(p.page_type) && !p.tr_blocked && !p.tr_has;

// What enrol-auto's Mongo cut (selectAutoCandidates) accepts, minus its run-history exclusions.
function autoEligible(b) {
  if (!AUTO_STATUSES.includes(b.pipeline_auto?.status)) return false;
  if (b.pipeline_auto?.hold) return false;
  if (!(b.pages_ocr > 0)) return false;
  if (b.needs_splitting === true && b.split_completed !== true) return false;
  const denom = (b.pages_ocr || 0) - (b.pages_blank || 0);
  if (!(denom > 0)) return false;
  if ((b.pages_translated || 0) / denom >= 0.9) return false;
  return b.pages_ocr >= 0.9 * (b.pages_count || 0);
}

const rows = [];
let done = 0;
for (const b of todo) {
  const profile = { handwritten: 0, printed: 0, mixed: 0, ocr: 0, reread: {} };
  const readers = {};
  let pending = 0, translated = 0, pages = 0;
  const cur = db.collection('pages').aggregate([
    { $match: { book_id: b.id } },
    { $project: {
      _id: 0, page_number: 1, page_type: 1, script_type: 1,
      'ocr.model': 1, 'ocr.source': 1, 'ocr.pipeline': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1,
      'ocr.has': { $gt: [{ $strLenCP: { $ifNull: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, ''] } }, 0] },
      tr_has: { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''] } }, 0] },
      tr_blocked: { $or: [{ $eq: ['$translation.recitation_blocked', true] }, { $eq: ['$translation.safety_blocked', true] }, { $ne: [{ $type: '$translation.health_blocked' }, 'missing'] }] },
    } },
  ]);
  for await (const p of cur) {
    pages += 1;
    if (['handwritten', 'printed', 'mixed'].includes(p.script_type)) profile[p.script_type] += 1;
    if (p.tr_has) translated += 1;
    if (p.ocr?.has && p.page_number > 0 && p.ocr.unreadable !== true) {
      profile.ocr += 1;
      const k = p.ocr.model || p.ocr.source || 'unstamped';
      readers[k] = (readers[k] || 0) + 1;
      for (const r of OCR_TRUST_TABLE) if (isReread(p, r)) profile.reread[r.id] = (profile.reread[r.id] || 0) + 1;
    }
    if (isPending(p)) pending += 1;
  }
  const row = ocrTrustStratum(b, profile);
  rows.push({
    id: b.id, title: String(b.title || '').slice(0, 80), language: b.language, year: editionYear(b), hand: bookHand(profile),
    stratum: row?.id || null, verdict: ocrTrustVerdict(b, profile), pages, ocr: profile.ocr, translated, pending,
    status: b.pipeline_auto?.status || null, held: !!b.pipeline_auto?.hold, auto_eligible: autoEligible(b), readers, profile,
  });
  if (++done % 100 === 0) console.error(`  ${done}/${todo.length}`);
}

const openRuns = await db.collection(RUNS_COLLECTION).find(
  { phase: { $nin: [...TERMINAL_PHASES, 'written', 'shadow_complete', 'failed'] } },
  { projection: { _id: 0, id: 1, book_id: 1, mode: 1, phase: 1, page_count: 1, cursor: 1, counts: 1 } },
).toArray();

const summary = { generated_at: new Date().toISOString(), filter: 'visible: true, pages_count > 0; pending = translatablePageFilter + no translation.data + not health_blocked (exact per-book page reads, no $sample)', strata: {}, controls: {}, open_runs_total: openRuns.length };
const agg = (list) => {
  const readers = {};
  for (const r of list) for (const [k, n] of Object.entries(r.readers)) readers[k] = (readers[k] || 0) + n;
  const withPending = list.filter((r) => r.pending > 0);
  const auto = withPending.filter((r) => r.auto_eligible);
  return {
    books: list.length, pages: list.reduce((s, r) => s + r.pages, 0), pages_translated: list.reduce((s, r) => s + r.translated, 0),
    books_with_pending: withPending.length, pending_pages: withPending.reduce((s, r) => s + r.pending, 0),
    auto_eligible_books: auto.length, auto_eligible_pending_pages: auto.reduce((s, r) => s + r.pending, 0),
    held_books: list.filter((r) => r.held).length,
    open_runs: openRuns.filter((o) => list.some((r) => r.id === o.book_id)).map((o) => ({ run: o.id, book_id: o.book_id, mode: o.mode, phase: o.phase, page_count: o.page_count, written: o.counts?.written ?? null })),
    ocr_readers: Object.fromEntries(Object.entries(readers).sort((a, b) => b[1] - a[1]).slice(0, 8)),
  };
};
for (const t of OCR_TRUST_TABLE) summary.strata[t.id] = { gated: t.gated, ...agg(rows.filter((r) => r.stratum === t.id)) };
// The books the table's languages match but no row takes — the negative controls, sized.
const lang = (rx) => rows.filter((r) => rx.test(String(r.language)) && !r.stratum);
summary.controls['greek-print-1600+'] = agg(lang(/^\s*(ancient\s+)?greek\b/i).filter((r) => r.hand === 'print' && r.year >= 1600));
summary.controls['greek-hand-unknown'] = agg(lang(/^\s*(ancient\s+)?greek\b/i).filter((r) => r.hand === 'unknown'));
summary.controls['greek-print-year-unknown-or-pre-1450'] = agg(lang(/^\s*(ancient\s+)?greek\b/i).filter((r) => r.hand === 'print' && !(r.year >= 1600)));
summary.controls['greek-hand-unknown-undated'] = agg(lang(/^\s*(ancient\s+)?greek\b/i).filter((r) => r.hand === 'unknown' && r.year == null));
summary.controls['latin-manuscript-1450-1500'] = agg(lang(/^\s*latin\b/i));
summary.not_read = { books: skipped, why: 'table language, but outside every row\'s year window (Latin outside 1450–1500, or undated)' };

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(OUT, 'census-books.jsonl'), rows.filter((r) => r.stratum).map((r) => JSON.stringify(r)).join('\n') + '\n');
for (const [k, v] of Object.entries({ ...summary.strata, ...summary.controls })) {
  console.log(`${k.padEnd(40)} books ${String(v.books).padStart(5)}  pending ${String(v.pending_pages).padStart(7)}pp in ${String(v.books_with_pending).padStart(4)} books  auto-eligible ${String(v.auto_eligible_pending_pages).padStart(7)}pp in ${String(v.auto_eligible_books).padStart(4)}  open runs ${v.open_runs.length}  readers ${JSON.stringify(v.ocr_readers)}`);
}
await client.close();

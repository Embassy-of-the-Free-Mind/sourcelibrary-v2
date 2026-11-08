#!/usr/bin/env node
// PRIOR ART: scripts/audit/book-run-plant-catch.mjs reads the same volunteer_ratings rows (queue book-run) but scores
// the planted pages only, and writes nothing. scripts/lib/book-checks.mjs recordPageVerdicts() is the writer this
// uses unchanged. Nothing else moved volunteer reviews into book_checks (git grep volunteer_ratings scripts/).
//
// volunteer-paired-checks — a volunteer's completed paired-fifths check of a book becomes one book_checks row (#8405).
//
// A review shift serves a book's paired-fifths pages (src/app/api/review/book-run/route.ts, scripts/lib/paired-fifths.mjs).
// Once one volunteer has reviewed every planned page of a book, this writes one row under the method
// volunteer-paired-check (scripts/eval/methods/volunteer-paired-check.md): reader_warning false, so it is kept and
// shown on /book/<id>/checks but warns no reader. Reviews of planted test pages and `unclear` pages are left out.
//
// Dry run by default (prints what it would write). Usage:
//   node --env-file=.env.production.local scripts/audit/volunteer-paired-checks.mjs [--apply] [--json] [--rows=<file.json>]

import { createClient } from '@supabase/supabase-js';
import { withMongo } from '../lib/mongo.mjs';
import { recordPageVerdicts } from '../lib/book-checks.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { PAIRED_FIFTHS_VERSION, pairedFifths, pairedReadingOrder } from '../lib/paired-fifths.mjs';
import { SKIP_TYPES } from '../eval/confidence-7866/lib.mjs';

const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const METHOD = { id: 'volunteer-paired-check', version: '1' };
const OUTCOME = { both_sound: ['clean', 'show'], translation_drift: ['minor', 'caveat'], transcription_off: ['minor', 'caveat'], both_off: ['minor', 'caveat'] };
const HAS_TEXT = { 'ocr.data': { $type: 'string', $ne: '' }, 'translation.data': { $type: 'string', $ne: '' } };

async function bookRunRows() {
  // --rows=<file.json>: read the review rows from a file instead (a positive control: rows shaped like a completed check).
  const file = process.argv.find((a) => a.startsWith('--rows='))?.slice(7);
  if (file) return JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('volunteer_ratings').select('volunteer_id, rating, note, detail, created_at')
      .eq('queue', 'book-run').order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`volunteer_ratings: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/** The book's paired-fifths plan, with the same eligibility as the shift route. */
async function planFor(db, bookKeys, bookId) {
  const inBook = { book_id: { $in: bookKeys } };
  const [all, withText] = await Promise.all([
    db.collection('pages').find(inBook, { projection: { _id: 0, page_number: 1, page_type: 1, hidden: 1, split_into: 1 } }).sort({ page_number: 1 }).toArray(),
    db.collection('pages').find({ ...inBook, ...HAS_TEXT }, { projection: { _id: 0, page_number: 1 } }).toArray(),
  ]);
  const hasText = new Set(withText.map((p) => p.page_number));
  const draw = all.filter((p) => typeof p.page_number === 'number')
    .map((p) => ({ page_number: p.page_number, eligible: hasText.has(p.page_number) && !p.hidden && !p.split_into && !SKIP_TYPES.includes(p.page_type) }));
  return pairedReadingOrder(pairedFifths(draw, bookId));
}

const rows = await bookRunRows();
const groups = new Map();
for (const r of rows) {
  const d = r.detail ?? {};
  if (!d.book_id || typeof d.page_number !== 'number') continue;
  const k = `${r.volunteer_id}\u0000${d.book_id}`;
  if (!groups.has(k)) groups.set(k, { volunteer_id: r.volunteer_id, book_ref: d.book_id, byPage: new Map() });
  groups.get(k).byPage.set(d.page_number, r); // ascending created_at: the last review of a page wins
}

const report = { rows_read: rows.length, volunteer_books: groups.size, complete: 0, incomplete: 0, written: 0, already: 0, failed: [], books: [] };
await withMongo(async (db) => {
  for (const g of groups.values()) {
    const book = await db.collection('books').findOne({ $or: [{ id: g.book_ref }, { _id: g.book_ref }] }, { projection: { id: 1 } });
    if (!book) { report.failed.push({ book: g.book_ref, error: 'book not found' }); continue; }
    const bookId = String(book.id ?? book._id);
    const order = await planFor(db, [...new Set([bookId, String(book._id)])], bookId);
    const missing = order.filter((n) => !g.byPage.has(n));
    if (!order.length || missing.length) { report.incomplete++; report.books.push({ book: bookId, volunteer: g.volunteer_id, planned: order.length, missing: missing.length }); continue; }
    report.complete++;

    const pageDocs = await db.collection('pages').find({ book_id: { $in: [bookId, String(book._id)] }, page_number: { $in: order } },
      { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    const byNumber = new Map(pageDocs.map((p) => [p.page_number, p]));
    let plants = 0, unclear = 0;
    const models = new Set();
    const verdicts = [];
    for (const n of order) {
      const r = g.byPage.get(n), d = r.detail ?? {}, page = byNumber.get(n);
      if (d.control_plant_id) { plants++; continue; }
      if (!OUTCOME[r.rating]) { unclear++; continue; }
      if (!page) continue;
      models.add(d.assistant_model || 'unreported');
      const [outcome, page_verdict] = OUTCOME[r.rating];
      const findings = (d.assistant_findings ?? []).map((f) => `${f.layer}: "${f.quote ?? ''}" ${f.problem ?? ''}`.trim());
      const note = [`volunteer verdict ${r.rating}`, r.note, ...findings].filter(Boolean).join('; ').slice(0, 1500);
      const live = { ocr: page.ocr?.data ?? '', translation: page.translation?.data ?? '' };
      const same = d.text_version && d.text_version.ocr === contentHash(live.ocr) && d.text_version.translation === contentHash(live.translation);
      verdicts.push({ page_id: page.id, outcome, page_verdict, verdict: r.rating, note, ...(same ? { judged: live } : {}) });
    }
    if (!verdicts.length) { report.books.push({ book: bookId, volunteer: g.volunteer_id, planned: order.length, recorded: 0, plants, unclear }); continue; }
    const out = await recordPageVerdicts(db, {
      method_id: METHOD.id, method_version: METHOD.version,
      run_id: `${g.volunteer_id}:${PAIRED_FIFTHS_VERSION}`,
      checked_at: new Date(Math.max(...order.map((n) => +new Date(g.byPage.get(n).created_at)))),
      selection: 'random', stages: ['ocr', 'translation'],
      reader: { kind: 'model', model: [...models].join(' + '), image_opened: 'unrecorded' },
      evidence_path: `supabase:volunteer_ratings?queue=book-run&volunteer_id=${g.volunteer_id}`,
      reader_warning: false,
      frame: { draw: PAIRED_FIFTHS_VERSION, pages_planned: order.length, plant_pages_left_out: plants, unclear_left_out: unclear, volunteer_id: g.volunteer_id },
      note: `A volunteer's Claude (${[...models].join(', ')}) read this book's paired-fifths pages in a review shift (#8405).`,
      verdicts,
    }, { apply: APPLY });
    report.written += out.inserted; report.already += out.already; report.failed.push(...out.failed);
    report.books.push({ book: bookId, volunteer: g.volunteer_id, planned: order.length, recorded: verdicts.length, plants, unclear, verdict: out.rows[0]?.verdict ?? null });
  }
});

if (JSON_OUT) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`${APPLY ? 'APPLY' : 'dry run'}: ${report.rows_read} book-run reviews, ${report.volunteer_books} volunteer×book runs; ` +
    `${report.complete} complete paired checks, ${report.incomplete} not (yet) complete; written ${report.written}, already ${report.already}, failed ${report.failed.length}`);
  for (const f of report.failed) console.log(`  FAILED ${JSON.stringify(f)}`);
}
if (report.failed.length) process.exitCode = 1;

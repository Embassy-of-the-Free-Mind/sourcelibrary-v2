#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/page-integrity.mjs finds the printed-number jumps (leaf-order list) and
 * scripts/eval/results/page-integrity-leaf-order-sharpened-2026-10-13.jsonl.gz is the sharpened, read verdict on each
 * (#5059, PR #6674); neither tells a reader. scripts/maintenance/archive-mdz-gap-4190.mjs re-fetches missing MDZ
 * leaves, which only helps where the source holds the leaf (the Archive items here do not). None writes a note.
 *
 * write-scan-gaps-6675 — one `scan_gaps` row per place where printed pages are missing between two scans, so the
 * reader can say "Pages 41–44 are missing from this scan." (#6675, wording by Derek 2026-10-15; src/lib/scan-gaps.ts).
 * Nothing is hidden and no book or page document is changed.
 *
 * A row of the 2026-10-13 list is written only when all of these hold, so the note never names pages that are there:
 *   - verdict text-breaks (the blind read of foot and head says the text does not join);
 *   - the two scans are adjacent, numbering arabic or roman, and d = toValue − fromValue − 1;
 *   - the stored transcription of both scans still carries those printed numbers (the text may have changed since);
 *   - the printed numbers run in sequence on BOTH sides: a scan among the three before carries a number within three
 *     below fromValue, and a scan among the three after carries one within three above toValue. A misread number
 *     ("257" for "357") fails this and is skipped.
 * Skipped rows are written to the report with the reason.
 *
 *   node --env-file=.env.production.local scripts/maintenance/write-scan-gaps-6675.mjs --phase=1            # dry run, 5+ breaks
 *   node --env-file=.env.production.local scripts/maintenance/write-scan-gaps-6675.mjs --phase=2 --apply    # the rest
 *   node --env-file=.env.production.local scripts/maintenance/write-scan-gaps-6675.mjs --undo --apply      # delete every row this wrote
 * --report=<file> writes the per-row outcome as JSON (default: $JOB_SCRATCH or /tmp).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIST = path.join(__dirname, '..', 'eval', 'results', 'page-integrity-leaf-order-sharpened-2026-10-13.jsonl.gz');
const SOURCE = 'leaf-order-sharpened-2026-10-13';
const SWEEP = 'scan-gaps-6675';
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const PHASE = arg('phase', 'all'); // 1 = books with five or more breaks, 2 = the rest, all
const REPORT = arg('report', path.join(process.env.JOB_SCRATCH || '/tmp', `scan-gaps-6675-phase${PHASE}${APPLY ? '' : '-dry'}.json`));

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function fromRoman(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const a = ROMAN[s[i]], b = ROMAN[s[i + 1]] || 0; n += a < b ? -a : a; }
  return n;
}
const ROMAN_OUT = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function toRoman(n) { let o = ''; for (const [v, s] of ROMAN_OUT) while (n >= v) { o += s; n -= v; } return o; }

/** The printed number in a stored transcription's <page-num> tag, in the given numbering; null if absent or other. */
function printedNumber(ocr, numbering) {
  const m = /<page-num>\s*([^<]*?)\s*<\/page-num>/i.exec(ocr || '');
  if (!m) return null;
  const v = m[1].replace(/[[\]().]/g, '').trim().toLowerCase();
  if (numbering === 'arabic') return /^\d{1,4}$/.test(v) ? Number(v) : null;
  return /^[ivxlcdm]{1,10}$/.test(v) ? fromRoman(v) : null;
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db('bookstore');
const coll = db.collection('scan_gaps');

if (UNDO) {
  const n = await coll.countDocuments({ source: SOURCE });
  console.log(`${n} scan_gaps rows from ${SOURCE}`);
  if (APPLY) console.log('deleted', (await coll.deleteMany({ source: SOURCE })).deletedCount);
  await client.close();
  process.exit(0);
}

const all = zlib.gunzipSync(fs.readFileSync(LIST)).toString().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.verdict === 'text-breaks');
const perBook = new Map();
for (const r of all) perBook.set(r.book, (perBook.get(r.book) || 0) + 1);
const rows = all.filter(r => PHASE === 'all' || (PHASE === '1' ? perBook.get(r.book) >= 5 : perBook.get(r.book) < 5));
const byBook = new Map();
for (const r of rows) (byBook.get(r.book) || byBook.set(r.book, []).get(r.book)).push(r);

if (APPLY) await coll.createIndex({ book_id: 1 });
const out = [];
const tally = {};
let written = 0;
for (const [bookId, list] of byBook) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { visible: 1 } });
  const want = new Set();
  for (const r of list) for (let p = r.from - 3; p <= r.to + 3; p++) want.add(p);
  const pages = await db.collection('pages').find(
    { book_id: bookId, page_number: { $in: [...want] }, page_type: { $nin: ['archived-spread', 'digitizer-insert'] } },
    { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1 } },
  ).toArray();
  const at = new Map();
  for (const p of pages) if (!at.has(p.page_number)) at.set(p.page_number, p);
  const bookRows = [];
  for (const r of list) {
    const o = { book: bookId, visible: !!book?.visible, from: r.from, to: r.to, fromValue: r.fromValue, toValue: r.toValue, numbering: r.numbering };
    const num = (p) => printedNumber(at.get(p)?.ocr?.data, r.numbering);
    let skip = null;
    if (!book) skip = 'book-gone';
    else if (r.to - r.from !== 1) skip = 'scans-not-adjacent';
    else if (!['arabic', 'roman'].includes(r.numbering)) skip = `numbering-${r.numbering}`;
    else if (r.d !== r.toValue - r.fromValue - 1) skip = 'spread-or-uneven';
    else if (!at.get(r.from) || !at.get(r.to)) skip = 'page-gone';
    else if (num(r.from) !== r.fromValue || num(r.to) !== r.toValue) skip = 'number-changed';
    else {
      const before = [1, 2, 3].some(k => { const v = num(r.from - k); return v != null && v < r.fromValue && v >= r.fromValue - 3; });
      const after = [1, 2, 3].some(k => { const v = num(r.to + k); return v != null && v > r.toValue && v <= r.toValue + 3; });
      if (!before || !after) skip = `sequence-unconfirmed-${before ? '' : 'before'}${!before && !after ? '-' : ''}${after ? '' : 'after'}`;
    }
    tally[skip || 'write'] = (tally[skip || 'write'] || 0) + 1;
    if (skip) { out.push({ ...o, skip }); continue; }
    const first = r.fromValue + 1, last = r.toValue - 1;
    const label = r.numbering === 'roman' ? toRoman : String;
    const doc = {
      book_id: bookId, after_page: r.from, before_page: r.to,
      after_page_id: at.get(r.from).id, before_page_id: at.get(r.to).id,
      first: label(first), last: last > first ? label(last) : null, numbering: r.numbering,
      source: SOURCE, issue: 6675, created_at: new Date(),
    };
    out.push({ ...o, write: { first: doc.first, last: doc.last } });
    bookRows.push(doc);
  }
  if (APPLY && bookRows.length) {
    for (const d of bookRows) {
      await coll.updateOne({ book_id: d.book_id, after_page: d.after_page, before_page: d.before_page }, { $set: d }, { upsert: true });
    }
    await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'scan-gap-notes', detail: { rows: bookRows.length, source: SOURCE, undo: 'write-scan-gaps-6675.mjs --undo --apply' } });
    written += bookRows.length;
  }
}
const books = new Set(out.filter(o => o.write).map(o => o.book));
const live = new Set(out.filter(o => o.write && o.visible).map(o => o.book));
fs.writeFileSync(REPORT, JSON.stringify({ phase: PHASE, apply: APPLY, tally, books: books.size, live_books: live.size, rows: out }, null, 1));
console.log(JSON.stringify({ phase: PHASE, apply: APPLY, listRows: rows.length, tally, books: books.size, live_books: live.size, written, report: REPORT }));
await client.close();

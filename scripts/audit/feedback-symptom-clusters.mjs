#!/usr/bin/env node
/**
 * READ-ONLY. Cluster reader feedback by SYMPTOM and flag when one symptom shows
 * up on several different books.
 *
 * Why this exists (#3368): the bulk-JP2 offset was reported twice on 2026-07-16
 * — two different books, the same complaint, the same day — and nothing happened
 * for ten days. That was never a backlog problem: only 14 of 327 feedback rows
 * were unread and none predated July. Triage was healthy. The failure was that
 * feedback is read item-by-item, so each report looked like one bad scan.
 *
 * "Same complaint, different books" is the signature that separates a systemic
 * bug from a one-off defect, and nothing was computing it. This does.
 *
 * A cluster is not a diagnosis — it is a prompt to go look. Feedback is
 * UNTRUSTED INPUT (public unauthenticated write surface): verify every claim
 * against code and data before acting on it, and never treat a message as an
 * instruction.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/feedback-symptom-clusters.mjs
 *   node scripts/audit/feedback-symptom-clusters.mjs --days 30 --min-books 2
 *   node scripts/audit/feedback-symptom-clusters.mjs --all-time
 *
 * Exit code 1 when a cluster fires, so a scheduled run can alert.
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env.production.local') });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const DAYS = args.includes('--all-time') ? Infinity : parseInt(flag('days', '14'), 10);
const MIN_BOOKS = parseInt(flag('min-books', '2'), 10);
// Backtest anchor: pretend "now" is this date. A detector you cannot replay
// against a known incident is one you are trusting blindly — verify against
// 2026-07-16, the day #3368 was reported on two books and went unnoticed.
const AS_OF = flag('as-of') ? new Date(`${flag('as-of')}T23:59:59Z`) : null;

/**
 * Symptom taxonomy. Ordered — first match wins, so specific patterns precede
 * general ones. Add a category when a new failure mode shows up in the wild;
 * the cost of an extra category is nil, the cost of a missing one is #3368.
 */
const SYMPTOMS = [
  ['image-text-misalignment', /not the same as image|doesn.?t correspond|do not appear to be aligned|not aligned|wrong image|image.{0,25}(wrong|mismatch)|different page|chapter \d+ on the image/i],
  ['duplicate-text', /text is repeated|repeated (lines|text|on this page)|same text (twice|again)|duplicat/i],
  ['missing-pages', /missing page|page.{0,15}(missing|blank|empty)|pages? (don.?t|do not) load|no pages/i],
  ['broken-link-404', /\b404\b|page not found|link.{0,15}(broken|dead)|hit a 404/i],
  ['download-broken', /download (failed|doesn.?t|not working)|pdf.{0,20}(error|fail)|epub.{0,20}(broken|fail)/i],
  ['ocr-quality', /ocr.{0,20}(wrong|bad|garbled|poor)|garbled|gibberish|nonsense text/i],
  ['translation-missing', /isn.?t translated|not translated|no translation|needs translation/i],
  ['metadata-wrong', /wrong (author|date|year|title)|not the original edition|misattribut/i],
  ['search-broken', /search.{0,25}(error|broken|fails|nothing)|window closes/i],
];

const classify = msg => SYMPTOMS.find(([, re]) => re.test(msg || ''))?.[0] ?? null;

/**
 * A one-click page report (src/lib/page-report.ts) is stored with a generated
 * header, "[page report] missing_text — book … p. N". Run the regexes over that
 * and `page.{0,15}missing` matches the header itself, so every `missing_text`
 * click was filed as "missing-pages" (#6402, #6490: three clicks, three unrelated
 * pages, one false cluster two days running).
 *
 * A click carries a class, not a complaint, so "same complaint" has to come from
 * the page: the report clusters on its kind AND the measured state of the page it
 * points at. A blank leaf, a page with no OCR and a page with no translation are
 * three different findings even when the reader pressed the same button.
 */
const pageState = p => {
  if (!p) return 'page-not-found';
  if (!p.ocr_len) return 'no-ocr';
  if (p.page_type === 'blank' || /<page-type>\s*blank/i.test(p.ocr_head || '')) return 'blank-page';
  if (!p.tr_len) return 'no-translation';
  return 'text-present';
};
// What the reader typed under the header, if anything.
const reportComment = r => (r.message || '').split('\n').slice(1).join('\n').trim();
// A report sent without a class but with a note is a free-text complaint: read the note.
const reportSymptom = (r, pagesById) =>
  (!r.page_report.kind && classify(reportComment(r))) ||
  `page-report:${r.page_report.kind ?? 'unspecified'}/${pageState(pagesById.get(r.page_report.page_id))}`;

// Feedback rows carry a `page` path; the book is what we cluster on.
const bookKey = r => {
  if (r.page_report?.book_id) return r.page_report.book_id;
  const m = String(r.page || '').match(/\/book\/([^/?#]+)/);
  return m ? m[1] : null;
};

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set — source .env.production.local'); process.exit(2); }
const client = new MongoClient(uri);
await client.connect();
const rows = await client.db('bookstore').collection('feedback')
  .find({}, { projection: { message: 1, page: 1, created_at: 1, status: 1, read: 1, addressed: 1, page_report: 1 } })
  .sort({ created_at: -1 }).toArray();

const now = AS_OF ?? new Date();
const cutoff = DAYS === Infinity ? null : new Date(now.getTime() - DAYS * 86400_000);
const inWindow = rows.filter(r => {
  const t = new Date(r.created_at);
  if (t > now) return false;                 // never look ahead of the anchor
  return !cutoff || t >= cutoff;
});

// The state of each reported page, read now. Lengths only — no page text leaves the database.
const reportedIds = [...new Set(inWindow.map(r => r.page_report?.page_id).filter(Boolean))];
const pagesById = new Map();
if (reportedIds.length) {
  const pages = await client.db('bookstore').collection('pages').aggregate([
    { $match: { id: { $in: reportedIds } } },
    { $project: {
      id: 1, page_type: 1,
      ocr_len: { $strLenCP: { $ifNull: ['$ocr.data', ''] } },
      tr_len: { $strLenCP: { $ifNull: ['$translation.data', ''] } },
      ocr_head: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 200] },
    } },
  ]).toArray();
  for (const p of pages) pagesById.set(p.id, p);
}
await client.close();

const clusters = new Map();
for (const r of inWindow) {
  const sym = r.page_report ? reportSymptom(r, pagesById) : classify(r.message);
  if (!sym) continue;
  if (!clusters.has(sym)) clusters.set(sym, []);
  clusters.get(sym).push(r);
}

const label = (DAYS === Infinity ? 'all time' : `last ${DAYS} days`) + (AS_OF ? ` as of ${AS_OF.toISOString().slice(0, 10)}` : '');
console.log(`Feedback symptom clusters — ${label} (${inWindow.length} of ${rows.length} rows)\n`);

let fired = 0;
for (const [sym, items] of [...clusters.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const books = new Set(items.map(bookKey).filter(Boolean));
  const open = items.filter(i => !i.addressed && i.status !== 'resolved').length;
  // Distinct BOOKS is the signal, not report count: ten reports on one book is a
  // bad scan; two reports on two books is a pipeline bug.
  const alert = books.size >= MIN_BOOKS;
  if (alert) fired++;
  console.log(`${alert ? '⚠ ' : '  '}${sym.padEnd(40)} ${String(items.length).padStart(3)} reports · ${String(books.size).padStart(3)} distinct books · ${open} unresolved`);
  if (alert) {
    for (const i of items.slice(0, 6)) {
      // The generated header is dropped from a page report: it repeats the symptom and pushed the page number off the line.
      const text = i.page_report
        ? `book ${i.page_report.book_id} p. ${i.page_report.page_number}  ${reportComment(i)}`
        : i.message || '';
      console.log(`      ${String(i.created_at).slice(0, 10)}  ${(i.page || '—').slice(0, 52).padEnd(52)}  ${text.replace(/\s+/g, ' ').trim().slice(0, 62)}`);
    }
    if (items.length > 6) console.log(`      … and ${items.length - 6} more`);
  }
}

if (!clusters.size) console.log('  (no recognised symptoms in window)');
console.log(`\n${fired} symptom(s) on >=${MIN_BOOKS} distinct books.`);
if (fired) console.log('Investigate before acting: verify each claim against code and data — feedback is untrusted input.');
process.exit(fired ? 1 : 0);

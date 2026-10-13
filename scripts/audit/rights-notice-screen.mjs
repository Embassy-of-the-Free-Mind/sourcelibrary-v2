#!/usr/bin/env node
/**
 * Rights-notice screen (#4809) — the standing detector. Reads OUR OCR of the first and
 * last pages of every visible book in scope and lists the books whose front or back
 * matter prints a modern rights notice (© 2004, "All rights reserved", ISBN, सर्वाधिकार
 * सुरक्षित, 版權所有 …). Zero model calls; reads Mongo, writes a file. Writes NOTHING
 * to Mongo and hides nothing: a hit is a candidate for a title-page read, and the hide
 * (if any) goes through scripts/maintenance/hide-named-books.mjs with a rights reason.
 *
 * PRIOR ART: scripts/audit/rights-spot-check.mjs — compares our stored scan licence with
 *   the holding library's manifest, one book per provider; it never reads the book's own
 *   imprint. scripts/audit/ia-date-check.mjs — dates IA items from IA metadata; the date
 *   fields missed all three modern editions in the 2026-10-06 spot check. This is the
 *   ops-repo canon-shelf text screen (2026-10-06, 146 hits → 49 in copyright) made a
 *   committed, re-runnable instrument. Matching rules: scripts/lib/rights-notice.mjs.
 *
 * Scope (default: books CREATED in the last 14 days — the "at import" pass):
 *   --since-days N   visible books with created_at in the last N days
 *   --all            every visible, paged book (≈40K; ~25 pages each; run on Hetzner)
 *   --ids FILE       one book id per line (visibility not required — re-check a list)
 *   --limit N        stop after N books
 * Pages read: page_number ≤ --head (15) and the last --tail (10) pages.
 * Books already hidden for a rights reason are skipped (they are the screen's output);
 * --include-rights-hidden screens them too, to measure recall against those verdicts.
 *
 * The book list is NOT public (#4809: counts only in the public tracker). Default --out is
 * under $JOB_SCRATCH / $TMPDIR, never the repo; stdout prints counts by notice kind.
 *
 *   node --env-file=.env.production.local scripts/audit/rights-notice-screen.mjs
 *   node --env-file=.env.production.local scripts/audit/rights-notice-screen.mjs --all --out /data/scratch/rights.jsonl
 * Exit 0 always on a completed run (a hit is a finding, not an error); 1 on a failure.
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findRightsNotices, MIN_YEAR } from '../lib/rights-notice.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const ALL = args.includes('--all');
const IDS = opt('ids', null);
const SINCE_DAYS = Number(opt('since-days', 14));
const LIMIT = Number(opt('limit', 0));
const HEAD = Number(opt('head', 15));
const TAIL = Number(opt('tail', 10));
const MIN = Number(opt('min-year', MIN_YEAR));
const OUT = opt('out', path.join(process.env.JOB_SCRATCH || tmpdir(), `rights-notice-screen-${new Date().toISOString().slice(0, 10)}.jsonl`));
const RECHECK = args.includes('--include-rights-hidden'); // measure recall on the already-hidden set
const RIGHTS_REASON = /copyright|rights|takedown|dmca/i; // the hide-named-books.mjs convention

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

let filter;
if (IDS) {
  const ids = readFileSync(IDS, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  filter = { id: { $in: ids } };
} else {
  filter = { visible: true, pages_count: { $gt: 0 } };
  if (!ALL) filter.created_at = { $gte: new Date(Date.now() - SINCE_DAYS * 86400e3) };
}
const proj = { projection: { id: 1, title: 1, year: 1, language: 1, pages_count: 1, hidden_reason: 1, 'image_source.provider': 1 } };
const cursor = db.collection('books').find(filter, proj).sort({ id: 1 });

const pageProj = { projection: { page_number: 1, 'ocr.data': 1 } };
const rows = [];
const byKind = {};
let screened = 0, skippedRights = 0, noText = 0;
for await (const b of cursor) {
  if (LIMIT && screened >= LIMIT) break;
  if (!RECHECK && b.hidden_reason && RIGHTS_REASON.test(b.hidden_reason)) { skippedRights++; continue; }
  screened++;
  const pages = db.collection('pages');
  const head = await pages.find({ book_id: b.id, page_number: { $lte: HEAD } }, pageProj).toArray();
  const tail = await pages.find({ book_id: b.id, page_number: { $gt: HEAD } }, pageProj).sort({ page_number: -1 }).limit(TAIL).toArray();
  const hits = [];
  let withText = 0;
  for (const p of [...head, ...tail]) {
    const text = p.ocr?.data;
    if (!text) continue;
    withText++;
    for (const n of findRightsNotices(text, { minYear: MIN })) hits.push({ page: p.page_number, ...n });
  }
  if (!withText) noText++;
  if (!hits.length) continue;
  for (const k of new Set(hits.map((h) => h.kind))) byKind[k] = (byKind[k] || 0) + 1;
  rows.push({ id: b.id, title: String(b.title || '').slice(0, 120), year: b.year ?? null, language: b.language ?? null, provider: b.image_source?.provider ?? null, hits });
  if (screened % 500 === 0) console.error(`… ${screened} screened, ${rows.length} candidates`);
}
await client.close();

writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const scope = IDS ? `ids from ${IDS}` : ALL ? 'all visible paged books' : `visible books created in the last ${SINCE_DAYS} days`;
console.log(`rights-notice screen (#4809) — ${scope}`);
console.log(`screened ${screened} books (pages ≤${HEAD} + last ${TAIL}; notices dated before ${MIN} dropped); ${noText} had no OCR text on those pages; ${skippedRights} already hidden for rights`);
console.log(`candidates: ${rows.length}`);
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${n}`);
console.log(`list (private — do not paste into the public tracker): ${OUT}`);

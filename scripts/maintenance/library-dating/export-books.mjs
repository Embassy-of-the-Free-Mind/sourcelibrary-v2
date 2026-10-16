#!/usr/bin/env node
/**
 * Export books for dating (#6721): catalogue fields from the nightly mirror, opening leaves from Mongo `pages`
 * (READ-ONLY; the mirror carries no page text). One JSONL row per book: { book_id, title, original_title, author,
 * published, language, visible, has_prior, work_id, catalogue_years, lead }. `catalogue_years` are the years the source
 * library's own record gives (catalog_metadata: IIIF navDate / Date pairs, IA date, Kloss year…; #4572). Nothing is written to Mongo.
 *
 * SCOPE: every book with pages_count > 0, visible and hidden, minus books a human has dated
 * (`source_work_dates_meta.edited_by`). `--ids <file>` (one id per line) narrows it, e.g. to a gold set.
 * The writer re-checks `edited_by` LIVE before each write; the mirror is only the plan.
 *
 * PRIOR ART: scripts/analysis/experience-map/build/export-atlas-books.mjs (#6652) — same row shape; it does not fit
 * because it reads one atlas's ids and its leaves from a per-book text mirror that this box does not have, and strips
 * tags without stripping the editorial wrappers' contents. Leaves are built by buildLead() in scripts/lib/date-works.mjs.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/export-books.mjs \
 *     <out.jsonl> [--ids ids.txt] [--max N] [--tail]
 *
 * `--tail` (#6721, Derek 2026-10-15: "colophon on the LAST 1-3 pages"): rows are { book_id, tail } instead — the last
 * three pages that carry text, in page order, editorial wrappers stripped, up to ~1,200 characters from the END
 * (Tibetan, Chinese, Arabic and Hebrew books date themselves in a colophon there).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { openMirror } from '../../lib/mirror.mjs';
import { buildLead, catalogueYears } from '../../lib/date-works.mjs';
import { stripEditorialWrappers } from '../../lib/strip-editorial-wrappers.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

const OUT = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (!OUT) { console.error('usage: export-books.mjs <out.jsonl> [--ids file] [--max N]'); process.exit(2); }
const IDS = arg('--ids'); const MAX = +arg('--max', 0); const CHUNK = 200; const TAIL = process.argv.includes('--tail');

const m = openMirror({ collections: ['books'] });
console.log(m.describe());
const idFilter = IDS ? new Set(fs.readFileSync(IDS, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) : null;
const books = m.query(`SELECT coalesce((id->>'$'), _id) AS book_id, (title->>'$') AS original_title,
    coalesce((display_title->>'$'), (english_title->>'$')) AS title, (author->>'$') AS author, published::VARCHAR AS published,
    ("language"->>'$') AS language, coalesce(TRY_CAST(visible::VARCHAR AS BOOLEAN), false) AS visible,
    (source_work_dates IS NOT NULL AND source_work_dates::VARCHAR <> 'null') AS has_prior,
    (work_id->>'$') AS work_id, catalog_metadata::VARCHAR AS catalog_metadata, TRY_CAST(pages_count::VARCHAR AS INTEGER) AS pages_count
  FROM books
  WHERE TRY_CAST(pages_count::VARCHAR AS DOUBLE) > 0 AND (source_work_dates_meta->>'edited_by') IS NULL
  ORDER BY book_id`).filter((b) => !idFilter || idFilter.has(b.book_id));
let todo = books;
const done = new Set();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) if (l) try { done.add(JSON.parse(l).book_id); } catch { /* torn line */ }
todo = todo.filter((b) => !done.has(b.book_id));
if (MAX) todo = todo.slice(0, MAX);
console.log(`${books.length} books in scope, ${done.size} already exported, ${todo.length} to export`);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db(process.env.MONGODB_DB || 'bookstore').collection('pages');
let withText = 0;
for (let i = 0; TAIL && i < todo.length; i += CHUNK) {
  const chunk = todo.slice(i, i + CHUNK);
  // the last four pages by number (an empty or unreadable one falls out), and only the END of each page's text: a
  // colophon closes the book, and Atlas egress is billed by the byte
  // strlen-safe: the filter below admits only pages whose ocr.data is $type 'string'
  const rows = await pages.find({ $or: chunk.map((b) => ({ book_id: b.book_id, page_number: { $gt: (b.pages_count || 0) - 4 } })),
    'ocr.data': { $type: 'string', $ne: '' }, 'ocr.unreadable': { $ne: true } },
  { projection: { _id: 0, book_id: 1, page_number: 1, text: { $substrCP: ['$ocr.data', { $max: [0, { $subtract: [{ $strLenCP: '$ocr.data' }, 1500] }] }, 1500] } }, maxTimeMS: 120_000 }).toArray();
  const by = new Map();
  for (const r of rows) { if (!by.has(r.book_id)) by.set(r.book_id, []); by.get(r.book_id).push(r); }
  const out = chunk.map((b) => {
    const ps = (by.get(b.book_id) || []).sort((x, y) => x.page_number - y.page_number).slice(-3);
    const tail = ps.map((p) => `[page ${p.page_number}] ${stripMarkupTags(stripEditorialWrappers(p.text || '') || '', ' ').replace(/\s+/g, ' ').trim()}`).join('\n');
    if (ps.length) withText++;
    return JSON.stringify({ book_id: b.book_id, tail: tail.slice(-1200) });
  });
  fs.appendFileSync(OUT, out.join('\n') + '\n');
  if ((i / CHUNK) % 25 === 0) console.log(`  ${i + chunk.length}/${todo.length} exported, ${withText} with closing text`);
}
for (let i = 0; !TAIL && i < todo.length; i += CHUNK) {
  const chunk = todo.slice(i, i + CHUNK);
  const rows = await pages.aggregate([
    { $match: { book_id: { $in: chunk.map((b) => b.book_id) }, page_number: { $lte: 12 }, 'ocr.data': { $type: 'string', $ne: '' }, 'ocr.unreadable': { $ne: true } } },
    { $project: { _id: 0, book_id: 1, page_number: 1, text: { $substrCP: ['$ocr.data', 0, 1800] } } },
  ], { maxTimeMS: 120_000 }).toArray();
  const by = new Map();
  for (const r of rows) { if (!by.has(r.book_id)) by.set(r.book_id, []); by.get(r.book_id).push(r); }
  const out = chunk.map((b) => {
    const lead = buildLead(by.get(b.book_id) || []);
    if (lead) withText++;
    const { catalog_metadata: cm, pages_count: _pc, ...rest } = b;
    return JSON.stringify({ ...rest, published: b.published == null ? null : JSON.parse(b.published), catalogue_years: catalogueYears(cm), lead });
  });
  fs.appendFileSync(OUT, out.join('\n') + '\n');
  if ((i / CHUNK) % 25 === 0) console.log(`  ${i + chunk.length}/${todo.length} exported, ${withText} with opening text`);
}
await c.close();
console.log(`done: ${todo.length} exported, ${withText} with opening text → ${OUT}`);

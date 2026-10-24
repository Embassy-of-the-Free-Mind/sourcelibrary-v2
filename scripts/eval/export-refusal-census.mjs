#!/usr/bin/env node
// PRIOR ART: scripts/eval/export-ft-dataset.mjs — the snapshot layout this copies (rows + DATASHEET + CANARY +
// manifest with sha256), for a different ledger; scripts/eval/estimator/ocr/refusal-census.mjs — builds the census
// this exports (read-only Mongo). Neither writes a public refusal dataset (#6740, #7271).
/**
 * export-refusal-census — the recitation-refusal census as a citable dataset snapshot.
 *
 * WHO READS IT: scholars of AI and of digitisation who want to know which printed historical texts a Gemini OCR
 * reader declines to transcribe because it judges them already published, by period, language and edition.
 *
 *   node scripts/eval/export-refusal-census.mjs --census DIR --out scripts/eval/dataset/refusal-census-v1 \
 *       --snapshot 2026-10-24
 *
 * DIR holds refusal-census.mjs's books.jsonl, ia-downloads.jsonl and gutenberg.jsonl. Writes:
 *   books.jsonl     one row per PUBLIC book (visible on sourcelibrary.org) that Flash-Lite attempted
 *   summary.csv     language x period x Archive-text cells, public and hidden books together (counts only)
 *   DATASHEET.md    what a row means, how it was made, and what it cannot tell you
 *   CANARY.txt      the benchmark canary (scripts/lib/dataset-canary.mjs)
 *   manifest.json   snapshot date, git SHA, counts, sha256 per file
 * Hidden books contribute to summary.csv only: their titles are not public.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { CANARY_TEXT } from '../lib/dataset-canary.mjs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const CENSUS = arg('census'), OUT = arg('out'), SNAPSHOT = arg('snapshot');
if (!CENSUS || !OUT || !SNAPSHOT) { console.error('usage: --census DIR --out DIR --snapshot YYYY-MM-DD'); process.exit(2); }
const rd = (f) => fs.readFileSync(path.join(CENSUS, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const books = rd('books.jsonl');
const dl = new Map(rd('ia-downloads.jsonl').filter((r) => r.found).map((r) => [r.ia_identifier, r.downloads]));
const gut = new Map(rd('gutenberg.jsonl').map((r) => [r.id, r.gutenberg]));

const period = (y) => (y == null ? 'unknown' : y < 1600 ? 'before 1600' : y < 1700 ? '1600-1699' : y < 1800 ? '1700-1799'
  : y < 1880 ? '1800-1879' : y <= 1930 ? '1880-1930' : 'after 1930');
const archiveText = (b) => Object.keys(b.models ?? {}).some((m) => m.startsWith('ia-ocr'));

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const cells = new Map();
for (const b of books) {
  if (!(b.lite_attempted > 0)) continue;
  const at = archiveText(b);
  const key = `${b.language}\t${period(b.year)}\t${at}`;
  const c = cells.get(key) ?? { books: 0, books_with_refusal: 0, attempted: 0, refused: 0 };
  c.books++; c.books_with_refusal += b.refused > 0 ? 1 : 0; c.attempted += b.lite_attempted; c.refused += Math.min(b.refused, b.lite_attempted);
  cells.set(key, c);
  if (!b.visible) continue;
  rows.push({
    book_id: b.id, url: `https://sourcelibrary.org/book/${b.id}`, title: b.title, author: b.author, year: b.year,
    language: b.language, work_id: b.work_id, ia_identifier: b.ia_identifier,
    archive_downloads: b.ia_identifier ? (dl.get(b.ia_identifier) ?? null) : null,
    gutenberg_ebooks: gut.get(b.id) ?? [], archive_text_online: at,
    pages: b.pages, lite_attempted: b.lite_attempted, refused: Math.min(b.refused, b.lite_attempted),
    refused_then_read: b.refused_then_read,
  });
}
rows.sort((a, b) => a.book_id.localeCompare(b.book_id));
fs.writeFileSync(path.join(OUT, 'books.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const csv = ['language,period,archive_text_online,books,books_with_refusal,pages_attempted,pages_refused,refusal_rate'];
for (const [k, c] of [...cells].sort()) {
  const [l, p, at] = k.split('\t');
  csv.push([l, p, at, c.books, c.books_with_refusal, c.attempted, c.refused, (c.refused / c.attempted).toFixed(5)].map((x) => (/,/.test(String(x)) ? `"${x}"` : x)).join(','));
}
fs.writeFileSync(path.join(OUT, 'summary.csv'), csv.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'CANARY.txt'), CANARY_TEXT + '\n');

const all = [...cells.values()].reduce((a, c) => ({ books: a.books + c.books, attempted: a.attempted + c.attempted, refused: a.refused + c.refused }), { books: 0, attempted: 0, refused: 0 });
const counts = {
  public_books: rows.length, public_pages_attempted: rows.reduce((s, r) => s + r.lite_attempted, 0),
  public_pages_refused: rows.reduce((s, r) => s + r.refused, 0), all_books: all.books, all_pages_attempted: all.attempted,
  all_pages_refused: all.refused,
};
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex');
const files = ['books.jsonl', 'summary.csv', 'CANARY.txt', 'DATASHEET.md'].filter((f) => fs.existsSync(path.join(OUT, f)));
const manifest = {
  dataset: 'Source Library recitation-refusal census', version: SNAPSHOT, snapshot_date: SNAPSHOT,
  git_sha: execSync('git rev-parse HEAD').toString().trim(), built_by: 'scripts/eval/export-refusal-census.mjs',
  census_by: 'scripts/eval/estimator/ocr/refusal-census.mjs', counts,
  sha256: Object.fromEntries(files.map((f) => [f, sha(f)])),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify(counts));

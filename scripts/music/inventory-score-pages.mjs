#!/usr/bin/env node
/**
 * Inventory of pages that carry musical notation — built from the OCR's own
 * words, because the OCR does not read notation, it DESCRIBES it.
 *
 * PRIOR ART: scripts/clip-cluster-images.mjs — CLIP clustering has "musical
 * notation" in its vocabulary but runs over extracted gallery images, not pages;
 * scripts/music/seed-shaker-transcriptions.mjs — per-piece seeds for one book.
 * Neither answers "which pages in the library hold notation, and of what kind?"
 *
 * Why text and not a vision pass: every OCR'd page with a stave already carries
 * an <image-desc> or <note> saying so ("Musical notation on a five-line stave
 * with a C-clef…"). Reading those is free and covers the whole mirrored corpus
 * in minutes; a vision pass over 5M pages is not. The `musical-score`
 * <page-type> only reached the database on 2026-09-07 (#4455), so it is nearly
 * unpopulated and cannot be the detector yet — it is read as one more signal.
 *
 * Source: the local corpus mirror (~/sl-corpus, see auto-memory
 * reference_local_corpus_mirror.md), never a $regex over Atlas `pages`.
 *
 * Output (committed, so any future OMR model can pick its pages from it):
 *   scripts/music/inventory/score-pages.jsonl   one row per page
 *   scripts/music/inventory/by-book.json        per-book rollup + notation guess
 *
 * Usage:  node scripts/music/inventory-score-pages.mjs [--corpus ~/sl-corpus] [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CORPUS = opt('--corpus', path.join(os.homedir(), 'sl-corpus'));
const LIMIT = Number(opt('--limit', 0)) || 0;
const OUT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'inventory');

// FTS5 recall query: wide on purpose; the regex below is the precision step.
const FTS_QUERY = [
  '"musical notation"', '"music notation"', 'stave', 'staves', 'clef', 'clefs',
  'neume', 'neumes', 'neumatic', 'tablature', 'mensural', 'notehead', 'noteheads',
  '"four-line"', '"five-line"', 'solmization', '"square notation"', 'plainchant', 'plainsong',
].join(' OR ');

// Precision: the mention must sit inside a descriptive tag (the OCR describing an
// image), or the page must be typed musical-score. A prose sentence about clefs
// in a music-theory treatise is not a page of notation.
const TAG_RE = /<(image-desc|note|meta|warning)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const MUSIC_RE = /\b(musical notation|music notation|stave|staves|staff lines|staff notation|clef|neume|neumatic|tablature|mensural|notehead|solmization|square notation|plainchant notation|four-line staff|five-line staff|five-line stave|four-line stave|musical (?:staff|score|example|passage|excerpt))/i;
const PAGE_TYPE_RE = /<page-type>\s*musical-score\s*<\/page-type>/i;

// Notation-system guess from the description's own vocabulary, then from the era.
function guessSystem(descText, year, bookTitle = '') {
  const t = descText.toLowerCase();
  // Shaker hymnals print pitch as letters; the OCR describes them as "musical
  // notation" without naming the system, so the book title is the tell.
  if (/letteral|letter notation|shaker/.test(t) || /shaker|sacred repository|millennial praises/i.test(bookTitle)) return 'letteral';
  if (/tablature|lute|fret/.test(t)) return 'tablature';
  if (/neume|neumatic|square notation|four-line|plainchant|gregorian/.test(t)) return 'neumes';
  if (/mensural|diamond-shaped|diamond shaped|lozenge|void note|ligature/.test(t)) return 'mensural';
  if (/five-line|treble clef|bass clef|g-clef|f-clef|engraved|bar ?lines|time signature/.test(t)) {
    if (year && year < 1600) return 'mensural';
    return 'common-practice';
  }
  if (year && year < 1450) return 'neumes';
  if (year && year < 1620) return 'mensural';
  if (year) return 'common-practice';
  return 'unknown';
}

const db = new DatabaseSync(path.join(CORPUS, 'corpus.sqlite'), { readOnly: true });
const hits = db.prepare(
  `select p.book_id, p.p from pages_src s join pages p on p.rowid = s.rowid where pages_src match ?`
).all(FTS_QUERY);
const byBook = new Map();
for (const h of hits) {
  if (!byBook.has(h.book_id)) byBook.set(h.book_id, new Set());
  byBook.get(h.book_id).add(h.p);
}
console.error(`recall: ${hits.length} pages in ${byBook.size} books`);

const catalog = db.prepare(
  `select id, title, display_title, author, language, year_num, visible, pages_count, collections from catalog where id = ?`
);

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPages = fs.createWriteStream(path.join(OUT_DIR, 'score-pages.jsonl'));
const rollup = {};
let done = 0, kept = 0;

for (const [bookId, pageSet] of byBook) {
  if (LIMIT && done >= LIMIT) break;
  done++;
  const file = path.join(CORPUS, 'books', `${bookId}.jsonl`);
  if (!fs.existsSync(file)) continue;
  const cat = catalog.get(bookId) || {};
  const year = cat.year_num || null;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (!pageSet.has(row.p)) continue;
    const ocr = row.ocr || '';
    const typed = PAGE_TYPE_RE.test(ocr);
    const descs = [];
    for (const m of ocr.matchAll(TAG_RE)) if (MUSIC_RE.test(m[2])) descs.push(m[2].replace(/\s+/g, ' ').trim());
    if (!typed && descs.length === 0) continue;
    const descText = descs.join(' ');
    const system = guessSystem(descText, year, `${cat.title || ''} ${cat.author || ''}`);
    const rec = {
      book_id: bookId,
      page_number: row.p,
      url: `https://sourcelibrary.org/book/${bookId}?page=${row.p}`,
      signal: typed ? 'page-type' : 'image-desc',
      examples: descs.length,           // notation blocks the OCR described on this page
      layout: typed || descs.length >= 3 ? 'full-page' : 'inline-example',
      notation_system: system,
      description: descs[0]?.slice(0, 240) || null,
    };
    outPages.write(JSON.stringify(rec) + '\n');
    kept++;
    const r = rollup[bookId] ||= {
      book_id: bookId,
      title: cat.display_title || cat.title || null,
      author: cat.author || null,
      language: cat.language || null,
      year,
      visible: !!cat.visible,
      pages_count: cat.pages_count || null,
      collections: cat.collections || null,
      score_pages: 0,
      full_pages: 0,
      systems: {},
      transcriptions: 0, // filled by future tech: rows in music_transcriptions
      first_page: row.p,
    };
    r.score_pages++;
    if (rec.layout === 'full-page') r.full_pages++;
    r.systems[system] = (r.systems[system] || 0) + 1;
  }
}
outPages.end();
const books = Object.values(rollup).sort((a, b) => b.score_pages - a.score_pages);
for (const b of books) b.notation_system = Object.entries(b.systems).sort((x, y) => y[1] - x[1])[0][0];
const summary = {
  generated: new Date().toISOString().slice(0, 10),
  corpus: 'local mirror (~/sl-corpus) — mirrored books only; re-run when the mirror grows',
  detector: 'OCR <image-desc>/<note> mentions of notation, or <page-type>musical-score',
  books: books.length,
  pages: kept,
  by_system: books.reduce((a, b) => { for (const [s, n] of Object.entries(b.systems)) a[s] = (a[s] || 0) + n; return a; }, {}),
  items: books,
};
fs.writeFileSync(path.join(OUT_DIR, 'by-book.json'), JSON.stringify(summary, null, 1) + '\n');
console.error(`kept ${kept} pages in ${books.length} books; by system: ${JSON.stringify(summary.by_system)}`);

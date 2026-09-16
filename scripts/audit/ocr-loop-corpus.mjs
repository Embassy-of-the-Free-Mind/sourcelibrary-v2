#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/detect-fabricated-ocr.mjs — a different fabrication class
 * (fluent invented prose on a BLANK leaf) which needs the page image to confirm, and
 * which measured repetition as a weak supporting signal only (0 confirmed of 316).
 * This one measures the repetition ITSELF, needs no image, and is exact.
 * Also: scripts/lib/ocr-loop-guard.mjs is the write-time half — the same verdict
 * function, so what this reports is exactly what the gate would have refused.
 *
 * Find stored OCR that is a degeneration loop, and the translations built on it (#4850).
 *
 * WHY
 * ---
 * A reader reported "all repeating" on a Balinese lontar. 156 of its 423 pages are
 * loops, and 102 of those already carry TRANSLATIONS — a model handed a loop writes
 * fluent connected prose with no basis in the page (#4765). The guard stops new ones;
 * this counts the ones already stored, because the translation is the part a reader
 * sees and neither the loop nor the prose fails loudly anywhere.
 *
 * NEVER WRITES. Withholding or re-OCR is a separate, reviewed step.
 *
 * Two sources, same verdict function:
 *   --mirror=DIR   read the local corpus mirror (~/sl-corpus/books/*.jsonl). Free and
 *                  fast — the whole corpus in minutes, no Atlas load. Per-machine.
 *   (default)      read Atlas book by book, with a checkpoint so a long walk can be
 *                  resumed; never streams one cursor across slow work.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/ocr-loop-corpus.mjs --book-id=6a20332318654bf8e19043ce
 *   node scripts/audit/ocr-loop-corpus.mjs --books=500 --out=scripts/output/ocr-loops.jsonl
 *   node scripts/audit/ocr-loop-corpus.mjs --mirror=$HOME/sl-corpus/books
 *
 * Flags:
 *   --book-id=ID[,ID]  audit these books only
 *   --books=N          random live books to audit (default 300; ignored with --book-id)
 *   --mirror=DIR       audit the local mirror instead of Atlas
 *   --out=FILE         JSONL of every flagged page (default scripts/output/ocr-loops.jsonl)
 *   --checkpoint=FILE  resume file for Atlas walks (default scripts/output/ocr-loops.checkpoint.json)
 *   --min-share=F      report threshold (default 0.30 — BELOW the gate's 0.50, so the
 *                      partial-loop band a human should look at is visible too)
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';

const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const flag = n => process.argv.includes(`--${n}`);

if (flag('apply') || flag('fix')) {
  console.error('This script never writes. Withholding or re-OCR of looping pages is a reviewed, separate step (#4850).');
  process.exit(2);
}

const BOOK_IDS = arg('book-id', '').split(',').filter(Boolean);
const N_BOOKS = Number(arg('books', '300'));
const MIRROR = arg('mirror', '');
const OUT = arg('out', 'scripts/output/ocr-loops.jsonl');
const CHECKPOINT = arg('checkpoint', 'scripts/output/ocr-loops.checkpoint.json');
const MIN_SHARE = Number(arg('min-share', '0.30'));

/** The gate's own threshold, so the report can say which rows it would have refused. */
const GATE_SHARE = 0.5;

const stats = { books: 0, pages: 0, judged: 0, refuse: 0, partial: 0, refuse_translated: 0 };
const byBook = new Map();

function judge({ bookId, bookTitle, pageId, pageNumber, text, translated, model }, sink) {
  stats.pages++;
  const v = loopVerdict(text);
  if (v.reason === 'body_too_short' || v.reason === 'guard_disabled') return;
  stats.judged++;
  if (v.share < MIN_SHARE) return;
  const band = v.refuse ? 'loop' : v.share >= GATE_SHARE ? 'below_reps' : 'partial';
  if (band === 'loop') {
    stats.refuse++;
    if (translated) stats.refuse_translated++;
  } else {
    stats.partial++;
  }
  const b = byBook.get(bookId) || { title: bookTitle, loop: 0, partial: 0, translated: 0 };
  b[band === 'loop' ? 'loop' : 'partial']++;
  if (band === 'loop' && translated) b.translated++;
  byBook.set(bookId, b);
  sink.write(JSON.stringify({
    book_id: bookId, title: bookTitle, page_id: pageId, page_number: pageNumber,
    band, share: v.share, period: v.period, reps: v.reps, covered: v.covered, body: v.body,
    unit: v.unit.slice(0, 60), model: model ?? null, translated: !!translated,
  }) + '\n');
}

async function fromMirror(sink) {
  const files = fs.readdirSync(MIRROR).filter(f => f.endsWith('.jsonl'));
  console.log(`Mirror: ${files.length} books in ${MIRROR}`);
  for (const f of files) {
    stats.books++;
    const bookId = f.replace(/\.jsonl$/, '');
    let lines;
    try { lines = fs.readFileSync(path.join(MIRROR, f), 'utf8').split('\n'); } catch { continue; }
    for (const line of lines) {
      if (!line) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      if (!d.ocr) continue;
      judge({ bookId, bookTitle: null, pageId: null, pageNumber: d.p, text: d.ocr, translated: !!d.tr }, sink);
    }
    if (stats.books % 5000 === 0) console.log(`  ${stats.books} books, ${stats.refuse} loops`);
  }
}

async function fromAtlas(sink) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = BOOK_IDS.length
    ? await db.collection('books').find({ id: { $in: BOOK_IDS } }, { projection: { id: 1, title: 1 } }).toArray()
    : await db.collection('books').aggregate([
      { $match: { visible: true, pages_ocr: { $gt: 0 } } },
      { $sample: { size: N_BOOKS } },
      { $project: { id: 1, title: 1 } },
    ], { maxTimeMS: 180000 }).toArray();

  // Checkpoint FIRST, then walk (lesson: never stream one cursor across slow work).
  const done = fs.existsSync(CHECKPOINT) ? new Set(JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')).done || []) : new Set();
  console.log(`Atlas: ${books.length} books (${done.size} already done in checkpoint)`);

  for (const book of books) {
    if (done.has(book.id)) continue;
    const pages = await db.collection('pages')
      .find({ book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } },
        { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1 } })
      .toArray();
    stats.books++;
    for (const p of pages) {
      judge({
        bookId: book.id, bookTitle: book.title, pageId: p.id, pageNumber: p.page_number,
        text: p.ocr?.data || '', translated: !!(p.translation?.data || '').length, model: p.ocr?.model,
      }, sink);
    }
    done.add(book.id);
    if (stats.books % 25 === 0) {
      fs.writeFileSync(CHECKPOINT, JSON.stringify({ done: [...done] }));
      console.log(`  ${stats.books} books, ${stats.refuse} loops`);
    }
  }
  fs.writeFileSync(CHECKPOINT, JSON.stringify({ done: [...done] }));
  await client.close();
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const sink = fs.createWriteStream(OUT, { flags: 'w' });

  if (MIRROR) await fromMirror(sink);
  else {
    if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
    await fromAtlas(sink);
  }
  sink.end();

  const pct = n => `${(n / Math.max(1, stats.judged) * 100).toFixed(2)}%`;
  console.log(`\nBooks ${stats.books}  pages ${stats.pages}  judged ${stats.judged}`);
  console.log(`LOOPS  ${stats.refuse} (${pct(stats.refuse)}) — the gate would refuse these`);
  console.log(`  of which already translated: ${stats.refuse_translated} (fabrication candidates, #4765)`);
  console.log(`PARTIAL (share ${MIN_SHARE}–${GATE_SHARE}, or too few repeats): ${stats.partial} — reported, NOT refused`);

  const worst = [...byBook.entries()].sort((a, b) => b[1].loop - a[1].loop).slice(0, 20);
  if (worst.length) {
    console.log('\nWorst books:');
    for (const [id, b] of worst) {
      if (!b.loop) continue;
      console.log(`  ${String(b.loop).padStart(5)} loops (${b.translated} translated)  ${id}  ${b.title || ''}`);
    }
  }
  console.log(`\nRows: ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });

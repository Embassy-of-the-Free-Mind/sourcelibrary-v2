#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/ocr-loop-corpus.mjs — the same mirror walk for degeneration loops,
 * which repeat across most of a page. This one checks short structures a loop check cannot
 * see: a planet column that breaks its fixed order, and a digit row copied from the row above.
 * The checks live in scripts/lib/table-sequence-check.mjs.
 *
 * Find stored OCR and English whose tables break an order the page itself must obey (#7274).
 *
 * WHY
 * ---
 * On the Book of Wonders p.140, 10 of 12 Friday planetary hours were wrong in the Arabic and
 * the English, and the page read fluently. Planetary hours follow a fixed order, so the error
 * is detectable from the text alone, with no image and no model. Faded red planet names that
 * the OCR model guessed were the cause on the pages checked by eye (pp.140, 143, 144).
 *
 * NEVER WRITES. Each row is a candidate for a by-eye look against the image.
 *
 * Reads the local corpus mirror (~/sl-corpus/books/*.jsonl, fields p/ocr/tr), so the whole
 * corpus costs nothing and puts no load on Atlas. The mirror can be days old: quote its date.
 *
 * Usage:
 *   node scripts/audit/table-sequence-corpus.mjs --mirror=$HOME/sl-corpus/books
 *   node scripts/audit/table-sequence-corpus.mjs --mirror=$HOME/sl-corpus/books --book-id=6953b56577f38f6761bd979d
 *
 * Flags:
 *   --mirror=DIR      the mirror's books directory (required)
 *   --catalog=FILE    titles for the report (default: DIR/../catalog.jsonl, optional)
 *   --book-id=ID[,ID] these books only
 *   --out=FILE        JSONL of every finding (default scripts/output/table-sequence.jsonl)
 */
import fs from 'node:fs';
import path from 'node:path';
import { sequenceFindings, repeatedRowFindings, orderedColumnCount } from '../lib/table-sequence-check.mjs';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
if (process.argv.includes('--apply') || process.argv.includes('--fix')) {
  console.error('This script never writes. A finding is checked against the image by eye first (#7274).');
  process.exit(2);
}

const MIRROR = arg('mirror', '');
if (!MIRROR) { console.error('--mirror=DIR is required.'); process.exit(1); }
const CATALOG = arg('catalog', path.join(MIRROR, '..', 'catalog.jsonl'));
const BOOK_IDS = new Set(arg('book-id', '').split(',').filter(Boolean));
const OUT = arg('out', 'scripts/output/table-sequence.jsonl');

const titles = new Map();
if (fs.existsSync(CATALOG)) {
  for (const line of fs.readFileSync(CATALOG, 'utf8').split('\n')) {
    if (!line) continue;
    try { const b = JSON.parse(line); titles.set(b.id, b.display_title || b.title); } catch { /* skip */ }
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const sink = fs.createWriteStream(OUT, { flags: 'w' });
const stats = { books: 0, pages: 0, ordered_pages: 0, sequence_pages: 0, hours_pages: 0, repeated_pages: 0 };
/** A full planetary-hours column: 12+ names stepping +1. Short planet lists are mostly enumerations
 *  in a non-Chaldean order (Sun, Moon, then the five), which the loose check flags too. */
const isHoursColumn = (x) => x.kind === 'sequence' && x.step === 1 && x.length >= 12;
const byBook = new Map();

const files = fs.readdirSync(MIRROR).filter((f) => f.endsWith('.jsonl'))
  .filter((f) => !BOOK_IDS.size || BOOK_IDS.has(f.replace(/\.jsonl$/, '')));
console.log(`Mirror: ${files.length} books in ${MIRROR}`);

for (const f of files) {
  const bookId = f.replace(/\.jsonl$/, '');
  stats.books++;
  let lines;
  try { lines = fs.readFileSync(path.join(MIRROR, f), 'utf8').split('\n'); } catch { continue; }
  for (const line of lines) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    stats.pages++;
    let ordered = false, seqHit = false, hoursHit = false, repHit = false;
    for (const field of ['ocr', 'tr']) {
      const text = d[field];
      if (!text) continue;
      if (orderedColumnCount(text)) ordered = true;
      const findings = [...sequenceFindings(text), ...repeatedRowFindings(text)];
      for (const x of findings) {
        if (x.kind === 'sequence') seqHit = true; else repHit = true;
        if (isHoursColumn(x)) hoursHit = true;
        sink.write(JSON.stringify({ book_id: bookId, title: titles.get(bookId) ?? null, page: d.p, field, hours: isHoursColumn(x), ...x }) + '\n');
      }
    }
    if (ordered) stats.ordered_pages++;
    if (seqHit) stats.sequence_pages++;
    if (hoursHit) stats.hours_pages++;
    if (repHit) stats.repeated_pages++;
    if (seqHit || repHit) {
      const b = byBook.get(bookId) || { sequence: 0, repeated: 0 };
      if (seqHit) b.sequence++;
      if (repHit) b.repeated++;
      byBook.set(bookId, b);
    }
  }
  if (stats.books % 5000 === 0) console.log(`  ${stats.books} books, ${stats.sequence_pages} sequence pages`);
}
sink.end();

console.log(`\nBooks ${stats.books}  pages ${stats.pages}`);
console.log(`Pages with an ordered planet column (7+ names on one step): ${stats.ordered_pages}`);
console.log(`  of which a column breaks its order: ${stats.sequence_pages}`);
console.log(`  of which a full planetary-hours column (12+, step +1) breaks: ${stats.hours_pages}  <- start here`);
console.log(`Pages with an identical adjacent digit row: ${stats.repeated_pages}`);
const worst = [...byBook.entries()].sort((a, b) => (b[1].sequence + b[1].repeated) - (a[1].sequence + a[1].repeated)).slice(0, 25);
if (worst.length) console.log('\nBooks with the most flagged pages (sequence / repeated row):');
for (const [id, b] of worst) console.log(`  ${String(b.sequence).padStart(4)} / ${String(b.repeated).padStart(4)}  ${id}  ${titles.get(id) || ''}`);
console.log(`\nRows: ${OUT}`);

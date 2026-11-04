#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/tokens.mjs counts the calls an eval MADE; nothing projects how many calls
// the 4/call reader would make on whole lane books, where only a short page (translate-batch-seam MIN_OCR_CHARS_FOR_BLOCK)
// or a refused/drifted block ends a block. planBlocks is imported, not copied.
/**
 * #5600: planned calls per page at --per-call=4 over the WHOLE untranslated page lists of the 30 drawn books (the
 * lane reads a book end to end; the eval's 4-page blocks also end at the draw's edges). Read only.
 *
 *   node --env-file=... scripts/eval/siku-percall-5600/lane-calls.mjs --scratch=DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { planBlocks, MIN_OCR_CHARS_FOR_BLOCK } from '../../lib/translate-batch-seam.mjs';
import { isTranslatablePage } from '../../lib/translate-core.mjs';
import { UNTRANSLATED } from '../../batch/cli-translate-lane.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const S = path.resolve(process.argv.find((a) => a.startsWith('--scratch='))?.slice(10) || '.');
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
let pages = 0, calls = 0, short = 0;
const sizes = {};
for (const b of draw.books) {
  const ps = (await c.db('bookstore').collection('pages').find({ book_id: b.book_id, ...UNTRANSLATED }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray()).filter((p) => isTranslatablePage(p).ok);
  // Runs of consecutive page numbers, as claude-translate.mjs groups them.
  const runs = [];
  for (const p of ps) { const r = runs.at(-1); if (r && r.at(-1).page_number + 1 === p.page_number) r.push(p); else runs.push([p]); }
  const blocks = runs.flatMap((r) => planBlocks(r, { blockSize: 4 }));
  pages += ps.length; calls += blocks.length; short += ps.filter((p) => (p.ocr?.data || '').length < MIN_OCR_CHARS_FOR_BLOCK).length;
  for (const bl of blocks) sizes[bl.length] = (sizes[bl.length] || 0) + 1;
}
await c.close();
const out = { books: draw.books.length, pages, planned_calls: calls, calls_per_page: +(calls / pages).toFixed(3), short_pages: short, short_share: +(short / pages).toFixed(3), min_ocr_chars_for_block: MIN_OCR_CHARS_FOR_BLOCK, call_sizes: sizes };
fs.writeFileSync(path.join(S, 'lane-calls.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));

#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr-lane.mjs `correct --reread-per-call=4` (the read@4 route: chunks of 4 consecutive pages
// of a book in one agy call). The #7947 draw's 3 pages a book are 25/50/75% through it, never consecutive, and
// cli-ocr.mjs read starts a new call at every gap, so they would go 1 a call. This builds the page-ids file that gives
// each drawn page the 3 pages after it (the 3 before at a book's end), so the arm is read 4 a call as the lane reads.
/**
 *   node --env-file=… scripts/eval/latin-ms-reader-7947/blocks.mjs --set <dir>/ms.json --out <file.json>
 * Writes a JSON array of page ids (cli-ocr.mjs --page-ids-file) in book/page order. Mongo is READ only.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const opt = (k) => args[args.indexOf(`--${k}`) + 1];
const set = JSON.parse(fs.readFileSync(opt('set'), 'utf8'));
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const pages = client.db('bookstore').collection('pages');
const ids = [];
for (const p of set) {
  const book = await pages.find({ book_id: p.book_id, page_number: { $gte: p.page_number - 3, $lte: p.page_number + 3 } },
    { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
  const after = book.filter((q) => q.page_number >= p.page_number && q.page_number <= p.page_number + 3);
  const before = book.filter((q) => q.page_number <= p.page_number && q.page_number >= p.page_number - 3);
  // A book under 4 pages long reads what it has (the lane would too).
  const block = after.length === 4 ? after : before.length === 4 ? before : (after.length >= before.length ? after : before);
  if (block.some((q, i) => i && q.page_number !== block[i - 1].page_number + 1)) throw new Error(`gap in the block of ${p.book_id} p${p.page_number}`);
  if (block.length < 4) console.log(`  ${p.book_id} p${p.page_number}: a block of ${block.length}`);
  ids.push(...block.map((q) => q.id));
}
fs.writeFileSync(opt('out'), JSON.stringify([...new Set(ids)]));
console.log(`${set.length} drawn pages → ${new Set(ids).size} page ids in blocks of 4`);
await client.close();

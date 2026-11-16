#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/error-zoo/repair-pilot/select.mjs writes a manifest from a selection query; this only turns
 * a list of {book_id, page_number} (the pages a dry run would write) into manifest rows with page ids, so
 * repair-pilot/snapshot.mjs can freeze them before the write. Read-only.
 *
 *   node --env-file=… ids-for.mjs IN.json OUT/manifest.jsonl
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const [IN, OUT] = process.argv.slice(2);
const want = JSON.parse(fs.readFileSync(IN, 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const rows = [];
for (const w of want) {
  // A hidden repeat capture keeps its page_number (#5056): more than one row is an error, not a pick.
  const ps = await c.db('bookstore').collection('pages').find({ book_id: w.book_id, page_number: w.page_number, hidden: { $ne: true } }, { projection: { id: 1 } }).toArray();
  if (ps.length !== 1) throw new Error(`${ps.length} visible pages for ${w.book_id} p.${w.page_number}`);
  const p = ps[0];
  rows.push({ page_id: p.id, book_id: w.book_id, page_number: w.page_number });
}
await c.close();
fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${rows.length} pages → ${OUT}`);

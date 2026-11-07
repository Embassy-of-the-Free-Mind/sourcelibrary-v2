#!/usr/bin/env node
// PRIOR ART: scripts/eval/caseless-drift-7503/calibrate.mjs (the 60 pages the rule was fitted on; this is the
// held-out check). scripts/audit/translation-page-boundaries.mjs audits served boundaries in cased prose only.
/**
 * #7503 held-out floor for block-drift's caseless branch: how often it fires on page breaks of production Chinese
 * translations, by the lane that wrote both pages (translation.engine.call_site). On a ONE-page-per-call lane every
 * flag is a false positive or a word the reader finished across the break, so its rate is the guard's floor; a block
 * lane's excess over that floor is drift already served.
 *
 *   node --env-file=.env.production.local scripts/eval/caseless-drift-7503/floor.mjs [--books=400] [--out=DIR]
 *
 * Books: a Mongo $sample (not seedable) of books whose language starts "Chinese"/"Classical Chinese" with >= 8 pages
 * translated, minus the 15 books of #7518. Pairs: consecutive page numbers, both translated by the same call site,
 * N+1's OCR Han (isHanSource). Writes floor.json beside this file (and the raw pull to --out, if given). Read only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { detectBlockDrift, isHanSource } from '../../lib/block-drift.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const evalBooks = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(HERE, 'ocr.json'), 'utf8'))));

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const books = await db.collection('books').aggregate([
  { $match: { language: { $regex: '^(Classical )?Chinese', $options: 'i' }, pages_translated: { $gte: 8 } } },
  { $sample: { size: Number(arg('books') || 400) } }, { $project: { id: 1 } }]).toArray();

const pairs = {}, flags = {};
for (const b of books) {
  const bid = b.id || String(b._id); if (evalBooks.has(bid)) continue;
  const pages = await db.collection('pages').find({ book_id: bid, 'translation.data': { $exists: true, $ne: '' } },
    { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.engine.call_site': 1, 'translation.model': 1 } }).sort({ page_number: 1 }).toArray();
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i], n = pages[i + 1];
    if (n.page_number !== a.page_number + 1 || !a.ocr?.data || !n.ocr?.data || !isHanSource(n.ocr.data)) continue;
    const site = a.translation.engine?.call_site ?? null;
    if (site !== (n.translation.engine?.call_site ?? null)) continue;
    const lane = `${site || 'unrecorded'} | ${a.translation.model === n.translation.model ? a.translation.model : 'mixed'}`;
    pairs[lane] = (pairs[lane] || 0) + 1;
    if (detectBlockDrift({ ocrPrev: a.ocr.data, ocrNext: n.ocr.data, trPrev: a.translation.data, trNext: n.translation.data, caseless: true }).drift) flags[lane] = (flags[lane] || 0) + 1;
  }
}
await client.close();
const rows = Object.entries(pairs).sort((x, y) => y[1] - x[1])
  .map(([lane, n]) => ({ lane, pairs: n, flagged: flags[lane] || 0, pct: +(((flags[lane] || 0) / n) * 100).toFixed(2) }));
const res = { at: new Date().toISOString(), books_sampled: books.length, rows };
fs.writeFileSync(path.join(HERE, 'floor.json'), JSON.stringify(res, null, 1) + '\n');
console.log(JSON.stringify(rows.slice(0, 12), null, 1));

// PRIOR ART: scripts/eval/translation-ab-5606/draw-candidates.mjs draws candidate pages per book into one JSONL; the
// reference cutters (REF-AGENT-BRIEF.md) read ONE file per book and must pick a page we actually serve.
/** split-cands.mjs <candidates.jsonl> <out dir> — one <lang>/<book_id>.json per book, each candidate flagged `served`, served first (read-only). */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const [IN, OUTDIR] = process.argv.slice(2);
const rows = fs.readFileSync(IN, 'utf8').trim().split('\n').map(JSON.parse);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const by = {};
for (const r of rows) {
  const p = await db.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: { 'translation.data': 1 } });
  r.served = !!(p?.translation?.data || '').trim();
  (by[`${r.lang}/${r.book_id}`] ??= []).push(r);
}
for (const [k, list] of Object.entries(by)) {
  list.sort((a, b) => b.served - a.served); // served pages first, draw order otherwise
  fs.mkdirSync(path.join(OUTDIR, path.dirname(k)), { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, `${k}.json`), JSON.stringify(list, null, 1));
  console.log(k, list.length, list.filter((x) => x.served).length, 'served');
}
await c.close();

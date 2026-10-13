// PRIOR ART: scripts/eval/tibetan-nyingma-reference/sample_nyingma.mjs — same one-page-per-book-per-served-class
// draw; this adds two DISCOVERY pages per book, disjoint from the scored ones, so the reference e-text is chosen
// on pages that are then not scored (no selection bias). Read-only. Seed 2026100701.
//   node --env-file=/root/sourcelibrary/.env.production.local draw_terma.mjs /root/tib-bl-evidence/strata.json /root/tib-bl-evidence/draw/
import { makeRng } from '../lib/paired-stats.mjs';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/root/sourcelibrary/package.json');
const { MongoClient } = require('mongodb');
const [strataFile, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const rnd = makeRng(2026100701);
const books = JSON.parse(fs.readFileSync(strataFile, 'utf8')).filter((b) => b.stratum === 'terma-bio');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const cls = (p) => p.ocr?.verdict?.verdict || (p.ocr?.unreadable ? 'UNREADABLE_OTHER' : 'NO_VERDICT');
const pick = (arr) => arr.splice(Math.floor(rnd() * arr.length), 1)[0];
const scored = fs.createWriteStream(OUT + 'terma-scored.jsonl');
const disc = fs.createWriteStream(OUT + 'terma-discovery.jsonl');
let ns = 0, nd = 0;
for (const b of books) {
  const cand = await pages.find({ book_id: b.id, 'ocr.data': { $exists: true } },
    { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.unreadable': 1, 'ocr.verdict': 1 } }).sort({ page_number: 1 }).toArray();
  const ok = cand.filter((p) => (p.ocr.data || '').length >= 600);
  const byCls = {};
  for (const p of ok) (byCls[cls(p)] ||= []).push(p);
  const used = new Set();
  const row = (p, k, kind) => JSON.stringify({ id: `${b.id}_${p.page_number}`, book_id: b.id, page_number: p.page_number,
    kind, verdict: k, work: b.work, coll: b.coll, title: b.title, arm: p.ocr.model || 'unknown', v_rule: p.ocr?.verdict?.rule ?? null,
    text: p.ocr.data }) + '\n';
  for (const k of Object.keys(byCls).sort()) {
    const p = pick(byCls[k]); used.add(p.page_number); scored.write(row(p, k, 'scored')); ns++;
  }
  // discovery: prefer SERVE pages (the served read most likely to retrieve), else any class
  const pool = (byCls.SERVE?.length ? byCls.SERVE : Object.values(byCls).flat()).filter((p) => !used.has(p.page_number));
  for (let i = 0; i < 2 && pool.length; i++) { const p = pick(pool); disc.write(row(p, cls(p), 'discovery')); nd++; }
}
scored.end(); disc.end();
console.error(`terma books ${books.length}; scored pages ${ns}; discovery pages ${nd}`);
await c.close();

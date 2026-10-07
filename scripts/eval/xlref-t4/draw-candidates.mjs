#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/t2/draw-pages.mjs (T2 job, unmerged) and scripts/eval/lib/sampling.mjs draw pages corpus-wide; here the BOOKS are fixed by where a published English exists, so this only orders each book's translated body pages with a seed, so an alignment agent takes the first page it can align instead of choosing one.
/** Seeded candidate pages per book for #5695 T4: translated pages with real text, from the middle 10–90% of the book. Read-only. */
//   node --env-file=… scripts/eval/xlref-t4/draw-candidates.mjs <books.txt (one id per line)> <out.json> [--seed 5695] [--n 10]
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
const [IN, OUT] = process.argv.slice(2);
const SEED = Number(process.argv.includes('--seed') ? process.argv[process.argv.indexOf('--seed') + 1] : 5695);
const N = Number(process.argv.includes('--n') ? process.argv[process.argv.indexOf('--n') + 1] : 10);
const ids = fs.readFileSync(IN, 'utf8').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const out = {};
try {
  for (const id of ids) {
    const ps = await pages.find({ book_id: id }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
    const max = ps.length ? ps[ps.length - 1].page_number : 0;
    const ok = ps.filter((p) => (p.ocr?.data || '').length > 300 && (p.translation?.data || '').length > 300 && p.page_number > 0.1 * max && p.page_number < 0.9 * max).map((p) => p.page_number);
    resetSeed(SEED + [...id].reduce((s, ch) => s + ch.charCodeAt(0), 0));
    for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
    out[id] = { pages_total: ps.length, eligible: ok.length, candidates: ok.slice(0, N) };
    console.log(id, ps.length, ok.length, ok.slice(0, N).join(','));
  }
} finally { await c.close(); }
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

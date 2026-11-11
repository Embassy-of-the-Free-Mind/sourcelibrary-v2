// Question search (#6875), live check step 2: for every blockquote or quoted span in a stored Librarian answer,
// find the page link that follows it and say whether the quoted words are on that page (translation or OCR).
//
// PRIOR ART: src/lib/embassy/citation-pages.ts (checkCitationPages) runs the same test inside the turn and rewrites
//   the answer; this only reports, after the fact, over a live-check file.
//
//   node --env-file=<.env.production.local> scripts/eval/question-search-6875/quote-check.mjs <live.jsonl>
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((r) => r.answer);
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const LINK = /sourcelibrary\.org\/book\/([a-z0-9-]+)(?:\?page=|\/page-number\/)(\d+)/;

for (const r of rows) {
  const lines = r.answer.split('\n');
  const checks = [];
  for (let i = 0; i < lines.length; i++) {
    const quotes = [...lines[i].matchAll(/"([^"]{40,})"|“([^”]{40,})”/g)].map((m) => m[1] || m[2]);
    if (!quotes.length) continue;
    let link = null;
    for (let j = i; j < Math.min(lines.length, i + 3) && !link; j++) link = lines[j].match(LINK);
    if (!link) { checks.push({ q: quotes[0].slice(0, 50), verdict: 'no link' }); continue; }
    const book = await db.collection('books').findOne({ $or: [{ slug: link[1] }, { id: link[1] }] }, { projection: { id: 1 } });
    const page = book && await db.collection('pages').findOne({ book_id: book.id, page_number: Number(link[2]) }, { projection: { 'translation.data': 1, 'ocr.data': 1 } });
    const hay = norm(`${page?.translation?.data || ''} ${page?.ocr?.data || ''}`);
    for (const q of quotes) {
      const parts = q.split(/\.\.\.|…|\[[^\]]*\]/).map(norm).filter((p) => p.split(' ').length >= 4);
      const found = parts.filter((p) => hay.includes(p)).length;
      checks.push({ q: q.slice(0, 50), page: `${link[1]}:${link[2]}`, verdict: !page ? 'page missing' : found === parts.length ? 'on page' : found ? `partly (${found}/${parts.length})` : 'NOT on page' });
    }
  }
  console.log('==', r.q);
  for (const k of checks) console.log('  ', k.verdict.padEnd(14), k.page || '', '|', k.q);
}
await c.close();

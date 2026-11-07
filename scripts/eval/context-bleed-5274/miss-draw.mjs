#!/usr/bin/env node
// PRIOR ART: scripts/eval/context-bleed-5274/scan.mjs (the screen this measures the misses of; its srcWeight is copied).
/**
 * Misses of the context-bleed screen (#5274): low-text translated leaves the screen did NOT flag.
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/miss-draw.mjs --scan=DIR --out=FILE [--books=400] [--n=30]
 *
 * Seeded draw of --books books with English (weighted by nothing: one book is one draw). In each, every page with
 * English whose OCR weight (scan.mjs srcWeight, Han ×8) is under 150 — a nearly empty leaf — and that is not in
 * cands.jsonl. Writes the count per book (for the population estimate) and a judge sample: --n pages, one per book.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
// scan.mjs's srcWeight, copied: importing scan.mjs would run the scan
const BLOCKS = /<(meta|image-desc|detected-images|vocab|summary|keywords|warning|note|scan-quality|language|lang|page-type|script|columns)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
function srcWeight(ocr) {
  const t = String(ocr || '').replace(BLOCKS, ' ').replace(/->|<-/g, ' ').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').replace(/\[[^\]]{0,40}\]/g, ' ').replace(/\s+/g, '');
  return { w: t.length + 7 * (t.match(HAN) || []).length };
}

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const SCAN = path.resolve(arg('scan'));
const flagged = new Set(fs.readFileSync(path.join(SCAN, 'cands.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id));
const stats = fs.readFileSync(path.join(SCAN, 'stats.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let a = 52743;
const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const books = [...stats].sort(() => rnd() - 0.5).slice(0, Number(arg('books', 400)));
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const pages = c.db('bookstore').collection('pages');
const per = [];
const pick = [];
for (const b of books) {
  const rows = await pages.aggregate([
    { $match: { book_id: b.book_id, page_number: { $gt: 0 } } },
    { $project: { _id: 0, id: 1, page_number: 1, ocr: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, has: { $or: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $eq: [{ $type: '$translation_withheld.text' }, 'string'] }] } } },
    { $match: { has: true } },
    { $project: { id: 1, page_number: 1, ocr: { $substrCP: ['$ocr', 0, 6000] } } },
  ]).toArray();
  const low = rows.filter((r) => !flagged.has(r.id) && srcWeight(r.ocr.replace(/<detected-images>[\s\S]*?<\/detected-images>/gi, '')).w < 150);
  per.push({ book_id: b.book_id, language: b.language, pages_en: rows.length, low_unflagged: low.length });
  if (low.length) { const r = low[Math.floor(rnd() * low.length)]; pick.push({ page_id: r.id, book_id: b.book_id, page: r.page_number, band: 'miss', language: b.language }); }
}
await c.close();
const n = Number(arg('n', 30));
const out = { books: per.length, pages_en: per.reduce((s, r) => s + r.pages_en, 0), low_unflagged: per.reduce((s, r) => s + r.low_unflagged, 0), books_with_low: pick.length, sample: pick.slice(0, n), per };
fs.writeFileSync(path.resolve(arg('out')), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ books: out.books, pages_en: out.pages_en, low_unflagged: out.low_unflagged, books_with_low: out.books_with_low, sample: out.sample.length }));

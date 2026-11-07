#!/usr/bin/env node
// PRIOR ART: scripts/eval/context-bleed-5274/scan.mjs shareIn (English to English); scripts/audit/r2-key-book-scope.mjs
// and the #3362 detectors (whole-image identity, not a transcription that repeats its neighbour). Neither asks whether a
// page's OWN transcription is its neighbour's text, which decides whether re-translating it can help.
/**
 * Is the page's OCR itself a neighbour's text? (#5274, by eye 2026-11-04: a blank verso whose OCR transcribed the recto's
 * show-through; a Greek leaf whose OCR is the next leaf's Latin.) Re-translating such a page from its own OCR gives the
 * same wrong English, so the fix lists it instead of spending a call.
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/ocr-overlap.mjs --queue=FILE.jsonl --out=FILE.jsonl
 *
 * Per queued page: the share of its OCR tokens (Latin-script words of 4+ letters; for Han, character bigrams) found in
 * the OCR of n-1 and of n+1. `ocr_dup` when either share ≥ 0.6 over at least 12 tokens. $0, secondary reads.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STRIP = /<(meta|image-desc|detected-images|vocab|summary|keywords|warning|note|lang|language|page-type|page-num|header|sig|script|scan-quality)\b[^>]*>[\s\S]*?<\/\1>/gi;
export function tokens(ocr) {
  const t = String(ocr || '').replace(STRIP, ' ').replace(/<[^>]+>/g, ' ');
  const han = t.match(/\p{Script=Han}/gu) || [];
  if (han.length >= 12) { const s = han.join(''); const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; }
  return (t.toLowerCase().match(/\p{L}{4,}/gu) || []);
}
const share = (a, b) => { if (a.length < 12 || !b.length) return null; const B = new Set(b); return +(a.filter((w) => B.has(w)).length / a.length).toFixed(3); };

const rows = fs.readFileSync(arg('queue'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const pages = c.db('bookstore').collection('pages');
const byBook = new Map();
for (const r of rows) (byBook.get(r.book_id) ?? byBook.set(r.book_id, []).get(r.book_id)).push(r);
const out = [];
let k = 0;
for (const [b, rs] of byBook) {
  const want = [...new Set(rs.flatMap((r) => [r.page - 1, r.page, r.page + 1]))];
  const m = new Map((await pages.find({ book_id: b, page_number: { $in: want } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.page_number, tokens(p.ocr?.data)]));
  for (const r of rs) {
    const me = m.get(r.page) || [];
    const prev = share(me, m.get(r.page - 1) || []), next = share(me, m.get(r.page + 1) || []);
    out.push({ page_id: r.page_id, book_id: b, page: r.page, n_tokens: me.length, ocr_prev: prev, ocr_next: next, ocr_dup: Math.max(prev ?? 0, next ?? 0) >= 0.6 });
  }
  if (++k % 500 === 0) console.log(`${k}/${byBook.size} books`);
}
await c.close();
fs.writeFileSync(arg('out'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(JSON.stringify({ pages: out.length, ocr_dup: out.filter((o) => o.ocr_dup).length, judged: out.filter((o) => o.ocr_prev != null || o.ocr_next != null).length }));

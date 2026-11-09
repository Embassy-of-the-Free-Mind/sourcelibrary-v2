#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/wrong-leaf-fix-5021.mjs gate-pick (a stratified pick over its own route classes, not
// one slice's language × OCR-first cells, and no era rule) and its `run --frame=ids`, which this feeds; slice-frame.mjs
// (this directory) builds the queue's input. Neither picks the next wave of a queue by ledger state, so this does.
/**
 * slice-waves — the gate pick and the wave picks for the #5026 round-3 slice (Latin and German print, OCR-screen clean).
 *
 *   node --env-file=… scripts/eval/leak-repair-5026/slice-waves.mjs gate --fix=DIR --n=44 --seed=S --out=FILE
 *        [--exclude-samples=a.json,b.json] [--exclude-ledgers=a.jsonl,…]
 *   node --env-file=… scripts/eval/leak-repair-5026/slice-waves.mjs wave --fix=DIR --size=2000 --out=FILE
 *
 * THE ERA RULE (gate 1, 2026-11-08): books printed before 1501 are left out. Of the 4 incunabula in gate 1's 30
 * judged pages, 3 were not usable (Summa 1489, Manuale confessorum 1475, Anselm 14uu: reversed or garbled sense in
 * dense abbreviated gothic Latin), against 2 of the other 26. The stored OCR expands the abbreviations, so it cannot be
 * measured from the text; the print date is the proxy. A book with no readable date stays in.
 *
 * gate: one page per book from books no earlier post-check or ledger used, in proportion to the queue's
 *       (Latin|German) × OCR-first cells, seeded. wave: the next SIZE pages of the queue (it is ranked books with readers
 *       first) whose ledger state is not final, by whole books, era rule applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const MODE = process.argv[2];
const arg = (n, d = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const ROMAN = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
const roman = (s) => { let t = 0; for (let i = 0; i < s.length; i++) { const v = ROMAN[s[i]], n = ROMAN[s[i + 1]] || 0; t += v < n ? -v : v; } return t; };
/** The print year a `published` string names, or null: "1489", "[ca. 1497]", "14uu", "15th century", "MDXLIX.". */
export function printYear(s) {
  const t = String(s ?? '').trim();
  let m = t.match(/\b(1[0-9]{3})\b/); if (m) return Number(m[1]);
  m = t.match(/\b(1[0-9])([0-9])u\b/); if (m) return Number(`${m[1]}${m[2]}5`);
  m = t.match(/\b(1[0-9])uu\b/); if (m) return Number(`${m[1]}50`);
  m = t.match(/\b(\d{1,2})(st|nd|rd|th) cen/i); if (m) return (Number(m[1]) - 1) * 100 + 50;
  if (/medieval/i.test(t)) return 1400;
  m = t.match(/\b(M[MDCLXVI.\s]{2,})/); if (m) { const y = roman(m[1].replace(/[.\s]/g, '')); if (y >= 1000 && y < 2000) return y; }
  return null;
}
export const eraOut = (published) => { const y = printYear(published); return y != null && y < 1501; };

const FINAL = new Set(['retranslated', 'ocr-refused', 'apply-refused', 'read-failed', 'not-translatable', 'skip-human', 'skip-changed', 'skip-gone', 'gate-refused', 'skip-opus-context', 'skip-ocr-neighbour', 'ocr-neighbour-persists']);
const FIX = path.resolve(arg('fix', '.'));
const q = readJsonl(path.join(FIX, 'queue.jsonl'));
const led = new Map(readJsonl(path.join(FIX, 'ledger.jsonl')).map((r) => [r.page_id, r]));
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const years = new Map((await c.db('bookstore').collection('books').find({ id: { $in: [...new Set(q.map((r) => r.book_id))] } }, { projection: { _id: 0, id: 1, published: 1 } }).toArray()).map((b) => [b.id, b.published]));
await c.close();
const live = q.filter((r) => !FINAL.has(led.get(r.page_id)?.state));
const kept = live.filter((r) => !eraOut(years.get(r.book_id)));
const summary = { queue: q.length, not_final: live.length, era_out: live.length - kept.length, era_out_books: new Set(live.filter((r) => eraOut(years.get(r.book_id))).map((r) => r.book_id)).size, eligible: kept.length };

let ids = [];
if (MODE === 'gate') {
  const excl = new Set([
    ...String(arg('exclude-samples', '')).split(',').filter(Boolean).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).map((r) => r.book)),
    ...String(arg('exclude-ledgers', '')).split(',').filter(Boolean).flatMap((f) => readJsonl(f).map((r) => r.book_id)),
    ...[...led.values()].map((r) => r.book_id),
  ]);
  const rnd = mulberry32(Number(arg('seed', 50266)));
  const cell = (r) => `${/^german/i.test(r.language) ? 'German' : 'Latin'}|${r.ocr_first ? 'reread' : 'ocr-ok'}`;
  const N = Number(arg('n', 44));
  const tot = kept.length, want = {};
  for (const r of kept) want[cell(r)] = (want[cell(r)] || 0) + 1;
  for (const k of Object.keys(want)) want[k] = Math.max(1, Math.round((want[k] / tot) * N));
  const byBook = new Map(); for (const r of kept) if (!excl.has(r.book_id)) (byBook.get(r.book_id) ?? byBook.set(r.book_id, []).get(r.book_id)).push(r);
  const books = [...byBook.keys()].sort();
  for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
  for (const b of books) {
    const rs = byBook.get(b), r = rs[Math.floor(rnd() * rs.length)];
    if ((want[cell(r)] || 0) > 0) { want[cell(r)]--; ids.push(r); }
    if (ids.length >= N) break;
  }
  summary.excluded_books = excl.size;
} else if (MODE === 'wave') {
  const size = Number(arg('size', 2000));
  const order = []; const by = new Map();
  for (const r of kept) { if (!by.has(r.book_id)) { by.set(r.book_id, []); order.push(r.book_id); } by.get(r.book_id).push(r); }
  for (const b of order) { if (ids.length >= size) break; ids.push(...by.get(b)); }
} else { console.error('usage: slice-waves.mjs gate|wave --fix=DIR --out=FILE (see the header)'); process.exit(2); }
summary.picked = ids.length; summary.books = new Set(ids.map((r) => r.book_id)).size; summary.with_readers = ids.filter((r) => r.reads > 0).length;
summary.cells = ids.reduce((m, r) => { const k = `${/^german/i.test(r.language) ? 'German' : 'Latin'}|${r.ocr_first ? 'reread' : 'ocr-ok'}`; m[k] = (m[k] || 0) + 1; return m; }, {});
fs.writeFileSync(arg('out'), JSON.stringify(ids.map((r) => r.page_id)));
console.log(JSON.stringify(summary, null, 1));

#!/usr/bin/env node
// PRIOR ART: scripts/eval/leak-repair-5026/pair-judge.mjs (refresh, inFrame, direction): the live frame of the whole
// detector output, every language; scripts/maintenance/wrong-leaf-fix-5021.mjs build/enqueue: the runner's queue from
// a page list. Neither cuts the frame to one slice, so this is the round-3 slice (#5026, 2026-11-08: "gate ONLY the
// OCR-screen-clean Latin and German print slice") on top of them.
/**
 * slice-frame — the Latin and German PRINT pages of the #5026 leak frame whose OCR passes the neighbour screen.
 *
 *   node --env-file=.env.production.local scripts/eval/leak-repair-5026/slice-frame.mjs \
 *        --live=DIR/live-frame.jsonl --out=DIR [--ledgers=a.jsonl,b.jsonl]
 *
 * A pair is in the slice when
 *  - it is still flagged on the live English and inFrame() (pair-judge.mjs: run >= 500, both leaves carry text, not
 *    one text, not printed English, page > 0, no human edit, nothing withheld);
 *  - the book is not English (en) and not Tibetan or Pali (the refrains printed twice, #5026 spot check);
 *  - the page to repair (direction(): leak → N+1, forward/ident → N, unclear → both) reads Latin or German: its own
 *    language (ocr.language, else the OCR <lang> tag; the book's language when the page has none) names Latin or
 *    German FIRST, and the book's language names Latin or German and no English;
 *  - PRINT: neither page of the pair is tagged handwritten or mixed (pages.script_type, the OCR's <script> tag), the
 *    book's script_type is not handwritten/mixed, and under 5% of the book's tagged pages are handwritten or mixed;
 *  - the OCR-neighbour screen (ocr-neighbour.mjs) is CLEAN on both pages of the pair.
 * A page an earlier ledger (pilot, round 2) already took is left out. Writes DIR/slice-pages.json ({pages:[…]}, the
 * runner's `enqueue --from=` shape, src leak5026-<dir>-N|N1) and DIR/slice-summary.json (the cut, step by step).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { screen } from './ocr-neighbour.mjs';

const arg = (n, d = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const OUT = path.resolve(arg('out', '.'));
fs.mkdirSync(OUT, { recursive: true });

// pair-judge.mjs's frame rules, repeated (importing it runs its CLI). Kept identical; see its comments.
export function inFrame(r) {
  if (r.live === 'missing' || !(r.len >= 500)) return false;
  if (r.prev <= 0 || r.human || r.withheld) return false;
  if (r.ocr_a < 300 || r.ocr_b < 300) return false;
  if (r.ocr_share != null && r.ocr_share >= 0.5) return false;
  if (r.printed >= 0.3) return false;
  return true;
}
export const direction = (r) => (r.len >= 0.8 * Math.min(r.a, r.b) ? 'ident' : r.posA <= 0.15 ? 'leak' : r.endA >= 0.85 && r.posB <= 0.35 ? 'forward' : 'unclear');

const LA_DE = /^\s*(latin|german|neo-?latin|early new high german|middle high german|la|lat|de|deu|ger)\b/i;
// The page's own language when it has one: ocr.language, else the OCR's <lang> tag. Most stored pages have neither
// (null, "auto-detect", "Unknown": 235 + 34 + 8 of 600 sampled), and those fall back to the book's language.
const UNSET = /^\s*(auto-detect|unknown|none|n\/a|null|undefined)?\s*$/i;
const ownLang = (p) => [p?.ocr?.language, String(p?.ocr?.data || '').match(/<lang>\s*([^<]+?)\s*<\/lang>/i)?.[1]].map((x) => String(x ?? '')).find((x) => !UNSET.test(x)) || '';
let pageLang = (p) => ownLang(p);
const scriptTag = (p) => (String(p?.ocr?.data || '').match(/<script>\s*(\w+)\s*<\/script>/i)?.[1] || '').toLowerCase();
const notPrint = (p) => ['handwritten', 'mixed'].includes(String(p?.script_type || '').toLowerCase()) || ['handwritten', 'mixed'].includes(scriptTag(p));

const live = readJsonl(arg('live'));
const cut = { flagged_pairs: live.length };
let pairs = live.filter(inFrame);
cut.in_frame = pairs.length;
pairs = pairs.filter((r) => !/english/i.test(r.lang || '') && !/tibetan|pali/i.test(r.lang || ''));
cut.not_english_tibetan_pali = pairs.length;

const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const db = c.db('bookstore');
const bookIds = [...new Set(pairs.map((r) => r.book))];
const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { _id: 0, id: 1, language: 1, script_type: 1, human_read_count: 1 } }).toArray()).map((b) => [b.id, b]));
// book profile: tagged pages handwritten / mixed / printed
const prof = new Map();
for (const r of await db.collection('pages').aggregate([
  { $match: { book_id: { $in: bookIds }, script_type: { $in: ['handwritten', 'mixed', 'printed'] } } },
  { $group: { _id: { b: '$book_id', s: '$script_type' }, n: { $sum: 1 } } },
]).toArray()) { const m = prof.get(r._id.b) || { handwritten: 0, mixed: 0, printed: 0 }; m[r._id.s] = r.n; prof.set(r._id.b, m); }
const bookPrint = (b) => {
  const bk = books.get(b);
  if (!bk || ['handwritten', 'mixed'].includes(String(bk.script_type || '').toLowerCase())) return false;
  const m = prof.get(b); if (!m) return true;
  const t = m.handwritten + m.mixed + m.printed;
  return !t || (m.handwritten + m.mixed) / t < 0.05;
};
pairs = pairs.filter((r) => { const bk = books.get(r.book); return bk && !/english/i.test(String(bk.language || '')) && /latin|german/i.test(String(bk.language || '')); });
cut.book_la_de_not_en = pairs.length;
pairs = pairs.filter((r) => bookPrint(r.book));
cut.book_print = pairs.length;

// both pages of each pair, live
const pageRows = new Map();
for (const b of [...new Set(pairs.map((r) => r.book))]) {
  const nums = [...new Set(pairs.filter((r) => r.book === b).flatMap((r) => [r.prev, r.next]))];
  for (const p of await db.collection('pages').find({ book_id: b, page_number: { $in: nums } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, script_type: 1, 'ocr.language': 1, 'ocr.data': 1 } }).toArray()) pageRows.set(`${b}:${p.page_number}`, p);
}
pairs = pairs.filter((r) => { const A = pageRows.get(`${r.book}:${r.prev}`), B = pageRows.get(`${r.book}:${r.next}`); return A && B && !notPrint(A) && !notPrint(B); });
cut.pair_pages_print = pairs.length;

// the page(s) to repair, Latin or German by their own OCR
const wrongOf = (r) => { const d = direction(r); return d === 'leak' ? [['N1', r.next]] : d === 'unclear' ? [['N', r.prev], ['N1', r.next]] : [['N', r.prev]]; };
pageLang = (p) => ownLang(p) || String(books.get(p.book_id)?.language || '');
pairs = pairs.filter((r) => wrongOf(r).every(([, n]) => LA_DE.test(pageLang(pageRows.get(`${r.book}:${n}`)))));
cut.repair_page_la_de = pairs.length;

// the OCR-neighbour screen on both pages of each pair
const both = [...new Map(pairs.flatMap((r) => [r.prev, r.next].map((n) => { const p = pageRows.get(`${r.book}:${n}`); return [p.id, { book_id: r.book, page: n, page_id: p.id }]; }))).values()];
const scr = new Map((await screen(db.collection('pages'), both)).map((o) => [o.page_id, o]));
const dirty = (r) => [r.prev, r.next].some((n) => scr.get(pageRows.get(`${r.book}:${n}`).id)?.ocr_dup);
cut.ocr_screen_dirty_pairs = pairs.filter(dirty).length;
pairs = pairs.filter((r) => !dirty(r));
cut.ocr_screen_clean = pairs.length;
await c.close();

// pages, one row each (a page in two pairs carries both tags); earlier ledgers out
const taken = new Set(String(arg('ledgers', '')).split(',').filter(Boolean).flatMap((f) => readJsonl(f).map((r) => r.page_id)));
const pages = new Map();
for (const r of pairs) for (const [side, n] of wrongOf(r)) {
  const p = pageRows.get(`${r.book}:${n}`);
  const k = p.id, row = pages.get(k) || { book_id: r.book, page: n, page_id: p.id, reads: books.get(r.book)?.human_read_count || 0, lang: pageLang(p), src: [] };
  const tag = `leak5026-${direction(r)}-${side}`; if (!row.src.includes(tag)) row.src.push(tag);
  pages.set(k, row);
}
const all = [...pages.values()];
const out = all.filter((p) => !taken.has(p.page_id));
cut.pages = all.length; cut.pages_taken_before = all.length - out.length; cut.pages_left = out.length;
cut.books = new Set(out.map((p) => p.book_id)).size;
cut.pages_in_books_with_readers = out.filter((p) => p.reads > 0).length;
cut.by_lang = out.reduce((m, p) => ((m[p.lang] = (m[p.lang] || 0) + 1), m), {});
cut.by_dir = out.reduce((m, p) => { for (const s of p.src) m[s] = (m[s] || 0) + 1; return m; }, {});
out.sort((a, b) => b.reads - a.reads || (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : a.page - b.page));
fs.writeFileSync(path.join(OUT, 'slice-pages.json'), JSON.stringify({ built_at: new Date().toISOString(), pages: out }));
fs.writeFileSync(path.join(OUT, 'slice-summary.json'), JSON.stringify({ built_at: new Date().toISOString(), cut }, null, 1));
console.log(JSON.stringify(cut, null, 1));

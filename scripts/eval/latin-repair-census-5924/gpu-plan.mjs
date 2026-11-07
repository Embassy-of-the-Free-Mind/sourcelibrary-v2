#!/usr/bin/env node
/**
 * latin-repair-census-5924/gpu-plan.mjs — the page list for the GPU arm of #5924 (Derek's added scope, 2026-10-22):
 * do 25 pages predict whether a book can go to GPU OCR?
 *
 * PRIOR ART: scripts/eval/latin-bakeoff-5924/inputs.json (one leaf per reference page; this one is per BOOK) and
 *   ./analyze.mjs `spread` (the same 25 evenly spaced pages over a book's OCR'd pages, reused here verbatim).
 * Writes scripts/eval/latin-repair-census-5924/gpu-plan.json (committed; ids and page numbers only):
 *   spread25: for each of the 54 printed census books, its 25 spread page numbers;
 *   whole: 20 books, Mulberry32(5926) order, filled by format quota (gothic 5, two-column 4, Greek 4, side-notes 4,
 *   then any) so each format that might predict GPU failure has ≥ 4 books read in full.
 */
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/latin-repair-census';
const J = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const rows = zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'census-pages.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
const fmt = new Map(fs.readdirSync(path.join(OUT, 'agents')).filter(f => /^format-\d\.out\.json$/.test(f)).flatMap(f => J(`agents/${f}`)).map(b => [b.book_id, b]));
const isMS = b => /^\s*(MANUSCRIPT|NOT PRINTED)/i.test(`${fmt.get(b)?.notes || ''}`);
const draw = J('draw.json').filter(b => !isMS(b.book_id));
const pages = new Map(); for (const r of rows) (pages.get(r.book_id) || pages.set(r.book_id, []).get(r.book_id)).push(r);
for (const v of pages.values()) v.sort((a, b) => a.page_number - b.page_number);
const spread = v => Array.from({ length: 25 }, (_, i) => v[Math.floor((i + 0.5) * v.length / 25)]);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(5926); const order = [...draw].sort((a, b) => a.book_id.localeCompare(b.book_id));
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const F = id => fmt.get(id) || {};
const QUOTA = [['gothic', b => F(b).typeface === 'gothic', 5], ['two_column', b => F(b).columns === 2, 4], ['greek', b => !!F(b).greek, 4], ['side_notes', b => !!F(b).side_notes, 4]];
const whole = [];
for (const [name, test, n] of QUOTA) for (const b of order) { if (whole.filter(w => w.quota === name).length >= n) break; if (!whole.some(w => w.book_id === b.book_id) && test(b.book_id)) whole.push({ book_id: b.book_id, quota: name }); }
for (const b of order) { if (whole.length >= 20) break; if (!whole.some(w => w.book_id === b.book_id)) whole.push({ book_id: b.book_id, quota: 'any' }); }
const label = id => ({ typeface: F(id).typeface ?? null, columns: F(id).columns ?? null, greek: !!F(id).greek, side_notes: !!F(id).side_notes, spread: !!F(id).spread });
const plan = {
  built_at: new Date().toISOString(), note: 'page numbers are pages.page_number; the stored OCR to compare against is pages.ocr.data as of the census (2026-10-22)',
  spread25: draw.map(b => ({ book_id: b.book_id, century: b.century, engine: b.engine, format: label(b.book_id), pages: spread(pages.get(b.book_id)).map(r => r.page_number) })),
  whole: whole.map(w => ({ ...w, century: draw.find(b => b.book_id === w.book_id).century, format: label(w.book_id), pages_with_ocr: pages.get(w.book_id).length })),
};
fs.writeFileSync(path.join(HERE, 'gpu-plan.json'), JSON.stringify(plan, null, 1));
console.log(JSON.stringify({ spread_books: plan.spread25.length, spread_pages: plan.spread25.length * 25, whole_books: plan.whole.length, whole_pages: plan.whole.reduce((s, w) => s + w.pages_with_ocr, 0), quotas: whole.reduce((o, w) => (o[w.quota] = (o[w.quota] || 0) + 1, o), {}) }));

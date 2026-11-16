#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs sampleOnePagePerBook (one page per book from a page list already in hand; it
// does not draw books from the catalogue or place a page in a router cell); scripts/eval/router-next-7263/waiting-split.mjs
// (counts pages waiting per cell, draws nothing); scripts/eval/shelf-overview draws (4 pages per book on a shelf, not one
// interior page per book across router cells). None draws the #264 frame: books from the whole library, hidden included,
// one interior page each, kept only when that page is waiting in a router cell that still has room.
/**
 * Stage 1 step 2 of #264, part 1: draw the frame's pages. Read-only (secondary reads), $0.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/test-set-264/draw.mjs \
 *     [--out=$JOB_SCRATCH/draw.json] [--cap=20000]
 *
 * For every catalogue language that feeds a router OCR cell: the language's books (pages_count > 0, hidden included,
 * duplicates / rights holds / withdrawn manuscripts left out) in the order of sha256(SEED|book id); for each book ONE
 * interior page (skip the first 15% and the last 5%, eval-design 3.2, the leaf picked by the same hash); the page is
 * placed in its router cell (cells.mjs: language x stored-text engine x script type) and kept when the cell still has
 * room. A book whose page is not waiting (re-read already, no cell, no image, not a text page) is skipped and the
 * reason counted in the draw log. Each language stops when its cells are full or after --cap books.
 *
 * Pooled cells (other-<script>) split their target across their router cells by pages waiting (largest remainder), so a
 * pooled cell's books follow its pages.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { classifyPages } from '../router-next-7263/script-type.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { SEED } from './seed.mjs';
import { loadOcrCells, frameCells, baseOf, cellId, FRAME_LANGUAGES, SIZE_RULE, languageOfBase } from './cells.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out', `${process.env.JOB_SCRATCH || '/tmp'}/draw.json`);
const CAP = Number(arg('cap', 20000));
const h = (s) => crypto.createHash('sha256').update(`${SEED}|${s}`).digest();
const u01 = (buf, off = 0) => buf.readUInt32BE(off) / 2 ** 32;

// Not part of the library a reader reaches, or not ours to test on: duplicates, rights holds, withdrawn manuscripts.
export const EXCLUDE_HIDDEN = /duplicate|same_edition|kloss_manuscripts_removed|rights|copyright|access.?restricted/i;
const NOT_TEXT = /^(blank|cover|illustration|plate|map|digitizer-insert|exlibris|binding|colour-chart|color-chart)$/i;

const { table, cells } = loadOcrCells();
const frame = frameCells(cells);
// quota per router cell
const quota = new Map();
for (const f of frame.values()) {
  if (!f.pooled) { quota.set(f.router_cells[0], { frame_cell: f.id, n: f.target }); continue; }
  const ws = f.router_cells.map((id) => ({ id, w: cells.get(id).pages_waiting }));
  const tot = ws.reduce((a, x) => a + x.w, 0);
  const raw = ws.map((x) => ({ ...x, q: (f.target * x.w) / tot }));
  raw.forEach((x) => { x.n = Math.floor(x.q); });
  let left = f.target - raw.reduce((a, x) => a + x.n, 0);
  for (const x of [...raw].sort((a, b) => (b.q - b.n) - (a.q - a.n) || a.id.localeCompare(b.id))) { if (left <= 0) break; x.n++; left--; }
  for (const x of raw) quota.set(x.id, { frame_cell: f.id, n: x.n });
}
const langOfBase = languageOfBase;

const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const BOOK_PROJ = { id: 1, language: 1, year: 1, published: 1, work_id: 1, visible: 1, hidden: 1, hidden_reason: 1, pages_count: 1, text_role: 1, languages: 1,
  book_class: 1, contributing_library: 1, image_source: 1, title: 1 };
const PAGE_PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.qa_screen.dice': 1, 'ocr.updated_at': 1,
  script_type: 1, photo: 1, archived_photo: 1, photo_original: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1 };

const rows = [], log = { seed: SEED, at: new Date().toISOString(), router_table: table, cap_books_per_language: CAP, languages: {} };
const filled = new Map([...quota.keys()].map((k) => [k, 0]));
for (const lang of FRAME_LANGUAGES) {
  const mine = [...quota.entries()].filter(([id, q]) => q.n > 0 && langOfBase(cells.get(id).base) === lang).map(([id]) => id);
  if (!mine.length) continue;
  const L = log.languages[lang] = { router_cells: mine, books_in_catalogue: 0, excluded_hidden: 0, examined: 0, kept: 0, skipped: {} };
  const skip = (w) => { L.skipped[w] = (L.skipped[w] || 0) + 1; };
  const all = await db.collection('books').find({ language: lang, pages_count: { $gt: 0 } }, { projection: { id: 1, hidden_reason: 1 } }).toArray();
  L.books_in_catalogue = all.length;
  const ids = all.filter((b) => { const x = EXCLUDE_HIDDEN.test(String(b.hidden_reason || '')); if (x) L.excluded_hidden++; return !x; })
    .map((b) => ({ key: b.id || String(b._id), _id: b._id, hk: h(b.id || String(b._id)) })).sort((a, b) => Buffer.compare(a.hk, b.hk));
  const full = () => mine.every((id) => filled.get(id) >= quota.get(id).n);
  for (let i = 0; i < ids.length && L.examined < CAP && !full(); i += 200) {
    const batch = ids.slice(i, Math.min(i + 200, i + CAP - L.examined));
    const bdocs = await db.collection('books').find({ _id: { $in: batch.map((b) => b._id) } }, { projection: BOOK_PROJ }).toArray();
    const byOid = new Map(bdocs.map((b) => [String(b._id), b]));
    const want = [];
    for (const c of batch) {
      const b = byOid.get(String(c._id)); if (!b) continue;
      const pc = Number(b.pages_count) || 0;
      const lo = Math.floor(pc * 0.15), span = Math.max(1, pc - lo - Math.floor(pc * 0.05));
      want.push({ c, b, pn: 1 + lo + Math.floor(u01(c.hk, 4) * span), keys: [...new Set([b.id, String(b._id)].filter(Boolean))] });
    }
    const pdocs = await db.collection('pages').find({ $or: want.map((w) => ({ book_id: { $in: w.keys }, page_number: w.pn })) }, { projection: PAGE_PROJ }).toArray();
    const pByKey = new Map(pdocs.map((p) => [`${p.book_id}|${p.page_number}`, p]));
    const withText = [];
    for (const w of want) { w.p = w.keys.map((k) => pByKey.get(`${k}|${w.pn}`)).find(Boolean); if (w.p?.ocr?.model) withText.push(w.p.id); }
    const cls = withText.length ? await classifyPages(db, withText) : new Map();
    for (const w of want) {
      if (full()) break;
      L.examined++;
      const { b, p } = w;
      if (!p) { skip('drawn page number not found'); continue; }
      if (p.page_type && NOT_TEXT.test(p.page_type)) { skip(`page_type ${p.page_type}`); continue; }
      const img = getPageSource(p);
      if (!img) { skip('no usable image'); continue; }
      const year = Number(b.year) || Number(String(b.published || '').match(/\d{4}/)?.[0]) || null;
      const pl = baseOf({ language: b.language, year }, { model: p.ocr?.model, pipeline: p.ocr?.pipeline, dice: p.ocr?.qa_screen?.dice });
      if (!pl.base) { skip(pl.why); continue; }
      const k = p.ocr?.model ? cls.get(p.id) : { cls: null, basis: 'no stored text' };
      const rc = cellId(cells, pl.base, k?.cls || 'unknown');
      if (!rc || !quota.has(rc)) { skip(`no frame cell ${pl.base}/${k?.cls || 'unknown'}`); continue; }
      if (filled.get(rc) >= quota.get(rc).n) { skip(`cell full ${rc}`); continue; }
      filled.set(rc, filled.get(rc) + 1); L.kept++;
      rows.push({ origin: 'draw', draw_rank: L.examined, frame_cell: quota.get(rc).frame_cell, router_cell: rc, book_id: b.id || String(b._id), book_oid: String(b._id),
        work_id: b.work_id || null, page_id: p.id, page_number: p.page_number, pages_count: b.pages_count, image_url: img,
        stored_text: { engine_bucket: pl.bucket, model: p.ocr?.model || null, pipeline: p.ocr?.pipeline || null },
        router_script: { cls: k?.cls || null, basis: k?.basis || null },
        catalogue: { language: b.language, languages: b.languages || null, published: b.published ?? null, year, text_role: b.text_role || null, visible: !!b.visible, hidden_reason: b.hidden_reason || null, title: b.title || null },
        book_class: b.book_class ? { class: b.book_class.class, script_family: b.book_class.script_family || null, source: b.book_class.evidence?.source || null, version: b.book_class.version || null, model: b.book_class.model || null, at: b.book_class.at || null } : null,
        image_holder: b.contributing_library || b.image_source?.provider || b.image_source?.name || null, image_source: b.image_source || null });
    }
    process.stderr.write(`\r${lang}: examined ${L.examined}, kept ${L.kept}   `);
  }
  L.cells = Object.fromEntries(mine.map((id) => [id, { quota: quota.get(id).n, drawn: filled.get(id) }]));
  process.stderr.write('\n');
}
await client.close();
log.quota = Object.fromEntries([...quota.entries()].map(([id, q]) => [id, { ...q, drawn: filled.get(id) }]));
log.frame_cells = [...frame.values()];
log.size_rule = SIZE_RULE;
fs.writeFileSync(OUT, JSON.stringify({ log, rows }, null, 1));
console.log(`drew ${rows.length} pages; short cells:`, Object.entries(log.quota).filter(([, q]) => q.drawn < q.n).map(([id, q]) => `${id} ${q.drawn}/${q.n}`).join(', ') || 'none');
console.log(`wrote ${OUT}`);

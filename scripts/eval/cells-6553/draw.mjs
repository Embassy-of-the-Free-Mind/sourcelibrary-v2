#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs sampleOnePagePerBook — one page per book, but unseeded ($sample), no
// interior window and no per-language cells; scripts/eval/benchmark-seal.mjs seals strata with exported images for
// the standing benchmark, a heavier pipeline than this exploratory draw needs. This draws the #6553/#7270 untested
// language cells: one interior page per book, seeded, n = min(books, 30) per cell. Read-only on Mongo.
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local draw.mjs --work=DIR
 * → DIR/draw.jsonl  {cell, task, code, book_id, title, author, year, language, page_id, page_number, pages_count,
 *                    stored_ocr: {chars, model} | null, non_latin, script}
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { toLanguageCodes, languageRow } from '../../lib/language-normalize.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const WORK = arg('work', path.dirname(new URL(import.meta.url).pathname));
const SEED = '6553-cells-v1';
const h = (s) => createHash('sha1').update(`${SEED}:${s}`).digest('hex');
// cell → task. "ocr" cells judge OCR; "tr" cells judge translation (OCR is read and judged as well); "zero" both.
const NAMED = { ita: 'ocr', kor: 'ocr', spa: 'ocr', rus: 'tr', por: 'tr' };
const ZERO = ['gmh', 'yid', 'tur', 'ota', 'smp', 'nds', 'enm', 'frm', 'fro', 'pol', 'tsz', 'dan', 'ces', 'roh', 'hrv', 'non', 'urd', 'dum', 'slv', 'hin', 'pra',
  'pan', 'ave', 'mar', 'hun', 'que', 'nor', 'tam', 'tel', 'lav', 'haw', 'mri', 'sco'];
const CAP = 30; const ZERO_CAP = Number(arg('zero-cap', 10));   // budget: $1 hard stop at realtime flash-lite prices

const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, pages_count: 1 } }).toArray();
const cells = {}; const unknownZero = new Set();
for (const b of books) {
  const raw = String(b.language || '').trim().toLowerCase();
  const RAW = { nds: 'nds', 'low german': 'nds', 'purépecha': 'tsz', roh: 'roh' };   // labels the vocabulary does not resolve
  const codes = RAW[raw] ? [RAW[raw]] : toLanguageCodes(b.language).codes;
  const z = codes.find((x) => ZERO.includes(x));
  const cell = z || (codes.length === 1 && NAMED[codes[0]] ? codes[0] : null);
  if (!cell) continue;
  (cells[cell] ??= []).push(b);
}
for (const z of ZERO) if (!cells[z]) unknownZero.add(z);
console.log('cell sizes:', Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.length])), 'zero cells with no live book:', [...unknownZero]);

const out = [];
for (const [cell, list] of Object.entries(cells)) {
  const task = NAMED[cell] || 'zero'; const row = languageRow(cell);
  const ordered = [...list].sort((a, b) => h(a.id).localeCompare(h(b.id)));
  let taken = 0;
  for (const b of ordered) {
    if (taken >= (task === 'zero' ? ZERO_CAP : CAP)) break;
    const N = b.pages_count; const lo = Math.max(1, Math.floor(N * 0.15)), hi = Math.max(lo, Math.ceil(N * 0.95));
    const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gte: lo, $lte: hi } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, page_type: 1 } }).toArray();
    const all = pages.length ? pages : await db.collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, page_type: 1 } }).toArray();
    if (!all.length) continue;
    const texty = all.filter((p) => typeof p.ocr?.data === 'string' && p.ocr.data.replace(/<[^>]+>/g, '').trim().length >= 200);
    const pool = texty.length ? texty : all;
    const p = [...pool].sort((x, y) => h(x.id).localeCompare(h(y.id)))[0];
    out.push({ cell, task, code: cell, cell_name: row?.name || cell, script: row?.script || null, non_latin: !!row?.script && row.script !== 'Latn',
      book_id: b.id, title: b.display_title || b.title, author: b.author || null, year: b.year ?? b.published ?? null, language: b.language, pages_count: N,
      page_id: p.id, page_number: p.page_number, picked_by: texty.length ? 'stored-ocr>=200' : 'interior-any',
      stored_ocr: typeof p.ocr?.data === 'string' ? { chars: p.ocr.data.length, model: p.ocr.model || null } : null });
    taken++;
  }
}
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'draw.jsonl'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
const by = {}; for (const x of out) by[x.cell] = (by[x.cell] || 0) + 1;
console.log(`drew ${out.length} pages`, by, 'non-latin:', out.filter((x) => x.non_latin).length, 'no stored text page:', out.filter((x) => x.picked_by !== 'stored-ocr>=200').length);
await c.close();

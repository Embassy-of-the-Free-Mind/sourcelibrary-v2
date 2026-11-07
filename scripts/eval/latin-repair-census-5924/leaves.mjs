#!/usr/bin/env node
/**
 * latin-repair-census-5924/leaves.mjs — the leaves a reader looks at (#5924): 2 per book for the format labels, and
 * the by-eye detector sample (5 flagged per class + 10 unflagged, Mulberry32(5925)).
 *
 * PRIOR ART: scripts/lib/page-image-url.mjs `getPageSource` (used — the same image the OCR read).
 * Writes $JOB_SCRATCH/img/<book>-p<n>.jpg (≤ 1800 px long side), $JOB_SCRATCH/text/<book>-p<n>.txt (stored OCR, the
 * by-eye pages only) and $JOB_SCRATCH/leaves.json. Read only. `--round2=<class>:<n>` appends a second by-eye sample.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import sharp from 'sharp';
import { getPageSource } from '../../lib/page-image-url.mjs';

const OUT = process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/latin-repair-census';
for (const d of ['img', 'text']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const rd = f => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(5925);
const rows = rd(path.join(OUT, 'census-pages.jsonl.gz'));
const draw = JSON.parse(fs.readFileSync(path.join(OUT, 'draw.json'), 'utf8'));

// format: two body leaves per book, at 35% and 65% of its text pages
const format = [];
for (const b of draw) {
  const t = rows.filter(r => r.book_id === b.book_id && (r.page_type === 'text' || r.page_type == null) && r.letters >= 400);
  for (const q of [0.35, 0.65]) if (t.length) format.push({ book_id: b.book_id, page_number: t[Math.floor(t.length * q)].page_number, use: 'format' });
}
// by-eye: 5 flagged per class (distinct books first), 10 unflagged text pages
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const eye = [];
for (const k of ['long_s', 'bleed', 'loop', 'interleave', 'truncation', 'empty']) {
  const pool = shuffle(rows.filter(r => r.flags[k])); const seen = new Set(); const pick = [];
  for (const r of pool) if (pick.length < 5 && !seen.has(r.book_id)) { pick.push(r); seen.add(r.book_id); }
  for (const r of pool) if (pick.length < 5 && !pick.includes(r)) pick.push(r);
  for (const r of pick) eye.push({ book_id: r.book_id, page_number: r.page_number, use: 'eye', flagged: k, flags: r.flags });
}
for (const r of shuffle(rows.filter(r => !r.any && (r.page_type === 'text' || r.page_type == null) && r.letters >= 300)).slice(0, 10))
  eye.push({ book_id: r.book_id, page_number: r.page_number, use: 'eye', flagged: null, flags: r.flags });

// --round2=<class>:<n> — a second by-eye sample of one reworked detector, pages not in round 1, distinct books,
// manuscripts (format labels) excluded; appended to leaves.json with use 'eye2'
const r2 = (process.argv.find(a => a.startsWith('--round2=')) || '').slice(9);
let all = [...format, ...eye];
if (r2) {
  const [k, n] = r2.split(':'); const prev = JSON.parse(fs.readFileSync(path.join(OUT, 'leaves.json'), 'utf8'));
  const done = new Set(prev.map(x => `${x.book_id}-p${x.page_number}`)); const ms = manuscripts();
  const pool = shuffle(rows.filter(r => r.flags[k] && !done.has(`${r.book_id}-p${r.page_number}`) && !ms.has(r.book_id))); const seen = new Set(); const pick = [];
  for (const r of pool) if (pick.length < +n && !seen.has(r.book_id)) { pick.push(r); seen.add(r.book_id); }
  for (const r of pool) if (pick.length < +n && !pick.includes(r)) pick.push(r);
  all = [...prev, ...pick.map(r => ({ book_id: r.book_id, page_number: r.page_number, use: 'eye2', flagged: k, flags: r.flags }))];
}
function manuscripts() {
  const s = new Set();
  for (const f of fs.readdirSync(path.join(OUT, 'agents')).filter(f => /^format-\d\.out\.json$/.test(f)))
    for (const b of JSON.parse(fs.readFileSync(path.join(OUT, 'agents', f), 'utf8'))) if (/^\s*(MANUSCRIPT|NOT PRINTED)/i.test(`${b.notes}`)) s.add(b.book_id);
  return s;
}
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
let ok = 0, fail = 0;
for (const x of all) {
  const p = await db.collection('pages').findOne({ book_id: x.book_id, page_number: x.page_number },
    { projection: { cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1 } });
  x.url = p ? getPageSource(p) : null; x.slug = `${x.book_id}-p${x.page_number}`;
  if (x.use.startsWith('eye')) fs.writeFileSync(path.join(OUT, 'text', `${x.slug}.txt`), p?.ocr?.data || '');
  const f = path.join(OUT, 'img', `${x.slug}.jpg`);
  if (fs.existsSync(f)) { x.img = f; ok++; continue; }
  try {
    const r = await fetch(x.url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await sharp(Buffer.from(await r.arrayBuffer())).resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(f);
    x.img = f; ok++;
  } catch (e) { x.err = String(e.message || e); fail++; }
}
fs.writeFileSync(path.join(OUT, 'leaves.json'), JSON.stringify(all, null, 1));
console.log(JSON.stringify({ format: format.length, eye: eye.length, ok, fail }));
await c.close();

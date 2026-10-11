#!/usr/bin/env node
// PRIOR ART: ../draw-byeye.mjs (step 3's A/B packets: image, OCR, stored vs staged English, blind key) — it draws 3
// consecutive pages from 7 volumes; this check draws ONE page per volume across all 37 (+3) and adds the 2× crops
// and a REVIEWER.md packet. scripts/eval/second-reader/ plants seeded errors and clusters issues across 4 readers;
// this asks a narrower question (new vs old English on the same page) of 2 readers, so it reuses only the brief.
//
// #6361 convergent check (#6420, Derek 2026-10-10: two independent model families against the image stand in for a
// human read this month). 40 slots: one page in each of the 37 volumes plus a second page in 3 volumes drawn at random;
// 10 slots (drawn) are pages from the item-3 re-read, the rest from the 17,135 applied in stage 2. A page is drawn
// uniformly within its volume among pages with ≥300 chars of OCR, excluding the step-3 by-eye pages.
//
//   node --env-file=… draw.mjs slots  --out=DIR [--seed=6420]                      (writes DIR/slots.json)
//   node --env-file=… draw.mjs build  --out=DIR --set=stage1|reread [--reread=<reread-apply dir> --reread-dir=<driver dir>]
// Each packet: DIR/packets/sNN/{page.jpg, c1.jpg, c2.jpg, c3.jpg, ocr.txt, A.txt, B.txt, packet.json};
// DIR/private/key.json holds which of A/B is new (readers never get DIR/private).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { sanitizeTranslationTags, guardTranslationText } from '../../../lib/translate-core.mjs';
import { unwrapHiddenTranslation } from '../../../lib/hidden-translation.mjs';
import { strayScriptVerdict } from '../../../lib/stray-script.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const W = '/root/tengyur-cli-6361';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const cmd = process.argv[2];
const OUT = arg('out');
if (!OUT) throw new Error('--out is required');
const SEED = Number(arg('seed', '6420'));
let st = SEED >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tsv = (f) => fs.readFileSync(f, 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
const MIN_OCR = 300;
fs.mkdirSync(path.join(OUT, 'private'), { recursive: true });

if (cmd === 'slots') {
  const vols = [...new Set(jl(path.join(W, 'pages.jsonl')).map((p) => p.vol))].sort((a, b) => a - b);
  const pool = [...vols];
  const extra = [];
  while (extra.length < 3) extra.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const slots = [...vols, ...extra].map((vol, i) => ({ slot: i + 1, vol }));
  const idx = slots.map((s) => s.slot);
  const reread = [];
  while (reread.length < 10) reread.push(idx.splice(Math.floor(rnd() * idx.length), 1)[0]);
  for (const s of slots) { s.set = reread.includes(s.slot) ? 'reread' : 'stage1'; s.page_seed = Math.floor(rnd() * 2 ** 31); }
  fs.writeFileSync(path.join(OUT, 'slots.json'), JSON.stringify({ seed: SEED, at: new Date().toISOString(), min_ocr_chars: MIN_OCR, slots }, null, 1));
  console.log(slots.map((s) => `${s.slot}:${s.vol}:${s.set}`).join(' '));
  process.exit(0);
}
if (cmd !== 'build') throw new Error('usage: draw.mjs slots|build …');

const SET = arg('set');
const { slots } = JSON.parse(fs.readFileSync(path.join(OUT, 'slots.json'), 'utf8'));
const byeye = new Set(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'results', 'byeye', 'draw.json'), 'utf8')).draw.flatMap((d) => d.pages.map((p) => p.page_id)));
const stage1Na = new Set(tsv(path.join(HERE, '..', 'results', 'not-applicable.tsv')).map((r) => r[0]));
const manifest = jl(path.join(W, 'manifest.jsonl'));
const stored = new Map(zlib.gunzipSync(fs.readFileSync(arg('stored'))).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.page_id, r]; }));
let eligible;
if (SET === 'stage1') eligible = new Set(manifest.filter((m) => m.status === 'staged' && !stage1Na.has(m.page_id)).map((m) => m.page_id));
else if (SET === 'reread') eligible = new Set(tsv(path.join(arg('reread'), 'applicable.tsv')).map((r) => r[0]));
else throw new Error('--set=stage1|reread');
const pagesByVol = new Map();
for (const p of jl(path.join(W, 'pages.jsonl'))) (pagesByVol.get(p.vol) ?? pagesByVol.set(p.vol, []).get(p.vol)).push(p);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const keyFile = path.join(OUT, 'private', 'key.json');
const key = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, 'utf8')) : {};
const used = new Set(Object.values(key).map((k) => k.page_id));
for (const s of slots.filter((x) => x.set === SET)) {
  let r = s.page_seed >>> 0;
  const prng = () => { r = (r + 0x6D2B79F5) >>> 0; let t = r; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cands = pagesByVol.get(s.vol).filter((p) => eligible.has(p.page_id) && !byeye.has(p.page_id) && !used.has(p.page_id) && (stored.get(p.page_id)?.ocr || '').length >= MIN_OCR).sort((a, b) => a.page_number - b.page_number);
  if (!cands.length) { console.log(`slot ${s.slot} vol ${s.vol}: no eligible page in set ${SET}`); continue; }
  const p = cands[Math.floor(prng() * cands.length)];
  used.add(p.page_id);
  const doc = await db.collection('pages').findOne({ id: p.page_id }, { projection: { _id: 0, id: 1, archived_photo: 1, photo: 1, translation: 1, ocr: 1, page_type: 1 } });
  const s0 = stored.get(p.page_id);
  let oldText, newText;
  if (SET === 'stage1') {
    oldText = s0.translation?.data || '';
    newText = doc.translation?.data || '';
    if (doc.translation?.engine?.run?.job_id !== 'tengyur-cli-6361') throw new Error(`${p.page_id}: stored English is not the stage-2 write`);
  } else {
    const rec = JSON.parse(fs.readFileSync(path.join(arg('reread-dir'), 'out', `${p.page_id}.json`), 'utf8'));
    const raw = (rec.agy.response || '').trim();
    newText = strayScriptVerdict(unwrapHiddenTranslation({ ocr: doc.ocr?.data, tr: guardTranslationText(sanitizeTranslationTags(raw)), type: doc.page_type }).text, { ocr: doc.ocr?.data, language: 'Tibetan' }).text;
    oldText = doc.translation?.engine?.run?.job_id === 'tengyur-cli-6361-reread' ? s0.translation?.data || '' : doc.translation?.data || '';
  }
  const dir = path.join(OUT, 'packets', `s${String(s.slot).padStart(2, '0')}`);
  fs.mkdirSync(dir, { recursive: true });
  const url = doc.archived_photo || doc.photo;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(dir, 'page.jpg'), buf);
  const meta = await sharp(buf).metadata();
  const w3 = Math.ceil(meta.width / 3), ov = Math.round(meta.width * 0.04);
  for (let i = 0; i < 3; i++) {
    const left = Math.max(0, i * w3 - ov), width = Math.min(meta.width - left, w3 + 2 * ov);
    await sharp(buf).extract({ left, top: 0, width, height: meta.height }).resize({ width: width * 2 }).jpeg({ quality: 90 }).toFile(path.join(dir, `c${i + 1}.jpg`));
  }
  const newIsA = prng() < 0.5;
  fs.writeFileSync(path.join(dir, 'ocr.txt'), doc.ocr?.data || '');
  fs.writeFileSync(path.join(dir, 'A.txt'), newIsA ? newText : oldText);
  fs.writeFileSync(path.join(dir, 'B.txt'), newIsA ? oldText : newText);
  const book = await db.collection('books').findOne({ id: p.book_id }, { projection: { _id: 0, id: 1, title: 1, author: 1, language: 1 } });
  fs.writeFileSync(path.join(dir, 'packet.json'), JSON.stringify([{
    book_id: p.book_id, slot: s.slot, title: book?.title ?? null, tradition: 'Tibetan Buddhist (Derge Tengyur)', book: { title: book?.title, author: book?.author ?? null, language: book?.language ?? 'Tibetan', section: p.section, volume: p.vol },
    structure: null,
    pages: [{ page_number: p.page_number, image_url: url, image_files: ['page.jpg', 'c1.jpg', 'c2.jpg', 'c3.jpg'], crop: null, ocr: doc.ocr?.data || '', ocr_engine: doc.ocr?.model ?? null, translation_A: newIsA ? newText : oldText, translation_B: newIsA ? oldText : newText, translation_engines: 'two AI translations, order random' }],
  }], null, 1));
  key[`s${String(s.slot).padStart(2, '0')}`] = { slot: s.slot, vol: s.vol, section: p.section, page_id: p.page_id, page_number: p.page_number, set: SET, new_is: newIsA ? 'A' : 'B', nudged: SET === 'reread' ? (JSON.parse(fs.readFileSync(path.join(arg('reread-dir'), 'out', `${p.page_id}.json`), 'utf8')).nudged ?? null) : false };
  console.log(`slot ${s.slot} vol ${s.vol} p${p.page_number} (${SET})`);
}
fs.writeFileSync(keyFile, JSON.stringify(key, null, 1));
await client.close();

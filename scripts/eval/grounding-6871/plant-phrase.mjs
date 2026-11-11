#!/usr/bin/env node
/**
 * plant-phrase.mjs — the #6871 row A follow-up (job grounding-6871a) planted set: 50 clean pages, 1–3 PHRASES each
 * swapped in from another page of the same book, offsets recorded. Plus the raw SKQS pages for skqs-real.py.
 *
 * PRIOR ART: plant.mjs (this folder; 41 plants, 21 of them flash-lite word swaps and 20 one-sentence swaps). This one
 * follows the 2026-10-22 brief instead: short phrases (2–5 words / 4–8 Han characters), 1–3 per page, $0 (no model
 * proposes anything), and a Chinese SKQS cell, which plant.mjs did not have (its Chinese pages are 三才圖會/武備志
 * prints). SKQS plants go into the Kanripo WYG transcription of the leaf (#5568 align.json/sources.json `K`), which is
 * the closest thing to a clean read of that leaf we hold.
 *
 *   node --env-file=.env.production.local scripts/eval/grounding-6871/plant-phrase.mjs <items-real.jsonl> <old-plants.jsonl> <out-dir>
 * Writes <out-dir>/plants2.jsonl (items, plant: 'phrase') and <out-dir>/skqs-raw.jsonl. Read-only on `pages`.
 *
 * Draw (seed 68711): latin 22 and greek 15 (13 land) from #6420 pages Opus judged clean (n_errors = 0, not serious, >= 500
 * cleaned characters, not a plant.mjs page); SKQS 15 from the 36 #5568 pages Kanripo aligned (K >= 100 Han chars).
 * Each page gets 1, 2 or 3 plants (uniform). A plant replaces a run of 2–5 words (Latin/Greek; >= 10 chars) or 4–8 Han
 * characters (SKQS) inside the middle 15–90 % of the text with a run of the same size from a donor page of the same
 * book (|Δpage| 2–12, stored OCR, cleaned like the scored text), never identical to the replaced run, plants >= 60 chars
 * (Han: 12) apart. The positions live only in the item's spans; no prompt mentions them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';

const [src, oldPlants, outDir] = process.argv.slice(2);
if (!outDir) { console.error('usage: plant-phrase.mjs <items-real.jsonl> <old-plants.jsonl> <out-dir>'); process.exit(2); }
const QUOTA = { latin: 22, greek: 15, skqs: 15 };   // greek's clean pool yields 13, so 50 land
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(68711);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (t) => (t || '').normalize('NFC').replace(/<detected-images>[\s\S]*?(<\/detected-images>|$)/g, '').replace(/<vocab>[\s\S]*?(<\/vocab>|$)/g, '').trim().slice(0, 8000);
const HAN = /[㐀-鿿豈-﫿\u{20000}-\u{2ffff}]/u;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// body text only: a run never touches a tagged block (<image-desc>, <meta>, <margin>, <header>, …) — those are not
// the leaf's running text, and an English image description is no place for a Latin plant
const tagged = (t) => [...t.matchAll(/<([a-z][a-z-]*)>[\s\S]*?(<\/\1>|$)/g)].map((m) => [m.index, m.index + m[0].length]);
const body = (t) => t.replace(/<([a-z][a-z-]*)>[\s\S]*?(<\/\1>|$)/g, (m) => '\n'.repeat(1) + ' '.repeat(Math.max(0, m.length - 1)));
// runs of n consecutive plain words (letters only, so no tags, numbers or markup are swapped), with offsets
function wordRuns(t, n) {
  const words = [...t.matchAll(/[\p{L}\p{M}]+/gu)].map((m) => ({ s: m.index, e: m.index + m[0].length }));
  const out = [];
  for (let i = 0; i + n <= words.length; i++) {
    const s = words[i].s, e = words[i + n - 1].e, seg = t.slice(s, e);
    if (/[\n<>#*|]/.test(seg) || !/^[\p{L}\p{M}]+(\s+[\p{L}\p{M}]+)*$/u.test(seg) || seg.length < 10) continue;
    out.push({ s, e, text: seg });
  }
  return out;
}
function hanRuns(t, n) {
  const out = []; const cs = [...t]; let off = 0; const pos = cs.map((c) => { const p = off; off += c.length; return p; });
  for (let i = 0; i + n <= cs.length; i++) {
    if (cs.slice(i, i + n).every((c) => HAN.test(c))) out.push({ s: pos[i], e: pos[i + n - 1] + cs[i + n - 1].length, text: cs.slice(i, i + n).join('') });
  }
  return out;
}
// same-language guard (the brief: "plausible same-language text"): a Latin run holds no English/German/Romance
// function word, a Greek run is Greek letters only; neither sits on a heading (#) or centred (->) line
const FOREIGN = new Set('the of and with an is are on at to by from which that this his her was be were page figure image left right top bottom red der die das und für einen eine ein nicht ist mit von zu den dem des unter auf il la le lo gli di che el los las con del della dello una uno nel sono per il è porque que en vuestra raised bands ornate within set border text woodcut decorative illustration'.split(' ').filter((w) => !['per'].includes(w)));
const lineOf = (t, s) => t.slice(t.lastIndexOf('\n', s - 1) + 1, s);
const sameLang = (txt, g) => (g === 'greek' ? /^[\p{Script=Greek}\s\u0300-\u036f’']+$/u.test(txt) : g === 'latin' ? !txt.toLowerCase().split(/\s+/).some((w) => FOREIGN.has(w)) && !/\p{Script=Greek}/u.test(txt) : true);
let GROUP = 'latin';
const runs = (t, zh, n) => { const tg = tagged(t); return (zh ? hanRuns(t, n) : wordRuns(t, n)).filter((x) => !tg.some(([a, b]) => x.s < b && x.e > a) && sameLang(x.text, GROUP) && !/^\s*(#|->)/.test(lineOf(t, x.s))); };

function plantPage(text, zh, donors) {
  const k = 1 + Math.floor(rnd() * 3); const gap = zh ? 12 : 60; let spans = [];
  for (let tries = 0; spans.length < k && tries < 40; tries++) {
    const n = zh ? 4 + Math.floor(rnd() * 5) : 2 + Math.floor(rnd() * 4);
    const mine = runs(text, zh, n).filter((x) => x.s > text.length * 0.15 && x.e < text.length * 0.9 && spans.every((sp) => x.e + gap < sp.s || x.s > sp.e + gap));
    const donor = pick(donors); if (!mine.length || !donor) continue;
    const target = pick(mine);
    const cands = runs(body(donor.text), zh, n).filter((x) => x.text !== target.text && !text.includes(x.text) && (zh || Math.abs(x.text.length - target.text.length) <= target.text.length * 0.5));
    if (!cands.length) continue;
    const ins = pick(cands).text; const d = ins.length - (target.e - target.s);
    text = text.slice(0, target.s) + ins + text.slice(target.e);
    spans = spans.map((sp) => (sp.s > target.s ? { ...sp, s: sp.s + d, e: sp.e + d } : sp));
    spans.push({ s: target.s, e: target.s + ins.length, kind: 'plant_phrase', quote: `${target.text}→${ins} (donor p${donor.page_number})` });
  }
  return { text, spans: spans.sort((a, b) => a.s - b.s) };
}

const cli = await MongoClient.connect(process.env.MONGODB_URI); const db = cli.db('bookstore');
const donorsOf = async (bookId, pageNumber, selfId) => {
  const ps = await db.collection('pages').find({ book_id: bookId, page_number: { $gte: pageNumber - 12, $lte: pageNumber + 12 }, 'ocr.data': { $exists: true, $ne: '' } },
    { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
  return ps.filter((p) => Math.abs(p.page_number - pageNumber) >= 2 && p.id !== selfId && String(p._id) !== selfId).map((p) => ({ page_number: p.page_number, text: clean(p.ocr.data) }));
};

const old = new Set(readJsonl(oldPlants).map((r) => r.page_id));
const items = readJsonl(src);
const out = []; const used = { latin: 0, greek: 0, skqs: 0 };
for (const g of ['latin', 'greek']) {
  GROUP = g;
  const pool = shuffle(items.filter((r) => r.group === g && r.n_errors === 0 && !r.stored_serious && r.text.length >= 500 && !old.has(r.page_id)).sort((a, b) => a.page_id.localeCompare(b.page_id)));
  for (const r of pool) {
    if (used[g] >= QUOTA[g]) break;
    const pn = (await db.collection('pages').findOne({ $or: [{ id: r.page_id }, ...(/^[0-9a-f]{24}$/.test(r.page_id) ? [{ _id: new ObjectId(r.page_id) }] : [])] }, { projection: { page_number: 1 } }))?.page_number;
    if (pn == null) continue;
    const donors = await donorsOf(r.book_id, pn, r.page_id);
    const { text, spans } = plantPage(r.text, false, donors);
    if (!spans.length) continue;
    used[g]++;
    out.push({ ...r, item: `${r.page_id}__phrase`, text, spans, masks: [], plant: 'phrase', n_errors: 0, n_plants: spans.length });
  }
}

// SKQS: the #5568 sealed pages with an aligned Kanripo leaf
const R = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../results/chinese-skqs-5568');
const sources = JSON.parse(fs.readFileSync(path.join(R, 'test2/sources.json'), 'utf8'));
const align = new Map(JSON.parse(fs.readFileSync(path.join(R, 'align.json'), 'utf8')).rows.map((r) => [r.slug, r]));
const raw = [];
for (const [slug, s] of Object.entries(sources)) {
  const a = align.get(slug);
  if (!a?.aligned || !s.K) continue;
  const p = await db.collection('pages').findOne({ book_id: a.book_id, page_number: a.page_number },
    { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, archived_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1 } });
  if (!p) continue;
  raw.push({ slug, page_id: p.id || String(p._id), book_id: a.book_id, page_number: a.page_number, title: a.title, image: getPageSource(p), L: s.L, P: s.P, K: s.K,
    stored: clean(p.ocr?.data), stored_model: p.ocr?.model || p.ocr?.source || null, boundary_both_ends: null });
}
GROUP = 'skqs';
const bnd = new Map(JSON.parse(fs.readFileSync(path.join(R, 'boundary.json'), 'utf8')).rows.map((r) => [r.slug, r]));
for (const r of raw) { const b = bnd.get(r.slug); r.boundary_both_ends = b ? !!(b.start && b.end) : null; }
for (const r of shuffle(raw.filter((x) => [...x.K].filter((c) => HAN.test(c)).length >= 100).sort((a, b) => a.slug.localeCompare(b.slug)))) {
  if (used.skqs >= QUOTA.skqs) break;
  const donors = await donorsOf(r.book_id, r.page_number, r.page_id);
  const base = r.K.replace(/　/g, '');
  const { text, spans } = plantPage(base, true, donors);
  if (!spans.length) continue;
  used.skqs++;
  out.push({ item: `${r.page_id}__phrase`, page_id: r.page_id, book_id: r.book_id, group: 'skqs', language: 'Classical Chinese', set: 'skqs-5568', image: r.image,
    text, spans, masks: [], plant: 'phrase', n_errors: 0, n_plants: spans.length, base: 'kanripo-WYG' });
}
await cli.close();
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'plants2.jsonl'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'skqs-raw.jsonl'), raw.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(JSON.stringify({ plants: out.length, by: used, spans: out.reduce((n, x) => n + x.spans.length, 0), skqs_raw: raw.length }));

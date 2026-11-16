#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `draw` (one page per book, seeded, interior pages; its frames are
// visible books with stored OCR of one engine, so it cannot draw HIDDEN books with no OCR at all, which is what #225
// imported) and scripts/eval/route-judge-6740/fresh-gate-7517.mjs (a fresh-read draw). This draw picks the page by the
// Internet Archive's own OCR of the leaf (the item's _djvu.xml, one OBJECT per leaf), because the books have no text of
// ours yet; the IA text picks a candidate TEXT page and is later arm B's draft, never the truth.
/**
 * Draw for the two #225 OCR cell tests (job indic-ocr-tests-225).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local draw.mjs tamil  --out=DIR --n=20 --collection=kov|tor [--seed=S]
 *   node --env-file=/root/sourcelibrary/.env.production.local draw.mjs series --out=DIR --census   (diacritic density per book)
 *   node --env-file=/root/sourcelibrary/.env.production.local draw.mjs series --out=DIR --books=F  (one page per listed book)
 *
 * tamil:  books of campaign indic-tamil-print-2026-11 in the named IA collection (kov = koviloorandavarlibrary,
 *         tor = the University of Toronto items), ordered by sha256(seed:book id), taken round-robin over decades so the
 *         draw spreads across 1840-1928. Per book, leaves of the middle third in sha256(seed:page id) order; the first
 *         leaf whose IA text has >= 150 Tamil letters and a Tamil share of letters >= 0.6 is the candidate. A book with
 *         no such leaf in its middle third is recorded as skipped (most often an English book filed as Tamil).
 * series: books of campaign indic-translation-series-2026-11. --census counts, per book, the share of Latin letters in
 *         the IA text that carry an Indological diacritic (ā ī ū ṛ ṝ ḷ ṃ ṁ ṅ ñ ṇ ṭ ḍ ś ṣ ḥ ç), on the middle third. The
 *         books are then chosen BY EYE (a text edition, not a translation volume) and listed in --books; the page per
 *         book is the middle-third leaf with the densest diacritics among 6 seeded candidates with >= 600 letters.
 * Every candidate page is then looked at (contact sheet, contact.mjs) and replaced by hand where it is not a text page;
 * the replacements are recorded in DIR/replaced.json. Writes DIR/draw-<kind>.json. Read-only: no write to Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../../lib/page-image-url.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const KIND = process.argv[2];
const OUT = path.resolve(arg('out'));
const SEED = arg('seed') || 'indic-ocr-225';
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
fs.mkdirSync(path.join(OUT, 'ia'), { recursive: true });

const TAMIL = /[஀-௿]/gu;
const LETTER = /\p{L}/gu;
const DIA = /[āīūṛṝḷṃṁṅñṇṭḍśṣḥçĀĪŪṚṜḶṂṀṄÑṆṬḌŚṢḤÇ]/gu;
const LATIN = /\p{Script=Latin}/gu;
const count = (t, re) => (String(t).normalize('NFC').match(re) || []).length;

/** The IA item's OCR, one string per leaf (djvu.xml OBJECT order = the IIIF page/nN index). Cached under DIR/ia/. */
async function iaLeaves(id) {
  const f = path.join(OUT, 'ia', `${id}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const meta = await (await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}/files`)).json();
  const x = (meta.result || []).find((r) => r.name.endsWith('_djvu.xml'));
  if (!x) { fs.writeFileSync(f, JSON.stringify({ none: 'no _djvu.xml' })); return { none: 'no _djvu.xml' }; }
  const res = await fetch(`https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(x.name)}`);
  if (!res.ok) return { none: `HTTP ${res.status}` };
  const xml = await res.text();
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const leaves = [...xml.matchAll(/<OBJECT\b[\s\S]*?<\/OBJECT>/g)].map((m) => {
    const paras = [...m[0].matchAll(/<PARAGRAPH>([\s\S]*?)<\/PARAGRAPH>/g)].map((p) => [...p[1].matchAll(/<LINE>([\s\S]*?)<\/LINE>/g)]
      .map((l) => [...l[1].matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((w) => dec(w[1]).trim()).join(' ')).join('\n'));
    return paras.join('\n\n').normalize('NFC');
  });
  const out = { file: x.name, leaves };
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}

const leafIndex = (p) => { const m = String(p.photo || p.photo_original || '').match(/\/page\/n(\d+)\//); return m ? Number(m[1]) : p.page_number - 1; };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const PAGE_PROJ = { id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, 'ocr.data': 1 };

if (KIND === 'tamil') {
  const coll = arg('collection');
  const N = Number(arg('n') || 20);
  const books = (await db.collection('books').find({ acquisition_campaign: 'indic-tamil-print-2026-11' },
    { projection: { id: 1, title: 1, year: 1, ia_identifier: 1, pages_count: 1, language: 1, 'catalog_metadata.collections': 1 } }).toArray())
    .filter((b) => { const cs = b.catalog_metadata?.collections || []; return coll === 'kov' ? cs.includes('koviloorandavarlibrary') : !cs.includes('koviloorandavarlibrary'); })
    .filter((b) => b.pages_count >= 6)
    .sort((a, b) => h(`${SEED}:${a.id}`).localeCompare(h(`${SEED}:${b.id}`)));
  const decades = new Map();
  for (const b of books) { const d = Math.floor((b.year || 0) / 10) * 10; if (!decades.has(d)) decades.set(d, []); decades.get(d).push(b); }
  const order = [];   // round-robin over decades (oldest first), each decade in seeded order
  const ds = [...decades.keys()].sort();
  for (let i = 0; order.length < books.length; i++) for (const d of ds) if (decades.get(d)[i]) order.push(decades.get(d)[i]);
  const picked = [], skipped = [];
  for (const b of order) {
    if (picked.length >= N) break;
    const ia = await iaLeaves(b.ia_identifier);
    if (ia.none) { skipped.push({ book_id: b.id, ia: b.ia_identifier, why: ia.none }); continue; }
    const pages = await db.collection('pages').find({ book_id: b.id }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
    const lo = Math.floor(pages.length / 3), hi = Math.ceil((2 * pages.length) / 3);
    const mid = pages.slice(lo, hi).sort((a, x) => h(`${SEED}:${a.id}`).localeCompare(h(`${SEED}:${x.id}`)));
    let got = null;
    for (const p of mid) {
      if (p.ocr?.data) continue;
      const t = ia.leaves[leafIndex(p)] || '';
      const ta = count(t, TAMIL), le = count(t, LETTER);
      if (ta >= 150 && ta / Math.max(1, le) >= 0.6) { got = { p, ta, le }; break; }
    }
    if (!got) { skipped.push({ book_id: b.id, ia: b.ia_identifier, title: b.title, why: 'no middle-third leaf with >= 150 Tamil letters at >= 0.6 share in the IA text' }); continue; }
    picked.push({ book_id: b.id, ia: b.ia_identifier, title: b.title, year: b.year, collection: coll, page_id: got.p.id, page_number: got.p.page_number,
      leaf: leafIndex(got.p), pages: pages.length, image_url: getPageSource(got.p), ia_tamil_letters: got.ta, ia_letters: got.le });
    console.log(`${picked.length}. ${b.year} ${b.ia_identifier} p${got.p.page_number}/${pages.length} ta=${got.ta}`);
  }
  const file = path.join(OUT, `draw-tamil-${coll}.json`);
  fs.writeFileSync(file, JSON.stringify({ drawn_at: new Date().toISOString(), seed: SEED, campaign: 'indic-tamil-print-2026-11', collection: coll,
    frame_books: books.length, decades: Object.fromEntries(ds.map((d) => [d, decades.get(d).length])), picked, skipped }, null, 1));
  console.log(`${picked.length} picked, ${skipped.length} skipped, frame ${books.length} → ${file}`);
}

if (KIND === 'series') {
  const books = await db.collection('books').find({ acquisition_campaign: 'indic-translation-series-2026-11' },
    { projection: { id: 1, title: 1, year: 1, ia_identifier: 1, pages_count: 1, author: 1 } }).toArray();
  if (process.argv.includes('--census')) {
    const rows = [];
    for (const b of books) {
      const ia = await iaLeaves(b.ia_identifier);
      if (ia.none) { rows.push({ book_id: b.id, ia: b.ia_identifier, title: b.title, none: ia.none }); continue; }
      const L = ia.leaves, mid = L.slice(Math.floor(L.length / 3), Math.ceil((2 * L.length) / 3)).join('\n');
      const lat = count(mid, LATIN), dia = count(mid, DIA);
      rows.push({ book_id: b.id, ia: b.ia_identifier, title: b.title, author: b.author, year: b.year, leaves: L.length, latin: lat, dia, dia_per_1k: +(1000 * dia / Math.max(1, lat)).toFixed(1) });
      console.log(`${(1000 * dia / Math.max(1, lat)).toFixed(1).padStart(6)}  ${b.ia_identifier}  ${b.title}`);
    }
    rows.sort((a, b) => (b.dia_per_1k ?? -1) - (a.dia_per_1k ?? -1));
    fs.writeFileSync(path.join(OUT, 'series-census.json'), JSON.stringify(rows, null, 1));
  } else {
    const want = JSON.parse(fs.readFileSync(arg('books'), 'utf8'));   // [book_id, ...]
    const picked = [];
    for (const id of want) {
      const b = books.find((x) => x.id === id); if (!b) throw new Error(`not in the campaign: ${id}`);
      const ia = await iaLeaves(b.ia_identifier);
      const pages = await db.collection('pages').find({ book_id: b.id }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
      const mid = pages.slice(Math.floor(pages.length / 3), Math.ceil((2 * pages.length) / 3)).filter((p) => !p.ocr?.data)
        .sort((a, x) => h(`${SEED}:${a.id}`).localeCompare(h(`${SEED}:${x.id}`)));
      const cands = mid.map((p) => { const t = ia.leaves?.[leafIndex(p)] || ''; return { p, lat: count(t, LATIN), dia: count(t, DIA) }; }).filter((x) => x.lat >= 600).slice(0, 6);
      if (!cands.length) { console.log(`no candidate leaf: ${b.ia_identifier}`); continue; }
      const best = cands.sort((a, x) => x.dia / x.lat - a.dia / a.lat)[0];
      picked.push({ book_id: b.id, ia: b.ia_identifier, title: b.title, year: b.year, page_id: best.p.id, page_number: best.p.page_number, leaf: leafIndex(best.p),
        pages: pages.length, image_url: getPageSource(best.p), ia_latin: best.lat, ia_dia: best.dia });
      console.log(`${picked.length}. ${b.ia_identifier} p${best.p.page_number}/${pages.length} dia/1k=${(1000 * best.dia / best.lat).toFixed(1)}`);
    }
    fs.writeFileSync(path.join(OUT, 'draw-series.json'), JSON.stringify({ drawn_at: new Date().toISOString(), seed: SEED, campaign: 'indic-translation-series-2026-11', picked }, null, 1));
  }
}
await c.close();

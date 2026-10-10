#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-cli-pilot-6375.mjs stageDraw (the seeded book-then-page shape, copied; its frame is
// the OCR queue, not served books, and it skips 5% front, not 15%); scripts/eval/lib/sampling.mjs sampleOnePagePerBook
// (uses Mongo $sample and drops pages with < 200 production-OCR chars, both ruled out by #6388). The rule is in
// README.md, committed before this ran.
/**
 * draw.mjs — the #6388 draw: 30 works per stratum (+5 spares), one interior page per work, seed 6386.
 * Read-only on Mongo. Writes draw.json and control-set.json next to this file.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-prereg-6388/draw.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SEED = 6386, N = 30, SPARES = 5;
const FRAME = { visible: true, hidden: { $ne: true }, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } };
const STRATA = [
  { id: 'latin-print', language: ['Latin', 'lat'], cls: 'printed', family: 'latin', years: [1500, 1800] },
  { id: 'zh-manuscript', language: ['Chinese', 'Classical Chinese', 'zh', 'lzh'], cls: 'handwritten', family: 'cjk', years: null },
  { id: 'english-print', language: ['English', 'en', 'eng'], cls: 'printed', family: 'latin', years: [1500, 1900] },
];
const EXCLUDE_TYPE = /blank|title|cover|plate|illustrat|frontis|endpaper|end-paper|binding|colou?r[- ]?(chart|card|bar)|front[- ]?matter|dedicat|imprimatur|approbat|privilege|^image$|^figure$|^map$|^photo/i;

const fnv1a = s => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; };
function yearOf(b) {
  if (Number.isFinite(b.year) && !b.year_estimated) return b.year;
  const m = String(b.published || '').match(/\b(1[0-9]\d\d|20[0-2]\d|[5-9]\d\d)\b/);
  return m ? Number(m[1]) : null;
}
function shuffle(xs, seed) {
  const a = xs.slice(), r = makeRng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const out = { seed: SEED, drawn_at: new Date().toISOString(), rule: 'scripts/eval/ocr-prereg-6388/README.md', strata: {}, rows: [], spares: [], skipped: [] };

for (const [k, st] of STRATA.entries()) {
  const books = await db.collection('books').find(
    { ...FRAME, language: { $in: st.language }, 'book_class.class': st.cls, 'book_class.script_family': st.family },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, year_estimated: 1, published: 1, pages_count: 1, 'image_source.provider': 1, 'image_source.identifier': 1, ia_identifier: 1 } },
  ).toArray();
  const elig = books.filter(b => b.id && (!st.years || ((y) => y != null && y >= st.years[0] && y <= st.years[1])(yearOf(b))));
  elig.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const order = shuffle(elig, SEED + k);
  out.strata[st.id] = { eligible_books: elig.length, eligible_pages: elig.reduce((n, b) => n + (b.pages_count || 0), 0), seed: SEED + k };
  let got = 0;
  for (const b of order) {
    if (got >= N + SPARES) break;
    const pages = await db.collection('pages').find({ book_id: b.id }, {
      projection: { _id: 0, id: 1, page_number: 1, page_type: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.model': 1, 'ocr.updated_at': 1, ocr_present: { $cond: [{ $eq: [{ $type: '$ocr' }, 'object'] }, true, false] } },
    }).toArray();
    pages.sort((x, y) => x.page_number - y.page_number);
    const n = pages.length, lo = Math.floor(0.15 * n), hi = Math.ceil(0.95 * n) - 1;
    const interior = pages.slice(lo, hi + 1);
    const ok = interior.filter(p => p.ocr_present && getPageSource(p) && !EXCLUDE_TYPE.test(String(p.page_type || '')));
    if (!ok.length) { out.skipped.push({ stratum: st.id, book_id: b.id, n_pages: n, interior: interior.length, why: n < 3 ? 'under 3 pages' : 'no eligible interior page' }); continue; }
    const p = ok[Math.floor(makeRng((SEED ^ fnv1a(b.id)) >>> 0)() * ok.length)];
    const row = {
      uid: `${st.id}|${b.id}-p${p.page_number}`, stratum: st.id, book_id: b.id, page_id: p.id, page_number: p.page_number,
      n_pages: n, interior_index: pages.indexOf(p), eligible_in_book: ok.length, page_type: p.page_type ?? null,
      stored_ocr_model: p.ocr?.model ?? null, stored_ocr_at: p.ocr?.updated_at ?? null,
      image: getPageSource(p), title: String(b.display_title || b.title || '').slice(0, 140), author: String(b.author || '').slice(0, 80),
      language: b.language, year: yearOf(b), provider: b.image_source?.provider ?? null, ia_identifier: b.ia_identifier || (b.image_source?.provider === 'internet_archive' ? b.image_source?.identifier : null) || null,
    };
    (got < N ? out.rows : out.spares).push(row);
    got++;
  }
  console.log(st.id, 'eligible books', elig.length, 'drawn', Math.min(got, N), 'spares', Math.max(0, got - N));
}
await client.close();

const control = shuffle(out.rows.map(r => r.uid), SEED + 10).slice(0, 10);
fs.writeFileSync(path.join(HERE, 'draw.json'), JSON.stringify(out, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'control-set.json'), JSON.stringify({ seed: SEED + 10, rule: 'README.md § Hand-key control set', uids: control }, null, 1) + '\n');
console.log('rows', out.rows.length, 'spares', out.spares.length, 'skipped', out.skipped.length, 'control', control.length);

#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-shift-risk-5021.mjs loadBook (rebuilds contained pages' English as of a date); this
// needs only each labelled page's write time, model, prompt version and source shape, so it reads page_revisions
// for those and leaves the texts. Read-only.
/**
 *   node --env-file=.env.production.local scripts/eval/wrong-leaf-find-5021/labels.mjs OUT.jsonl
 * Every page in the two 2026-11-03 Opus label files (leaf-shift-library, shift-screen) with its verdict, and for every
 * page of those books (withheld ones included, from the withhold's page_revisions snapshot): n, t (write ms), m, pv,
 * en/src lengths, hr (source "---" rules), h/tl (English edges), ty. One line per book.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
const R = 'scripts/eval/results';
const verdicts = new Map();
for (const f of [`${R}/translation-leaf-shift-5021/2026-11-03/opus-verdicts.jsonl.gz`, `${R}/shift-screen-5021/2026-11-03/opus-verdicts.jsonl.gz`]) {
  for (const l of zlib.gunzipSync(fs.readFileSync(f)).toString().split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    for (const v of r.verdicts || []) verdicts.set(`${r.book_id}:${v.page}`, { v: v.verdict, src: f.includes('shift-screen') ? 'screen' : 'library', frame: r.frame, tier: r.tier });
  }
}
const books = [...new Set([...verdicts.keys()].map((k) => k.split(':')[0]))];
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const out = fs.createWriteStream(process.argv[2]);
const HR = /\n\s*(?:-{3,}|\*{3,}|_{3,})\s*\n/g;
let i = 0;
for (const b of books) {
  const ps = await db.collection('pages').find({ book_id: b }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1, 'translation.model': 1, 'translation.prompt_version': 1, translation_withheld: 1 } }).toArray();
  // By page_id (indexed), and only for pages withheld now: a book_id + reason query scans (5 books in 8 min).
  const wh = ps.filter((p) => typeof p.translation?.data !== 'string' && p.translation_withheld).map((p) => p.id);
  const revs = wh.length ? await db.collection('page_revisions').find({ page_id: { $in: wh }, field: 'translation' }, { projection: { page_id: 1, data: 1, model: 1, prompt_version: 1, original_date: 1, created_at: 1 } }).sort({ created_at: -1 }).toArray() : [];
  // The latest revision row of a withheld page is the withhold's snapshot of the English it removed.
  const rv = new Map(); for (const r of revs) if (!rv.has(r.page_id) && typeof r.data === 'string' && r.data.length) rv.set(r.page_id, r);
  const book = await db.collection('books').findOne({ id: b }, { projection: { language: 1, title: 1 } });
  const pages = [];
  for (const p of ps) {
    let en = p.translation?.data, t = p.translation?.updated_at, m = p.translation?.model, pv = p.translation?.prompt_version;
    const r = rv.get(p.id);
    if (typeof en !== 'string' && r && typeof r.data === 'string') { en = r.data; t = r.original_date; m = r.model; pv = r.prompt_version; }
    if (typeof en !== 'string') continue;
    const src = typeof p.ocr?.data === 'string' ? p.ocr.data : '';
    const lab = verdicts.get(`${b}:${p.page_number}`);
    pages.push({ n: p.page_number, t: t ? new Date(t).getTime() : null, m: m ?? null, pv: pv != null ? String(pv) : null, ty: p.page_type ?? null, en: en.length, src: src.length, hr: (src.match(HR) || []).length, h: en.slice(0, 24), tl: en.slice(-24), wh: p.translation_withheld ? 1 : 0, ...(lab ? { y: lab.v, ysrc: lab.src } : {}) });
  }
  pages.sort((a, z) => a.n - z.n);
  out.write(JSON.stringify({ b, lang: book?.language ?? null, title: book?.title ?? null, pages }) + '\n');
  if (++i % 50 === 0) console.log(i, '/', books.length);
}
out.end(); await c.close();
console.log('labelled pages', verdicts.size, 'books', books.length);

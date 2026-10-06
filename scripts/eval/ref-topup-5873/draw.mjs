#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t4/draw-candidates.mjs orders the translated body pages of a HAND-PICKED book list with a seed; scripts/eval/xlref-t4/leak-check.mjs measures facing English afterwards. Neither draws the BOOKS: T4 and T5 chose books where a translation was known to exist. This draws the books too (seeded order over every live translated book of the language not already tried), then their candidate pages, and writes one file per book for an alignment agent. Read-only.
/** Seeded book and page draw for the #5873 reference top-up. */
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ref-topup-5873/draw.mjs --out <private dir> --sealed <sealed.json> [--seed 5873] [--pages 6]
//   Writes <out>/cands/<Lang>/<order>_<book_id>.json (book metadata + candidate pages with their OCR) and <sealed.json> (ids and page numbers only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';
import { langOf } from './census.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = opt('out'), SEALED = opt('sealed'), SEED = Number(opt('seed', 5873)), NPAGES = Number(opt('pages', 6));
// How many books to PREPARE per language, in seeded order (more than the quota: about a quarter do not align).
// The first draw (40 / 30 / 20 / 10 for Hebrew / Arabic / Chinese / Sanskrit) was extended the same day, before any alignment: the order is a
// deterministic shuffle, so a longer list only appends. Most drawn Chinese books are rhyme-dictionary volumes nobody has translated.
const PREPARE = { Persian: 60, Hebrew: 90, Arabic: 70, Pali: 30, Chinese: 120, Sanskrit: 30 };
const RES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results');
const jl = (f) => fs.readFileSync(path.join(RES, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// Books already referenced or already tried in the first runs are not drawn again.
const tried = new Set([
  ...jl('xlref-t4-2026-10/pages.jsonl').map((r) => r.book_id), ...jl('xlref-t5-2026-10/pages.jsonl').map((r) => r.book_id),
  ...JSON.parse(fs.readFileSync(path.join(RES, 'xlref-t4-2026-10/books-not-aligned.json'), 'utf8')).map((r) => r.book_id),
  ...JSON.parse(fs.readFileSync(path.join(RES, 'xlref-t5-2026-10/work/excluded.json'), 'utf8')).map((r) => r.book_id),
]);
const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const latinShare = (t) => { const w = stripMarkupTags(String(t || '')).split(/\s+/).filter((x) => /\p{L}{2,}/u.test(x)); return w.length ? Math.round(100 * w.filter((x) => /^[\p{Script=Latin}\p{P}\d]+$/u.test(x)).length / w.length) / 100 : null; };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore'); const sealed = { seed: SEED, at: new Date().toISOString(), pages_per_book: NPAGES, eligible: {}, books: {} };
try {
  const all = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, language: { $regex: /^\s*(persian|hebrew|heb|arabic|pali|chinese|classical\s+chinese|sanskrit)\b/i } },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, pages_count: 1, pages_translated: 1 } }).toArray();
  for (const lang of Object.keys(PREPARE)) {
    const pool = all.filter((b) => langOf(b.language) === lang && !tried.has(b.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
    sealed.eligible[lang] = { live_translated_books: all.filter((b) => langOf(b.language) === lang).length, already_tried: all.filter((b) => langOf(b.language) === lang && tried.has(b.id)).length, drawable: pool.length };
    const order = shuffle(pool, makeRng(SEED + lang.length * 1000 + lang.charCodeAt(0))).slice(0, PREPARE[lang]);
    sealed.books[lang] = [];
    let k = 0;
    for (const b of order) {
      k++;
      const cf = path.join(OUT, 'cands', lang, `${String(k).padStart(2, '0')}_${b.id}.json`);
      if (fs.existsSync(cf)) { const d = JSON.parse(fs.readFileSync(cf, 'utf8')); sealed.books[lang].push({ order: k, book_id: b.id, eligible_pages: d.eligible_pages, candidates: d.candidates.map((x) => x.page_number) }); continue; } // resumable
      const lens = await db.collection('pages').aggregate([{ $match: { book_id: b.id } }, { $project: { page_number: 1, o: { $strLenCP: { $ifNull: ['$ocr.data', ''] } }, t: { $strLenCP: { $ifNull: ['$translation.data', ''] } } } }, { $sort: { page_number: 1 } }]).toArray();
      const max = lens.length ? lens[lens.length - 1].page_number : 0;
      const ok = lens.filter((p) => p.o > 300 && p.t > 300 && p.page_number > 0.1 * max && p.page_number < 0.9 * max).map((p) => p.page_number);
      const picks = shuffle(ok, makeRng(SEED + [...b.id].reduce((s, ch) => s + ch.charCodeAt(0), 0))).slice(0, NPAGES);
      const cands = [];
      for (const pn of picks) {
        const near = await db.collection('pages').find({ book_id: b.id, page_number: { $gte: pn - 1, $lte: pn + 1 } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
        const by = Object.fromEntries(near.map((p) => [p.page_number, p.ocr?.data || '']));
        cands.push({ page_number: pn, served: true, latin_share_page: latinShare(by[pn]), latin_share_neighbours: [latinShare(by[pn - 1]), latinShare(by[pn + 1])], ocr: by[pn] });
      }
      const dir = path.join(OUT, 'cands', lang); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cf, JSON.stringify({ order: k, book_id: b.id, lang_label: b.language, title: b.display_title || b.title, author: b.author ?? null, year: b.year ?? null, pages_total: lens.length, eligible_pages: ok.length, candidates: cands }, null, 1));
      sealed.books[lang].push({ order: k, book_id: b.id, eligible_pages: ok.length, candidates: picks });
    }
    console.log(lang, JSON.stringify(sealed.eligible[lang]), 'prepared', order.length);
  }
} finally { await c.close(); }
fs.writeFileSync(SEALED, JSON.stringify(sealed, null, 1));

#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-strata-7947/draw.mjs (stratified live-book draw of one language, packets of pages; 3
// pages a book at fixed quantiles, uniform over books — this study wants ONE page a book, page-weighted, so the book
// is drawn with probability ∝ its translated pages); scripts/eval/confidence-7866/lib.mjs (eligiblePage, imageUrl,
// cellLang, FRAME — imported); scripts/eval/route-judge-6740/defect-rate.mjs words(); lib/paired-stats.mjs makeRng.
// Searched scripts/eval/INDEX.md and `gh issue list --search "sanskrit greek served quality"`: no draw of live
// Sanskrit or Greek beyond #7866's 3 and 6 books.
/**
 * #7991 stage 1: the draw. Read-only on Mongo, no model calls.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/sa-gr-served-7991/draw.mjs [--out DIR]
 *
 * Frame: live books (visible, pages_count > 0, pages_translated > 0) of language /^Sanskrit/ or /^(Ancient )?Greek/,
 * minus every book of the #7866 draw (confidence-7866/results/draw.json).
 * Strata (from the catalogue, checked later on the image; the analysis reports the image's form):
 *   Sanskrit  form  = book_class.class (handwritten → manuscript; printed, mixed, none → print)       15 + 15 books
 *   Greek     form × era (year ?? year_earliest ?? first 4-digit run of published; < 1600 | ≥ 1600)   4 × 10 books
 *             Greek books with no date are outside the era cells: counted in frame.json, not drawn.
 * Page-weighted: within a stratum, books are drawn without replacement with probability ∝ pages_translated
 * (Efraimidis–Spirakis keys u^(1/w), seeded), then ONE page uniformly from the book's eligible pages: eligiblePage()
 * (#7866's rule: OCR text, not a plate/blank/front-matter, not hidden or split, has an image), English longer than
 * 20 characters (#7968's rule) and at least 40 words of OCR (#7947's floor). A drawn book with no such page is logged
 * and the next key is taken. One page a book: the book IS the cluster.
 * SERVED pages only: isVisiblePage() (page_number > 0, not a repeat capture — what the reader lists). eligiblePage()
 * alone admits soft-hidden pages (negative page_number) that no reader sees; the first draw took three of them.
 *   --replace   amendment (2026-11-03): for every drawn page that is not served, draw again, uniformly, from the same
 *               book's served eligible pages (seeded by the book id). Rejection inside a book keeps the page uniform
 *               over served pages; the replaced page is kept under `replaced` and never enters a rate.
 * Writes OUT/sample.json (books + their page, provenance, the stratum's frame pages) and OUT/frame.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { eligiblePage, imageUrl } from '../confidence-7866/lib.mjs';
import { words } from '../route-judge-6740/defect-rate.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { isVisiblePage } from '../../lib/page-counts.mjs';
import { OUT, SEED, ALLOC, HERE } from './lib.mjs';

const MIN_WORDS = 40, MIN_TR = 20;
if (!process.argv.includes('--replace') && fs.existsSync(path.join(OUT, 'sample.json'))) throw new Error(`${OUT}/sample.json exists — refusing to draw over a run`);

const yearOf = (b) => {
  const y = Number.parseInt(String(b.year ?? b.year_earliest ?? String(b.published ?? '').match(/\d{4}/)?.[0] ?? ''), 10);
  return Number.isFinite(y) && y > 100 && y < 2100 ? y : null;
};
const formTag = (b) => (b.book_class?.class === 'handwritten' ? 'manuscript' : 'print');
export const stratumOf = (lang, b) => {
  if (lang === 'Sanskrit') return formTag(b);
  const y = yearOf(b);
  return y == null ? null : `${formTag(b)}|${y < 1600 ? 'before 1600' : '1600 and later'}`;
};
const LANGS = { Sanskrit: /^Sanskrit/, Greek: /^(Ancient )?Greek/ };

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const excluded = new Set(JSON.parse(fs.readFileSync(path.join(HERE, '../confidence-7866/results/draw.json'), 'utf8')).books.map((b) => b.id));
const PROJ = { id: 1, page_number: 1, repeat_of: 1, page_type: 1, hidden: 1, split_into: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.pipeline': 1, 'ocr.updated_at': 1,
  'translation.data': 1, 'translation.model': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.engine.call_site': 1, 'translation.edited_by': 1,
  display_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 };

if (process.argv.includes('--replace')) {
  const cur = JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8'));
  const books = new Map((await db.collection('books').find({ id: { $in: cur.map((x) => x.book_id) } }, { projection: { id: 1, title: 1, language: 1, year: 1, year_earliest: 1, published: 1, 'book_class.class': 1, pages_translated: 1 } }).toArray()).map((b) => [b.id, b]));
  let n = 0;
  for (let i = 0; i < cur.length; i++) {
    const x = cur[i];
    const p = await db.collection('pages').findOne({ id: x.page_id }, { projection: { page_number: 1, repeat_of: 1 } });
    if (isVisiblePage(p)) continue;
    const pages = await eligibleOf(x.book_id);
    const rng = makeRng(SEED + [...x.book_id].reduce((a, ch) => a + ch.charCodeAt(0), 0));
    const q = pages[Math.floor(rng() * pages.length)];
    const { ocr, translation, ...old } = x;
    cur[i] = { ...(await rowOf(x.language, x.stratum, books.get(x.book_id), q, pages.length)), replaced: { ...old, why: `not served: page_number ${p?.page_number}, repeat_of ${p?.repeat_of ?? null}` } };
    console.log(`replaced ${x.book_id} p${x.page_number} → p${q.page_number}`); n++;
  }
  fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify(cur, null, 1));
  console.log(`${n} pages replaced`);
  await c.close();
  process.exit(0);
}

const sample = [], frame = { seed: SEED, alloc: ALLOC, excluded_7866_books: excluded.size, languages: {} };
for (const [lang, re] of Object.entries(LANGS)) {
  const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, language: re },
    { projection: { id: 1, title: 1, language: 1, year: 1, year_earliest: 1, published: 1, 'book_class.class': 1, pages_count: 1, pages_translated: 1 } }).toArray();
  const fr = (frame.languages[lang] = { books: books.length, in_7866: 0, undated: { books: 0, pages_translated: 0 }, strata: {} });
  const by = {};
  for (const b of books) {
    if (excluded.has(b.id)) { fr.in_7866++; continue; }
    const s = stratumOf(lang, b);
    if (!s) { fr.undated.books++; fr.undated.pages_translated += b.pages_translated; continue; }
    (by[s] ??= []).push(b);
  }
  for (const [s, bs] of Object.entries(by).sort()) {
    const rng = makeRng(SEED + [...`${lang}|${s}`].reduce((a, ch) => a + ch.charCodeAt(0), 0));
    const keyed = bs.sort((a, b) => (a.id < b.id ? -1 : 1)).map((b) => ({ b, k: Math.log(rng()) / b.pages_translated })).sort((x, y) => y.k - x.k);
    const st = (fr.strata[s] = { books: bs.length, pages_translated: bs.reduce((a, b) => a + b.pages_translated, 0), want: ALLOC[lang][s] ?? 0, drawn: 0, skipped: [] });
    for (const { b } of keyed) {
      if (st.drawn >= st.want) break;
      const pages = await eligibleOf(b.id);
      if (!pages.length) { st.skipped.push({ book_id: b.id, why: 'no eligible translated page' }); continue; }
      const p = pages[Math.floor(rng() * pages.length)];
      sample.push(await rowOf(lang, s, b, p, pages.length));
      st.drawn++;
    }
    console.log(`${lang} ${s}: ${st.drawn}/${st.want} of ${bs.length} books (${st.pages_translated} translated pages); skipped ${st.skipped.length}`);
  }
}
await c.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify(sample, null, 1));
fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify(frame, null, 1));
console.log(`sample: ${sample.length} pages → ${OUT}`);

async function eligibleOf(bookId, { served = true } = {}) {
  return (await db.collection('pages').find({ book_id: bookId }, { projection: PROJ }).sort({ page_number: 1 }).toArray())
    .filter((p) => (!served || isVisiblePage(p)) && eligiblePage(p) && typeof p.translation?.data === 'string' && p.translation.data.trim().length > MIN_TR && words(p.ocr.data) >= MIN_WORDS);
}
async function rowOf(lang, s, b, p, nEligible) {
      // #5813 (Greek): the Flash re-read replaced a flash-lite read; its trace is an earlier lite OCR revision of the page.
      const revs = await db.collection('page_revisions').find({ page_id: p.id, field: 'ocr' }, { projection: { model: 1, source: 1, created_at: 1 } }).toArray();
      return {
        book_id: b.id, language: lang, book_language: b.language, stratum: s, form_tag: formTag(b), year: yearOf(b),
        title: String(b.title ?? '').slice(0, 160), pages_translated: b.pages_translated, eligible_pages: nEligible,
        page_id: p.id, page_number: p.page_number, image: imageUrl(p), script_type: p.script_type ?? null, words: words(p.ocr.data),
        ocr: p.ocr.data, translation: p.translation.data,
        prov: { ocr_model: p.ocr.model ?? null, ocr_source: p.ocr.source ?? null, ocr_pipeline: p.ocr.pipeline ?? null, ocr_at: p.ocr.updated_at ?? null,
          tr_model: p.translation.model ?? null, tr_source: p.translation.source ?? null, tr_at: p.translation.updated_at ?? null,
          tr_call_site: p.translation.engine?.call_site ?? null, tr_edited: !!p.translation.edited_by,
          ocr_revisions: revs.map((r) => `${r.source ?? '?'}:${r.model ?? '?'}`),
          redo_5813_ocr: lang === 'Greek' && p.ocr.model === 'gemini-3-flash-preview' && revs.some((r) => /flash-lite/.test(r.model ?? '')),
          tr_after_ocr: p.translation.updated_at && p.ocr.updated_at ? new Date(p.translation.updated_at) >= new Date(p.ocr.updated_at) : null },
      };
}

#!/usr/bin/env node
// Corpus size measurement — how much text does Source Library hold?
//
// Counts words across every text layer: original-language OCR, AI translation,
// per-page enrichment (summaries/keywords), AI image descriptions, and
// book-level enrichment. Reports against English Wikipedia (~5B words of
// article prose) and all-Wikipedias-combined (~30B words).
//
// WHY trimmed means: a handful of `pages.translation.data` fields hold
// 50k-65k "words" (whole-book/concatenated dumps stuffed into one page record
// — a genuine ingest bug, see --outliers). Those wreck the arithmetic mean
// (translation mean 2,326 vs median 463). We report the median and a 1%-
// trimmed mean; the trimmed mean is the headline estimate. Run --outliers to
// list the pathological pages.
//
// Source of truth is Mongo `pages` (NOT Supabase page_translations, which is a
// partial ~74% mirror used for embeddings/snippets). Estimates are $sample
// extrapolations — expect a few percent of sampling noise.
//
// Run:  set -a; source .env.production.local; set +a; \
//       node scripts/analytics/corpus-size.mjs [--sample N] [--outliers]

import { MongoClient } from 'mongodb';

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : def; };
const SAMPLE = Number(arg('--sample', 8000));
const OUTLIERS = process.argv.includes('--outliers');
// Per-page winsorization cap. A real dense double-column folio translates to at
// most ~2,500 English words; anything above WINSOR is a duplicated/concatenated
// ingest artifact (see --outliers), so we cap each page's contribution here.
// This is the honest basis for a TOTAL — it keeps legitimately long pages while
// refusing to let a handful of 50k-word junk pages dominate the sum.
const WINSOR = Number(arg('--winsor', 3000));

const WIKI_EN = 5.0e9;   // English Wikipedia article prose, words (~2026)
const WIKI_ALL = 30e9;   // all language Wikipedias combined, words

// --- word counting + editorial-wrapper stripping (mirrors
//     src/lib/strip-editorial-wrappers.ts; inlined for .mjs) ---
const EDITORIAL = 'meta|summary|keywords|vocab';
const stripEditorial = (t) => !t ? '' : t
  .replace(new RegExp(`<(${EDITORIAL})>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
  .replace(new RegExp(`<\\/?(?:${EDITORIAL})>`, 'gi'), ' ');
// Also drop structural OCR tags (header/sig/lang/page-type) and any remaining
// inline tags, keeping inner text (note/term/margin/gloss are real body text).
const cleanWords = (t) => {
  if (!t || typeof t !== 'string') return 0;
  const body = stripEditorial(t)
    .replace(/<(header|sig|lang|page-type)>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const m = body.trim().match(/\S+/g);
  return m ? m.length : 0;
};

const stats = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  const pct = (p) => a[Math.min(n - 1, Math.floor(n * p))] ?? 0;
  const mean = a.reduce((s, v) => s + v, 0) / Math.max(1, n);
  // Winsorized mean: cap each value at WINSOR before averaging. Robust to the
  // fat junk-page tail (p99 ~52k words) in a way a 1% trim is not — the tail
  // here is far thicker than 1%.
  const winsor = a.reduce((s, v) => s + Math.min(v, WINSOR), 0) / Math.max(1, n);
  const capped = a.filter(v => v > WINSOR).length;
  return { n, mean, winsor, capped, median: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: a[n - 1] ?? 0 };
};

const B = (x) => (x / 1e9).toFixed(2) + ' B';
const M = (x) => (x / 1e6).toFixed(0) + ' M';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('Set MONGODB_URI'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');
const books = db.collection('books');
const gallery = db.collection('gallery_images');

const totalPages = await pages.estimatedDocumentCount();
console.log(`\nCORPUS SIZE — ${totalPages.toLocaleString()} page docs, sampling ${SAMPLE.toLocaleString()}\n`);

// --- outlier mode: list the pathological pages and exit ---
if (OUTLIERS) {
  console.log('Pages whose translation.data exceeds 15,000 words (a page should be ~300-700):');
  const samp = await pages.aggregate([
    { $sample: { size: 40000 } },
    { $project: { book_id: 1, page_number: 1, 'translation.data': 1 } },
  ], { allowDiskUse: true }).toArray();
  const bad = samp
    .map(p => ({ book_id: p.book_id, page: p.page_number, words: cleanWords(p.translation?.data) }))
    .filter(p => p.words > 15000)
    .sort((a, b) => b.words - a.words);
  if (!bad.length) { console.log('  none in this sample (they are rare — try a larger --sample).'); }
  for (const p of bad) console.log(`  ${p.words.toLocaleString().padStart(8)} words  book=${p.book_id} page=${p.page}`);
  console.log(`\n  ${bad.length} of ${samp.length} sampled (${(bad.length / samp.length * 100).toFixed(2)}%). ` +
    `Extrapolated ~${Math.round(bad.length / samp.length * totalPages).toLocaleString()} pathological pages library-wide.`);
  await client.close();
  process.exit(0);
}

// --- main: sample pages, measure OCR + translation + per-page enrichment ---
const samp = await pages.aggregate([
  { $sample: { size: SAMPLE } },
  { $project: { 'ocr.data': 1, 'translation.data': 1, translation_summary: 1, translation_keywords: 1 } },
], { allowDiskUse: true }).toArray();

const ocr = [], tr = [];
let psWords = 0, kwWords = 0;
for (const p of samp) {
  if (p.ocr?.data) ocr.push(cleanWords(p.ocr.data));
  if (p.translation?.data) tr.push(cleanWords(p.translation.data));
  psWords += cleanWords(p.translation_summary);
  kwWords += cleanWords(p.translation_keywords);
}
const ocrS = stats(ocr), trS = stats(tr);
const ocrCov = ocr.length / samp.length, trCov = tr.length / samp.length;

const project = (perPage, cov) => perPage * cov * totalPages;
const ocrWords = project(ocrS.winsor, ocrCov);
const trWords = project(trS.winsor, trCov);
const psTotal = (psWords / samp.length) * totalPages;
const kwTotal = (kwWords / samp.length) * totalPages;

console.log(`PER-PAGE (clean words, editorial wrappers stripped; winsorized at ${WINSOR}):`);
console.log(`  OCR  : ${(ocrCov * 100).toFixed(1)}% of pages | median ${ocrS.median} | winsor-mean ${ocrS.winsor.toFixed(0)} | raw-mean ${ocrS.mean.toFixed(0)} | p99 ${ocrS.p99} | max ${ocrS.max}`);
console.log(`  TRANS: ${(trCov * 100).toFixed(1)}% of pages | median ${trS.median} | winsor-mean ${trS.winsor.toFixed(0)} | raw-mean ${trS.mean.toFixed(0)} | p99 ${trS.p99} | max ${trS.max}`);
console.log(`  (capped ${ocrS.capped} OCR + ${trS.capped} TRANS pages above ${WINSOR}w as junk; raw-mean is the inflated ceiling)`);
if (trS.max > 15000) console.log(`  ⚠  translation max ${trS.max.toLocaleString()} words on one page — outlier ingest bug. Run --outliers.`);

// --- gallery image descriptions ---
const giTotal = await gallery.estimatedDocumentCount();
const gsamp = await gallery.aggregate([{ $sample: { size: 4000 } },
  { $project: { description: 1, museum_description: 1, gallery_rationale: 1 } }]).toArray();
let giWords = 0;
for (const g of gsamp) giWords += cleanWords(g.description) + cleanWords(g.museum_description) + cleanWords(g.gallery_rationale);
const giTotalWords = (giWords / gsamp.length) * giTotal;

// --- book-level enrichment (full scan, robust) ---
let bkWords = 0, nb = 0;
try {
  const cur = books.find({}, { projection: {
    description: 1, 'index.bookSummary': 1, 'summary.data': 1,
    'reading_summary.overview': 1, 'reading_summary.detailed': 1, 'reading_summary.themes': 1,
    'ai_metadata.description': 1,
  } });
  for await (const b of cur) {
    nb++;
    const themes = Array.isArray(b.reading_summary?.themes) ? b.reading_summary.themes.join(' ') : b.reading_summary?.themes;
    bkWords += cleanWords(b.description) + cleanWords(b.index?.bookSummary) + cleanWords(b.summary?.data)
      + cleanWords(b.reading_summary?.overview) + cleanWords(b.reading_summary?.detailed)
      + cleanWords(themes) + cleanWords(b.ai_metadata?.description);
  }
} catch (e) { console.error('book scan stopped early after', nb, ':', e.message); }

const enrich = psTotal + kwTotal + giTotalWords + bkWords;
const grand = ocrWords + trWords + enrich;

console.log('\nTOTALS (winsorized-mean basis, words):');
console.log(`  OCR (originals)     ${B(ocrWords)}`);
console.log(`  Translations        ${B(trWords)}`);
console.log(`  Enrichment          ${B(enrich)}  (page-sum ${M(psTotal)} + kw ${M(kwTotal)} + image ${M(giTotalWords)} (${giTotal.toLocaleString()} imgs) + book ${M(bkWords)} over ${nb.toLocaleString()} books)`);
console.log(`  ─────────────────────────────`);
console.log(`  TOTAL               ${B(grand)} words  |  ~${B(grand * 1.4)} tokens (~1.4x, mixed scripts)`);
console.log('\nvs WIKIPEDIA:');
console.log(`  English Wikipedia (~5B words): ${(grand / WIKI_EN * 100).toFixed(0)}%`);
console.log(`  Originals only vs EN-Wiki:     ${(ocrWords / WIKI_EN * 100).toFixed(0)}%`);
console.log(`  All Wikipedias (~30B words):   ${(grand / WIKI_ALL * 100).toFixed(0)}%`);
console.log('\nFor reference, MEDIAN-basis totals (conservative floor):');
console.log(`  OCR ${B(project(ocrS.median, ocrCov))} + TRANS ${B(project(trS.median, trCov))} = ${B(project(ocrS.median, ocrCov) + project(trS.median, trCov) + enrich)}`);
console.log('\nNote: estimates are $sample extrapolations (±few %). Winsorized-mean is the');
console.log(`headline (caps junk pages at ${WINSOR}w); median is the floor; raw-mean the inflated`);
console.log('ceiling. Run --outliers to inspect the junk pages.\n');

await client.close();
process.exit(0);

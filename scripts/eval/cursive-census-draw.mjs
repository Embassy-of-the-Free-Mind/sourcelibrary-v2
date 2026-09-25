#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/benchmark-seal.mjs — seals ONE page per book for an engine benchmark
 * and screens by OCR text; the census needs three interior pages per book across the WHOLE
 * cohort with no screen, and a manifest a classifier can resume over, so it shares the seal's
 * helpers (getPageSource, connect) but not its draw.
 *
 * #5100 step 1 — cursive census of pre-1868 Japanese, the DRAW.
 *
 * Who runs it: a session on the laptop (needs the local mirror + Atlas read access).
 * What it writes: scripts/eval/results/cursive-census/manifest.jsonl — one row per page to
 * classify: the 3 seeded interior pages of every Japanese book whose catalogue year is
 * pre-1868 or unknown (the year is the WORK's date, #4884, so the classifier decides), plus the
 * 10 pages read by eye in #4745 as a positive control (flag `control`, with the eye class).
 *
 * Cohort source: ~/sl-corpus/catalog.jsonl (the local mirror; never a $regex over Atlas).
 * Page source: Atlas `pages` by indexed book_id, image fields only.
 * Interior rule: skip the first 10 % of pages (front matter lies); seeded PRNG per book.
 *
 *   node scripts/eval/cursive-census-draw.mjs [--catalog=~/sl-corpus/catalog.jsonl] [--out=...]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadEnv, connect, disconnect } from './lib/sampling.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CATALOG = argOf('catalog', path.join(os.homedir(), 'sl-corpus', 'catalog.jsonl'));
const OUT_DIR = argOf('out', 'scripts/eval/results/cursive-census');
const PER_BOOK = 3;
const SKIP_FRONT = 0.10;
const CUTOFF_YEAR = 1868;
const SEED = 5100;

// The ten pages read by eye in #4745 (confusion table in the issue). Images are the exact
// files the benchmark ran on, kept at hetzner:/root/ocr-bench/images/<stratum>/<slug>.jpg.
const CONTROLS = [
  { slug: 'japanese-4eb403-p40', eye: 'woodblock-cursive', note: 'Utaibon 1840, printed cursive kana with kunten' },
  { slug: 'japanese-fa4343-p159', eye: 'woodblock-regular', note: 'bibliographic list, block-printed gyosho' },
  { slug: 'japanese-88a16c-p24', eye: 'typeset', note: 'go manual, modern typeset' },
  { slug: 'japanese-59945e-p51', eye: 'typeset', note: 'Hagakure "1716", modern typeset reprint' },
  { slug: 'japanese-c589d4-p17', eye: 'manuscript-cursive', note: 'Bunsho soshi c.1600, Nara-ehon manuscript (classifier said woodblock-cursive in #4745)' },
  { slug: 'japanese-264a74-p5', eye: 'woodblock-cursive', note: 'Koshoku ichidai otoko, printed cursive + picture' },
  { slug: 'japanese-ext-4feaac-p39', eye: 'illustration', note: 'mushroom album, painting with a few labels' },
  { slug: 'japanese-ext-f9eae1-p53', eye: 'manuscript-regular', note: 'medical MS, handwritten kaisho + katakana' },
  { slug: 'japanese-ext-fa2831-p56', eye: 'manuscript-regular', note: 'catalogue MS, handwritten kaisho + katakana' },
  { slug: 'japanese-ext-b16f63-p14', eye: 'manuscript-cursive', note: 'kana-zoshi, cursive' },
];

// mulberry32 — small seeded PRNG, same family the seal uses; seed = census seed + book id.
function prng(seedStr) {
  let h = SEED >>> 0;
  for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0;
  return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function isJapanese(r) { return /jap/i.test(r.language || ''); }
function inCohort(r) {
  if (!isJapanese(r)) return false;
  if ((r.pages_count || 0) <= 0) return false;            // artwork records (single prints) have no pages
  const y = Number(r.year);
  return !y || y < CUTOFF_YEAR;                            // unknown year stays in; the classifier decides
}

async function main() {
  loadEnv();
  const rows = fs.readFileSync(CATALOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const cohort = rows.filter(inCohort).sort((a, b) => a.id.localeCompare(b.id));
  const excludedNoPages = rows.filter(r => isJapanese(r) && (r.pages_count || 0) <= 0 && (!Number(r.year) || Number(r.year) < CUTOFF_YEAR)).length;
  console.log(`catalog rows ${rows.length}; Japanese ${rows.filter(isJapanese).length}; cohort (pre-${CUTOFF_YEAR} or unknown year, pages>0) ${cohort.length}; excluded page-less ${excludedNoPages}`);

  const { db } = await connect();
  const PROJ = { page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outF = path.join(OUT_DIR, 'manifest.jsonl');
  const lines = [];
  const bookRows = [];
  let noImage = 0, short = 0;
  for (const [i, b] of cohort.entries()) {
    const pages = await db.collection('pages').find({ book_id: b.id }, { projection: PROJ, maxTimeMS: 30000 }).sort({ page_number: 1 }).toArray();
    const usable = pages.map(p => ({ page_number: p.page_number, url: getPageSource(p) })).filter(p => p.url);
    const n = pages.length;
    const start = Math.ceil(n * SKIP_FRONT);
    const interior = usable.filter(p => p.page_number > start);
    const pool = interior.length >= PER_BOOK ? interior : usable;   // tiny books: fall back to any page with an image
    if (!pool.length) { noImage++; bookRows.push({ book_id: b.id, drawn: 0, reason: 'no usable image' }); continue; }
    if (pool.length < PER_BOOK) short++;
    const rnd = prng(b.id);
    const picked = [];
    const bag = [...pool];
    while (picked.length < PER_BOOK && bag.length) picked.push(bag.splice(Math.floor(rnd() * bag.length), 1)[0]);
    picked.sort((a, c) => a.page_number - c.page_number);
    for (const p of picked) lines.push(JSON.stringify({
      slug: `census-${b.id.slice(-6)}-p${p.page_number}`, book_id: b.id, page_number: p.page_number, image_url: p.url,
      title: b.title, year: b.year ?? null, published: b.published ?? null, visible: !!b.visible, pages_count: b.pages_count, pages_in_atlas: n,
    }));
    bookRows.push({ book_id: b.id, drawn: picked.length, pages_in_atlas: n, pages_count: b.pages_count, visible: !!b.visible, year: b.year ?? null });
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${cohort.length} books`);
  }
  for (const c of CONTROLS) {
    const stratum = c.slug.startsWith('japanese-ext-') ? 'japanese-ext' : 'japanese';
    lines.push(JSON.stringify({ slug: c.slug, control: true, eye: c.eye, note: c.note, local_file: `/root/ocr-bench/images/${stratum}/${c.slug}.jpg` }));
  }
  fs.writeFileSync(outF, lines.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'books.json'), JSON.stringify({ seed: SEED, cutoff_year: CUTOFF_YEAR, per_book: PER_BOOK, skip_front: SKIP_FRONT, drawn_at: new Date().toISOString(), catalog: CATALOG, books: bookRows }, null, 1));
  console.log(`wrote ${lines.length} manifest rows (${lines.length - CONTROLS.length} census + ${CONTROLS.length} controls) → ${outF}; books with no usable image ${noImage}; books with < ${PER_BOOK} pages ${short}`);
  await disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });

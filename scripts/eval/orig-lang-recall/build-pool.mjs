#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/search-recall/ (#5905) — book-level recall of
 * /api/search against an Atlas-facet expected set; it scores the live English
 * lanes, not a candidate embedding of ORIGINAL text, and its expected sets are
 * built from period-term phrase hits, which an English query over Latin OCR
 * cannot have. scripts/eval/librarian-search/ — golden set at page grain over
 * TRANSLATED books for the Librarian's tools. scripts/eval/lib/embedding-eval.mjs
 * — Gemini only, for OCR/translation quality, not retrieval. None embeds
 * original-language OCR with an open model.
 *
 * build-pool — the retrieval pool for the #5729 recall test: pages of
 * UNTRANSLATED live books (pages_translated: 0) in Latin, German, French and
 * Chinese, all four languages in ONE pool so every query competes cross-lingually.
 *
 *   French: every eligible book (there are ~42; most are 25-page stubs).
 *   Latin / German / Chinese: BOOKS_PER_LANG books by seeded shuffle.
 *   Up to PAGES_PER_BOOK pages per book, drawn at random from pages whose
 *   cleaned OCR has >= MIN_CHARS characters (no blank leaves, plates, stubs).
 *   Most untranslated books hold only 25 OCR'd pages, so the pool is wide
 *   rather than deep.
 *
 * Text is cleaned with the production composer (`cleanPageText`, the same
 * function that writes page_translations' input), so what is embedded here is
 * what a backfill would embed.
 *
 * Writes <out>/pool.jsonl: { book_id, page_number, lang, title, year, text }.
 *
 *   node --env-file=.env.production.local scripts/eval/orig-lang-recall/build-pool.mjs \
 *     --out /root/claude-jobs/librarian-orig-5867 [--seed 5729]
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../../lib/mongo.mjs';
import { cleanPageText } from '../../lib/page-embedding-text.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const OUT = arg('--out');
const SEED = Number(arg('--seed', 5729));
const BOOKS_PER_LANG = Number(arg('--books', 80));
const PAGES_PER_BOOK = Number(arg('--pages', 60));
// Chinese prints ~3x the content per character, so its floor is lower.
const MIN_CHARS = { Latin: 300, German: 300, French: 300, Chinese: 100 };
const LANGS = ['Latin', 'German', 'French', 'Chinese'];
if (!OUT) { console.error('--out DIR required'); process.exit(1); }

const rng = makeRng(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

await withMongo(async (db) => {
  const pool = [];
  for (const lang of LANGS) {
    const live = { visible: true, pages_count: { $gt: 0 }, language: lang, pages_translated: 0, pages_ocr: { $gte: 10 }, content_type: { $ne: 'artwork' } };
    // Sorted by id then shuffled with the seed, so the draw is reproducible
    // (a $sample is not).
    const all = await db.collection('books').find(live).project({ id: 1, title: 1, year: 1 }).sort({ id: 1 }).toArray();
    const books = lang === 'French' ? all : shuffle(all).slice(0, BOOKS_PER_LANG);
    let n = 0;
    for (const b of books) {
      const pages = await db.collection('pages')
        .find({ book_id: b.id, page_number: { $gt: 0 }, 'ocr.data': { $exists: true } })
        .project({ page_number: 1, 'ocr.data': 1 })
        .sort({ page_number: 1 })
        .toArray();
      const usable = pages
        .map((p) => ({ page_number: p.page_number, text: cleanPageText(p.ocr?.data) }))
        .filter((p) => p.text.length >= MIN_CHARS[lang]);
      for (const p of shuffle(usable).slice(0, PAGES_PER_BOOK).sort((a, c) => a.page_number - c.page_number)) {
        pool.push({ book_id: b.id, page_number: p.page_number, lang, title: b.title || '', year: b.year ?? null, text: p.text });
        n++;
      }
    }
    console.log(`${lang}: ${books.length} books, ${n} pages`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pool.jsonl'), pool.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`pool: ${pool.length} pages → ${path.join(OUT, 'pool.jsonl')}`);
}, { timeoutMs: 1_200_000 });

#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/build-pool.mjs (#5729) — pool of
 * UNTRANSLATED pages stratified by language, random pages per book; this pool
 * is stratified by TRADITION, takes a contiguous window (paragraph and context
 * arms need neighbouring pages) and keeps chapter titles. scripts/analysis/
 * experience-map/retrieve — stratifies by language over the whole store, no
 * tradition label and no gold set.
 *
 * build-pool — the pool for the #6173 cross-tradition pilot: ~300 live books
 * in eight traditions, a contiguous window of readable English pages from each.
 *
 * `books.tradition` does not exist (#4773 is a proposal), so a tradition here
 * is a set of collection slugs, checked in the order below (first match wins,
 * so a book shelved under both `kabbalah` and `hermetica` is Kabbalah, and the
 * broad `classical-philosophy` shelf only takes what nothing narrower claimed).
 * The label is for THIS pilot's diversity arm and metric, not a proposal for
 * the field.
 *
 * Page text is the production composer's (`pageEmbeddingInput`: translation,
 * else OCR). A page with no translation is kept only when the book is in
 * English, so every pool page is English text and the arms differ in unit and
 * method, not in language.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-granularity/build-pool.mjs --out DIR [--seed 6173]
 *
 * Writes DIR/pool.jsonl { i, page_id, book_id, page_number, tradition, title,
 * author, year, language, chapter, text } and DIR/books.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../../lib/mongo.mjs';
import { pageEmbeddingInput } from '../../lib/page-embedding-text.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const OUT = arg('--out');
const SEED = Number(arg('--seed', 6173));
const BOOKS_PER_TRADITION = Number(arg('--books', 38));
const WINDOW = Number(arg('--pages', 40));
const MIN_CHARS = 500;
if (!OUT) { console.error('--out DIR required'); process.exit(1); }

export const TRADITIONS = [
  ['kabbalah', ['kabbalah', 'jewish-kabbalistic-mysticism']],
  ['sufi-islamic', ['sufism-islamic-mysticism', 'sufi-eastern-mysticism', 'islamic-philosophy', 'falsafa', 'quran-islamic-theology', 'islam']],
  ['daoist-confucian', ['daoist-classics', 'confucian-classics', 'confucianism']],
  ['buddhist', ['zen-chan', 'theravada', 'chinese-buddhist-texts', 'buddhism', 'indian-buddhist-jain', 'buddhist-studies', 'vajrayana']],
  ['hindu', ['vedanta-darshana', 'yoga', 'yoga-tantra-mysticism', 'vedic-literature', 'hinduism', 'indian-philosophy']],
  ['christian-mystical', ['christian-mysticism-sub', 'german-speculative-mysticism', 'behmenist-underground']],
  ['hermetic-alchemical', ['corpus-hermeticum', 'hermetica', 'spiritual-alchemy', 'rosicrucian-tradition', 'alchemy']],
  ['greek-philosophy', ['neoplatonism', 'platonic-tradition', 'stoicism', 'stoic-moral-philosophy', 'aristotelian-tradition', 'classical-philosophy']],
];

const rng = makeRng(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

await withMongo(async (db) => {
  const live = { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gte: WINDOW }, content_type: { $ne: 'artwork' } };
  const taken = new Set();
  const seenWork = new Set();
  const pool = [];
  const bookRows = [];
  for (const [tradition, slugs] of TRADITIONS) {
    const all = await db.collection('books')
      .find({ ...live, collections: { $in: slugs } })
      .project({ id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, collections: 1, chapters: 1, work_id: 1 })
      .sort({ id: 1 }).toArray();
    let nBooks = 0; let nPages = 0;
    for (const b of shuffle(all.filter((x) => !taken.has(x.id)))) {
      if (nBooks >= BOOKS_PER_TRADITION) break;
      // One edition per work: ten editions of one text is the failure under
      // test (#3514), but the pool should not manufacture it.
      if (b.work_id && seenWork.has(b.work_id)) continue;
      const pages = await db.collection('pages')
        .find({ book_id: b.id, page_number: { $gt: 0 } })
        .project({ id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 })
        .sort({ page_number: 1 }).toArray();
      const english = /^english$/i.test(b.language || '');
      const usable = pages.map((p) => {
        const { text, hasTranslation } = pageEmbeddingInput(p) || { text: '', hasTranslation: false };
        return { page_id: String(p.id ?? p._id), page_number: p.page_number, text, ok: text.length >= MIN_CHARS && (hasTranslation || english) };
      }).filter((p) => p.ok);
      if (usable.length < WINDOW) continue;
      // Skip the first 10% (front matter), then a seeded contiguous window.
      const lo = Math.floor(usable.length * 0.1);
      const start = lo + Math.floor(rng() * Math.max(1, usable.length - WINDOW - lo));
      const win = usable.slice(start, start + WINDOW);
      const chapters = Array.isArray(b.chapters) ? b.chapters : [];
      for (const p of win) {
        const ch = chapters.filter((c) => c.pageNumber <= p.page_number && (c.endPage ?? Infinity) >= p.page_number).pop();
        pool.push({
          i: pool.length, page_id: p.page_id, book_id: b.id, page_number: p.page_number, tradition,
          title: b.display_title || b.title || '', author: b.author || '', year: b.year ?? null, language: b.language || '',
          chapter: ch ? (ch.titleEn || ch.title || '') : '', text: p.text,
        });
      }
      taken.add(b.id); if (b.work_id) seenWork.add(b.work_id);
      bookRows.push({ book_id: b.id, tradition, title: b.display_title || b.title, author: b.author, year: b.year, language: b.language, collections: b.collections, pages: win.length, first: win[0].page_number, last: win[win.length - 1].page_number, has_chapters: chapters.length > 0 });
      nBooks++; nPages += win.length;
    }
    console.log(`${tradition}: ${nBooks} books (of ${all.length} eligible), ${nPages} pages`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pool.jsonl'), pool.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify(bookRows, null, 1));
  const chars = pool.reduce((s, p) => s + p.text.length, 0);
  console.log(`pool: ${pool.length} pages, ${bookRows.length} books, ${chars} chars (mean ${Math.round(chars / pool.length)}/page)`);
}, { timeoutMs: 1_800_000 });

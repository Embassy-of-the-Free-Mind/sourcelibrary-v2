#!/usr/bin/env node
// PRIOR ART: scripts/eval/sa-gr-served-7991/draw.mjs (live-book frame, one page a book, eligiblePage + isVisiblePage +
// a 40-word floor; it draws page-weighted and needs English, this draw is uniform over books and needs none).
// scripts/batch/zh-print-correct-7263/frame.mjs on #8067's branch (the Chinese true-print frame; its output, books.json
// and pages.jsonl.gz, is read here: the file is not on main, so its Gemini-model rule is restated as MODEL_RE).
/**
 * #7263 severity calibration, stage 1: the draw. Read-only on Mongo, no model calls.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/severity-cal-7263/draw.mjs --zh-frame=DIR
 *
 * DIR holds frame.mjs's books.json + pages.jsonl.gz. Writes OUT/sample.json (60 pages, stored text frozen) and
 * OUT/frame.json (frame sizes and every exclusion). Refuses to draw over an existing sample.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { eligiblePage, imageUrl } from '../confidence-7866/lib.mjs';
import { words } from '../route-judge-6740/defect-rate.mjs';
import { scriptClass } from '../lane-judge-sampler.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { isVisiblePage } from '../../lib/page-counts.mjs';
import { OUT, SEED, N_BOOKS, arg, sha, shuffle } from './lib.mjs';

const MODEL_RE = /^(gemini-3-flash-preview|gemini-3\.1-flash-lite)/;   // frame.mjs MODEL_RE
const MIN_WORDS = 40, DEVA_SHARE = 0.8;
if (fs.existsSync(path.join(OUT, 'sample.json'))) throw new Error(`${OUT}/sample.json exists — refusing to draw over a run`);
const ZH = path.resolve(arg('zh-frame') || '');
if (!fs.existsSync(path.join(ZH, 'books.json'))) throw new Error('--zh-frame=DIR with frame.mjs books.json + pages.jsonl.gz required');

const PROJ = { id: 1, book_id: 1, page_number: 1, repeat_of: 1, page_type: 1, hidden: 1, split_into: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.updated_at': 1,
  display_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, archived_photo: 1, photo_original: 1 };
const body = (t) => String(t || '').replace(/<(vocab|meta|note|summary|keywords|image-desc|warning)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
function devaShare(t) {
  const b = body(t), letters = (b.match(/\p{L}|\p{M}/gu) || []).length;
  return letters ? (b.match(/[ऀ-ॿ꣠-ꣿ]/g) || []).length / letters : 0;
}
const sanskritWhy = (p) => {
  if (!isVisiblePage(p)) return 'not served';
  if (!eligiblePage(p)) return 'not eligible (no text, plate/blank/front matter, hidden, split, or no image)';
  if (p.ocr.edited_by || p.ocr.source === 'manual') return 'human-edited';
  const sc = scriptClass(p.ocr.data, p.script_type, null).script_type;
  if (sc === 'manuscript' || sc === 'mixed') return 'tagged handwritten or mixed';
  if (words(p.ocr.data) < MIN_WORDS) return `under ${MIN_WORDS} words`;
  if (devaShare(p.ocr.data) < DEVA_SHARE) return 'under 80% Devanagari';
  return null;
};
const zhWhy = (p) => {
  if (!p) return 'page gone';
  if (!isVisiblePage(p)) return 'not served';
  if (!MODEL_RE.test(p.ocr?.model || '')) return `OCR is now ${p.ocr?.model ?? 'none'} (changed since the frame)`;
  if (p.ocr.edited_by || p.ocr.source === 'manual') return 'human-edited';
  if (!imageUrl(p)) return 'no image';
  return null;
};
const row = (lang, b, p, nEligible, extra = {}) => ({
  lang, book_id: b.id, title: String(b.title ?? '').slice(0, 160), year: b.year ?? null, book_language: b.language, eligible_pages: nEligible,
  page_id: p.id, page_number: p.page_number, image: imageUrl(p), script_type: p.script_type ?? null, words: words(p.ocr.data),
  stored: p.ocr.data, stored_sha: sha(p.ocr.data), stored_model: p.ocr.model ?? null, stored_at: p.ocr.updated_at ?? null, ...extra,
});

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const frame = { seed: SEED, at: new Date().toISOString(), sa: {}, zh: {} };
const sample = [];

// ── Sanskrit ──
{
  const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: /^Sanskrit/ }, { projection: { id: 1, title: 1, language: 1, year: 1, pages_count: 1, 'book_class.class': 1 } }).toArray();
  const hand = books.filter((b) => b.book_class?.class === 'handwritten');
  const pool = books.filter((b) => b.book_class?.class !== 'handwritten').sort((a, b) => (a.id < b.id ? -1 : 1));
  const F = (frame.sa = { live_books: books.length, live_pages: books.reduce((a, b) => a + (b.pages_count || 0), 0), excluded_handwritten_books: hand.length,
    frame_books: pool.length, frame_pages: pool.reduce((a, b) => a + (b.pages_count || 0), 0), skipped_books: [], page_exclusions_in_drawn_books: {} });
  const rng = makeRng(SEED);
  for (const b of shuffle(pool, rng)) {
    if (sample.filter((s) => s.lang === 'sa').length >= N_BOOKS) break;
    const pages = await db.collection('pages').find({ book_id: b.id }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
    const ok = [];
    for (const p of pages) { const why = sanskritWhy(p); if (why) F.page_exclusions_in_drawn_books[why] = (F.page_exclusions_in_drawn_books[why] ?? 0) + 1; else ok.push(p); }
    if (!ok.length) { F.skipped_books.push({ book_id: b.id, title: String(b.title ?? '').slice(0, 80), pages: pages.length, why: 'no eligible page' }); continue; }
    sample.push(row('sa', b, ok[Math.floor(rng() * ok.length)], ok.length, { form_tag: b.book_class?.class ?? null }));
  }
  F.drawn = sample.filter((s) => s.lang === 'sa').length;
  console.log(`sa: ${F.drawn} books drawn of ${F.frame_books} (${F.skipped_books.length} skipped)`);
}

// ── Chinese true print ──
{
  const fb = JSON.parse(fs.readFileSync(path.join(ZH, 'books.json'), 'utf8'));
  const pg = zlib.gunzipSync(fs.readFileSync(path.join(ZH, 'pages.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const owed = new Map(); const states = {};
  for (const p of pg) { states[p.state] = (states[p.state] ?? 0) + 1; if (p.state === 'owed') (owed.get(p.book_id) ?? owed.set(p.book_id, []).get(p.book_id)).push(p); }
  const pool = fb.books.filter((b) => owed.has(b.book_id)).sort((a, b) => (a.book_id < b.book_id ? -1 : 1));
  const F = (frame.zh = { frame_file_at: fb.at, print_books: fb.n, frame_pages: pg.length, page_states: states, books_with_owed: pool.length, owed_pages: [...owed.values()].reduce((a, x) => a + x.length, 0),
    skipped_books: [], redraws: [], not_visible_books: 0 });
  const rng = makeRng(SEED + 1);
  for (const fbk of shuffle(pool, rng)) {
    if (sample.filter((s) => s.lang === 'zh').length >= N_BOOKS) break;
    const b = await db.collection('books').findOne({ id: fbk.book_id }, { projection: { id: 1, title: 1, language: 1, year: 1, visible: 1 } });
    if (b?.visible !== true) { F.not_visible_books++; F.skipped_books.push({ book_id: fbk.book_id, why: 'book not visible' }); continue; }
    let cands = shuffle(owed.get(fbk.book_id), rng), got = null;
    for (const cand of cands) {
      const p = await db.collection('pages').findOne({ id: cand.page_id }, { projection: PROJ });
      const why = zhWhy(p);
      if (!why) { got = p; break; }
      F.redraws.push({ book_id: fbk.book_id, page_id: cand.page_id, why });
    }
    if (!got) { F.skipped_books.push({ book_id: fbk.book_id, why: 'no owed page still eligible' }); continue; }
    sample.push(row('zh', b, got, owed.get(fbk.book_id).length));
  }
  F.drawn = sample.filter((s) => s.lang === 'zh').length;
  console.log(`zh: ${F.drawn} books drawn of ${F.books_with_owed} (${F.skipped_books.length} skipped, ${F.redraws.length} page redraws)`);
}
await c.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify(sample, null, 1));
fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify(frame, null, 1));
console.log(`sample: ${sample.length} pages → ${OUT}`);

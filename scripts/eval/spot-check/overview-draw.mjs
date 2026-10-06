#!/usr/bin/env node
/**
 * PRIOR ART: draw.mjs (the fortnightly draw: one frame, 10 books, a RUN of 3 consecutive pages per book; frozen, so
 * it is not changed here). This draws for a different question — "what is this SHELF like to read?" — so it is
 * stratified (one stratum per tradition a partner cares about, frame size recorded for weighting) and spreads pages
 * across each book (one random translated page in each quarter) instead of a consecutive run. It reuses draw.mjs's
 * page record and lib.mjs helpers unchanged, so the packets fit REVIEWER.md's schema.
 *
 *   node --env-file=.env.production.local scripts/eval/spot-check/overview-draw.mjs \
 *     --strata strata.json --out scripts/eval/results/spot-check/overview-<date> [--books 4] [--bins 4] [--seed N]
 *
 * Only pages a reader can reach: page_number > 0 (≤ 0 is the soft-hide convention, scripts/lib/page-counts.mjs).
 * The 2026-10-07 run predates this filter and drew 6 soft-hidden records; overview-score.mjs drops them.
 *
 * strata.json: [{ name, desc, ids: [book ids] }] — the frame of each stratum, built by whoever runs it and copied
 * into the output (draw-log.json) so the weights travel with the result. Books need ≥ 2×bins translated pages.
 * Writes sample.json, packets/<stratum>.json (one reviewer per stratum), draw-log.json.
 */
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { structureCounts, pageImageUrl } from './lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out');
const STRATA = JSON.parse(readFileSync(opt('strata'), 'utf8'));
const K = Number(opt('books', 4)), BINS = Number(opt('bins', 4)), SEED = Number(opt('seed', 6056));
if (!OUT) throw new Error('--out required');
if (existsSync(join(OUT, 'sample.json'))) throw new Error(`${OUT}/sample.json exists — refusing to draw over a run`);

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const rng = makeRng(SEED);
const shuffle = (a) => { a = [...a].sort(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const sample = [], log = { issue: 6056, seed: SEED, books_per_stratum: K, bins: BINS, strata: [] };
mkdirSync(join(OUT, 'packets'), { recursive: true });
for (const st of STRATA) {
  const chosen = [];
  for (const id of shuffle(st.ids)) {
    if (chosen.length >= K) break;
    const tr = (await db.collection('pages').find({ book_id: id, page_number: { $gt: 0 }, 'translation.data': { $regex: '\\S' } }, { projection: { _id: 0, page_number: 1 } }).toArray())
      .map((p) => p.page_number).sort((a, b) => a - b);
    if (tr.length < 2 * BINS) continue;
    // One random translated page per quarter of the book's translated pages: start, two middles, end.
    const picks = [...Array(BINS).keys()].map((q) => { const lo = Math.floor(q * tr.length / BINS), hi = Math.floor((q + 1) * tr.length / BINS); return tr[lo + Math.floor(rng() * (hi - lo))]; });
    chosen.push({ id, picks });
  }
  const packet = [];
  for (const { id, picks } of chosen) {
    const b = await db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, visible: 1, 'catalog_metadata.collections': 1, 'image_source.provider': 1 } });
    const all = await db.collection('pages').find({ book_id: id }, { projection: { _id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1, _id: 1 }).toArray();
    const run = await db.collection('pages').find({ book_id: id, page_number: { $in: picks } }).sort({ page_number: 1, _id: 1 }).toArray();
    const pages = run.map((p) => ({ page_number: p.page_number, page_id: String(p._id), image_url: pageImageUrl(p),
      crop: !p.split_from_spread && !p.cropped_photo && p.crop?.xStart !== undefined ? p.crop : undefined,
      ocr: p.ocr?.data ?? '', ocr_engine: p.ocr?.source ?? null, ocr_model: p.ocr?.model ?? null,
      translation: p.translation?.data ?? '', translation_model: p.translation?.model ?? null, translation_source: p.translation?.source ?? null }));
    const rec = { slot: sample.length + 1, stratum: st.name, book_id: id, book_url: `https://sourcelibrary.org/book/${id}`, tradition: st.name, book: b,
      structure: { ...structureCounts(all), pages_count_field: b.pages_count, pages_translated_field: b.pages_translated }, run: picks, pages };
    sample.push(rec); packet.push(rec);
    console.log(`${st.name.padEnd(24)} ${id} ${String(b.language).padEnd(10)} p${picks.join(',')} ${String(b.title).slice(0, 44)}`);
  }
  writeFileSync(join(OUT, 'packets', `${st.name}.json`), JSON.stringify(packet, null, 1));
  log.strata.push({ name: st.name, desc: st.desc, frame_size: st.ids.length, drawn: chosen.length, frame_ids: st.ids });
}
await client.close();
writeFileSync(join(OUT, 'sample.json'), JSON.stringify(sample, null, 1));
writeFileSync(join(OUT, 'draw-log.json'), JSON.stringify(log, null, 1));
console.log(`wrote ${OUT}: ${sample.length} books, ${sample.reduce((s, b) => s + b.pages.length, 0)} pages, ${STRATA.length} strata`);

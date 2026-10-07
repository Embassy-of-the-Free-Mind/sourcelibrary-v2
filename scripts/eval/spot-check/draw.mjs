#!/usr/bin/env node
/**
 * Fortnightly spot check (#5914), stage 1: draw 10 public books uniformly per BOOK (never `$sample`), then a
 * random run of 3 consecutive translated pages per book, and write a review packet. Read-only on Mongo, no
 * model calls, no images written (reviewers open them by URL).
 *
 * PRIOR ART: ops `rights-screen/2026-10-06-canon-shelves/spot30/draw30.mjs` (month 0's draw; this is it,
 * parameterised, with the public-library frame and the packet split added). The monthly audit's
 * `../translation-corpus-audit/draw.mjs` draws ONE interior page per book stratified by language with
 * blinded controls — a different instrument; this one reads runs against images.
 *
 *   node --env-file=.env.production.local scripts/eval/spot-check/draw.mjs \
 *     --date 2026-10-19 --out scripts/eval/results/spot-check/2026-10-19 [--n 10] [--frame public|canon] [--no-check-images]
 *
 * Writes: sample.json (books, structure counts, pages with OCR + translation + engines + image URL),
 *         packets/packet-1.json, packets/packet-2.json (5 books each, what a reviewer reads), draw-log.json.
 */
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { drawSample, seedFromDate, structureCounts, pageImageUrl, RUN_LENGTH } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DATE = opt('date', new Date().toISOString().slice(0, 10));
const OUT = opt('out', `scripts/eval/results/spot-check/${DATE}`);
const N = Number(opt('n', 10));
const FRAME = opt('frame', 'public');
const SEED = Number(opt('seed', seedFromDate(DATE)));
const PER_PACKET = 5;
const CHECK_IMAGES = !args.includes('--no-check-images');
const CANON_STATUS = 'scripts/catalog-coverage/results/canon-gap-status-2026-10.json';

if (!['public', 'canon'].includes(FRAME)) throw new Error(`--frame must be public or canon, not ${FRAME}`);
if (existsSync(join(OUT, 'sample.json'))) throw new Error(`${OUT}/sample.json exists — refusing to draw over a run`);

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

// ── Frame: the public library (live filter + ≥ 3 translated pages by counter; the run check verifies) ──
const LIVE = { visible: true, pages_count: { $gt: 0 } };
let frame;
const traditionOf = new Map();
if (FRAME === 'public') {
  frame = (await books.find({ ...LIVE, pages_translated: { $gte: RUN_LENGTH } }, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id).filter(Boolean);
} else {
  const status = JSON.parse(readFileSync(CANON_STATUS, 'utf8'));
  for (const t of status.traditions) for (const b of t.book_pages) if (b[5] >= RUN_LENGTH && !traditionOf.has(b[0])) traditionOf.set(b[0], t.id);
  const live = await books.find({ ...LIVE, id: { $in: [...traditionOf.keys()] } }, { projection: { _id: 0, id: 1 } }).toArray();
  frame = live.map((b) => b.id);
}
console.log(`frame ${FRAME}: ${frame.length} books · seed ${SEED} · n ${N}`);

const translatedFor = async (id) =>
  (await pages.find({ book_id: id, 'translation.data': { $regex: '\\S' } }, { projection: { _id: 0, page_number: 1 } }).toArray()).map((p) => p.page_number);

const { picks, rejected } = await drawSample({ frame, n: N, seed: SEED, translatedFor });
if (picks.length < N) throw new Error(`only ${picks.length} books qualified (rejected ${rejected.length})`);

async function imageStatus(url) {
  if (!url || !CHECK_IMAGES) return null;
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (method === 'GET') await r.body?.cancel();
      if (r.ok || method === 'GET') return r.status;
    } catch (e) { if (method === 'GET') return `error: ${e.cause?.code ?? e.name}`; }
  }
}

const sample = [];
for (const [i, pk] of picks.entries()) {
  const b = await books.findOne({ id: pk.id }, {
    projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1, place_published: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, 'catalog_metadata.collections': 1, 'image_source.provider': 1, ia_identifier: 1 },
  });
  const all = await pages.find({ book_id: pk.id }, { projection: { _id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .sort({ page_number: 1, _id: 1 }).toArray();
  const run = await pages.find({ book_id: pk.id, page_number: { $in: pk.pages } }).sort({ page_number: 1, _id: 1 }).toArray();
  const out = [];
  for (const p of run) {
    const url = pageImageUrl(p);
    out.push({
      page_number: p.page_number,
      page_id: String(p._id),
      image_url: url,
      image_status: await imageStatus(url),
      crop: !p.split_from_spread && !p.cropped_photo && p.crop?.xStart !== undefined ? p.crop : undefined,
      ocr: p.ocr?.data ?? '',
      ocr_engine: p.ocr?.source ?? null,
      ocr_model: p.ocr?.model ?? null,
      translation: p.translation?.data ?? '',
      translation_model: p.translation?.model ?? null,
      translation_source: p.translation?.source ?? null,
    });
  }
  sample.push({
    slot: i + 1,
    book_id: pk.id,
    book_url: `https://sourcelibrary.org/book/${pk.id}`,
    tradition: traditionOf.get(pk.id) ?? null,
    book: b,
    structure: { ...structureCounts(all), pages_count_field: b.pages_count, pages_ocr_field: b.pages_ocr, pages_translated_field: b.pages_translated },
    run: pk.pages,
    pages: out,
  });
  const s = sample.at(-1).structure;
  console.log(String(i + 1).padStart(2), pk.id, String(b.language).padEnd(10), `p${pk.start}-${pk.start + RUN_LENGTH - 1}/${s.page_records}`,
    `back ${s.printed_backsteps} rep ${s.printed_repeats} dup ${s.duplicate_records}`, `img ${out.map((p) => p.image_status).join(',')}`, String(b.title).slice(0, 40));
}
await client.close();

mkdirSync(join(OUT, 'packets'), { recursive: true });
writeFileSync(join(OUT, 'sample.json'), JSON.stringify(sample, null, 1));
for (let k = 0; k * PER_PACKET < sample.length; k++) {
  writeFileSync(join(OUT, 'packets', `packet-${k + 1}.json`), JSON.stringify(sample.slice(k * PER_PACKET, (k + 1) * PER_PACKET), null, 1));
}
let sha = null;
try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const pageRows = sample.flatMap((b) => b.pages);
const log = {
  issue: 5914, date: DATE, seed: SEED, frame: FRAME, frame_size: frame.length, n_books: sample.length,
  n_page_records: pageRows.length, rejected_no_run: rejected,
  images: { checked: CHECK_IMAGES, ok: pageRows.filter((p) => p.image_status === 200).length, missing_url: pageRows.filter((p) => !p.image_url).length },
  rng: 'mulberry32 (paired-stats makeRng); books seed, runs seed ^ 0x9e3779b9', code_sha: sha,
};
writeFileSync(join(OUT, 'draw-log.json'), JSON.stringify(log, null, 1));
console.log(`wrote ${OUT}: ${sample.length} books, ${pageRows.length} page records, images ok ${log.images.ok}/${pageRows.length}`);

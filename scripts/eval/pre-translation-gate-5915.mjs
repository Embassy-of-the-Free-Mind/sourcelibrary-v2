#!/usr/bin/env node
// Calibration and dry run for the pre-translation gate (scripts/lib/pre-translation-gate.mjs, #5915).
// Read-only and $0: no model call, no write to Mongo. Images are touched only by HEAD (the hash of
// a suspected duplicate) and, with --images, by GET of the refused pages for the by-eye check.
//
// PRIOR ART: scripts/eval/lib/sampling.mjs `sampleOnePagePerBook` — one page per book, but it draws
// books and pages with `$sample`, filters on a minimum OCR length and returns no image size, no
// neighbour and no book read share; this draw shuffles the full id list with a fixed seed and keeps
// what the gate reads. scripts/eval/quality-covariates.mjs — joins audited pages to image
// resolution (finding: resolution above 1,500 px does not move quality); it measures the long edge
// of judged pages, not pixels per letter on the corpus. scripts/eval/illegible-gate-5305.mjs — the
// calibration of the OCR-says-illegible gate; a different rule on a different sample.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/pre-translation-gate-5915.mjs \
//     --draw --n=14000 --out=/data/scratch/sl/claude-jobs/gate-5915-work/draw.jsonl
//   node --env-file=… scripts/eval/pre-translation-gate-5915.mjs --calibrate --in=<draw.jsonl> [--images=<dir>]
//   node --env-file=… scripts/eval/pre-translation-gate-5915.mjs --dry-run --books=<id>,<id>
//
// --draw       one random page per book over every book with OCR (seed 20261006): the full id list
//              is shuffled in memory and one translatable page is picked per book by a seeded
//              generator, never `$sample` on pages (it favours big documents and big books).
// --calibrate  the gate over a draw: distributions per script family, refusals per rule, and the
//              refused list (written next to the draw as <draw>.refused.json).
// --dry-run    the gate over EVERY transcribed page of the named books, whatever their translation
//              state, with nothing recorded.

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { isTranslatablePage, SKIP_TRANSLATION_PAGE_TYPES } from '../lib/translate-core.mjs';
import {
  applyPreTranslationGate, bookStructure, bookVerdict, preTranslationVerdict, fetchImageHash, transcribed, imageBox, devanagariShape,
  REFUSAL, BOOK_REFUSAL, MIN_LETTERS_FOR_SIZE, READABILITY_MIN_TOKENS,
} from '../lib/pre-translation-gate.mjs';
import { probeStoredDimensions } from '../lib/archive-coverage.mjs';

const SEED = 20261006;
const arg = (name, dflt = null) => { const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`)); return hit ? (hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true) : dflt; };
const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const quantile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

const LIGHT = {
  _id: 0, id: 1, page_number: 1, page_type: 1, image_width: 1, image_height: 1, 'archive_metadata.bytes': 1, crop: 1, archived_photo: 1, photo: 1,
  has_ocr: { $and: [{ $gt: [{ $strLenCP: { $ifNull: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, ''] } }, 0] }, { $ne: ['$ocr.unreadable', true] }] },
};

async function connect() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  return { client, db: client.db(process.env.MONGODB_DB || 'bookstore') };
}

// ── draw ────────────────────────────────────────────────────────────────────────────────────

async function draw() {
  const n = Number(arg('n', 4000)), out = arg('out');
  if (!out) throw new Error('--draw needs --out=<file.jsonl>');
  const { client, db } = await connect();
  const ids = (await db.collection('books').find({ pages_ocr: { $gt: 0 } }, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id).filter(Boolean).sort();
  const rnd = lcg(SEED);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const picks = ids.slice(0, n);
  console.log(`books with OCR: ${ids.length}; drawing ${picks.length} (seed ${SEED})`);
  const stream = fs.createWriteStream(out);
  const skipped = {};
  let next = 0, kept = 0;

  async function one(bookId, k) {
    const r = lcg((SEED ^ Math.imul(k, 2654435761)) >>> 0);
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, id: 1, title: 1, language: 1, visible: 1, pages_count: 1, pages_translated: 1, 'image_source.provider': 1, 'pipeline_auto.status': 1 } });
    const light = await db.collection('pages').find({ book_id: bookId }, { projection: LIGHT }).toArray();
    const structure = bookStructure(light);
    // Negative page numbers stay in the pool: rule 3 is measured on them.
    const pool = light.filter((p) => p.has_ocr && !SKIP_TRANSLATION_PAGE_TYPES.includes(p.page_type)).sort((a, b) => a.page_number - b.page_number || String(a.id).localeCompare(String(b.id)));
    for (let tries = 0; tries < 4 && pool.length; tries++) {
      const pick = pool.splice(Math.floor(r() * pool.length), 1)[0];
      const page = await db.collection('pages').findOne({ id: pick.id }, { projection: {
        _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, script_type: 1, image_width: 1, image_height: 1, 'archive_metadata.bytes': 1, photo: 1, archived_photo: 1, crop: 1,
        'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'translation.model': 1, 'translation.health_blocked': 1, 'translation_withheld.reason': 1,
        has_translation: { $gt: [{ $strLenCP: { $ifNull: [{ $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''] }, ''] } }, 0] },
      } });
      // The worker's own door, with the page number made positive so rule 3 can be seen.
      const door = isTranslatablePage({ ...page, page_number: Math.abs(page.page_number) || 1 }, { illegibleGate: false });
      if (!door.ok) { skipped[door.reason] = (skipped[door.reason] || 0) + 1; continue; }
      return { k, book, page, prev: structure.previous.get(pick.id) || null, duplicate_number: structure.duplicateNumbers.has(pick.page_number), read: structure.read, translatable: structure.translatable };
    }
    return null;
  }

  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < picks.length) {
      const k = next++;
      try {
        const row = await one(picks[k], k);
        if (row) { stream.write(JSON.stringify(row) + '\n'); kept++; }
      } catch (e) { skipped[`error: ${String(e.message).slice(0, 40)}`] = (skipped[`error: ${String(e.message).slice(0, 40)}`] || 0) + 1; }
      if (next % 1000 === 0) console.log(`  ${next} books, ${kept} pages`);
    }
  }));
  await new Promise((resolve) => stream.end(resolve));
  console.log(`drawn ${kept} pages from ${picks.length} books; not translatable at the worker's door: ${JSON.stringify(skipped)}`);
  await client.close();
}

// ── calibrate ───────────────────────────────────────────────────────────────────────────────

/** The gate's verdict for one draw row, from what the draw stored (hash checked for duplicates). */
async function judgeRow(row) {
  const structure = {
    duplicateNumbers: new Set(row.duplicate_number ? [row.page.page_number] : []),
    previous: new Map(row.prev ? [[row.page.id, row.prev]] : []),
    byId: new Map(), read: row.read, translatable: row.translatable,
  };
  const book = bookVerdict(structure);
  let v = preTranslationVerdict(row.page, structure);
  if (v.reason === REFUSAL.DUPLICATE_IMAGE) {
    const [mine, theirs] = await Promise.all([fetchImageHash(row.page.archived_photo), fetchImageHash(row.prev.archived_photo)]);
    if (mine && theirs) v = preTranslationVerdict(row.page, structure, { imageHashes: new Map([[row.page.id, mine], [row.prev.id, theirs]]) });
  }
  if (v.reason === REFUSAL.IMAGE_TOO_SMALL) {
    const size = row.page.archived_photo ? await probeStoredDimensions(row.page.archived_photo) : null;
    if (size?.width > 0) v = preTranslationVerdict(row.page, structure, { imageSizes: new Map([[row.page.id, size]]) });
  }
  return { page: v, book };
}

async function calibrate() {
  const file = arg('in');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const feats = rows.map((row) => {
    const t = transcribed(row.page.ocr?.data), box = imageBox(row.page);
    return { row, t, box, perLetter: box && t.letters >= MIN_LETTERS_FOR_SIZE ? box.area / t.letters : null, shape: t.family === 'Devanagari' ? devanagariShape(t.text) : null };
  });
  console.log(`pages ${rows.length} (one per book) · with image size ${feats.filter((f) => f.box).length} · with stored byte length ${rows.filter((r) => r.page.archive_metadata?.bytes).length} · cut from a spread ${rows.filter((r) => r.page.crop).length}`);

  console.log('\npixels per transcribed letter, pages with ≥ 200 letters and a stored size');
  console.log('family        pages  sized  min     p1     p5    p50');
  const families = {};
  for (const f of feats) (families[f.t.family || '(none)'] ||= []).push(f);
  for (const [family, list] of Object.entries(families).sort((a, b) => b[1].length - a[1].length)) {
    const d = list.map((f) => f.perLetter).filter((x) => x != null);
    if (!d.length) { console.log(`${family.padEnd(12)} ${String(list.length).padStart(6)}      0`); continue; }
    console.log(`${family.padEnd(12)} ${String(list.length).padStart(6)} ${String(d.length).padStart(6)} ${[Math.min(...d), quantile(d, 0.01), quantile(d, 0.05), quantile(d, 0.5)].map((x) => String(Math.round(x)).padStart(6)).join(' ')}`);
  }
  const sized = feats.filter((f) => f.box && f.t.letters >= MIN_LETTERS_FOR_SIZE);
  console.log(`\nshort edge under 300 px: ${sized.filter((f) => f.box.shortEdge < 300).length} · aspect ≥ 8: ${sized.filter((f) => f.box.aspect >= 8).length} · widest Tibetan aspect ${Math.max(0, ...sized.filter((f) => f.t.family === 'Tibetan').map((f) => f.box.aspect)).toFixed(1)}`);
  const dev = feats.filter((f) => f.shape && f.shape.tokens >= READABILITY_MIN_TOKENS).map((f) => f.shape.fragmentShare);
  console.log(`Devanagari pages with ≥ ${READABILITY_MIN_TOKENS} tokens: ${dev.length} · fragment share p50 ${quantile(dev, 0.5)?.toFixed(3)} p75 ${quantile(dev, 0.75)?.toFixed(3)} p90 ${quantile(dev, 0.9)?.toFixed(3)} · in [0.15, 0.30): ${dev.filter((x) => x >= 0.15 && x < 0.3).length} · ≥ 0.30: ${dev.filter((x) => x >= 0.3).length}`);

  const refused = [], counts = {}, bookRefused = [];
  for (const f of feats) {
    const v = await judgeRow(f.row);
    if (v.book) bookRefused.push(f.row);
    if (!v.page.refuse) continue;
    counts[v.page.reason] = (counts[v.page.reason] || 0) + 1;
    refused.push({ k: f.row.k, book: f.row.book.id, title: (f.row.book.title || '').slice(0, 70), language: f.row.book.language, visible: !!f.row.book.visible, page_id: f.row.page.id, page_number: f.row.page.page_number, page_type: f.row.page.page_type || null, reason: v.page.reason, detail: v.page.detail, image: f.row.page.archived_photo || f.row.page.photo, crop: f.row.page.crop || null, has_translation: !!f.row.page.has_translation, ocr_model: f.row.page.ocr?.model || null, text: f.t.text.slice(0, 400) });
  }
  console.log(`\npage refusals: ${refused.length} of ${rows.length} (${(100 * refused.length / rows.length).toFixed(2)}%)  ${JSON.stringify(counts)}`);
  const positive = refused.filter((r) => r.reason !== REFUSAL.PAGE_NUMBER);
  console.log(`  of which new behaviour (the worker already skips page_number ≤ 0): ${positive.length} (${(100 * positive.length / rows.length).toFixed(2)}%)`);
  console.log(`book rule (${BOOK_REFUSAL}): ${bookRefused.length} of ${rows.length} books (${(100 * bookRefused.length / rows.length).toFixed(1)}%); with translated pages ${bookRefused.filter((r) => r.book.pages_translated > 0).length}, visible with translated pages ${bookRefused.filter((r) => r.book.pages_translated > 0 && r.book.visible).length}`);
  const outFile = `${file}.refused.json`;
  fs.writeFileSync(outFile, JSON.stringify(refused, null, 1));
  console.log(`refused list → ${outFile}`);

  const dir = arg('images');
  if (dir) await fetchImages(positive, dir);
}

/** The refused pages' images for the by-eye check: the whole page small, and a centre cut at full size. */
async function fetchImages(list, dir) {
  const sharp = (await import('sharp')).default;
  fs.mkdirSync(dir, { recursive: true });
  for (const r of list) {
    const base = path.join(dir, `${r.reason}-${r.book}-p${r.page_number}`);
    if (fs.existsSync(`${base}-page.jpg`)) continue;
    try {
      const res = await fetch(r.image, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const m = await sharp(buf).metadata();
      const left = r.crop?.xEnd > r.crop?.xStart ? Math.round(m.width * r.crop.xStart / 1000) : 0;
      const width = r.crop?.xEnd > r.crop?.xStart ? Math.min(m.width - left, Math.round(m.width * (r.crop.xEnd - r.crop.xStart) / 1000)) : m.width;
      const cw = Math.min(width, 760), ch = Math.min(m.height, 420);
      await sharp(buf).extract({ left, top: 0, width, height: m.height }).resize({ width: 640, height: 640, fit: 'inside' }).jpeg({ quality: 62 }).toFile(`${base}-page.jpg`);
      await sharp(buf).extract({ left: left + Math.floor((width - cw) / 2), top: Math.floor((m.height - ch) * 0.4), width: cw, height: ch }).jpeg({ quality: 78 }).toFile(`${base}-cut.jpg`);
    } catch (e) { console.log(`  image failed ${r.book} p${r.page_number}: ${e.message}`); }
  }
  console.log(`images → ${dir}`);
}

// ── dry run ─────────────────────────────────────────────────────────────────────────────────

async function dryRun() {
  const ids = String(arg('books', '')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('--dry-run needs --books=<id>,<id>');
  const { client, db } = await connect();
  let allRefused = true;
  for (const id of ids) {
    const book = await db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, title: 1, language: 1 } });
    const pages = await db.collection('pages').find(
      { book_id: id, 'ocr.data': { $type: 'string', $ne: '' } },
      { projection: { _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.updated_at': 1 } },
    ).sort({ page_number: 1 }).toArray();
    const judged = pages.filter((p) => !SKIP_TRANSLATION_PAGE_TYPES.includes(p.page_type));
    const res = await applyPreTranslationGate(db, id, judged, { record: false, lane: 'dry-run', enabled: true, log: () => {} });
    const by = {};
    for (const r of res.refused) (by[r.reason] ||= []).push(r.page.page_number);
    console.log(`\n${id}  ${(book?.title || '').slice(0, 60)} (${book?.language || '?'})`);
    console.log(`  transcribed pages judged: ${judged.length} · refused: ${res.refused.length} · would go to the model: ${res.pages.length}${res.error ? ` · ERROR ${res.error}` : ''}`);
    if (res.book) console.log(`  BOOK refused: ${res.book.reason} — ${res.book.detail.read} of ${res.book.detail.translatable} translatable pages transcribed (${(100 * res.book.detail.share).toFixed(1)}%)`);
    else for (const [reason, nums] of Object.entries(by)) {
      const sample = res.refused.find((r) => r.reason === reason);
      console.log(`  ${reason}: ${nums.length} page(s) — ${nums.slice(0, 14).join(', ')}${nums.length > 14 ? ', …' : ''}   e.g. ${JSON.stringify(sample.detail)}`);
    }
    if (!res.refused.length) allRefused = false;
  }
  console.log(`\n${allRefused ? 'every book has refusals' : 'AT LEAST ONE BOOK HAS NO REFUSAL'} · nothing was written`);
  await client.close();
}

const mode = arg('draw') ? draw : arg('calibrate') ? calibrate : arg('dry-run') ? dryRun : null;
if (!mode) { console.error('one of --draw, --calibrate, --dry-run'); process.exit(2); }
await mode();

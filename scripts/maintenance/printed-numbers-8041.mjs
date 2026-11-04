#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/backfill-printed-page-4291.mjs writes pages.printed_page from <page-num>,
// which this issue rules out, and citations read that field, which this issue must not move (a separate
// store, not its writer). scripts/audit/printed-page-image-read.mjs reads images with a paid model; these
// reads are made by Opus on the subscription, from a manifest, blind.
/**
 * Build the checked map of printed page numbers (#8041). Per book:
 *
 *   prep   propose runs from the running-head markers (never <page-num>), fetch the images to open at
 *          both ends, the middle and one frame between anchors. Files are named opaquely and the manifest
 *          the reader gets says nothing of the expected number: the reads are blind.
 *   more   a second look with whole-page images: nulls again (a padded scan hides the number from the
 *          head-and-foot crop), more anchors inward of an unnumbered end, frames between anchors.
 *   judge  score reads against the lines: <out>/confirmed.jsonl, one row per run with its verdict.
 *   apply  write page_printed_numbers (only with --apply), one sweep_log row per run. New collection,
 *          keyed by page id, so a renumber of page_number (#5699) does not disturb it, and neither
 *          pages nor the citation apparatus is written.
 *
 * Reads the reader sees: /book/… reads page_printed_numbers at render, so a written row appears
 * on that book's reader page at its next ISR revalidation, with no other job downstream.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/printed-numbers-8041.mjs \
 *     prep --books=<id,id> | --books-file=<path> --out=$JOB_SCRATCH/map [--every-frame] [--no-images]
 *   … judge --out=<dir> --reads=<file.jsonl>
 *   … apply --out=<dir> [--apply] [--run-id=printed-numbers-8041-2026-11-04]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { getPageSource } from '../lib/page-image-url.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { checkpoints, findRuns, framesOf, judgeRun, moreCheckpoints, parsePrintedToken, readAgrees, rowsForRun } from '../lib/printed-number-runs.mjs';

export const SWEEP = 'printed-numbers-8041';
export const COLLECTION = 'page_printed_numbers';
const HIDDEN = new Set(['digitizer-insert', 'archived-spread']); // src/lib/reader-pages.ts: READER_HIDDEN_PAGE_TYPES

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k) => rest.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const flag = (k) => rest.includes(`--${k}`);
const OUT = arg('out');
const METHOD_HEADS = 'running-head-line+blind-image-confirm';
const METHOD_EVERY = 'blind-image-read-every-frame';

const ocr = { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] };
async function readerPages(db, bookId) {
  const pages = await db.collection('pages').aggregate([
    { $match: { book_id: bookId, page_number: { $gte: 0 } } },
    { $sort: { page_number: 1 } },
    { $project: { _id: 0, id: 1, page_number: 1, page_type: 1, repeat_of: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1,
      head: { $substrCP: [ocr, 0, 700] }, tail: { $substrCP: [ocr, { $max: [0, { $subtract: [{ $strLenCP: ocr }, 800] }] }, 800] } } },
  ], { hint: { book_id: 1, page_number: 1 }, maxTimeMS: 300000 }).toArray();
  return pages.filter(p => !HIDDEN.has(p.page_type) && !p.repeat_of);
}

/** Fetch one page image, as the reader frames it, keep the head and foot where page numbers are printed. */
async function saveImage(page, file, { whole }) {
  const src = getPageSource(page);
  if (!src) throw new Error('no image');
  const res = await fetch(src, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let img = sharp(Buffer.from(await res.arrayBuffer())).rotate();
  const { width, height } = await img.metadata();
  const c = page.crop;
  if (c && typeof c.xStart === 'number' && !page.cropped_photo && !page.split_from_spread) {
    const left = Math.round(width * c.xStart / 1000), right = Math.round(width * c.xEnd / 1000);
    img = sharp(await img.extract({ left, top: 0, width: Math.max(1, right - left), height }).toBuffer());
  }
  const meta = await img.metadata();
  const scale = Math.min(1, 1100 / meta.width);
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  const buf = await img.resize(w, h).jpeg({ quality: 82 }).toBuffer();
  if (whole) { fs.writeFileSync(file, buf); return; }
  const band = Math.round(h * 0.2);
  const top = await sharp(buf).extract({ left: 0, top: 0, width: w, height: band }).toBuffer();
  const bottom = await sharp(buf).extract({ left: 0, top: h - band, width: w, height: band }).toBuffer();
  await sharp({ create: { width: w, height: band * 2 + 12, channels: 3, background: '#808080' } })
    .composite([{ input: top, top: 0, left: 0 }, { input: bottom, top: band + 12, left: 0 }])
    .jpeg({ quality: 82 }).toFile(file);
}

async function prep() {
  const ids = arg('books-file') ? fs.readFileSync(arg('books-file'), 'utf8').split(/\s+/).filter(Boolean) : arg('books').split(',');
  const imgDir = path.join(OUT, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const manifest = fs.createWriteStream(path.join(OUT, 'manifest.jsonl'), { flags: 'a' });
  const runsOut = fs.createWriteStream(path.join(OUT, 'runs.jsonl'), { flags: 'a' });
  const queue = [...ids];
  async function worker() {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      const book = await db.collection('books').findOne({ id }, { projection: { _id: 0, id: 1, title: 1, language: 1, visible: 1 } });
      const pages = await readerPages(db, id);
      const frames = framesOf(pages);
      const whole = /chinese|japanese|korean/i.test(book?.language || '');
      const runs = flag('every-frame') ? [] : findRuns(frames);
      const points = flag('every-frame')
        ? [{ run: null, points: pages.map((_, i) => ({ i, role: 'every' })) }]
        : runs.map((run, r) => ({ run: r, points: checkpoints(run, frames) }));
      runsOut.write(JSON.stringify({ book_id: id, title: book?.title, language: book?.language, visible: book?.visible, pages: pages.map(p => p.id), frames_with_marker: frames.filter(f => f.marker).length, runs, every_frame: flag('every-frame') }) + '\n');
      if (flag('no-images')) continue;
      for (const { run, points: pts } of points) for (const pt of pts) {
        const ref = crypto.createHash('sha1').update(`${id}:${pages[pt.i].id}`).digest('hex').slice(0, 12);
        const file = path.join(imgDir, `${ref}.jpg`);
        try {
          if (!fs.existsSync(file)) await saveImage(pages[pt.i], file, { whole });
          manifest.write(JSON.stringify({ ref, file, book_id: id, run, i: pt.i, role: pt.role, page_id: pages[pt.i].id }) + '\n');
        } catch (e) {
          manifest.write(JSON.stringify({ ref, error: e.message, book_id: id, run, i: pt.i, role: pt.role, page_id: pages[pt.i].id }) + '\n');
        }
      }
      console.error(`${id} ${runs.length} runs`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  manifest.end(); runsOut.end();
  await client.close();
}

async function more() {
  const books = jsonl(path.join(OUT, 'runs.jsonl'));
  const manifest = jsonl(path.join(OUT, 'manifest.jsonl'));
  const reads = readsFrom(arg('reads'));
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const add = fs.createWriteStream(path.join(OUT, 'manifest.jsonl'), { flags: 'a' });
  for (const b of books) {
    if (b.every_frame || !b.runs.length) continue;
    const pages = await readerPages(db, b.book_id);
    if (pages.map(p => p.id).join() !== b.pages.join()) { console.error(`${b.book_id}: page list moved since prep, skipped`); continue; }
    const frames = framesOf(pages);
    const open = async (run, i, role) => {
      const ref = crypto.createHash('sha1').update(`${b.book_id}:${pages[i].id}:whole`).digest('hex').slice(0, 12);
      const file = path.join(OUT, 'images', `${ref}.jpg`);
      try {
        if (!fs.existsSync(file)) await saveImage(pages[i], file, { whole: true });
        add.write(JSON.stringify({ ref, file, book_id: b.book_id, run, i, role, page_id: pages[i].id }) + '\n');
      } catch (e) { console.error(`${b.book_id} ${i}: ${e.message}`); }
    };
    for (const [r, run] of b.runs.entries()) {
      const pts = manifest.filter(m => m.book_id === b.book_id && m.run === r);
      const rs = pts.map(m => ({ i: m.i, role: m.role, printed: reads.get(m.ref) ?? null }));
      // A number the line does not hold has already rejected this run: nothing more could rescue it.
      if (rs.some(x => x.printed != null && !readAgrees(run, x.i, x.printed))) continue;
      for (const x of rs) if (x.printed == null) await open(r, x.i, x.role);
      for (const p of moreCheckpoints(run, frames, rs)) await open(r, p.i, p.role);
    }
  }
  add.end();
  await client.close();
}

function readsFrom(files) {
  const reads = new Map();
  for (const f of files.split(',')) for (const r of jsonl(f)) reads.set(r.ref, r.printed ?? null);
  return reads;
}

function jsonl(file) { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }

function judge() {
  const books = jsonl(path.join(OUT, 'runs.jsonl'));
  const manifest = jsonl(path.join(OUT, 'manifest.jsonl'));
  const reads = readsFrom(arg('reads'));
  const out = fs.createWriteStream(path.join(OUT, 'confirmed.jsonl'));
  for (const b of books) {
    const pts = manifest.filter(m => m.book_id === b.book_id);
    let runs = b.runs;
    if (b.every_frame) {
      // Every frame was opened: the blind reads ARE the markers, and the same line fit reads them.
      const seen = new Map(pts.map(m => [m.i, reads.get(m.ref)]));
      const frames = b.pages.map((_, i) => ({ i, marker: parsePrintedToken(seen.get(i)) }));
      runs = findRuns(frames).map(r => ({ ...r, from_images: true, reads: r.anchors.map(i => ({ i, printed: seen.get(i) })) }));
    }
    runs.forEach((run, r) => {
      const rs = run.from_images
        ? [run.first, run.anchors[Math.floor(run.anchors.length / 2)], run.last].map((i, x) => ({ i, role: x === 1 ? 'middle' : 'end', printed: run.reads.find(y => y.i === i).printed }))
        : dedupeReads(pts.filter(m => m.run === r && reads.has(m.ref)).map(m => ({ i: m.i, role: m.role, printed: reads.get(m.ref) })));
      const verdict = judgeRun(run, rs);
      out.write(JSON.stringify({ book_id: b.book_id, title: b.title, run_index: r, run, reads: rs, verdict, method: run.from_images ? METHOD_EVERY : METHOD_HEADS }) + '\n');
    });
  }
  out.end();
}

/** One read per frame: the same frame opened twice counts once, and a number beats a null. */
function dedupeReads(rs) {
  const byI = new Map();
  for (const r of rs) if (!byI.has(r.i) || (byI.get(r.i).printed == null && r.printed != null)) byI.set(r.i, r);
  return [...byI.values()];
}

async function apply() {
  const run_id = arg('run-id') || `${SWEEP}-${new Date().toISOString().slice(0, 10)}`;
  const confirmed_at = new Date();
  const books = new Map(jsonl(path.join(OUT, 'runs.jsonl')).map(b => [b.book_id, b]));
  const judged = jsonl(path.join(OUT, 'confirmed.jsonl')).filter(j => j.verdict.confirmed);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  if (flag('apply')) {
    await db.collection(COLLECTION).createIndex({ page_id: 1 }, { unique: true });
    await db.collection(COLLECTION).createIndex({ book_id: 1 });
  }
  let written = 0;
  for (const j of judged) {
    const b = books.get(j.book_id);
    const pages = b.pages.map(id => ({ id }));
    const rows = rowsForRun(j.run, j.verdict, pages, { book_id: j.book_id, run_id, method: j.method, confirmed_at });
    written += rows.length;
    console.log(`${j.book_id} run ${j.verdict.first}-${j.verdict.last} ${j.run.dir > 0 ? 'up' : 'down'} ${j.verdict.numbering}: ${rows.length} rows, ${rows[0]?.label}…${rows.at(-1)?.label}`);
    if (!flag('apply')) continue;
    await recordSweepAction(db, { sweep: SWEEP, book_id: j.book_id, action: 'printed-run-confirmed', detail: {
      run_id, method: j.method, frames: [j.verdict.first, j.verdict.last], dir: j.run.dir, numbering: j.verdict.numbering, first_page_id: rows[0]?.page_id, last_page_id: rows.at(-1)?.page_id,
      rows: rows.length, anchors: j.run.anchors.length, agree_share: j.run.agree_share, reads: j.reads.map(r => ({ i: r.i, role: r.role, printed: r.printed })),
    } });
    await db.collection(COLLECTION).bulkWrite(rows.map(row => ({ updateOne: { filter: { page_id: row.page_id }, update: { $set: row }, upsert: true } })), { ordered: false });
  }
  console.log(`${judged.length} confirmed runs, ${written} rows${flag('apply') ? ' written' : ' (dry run)'}`);
  await client.close();
}

if (cmd === 'prep') await prep();
else if (cmd === 'more') await more();
else if (cmd === 'judge') judge();
else if (cmd === 'apply') await apply();
else { console.error('usage: prep | judge | apply'); process.exit(1); }

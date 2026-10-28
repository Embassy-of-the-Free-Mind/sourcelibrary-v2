#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/spread-screen.mjs (#6114) flags CANDIDATES from stored aspect ratios and never looks at an
 * image; scripts/split-book.mjs runGutterDetect() asks agy for a gutter but its prompt opens "This is a photo of an
 * open book showing a left page and a right page", which leads the answer, and it runs inside a split, not as a census.
 * This reuses gatedImageCall() (scripts/lib/agy-cli.mjs) and the screen's positive-control book with a neutral prompt.
 *
 * Is a book flagged `needs_splitting` really a book of two-page spreads? (#7605 step 3)
 *
 * WHY
 * ---
 * The split-before-read guard (#7605, pipeline-hold.mjs UNSPLIT_SPREAD) holds every flagged book out of OCR and
 * translation until it is split. 886 books carry the flag, but only 1,692 of the 10,261 flash-preview OCR pages on
 * them carry the spread prompt's <page-break/>: many frames may already be single pages. A wrong flag holds a book
 * for nothing; a right one tells step 4 what to split. This census answers which, per book, for free.
 *
 * METHOD
 * ------
 * Three pages per book at 25/50/75% through it (split leaves and crops excluded), each image asked once through
 * `agy -p` on gemini-3.8-flash-low (subscription, no API spend; measured 33/33 spreads and 9/10 singles in
 * scripts/eval/experiments/2026-10-28-split-cuts-agy-flash-low-5771.md). Verdict per book:
 *   multi = every answered sample holds two or more pages or leaves (a spread, or loose leaves side by side or stacked:
 *   `layout` says which); single = every answered sample is one page; mixed = otherwise; unknown = no sample answered.
 *   The first prompt asked "one page or two facing pages" and called a frame of two STACKED palm leaves "1" (seen by
 *   eye in the 10-book pilot), so the prompt counts leaves in either direction.
 *   Also records the book's stored OCR: pages with text and pages with <page-break/>.
 *
 * POSITIVE CONTROL
 * ----------------
 * --control asks about 3 archived spreads (page_type 'archived-spread') and 3 live leaves of the spread-screen's
 * pilot book. The spreads must come back 2 and the leaves 1; a full run refuses to start otherwise.
 *
 * READ-ONLY. Writes nothing to Mongo; the flag change is a separate, reviewed step.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/spread-confirm.mjs --control
 *   node --env-file=.env.production.local scripts/audit/spread-confirm.mjs --out DIR [--limit N] [--concurrency 3]
 * Output: DIR/spread-confirm.jsonl (one row per book, resumable: books already in it are skipped), summary on stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { withMongo } from '../lib/mongo.mjs';
import { UNSPLIT_SPREAD } from '../lib/pipeline-hold.mjs';
import { gatedImageCall, firstJson } from '../lib/agy-cli.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const CONTROL_ONLY = args.includes('--control');
const OUT_DIR = arg('--out', null);
const LIMIT = Number(arg('--limit', 0));
const CONCURRENCY = Number(arg('--concurrency', 3));
const MODEL = 'gemini-3.8-flash-low';
const PILOT = '69bd0afdb01b17638a098546'; // spread-screen.mjs's control book: archived spreads + live split leaves
const LEAF = { split_from_spread: { $exists: false }, split_from_pecha: { $exists: false }, cropped_photo: { $in: [null, ''] }, crop: { $exists: false } };

const PROMPT = (f) => `Look at this scanned image from a book or manuscript: @./${f}
How many separate pages or leaves does it show? An open book photographed flat shows TWO facing pages side by side, joined at the binding. A frame can also hold several loose leaves (palm leaves, pothi folios) laid side by side or stacked one above another: count each. A single page, a cover, a plate or a fold-out counts as ONE, even if it is wide, has two columns, or has a thin strip of the facing page or the scanner bed at one edge.

Do not use any tool other than viewing the attached image. Reply with exactly one line of JSON and nothing else:
{"pages": the number of separate pages or leaves, "layout": "single", "side-by-side" or "stacked"}`;

const fetchBuf = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

/** One image → { pages: 1..8|null, layout, err } */
async function ask(url) {
  try {
    const small = await sharp(await fetchBuf(url)).resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const r = await gatedImageCall(PROMPT, small, { model: MODEL });
    if (r.cls === 'quota') throw Object.assign(new Error(`quota: ${r.err}`), { quota: true });
    if (r.cls) return { pages: null, err: `agy ${r.cls}` };
    const j = firstJson(r.text);
    const pages = j && Number.isInteger(j.pages) && j.pages >= 1 && j.pages <= 8 ? j.pages : null;
    return { pages, layout: pages ? String(j.layout || '') : null, err: pages ? null : `unparsed: ${r.text.slice(0, 80)}` };
  } catch (e) {
    if (e.quota) throw e;
    return { pages: null, err: e.message.slice(0, 120) };
  }
}

// image-pick-ok: this audit asks whether the WHOLE frame holds several leaves, so it must read the unsplit image
const imageOf = (p) => p.archived_photo || p.photo || null;

async function control(db) {
  const spreads = await db.collection('pages').find({ book_id: PILOT, page_type: 'archived-spread' }, { projection: { archived_photo: 1, photo: 1 } }).limit(40).toArray();
  const leaves = await db.collection('pages').find({ book_id: PILOT, page_type: { $ne: 'archived-spread' } }, { projection: { archived_photo: 1, photo: 1 } }).limit(40).toArray();
  const pick = (a) => [a[Math.floor(a.length / 4)], a[Math.floor(a.length / 2)], a[Math.floor((3 * a.length) / 4)]].filter(Boolean);
  const s = await Promise.all(pick(spreads).map((p) => ask(imageOf(p))));
  const l = await Promise.all(pick(leaves).map((p) => ask(imageOf(p))));
  const ok = s.length === 3 && l.length === 3 && s.every((r) => r.pages === 2) && l.every((r) => r.pages === 1);
  console.log(`control: archived spreads → ${s.map((r) => r.pages ?? r.err).join(', ')}; live leaves → ${l.map((r) => r.pages ?? r.err).join(', ')}: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

async function confirmBook(db, book) {
  // page_number >= 1: some books park covers and labels at page_number <= 0 (Gauri Jatakam has 38 such of 64), and a
  // sample landing on a cover label reads "single" whatever the book's leaves are.
  const pages = await db.collection('pages').find({ book_id: book.id, page_number: { $gte: 1 }, ...LEAF }, { projection: { page_number: 1, archived_photo: 1, photo: 1, image_width: 1, image_height: 1 } }).sort({ page_number: 1 }).toArray();
  const withImg = pages.filter(imageOf);
  const idx = [...new Set([0.25, 0.5, 0.75].map((q) => Math.floor(q * withImg.length)))].filter((i) => i < withImg.length);
  const samples = [];
  for (const i of idx) { const p = withImg[i]; samples.push({ page: p.page_number, aspect: p.image_width && p.image_height ? +(p.image_width / p.image_height).toFixed(2) : null, ...(await ask(imageOf(p))) }); }
  const answered = samples.filter((s) => s.pages);
  const verdict = !answered.length ? 'unknown' : answered.every((s) => s.pages >= 2) ? 'multi' : answered.every((s) => s.pages === 1) ? 'single' : 'mixed';
  const [ocr] = await db.collection('pages').aggregate([
    { $match: { book_id: book.id, 'ocr.data': { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: null, n: { $sum: 1 }, pb: { $sum: { $cond: [{ $regexMatch: { input: { $toString: '$ocr.data' }, regex: 'page-break' } }, 1, 0] } } } },
  ]).toArray();
  return { book_id: book.id, title: String(book.title || '').slice(0, 80), language: book.language || null, status: book.pipeline_auto?.status || null, visible: !!book.visible, pages_count: book.pages_count, verdict, samples, ocr_pages: ocr?.n || 0, page_break_pages: ocr?.pb || 0, at: new Date().toISOString() };
}

await withMongo(async (db) => {
  const ok = await control(db);
  if (CONTROL_ONLY) process.exit(ok ? 0 : 1);
  if (!ok) { console.error('positive control failed: not running the census'); process.exit(2); }
  if (!OUT_DIR) { console.error('--out DIR is required'); process.exit(2); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'spread-confirm.jsonl');
  const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
  let books = await db.collection('books').find(UNSPLIT_SPREAD, { projection: { id: 1, title: 1, language: 1, visible: 1, pages_count: 1, 'pipeline_auto.status': 1 } }).sort({ id: 1 }).toArray();
  books = books.filter((b) => !done.has(b.id));
  if (LIMIT) books = books.slice(0, LIMIT);
  console.log(`${done.size} done, ${books.length} to ask (${CONCURRENCY} at a time)`);
  let next = 0, n = 0;
  const worker = async () => {
    while (next < books.length) {
      const b = books[next++];
      const row = await confirmBook(db, b); // a quota error throws out of the run; rerun resumes
      fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
      if (++n % 25 === 0) console.log(`${n}/${books.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const rows = fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tally = rows.reduce((t, r) => ((t[r.verdict] = (t[r.verdict] || 0) + 1), t), {});
  console.log(`verdicts over ${rows.length} books: ${JSON.stringify(tally)}`);
}, { timeoutMs: 24 * 3600e3 });

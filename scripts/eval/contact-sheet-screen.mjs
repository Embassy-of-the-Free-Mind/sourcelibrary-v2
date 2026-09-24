#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/image-extract-worker.mjs (the production vision pass — it only ever
 * SEES pages that OCR already tagged, so it cannot answer whether a cheap screen would find the
 * same pages; its `IMAGE_CANDIDATE_PAGE_TYPES` filter is the thing under test here).
 * scripts/eval/ia-ocr-delivered-quality.mjs (same house pattern — sample, paid stage, report — but
 * measures TEXT against a fresh read, not page images against existing labels).
 * scripts/eval/lib/runners.mjs `fetchImage`/`runGemini` and lib/sampling.mjs are reused rather
 * than reimplemented. No existing script tiles page images into a grid.
 *
 * contact-sheet-screen — can one vision call over a grid of page thumbnails find the illustrated
 * pages that the expensive per-page pass finds? (#5009)
 *
 * WHY. Books filled with free Internet Archive text carry none of our `<page-type>` or
 * `<image-desc>` markup, so the production candidate filter returns nothing and the book is marked
 * `images_complete` having looked at no page at all. A pixel-based screen would not care how the
 * text arrived. Before building one, measure whether it works.
 *
 * THE REFERENCE. Books where BOTH stages already ran. Per page:
 *   strong positive = the page has a `gallery_images` row — a detection that survived the 0.5
 *     gallery-quality gate AND `isTrivialGalleryDetection`. NOT raw `detected_images`: the first
 *     smoke run (3 books, 527 pages) scored 0% recall against two "positives" that were both
 *     `page_type: title-page` ornaments, which this screen's prompt deliberately excludes. Scoring
 *     raw detections compares two different definitions of "picture" and measures nothing.
 *   weak positive   = OCR flagged it (`page_type` in the candidate list, or <image-desc> markup)
 * Neither is ground truth — they are what production does today. A screen hit on a page with no
 * label may be a REAL find (the body of a free-filled book is exactly where OCR never looked), so
 * disagreements are sampled for a human read rather than scored as errors. That asymmetry is the
 * point of the experiment, not a flaw in it.
 *
 * WHAT MATTERS. Recall against strong positives: a screen that misses plates is worthless at any
 * price. Precision is a COST dial — each false positive is one full-resolution call (~$0.002).
 *
 * Runs on Hetzner (the laptop is geo-blocked from Gemini).
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/contact-sheet-screen.mjs --books 30 --per-sheet 16 --max-cost 2
 * Options: --per-sheet 16 (cells per sheet)  --cell-px 384 (thumbnail edge)  --books 30
 *   --model gemini-3-flash-preview  --max-cost 2 (USD, hard stop)  --seed 5009  --out <prefix>
 *   --prompt-v2 (the revised picture definition; see PROMPT_V2 for what reading the misses changed)
 *   --book-ids a,b,c (pin the sample — REQUIRED when comparing arms; see the note at the query)
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
// This eval spends real money, so it records what it spent in the same attribution table as
// the pipeline (#4599) instead of declaring an exemption. The #4966 campaign's own sore point
// is a preview lane that spends invisibly; an eval measuring that campaign should not add to it.
import { logUsage } from '../workers/lib/supabase-usage-logger.mjs';

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PER_SHEET = +val('per-sheet', 16);
const CELL_PX = +val('cell-px', 384);
const N_BOOKS = +val('books', 30);
const MODEL = val('model', 'gemini-3-flash-preview');
const MAX_COST = +val('max-cost', 2);
const SEED = +val('seed', 5009);
const OUT = val('out', `/root/contact-sheet-${new Date().toISOString().slice(0, 10)}`);
const CANDIDATE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'title-page'];

// Realtime flash pricing, derived from 30 days of gemini_usage (extract_images):
// $86.43 over 104.44M input + 11.40M output tokens.
const PRICE_IN = 0.50 / 1e6, PRICE_OUT = 3.00 / 1e6;
let spent = 0, callsMade = 0;
const failedSheets = [];

const rand = (() => { let s = SEED; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

const PROMPT_V1 = `This is a contact sheet: a grid of ${PER_SHEET} scanned book pages, numbered left-to-right, top-to-bottom, starting at 1.

For EACH cell, decide whether that page contains a PICTURE — an engraving, plate, photograph, diagram, map, chart or portrait.

Do NOT count: ornamental initials or drop caps, printer's ornaments and rules, library stamps, text-only pages, blank pages, tables of numbers set as type.

Answer with JSON only: {"cells":[{"n":1,"picture":true,"what":"portrait"},...]} — one entry per cell, "what" only when picture is true (2-4 words).`;

// v2 closes the two gaps found by READING the v1 misses (2026-09-24, --rich control):
//  - 13 of 51 misses were text pages carrying ONE staff of music. The production extractor
//    catalogues a stave as an image; v1's "text-only pages" exclusion told the model to refuse it.
//    That is a definition mismatch, not blindness.
//  - 30 of 51 were sparse woodblock line art (武備志): a few thin black strokes on an otherwise
//    white leaf, which reads as "blank" once downsampled. v2 names that case.
//  - Two v1 FALSE positives were show-through from a painted shield on the far side of the leaf,
//    so v2 warns about ghosting in both directions.
const PROMPT_V2 = `This is a contact sheet: a grid of ${PER_SHEET} scanned book pages, numbered left-to-right, top-to-bottom, starting at 1.

For EACH cell, decide whether that page carries a PICTURE — an engraving, woodcut, plate, photograph, diagram, map, chart, portrait, heraldic arms, or a staff of musical notation.

Count it even when the picture occupies a small part of an otherwise typeset page, and even when it is only a few thin black outlines on a mostly white page — a sparse line drawing is still a picture.

Do NOT count: ornamental initials or drop caps, printer's ornaments and rules, library stamps, plain text, blank pages, tables of numbers set as type. Do NOT count ink SHOWING THROUGH from the other side of the leaf — that is faint, grey, mirrored and usually overlaps the text; the picture belongs to the page it is printed on.

Answer with JSON only: {"cells":[{"n":1,"picture":true,"what":"portrait"},...]} — one entry per cell, "what" only when picture is true (2-4 words).`;

const PROMPT = args.includes('--prompt-v2') ? PROMPT_V2 : PROMPT_V1;

async function sheetFor(pages, db) {
  const cols = Math.ceil(Math.sqrt(PER_SHEET));
  const rows = Math.ceil(pages.length / cols);
  const tiles = [];
  for (let i = 0; i < pages.length; i++) {
    const url = pages[i].archived_photo || pages[i].photo;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) { tiles.push(null); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      tiles.push(await sharp(buf).resize(CELL_PX, CELL_PX, { fit: 'contain', background: '#fff' }).jpeg({ quality: 78 }).toBuffer());
    } catch { tiles.push(null); }
  }
  const blank = await sharp({ create: { width: CELL_PX, height: CELL_PX, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const composites = tiles.map((t, i) => ({
    input: t || blank, left: (i % cols) * CELL_PX, top: Math.floor(i / cols) * CELL_PX,
  }));
  return sharp({ create: { width: cols * CELL_PX, height: rows * CELL_PX, channels: 3, background: '#fff' } })
    .composite(composites).jpeg({ quality: 80 }).toBuffer();
}

// A sheet that fails to answer MUST NOT read as a sheet with no pictures in it. The first
// version of this script returned `parsed = null` on any bad response and the caller then scored
// every cell on that sheet as "no picture". Measured on the 2026-09-24 control: 11 of 33 sheets
// came back empty, covering 154 pages and swallowing 42 of the 51 apparent misses, which dragged
// a real recall of 93.8% down to a reported 72.9%. The failure looked exactly like a confident
// negative — see auto-memory `lesson_partial_artifact_read_as_total` and
// `lesson_absence_is_not_failure_no_silent_skips`. So: retry, demand one cell per page, and hand
// the caller an explicit `ok` that the scorer excludes rather than counts.
const MAX_ATTEMPTS = 3;
async function askSheet(genAI, jpeg, expectedCells) {
  const model = genAI.getGenerativeModel({ model: MODEL, generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } });
  let inTok = 0, outTok = 0, finishReason = null, why = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    let res;
    try {
      res = await model.generateContent([{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }, PROMPT]);
    } catch (e) {
      why = `throw: ${String(e.message || e).slice(0, 120)}`;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    const u = res.response.usageMetadata || {};
    inTok = u.promptTokenCount || 0;
    // Billed output = visible + reasoning, even with thinkingBudget 0; keep them summed for money.
    outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    spent += inTok * PRICE_IN + outTok * PRICE_OUT; callsMade++;
    await logUsage({
      type: 'extract_images', mode: 'realtime', model: MODEL,
      input_tokens: inTok, output_tokens: outTok, status: 'success',
      duration_ms: Date.now() - t0, endpoint: 'eval/contact-sheet-screen', triggered_by: 'manual',
    }).catch(() => {});
    finishReason = res.response.candidates?.[0]?.finishReason || null;
    let text = '';
    try { text = res.response.text(); } catch (e) { why = `text(): ${String(e.message || e).slice(0, 80)}`; }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { why = `unparseable (${finishReason || 'no finishReason'}, ${text.length} chars): ${text.slice(0, 160).replace(/\s+/g, ' ')}`; }
    // The model answers in EITHER envelope: {"cells":[...]} as asked, or a bare [...] array.
    // v1 of this script only accepted the first, so a perfectly good bare-array answer was
    // discarded and every cell on that sheet scored as "no picture". That single line of
    // parsing cost 11 of 33 sheets on the 2026-09-24 control and turned a real 93%+ recall
    // into a reported 72.9%. Accept both shapes; never let an envelope mismatch read as a
    // negative finding.
    const cells = Array.isArray(parsed) ? parsed : parsed?.cells;
    if (parsed && !Array.isArray(cells)) {
      why = `JSON parsed but no cells[] — keys=[${Object.keys(parsed).join(',')}] finish=${finishReason} raw=${text.slice(0, 160).replace(/\s+/g, ' ')}`;
    }
    if (Array.isArray(cells) && cells.length >= expectedCells) {
      return { parsed, inTok, outTok, ok: true, attempts: attempt, finishReason };
    }
    if (Array.isArray(cells)) why = `partial: ${cells.length}/${expectedCells} cells (${finishReason})`;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return { parsed: null, inTok, outTok, ok: false, attempts: MAX_ATTEMPTS, finishReason, why };
}

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

// --rich selects books that actually HOLD pictures. A screen must first be shown to FIRE; three
// random books gave 527 pages with two title-page ornaments between them, which cannot tell a
// working screen from a broken one (auto-memory: a probe needs a positive control, and an empty
// set is not disagreement).
// --book-ids pins the sample. The arms of this experiment MUST run on the SAME books: Mongo's
// $sample redraws every run, and the misses are strongly book-specific (30 of 51 in the control
// came from ONE woodblock treatise), so an unpinned second arm measures the draw, not the change.
const BOOK_IDS = (val('book-ids', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const RICH = args.includes('--rich');
let books;
if (BOOK_IDS.length) {
  books = await db.collection('books').find({ id: { $in: BOOK_IDS } },
    { projection: { id: 1, title: 1, pages_count: 1 } }).toArray();
} else if (RICH) {
  const top = await db.collection('gallery_images').aggregate([
    { $group: { _id: '$book_id', n: { $sum: 1 } } },
    { $match: { n: { $gte: 8 } } }, { $sample: { size: N_BOOKS } },
  ], { maxTimeMS: 180000 }).toArray();
  books = await db.collection('books').find({ id: { $in: top.map((t) => t._id) }, pages_count: { $gt: 20, $lt: 400 } },
    { projection: { id: 1, title: 1, pages_count: 1 } }).toArray();
} else {
  books = await db.collection('books').aggregate([
    { $match: { 'pipeline_auto.status': { $in: ['images_complete', 'complete'] }, pages_count: { $gt: 40, $lt: 400 } } },
    { $sample: { size: N_BOOKS } },
    { $project: { id: 1, title: 1, pages_count: 1 } },
  ], { maxTimeMS: 120000 }).toArray();
}
const galleryPages = new Set((await db.collection('gallery_images')
  .find({ book_id: { $in: books.map((b) => b.id) } }, { projection: { book_id: 1, page_number: 1 } }).toArray())
  .map((g) => `${g.book_id}:${g.page_number}`));

const rows = [];
for (const b of books) {
  if (spent >= MAX_COST) { console.log(`STOP: cost cap $${MAX_COST} reached`); break; }
  const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 } },
    { projection: { page_number: 1, photo: 1, archived_photo: 1, page_type: 1, detected_images: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 }).toArray();
  if (!pages.length) continue;
  for (let s = 0; s < pages.length; s += PER_SHEET) {
    if (spent >= MAX_COST) break;
    const slice = pages.slice(s, s + PER_SHEET);
    const jpeg = await sheetFor(slice, db);
    const ask = await askSheet(genAI, jpeg, slice.length);
    const { parsed, inTok, outTok } = ask;
    if (!ask.ok) { failedSheets.push({ book: b.id, title: (b.title || '').slice(0, 40), from: slice[0].page_number, to: slice[slice.length - 1].page_number, n: slice.length, why: ask.why }); }
    const said = new Map((parsed?.cells || []).map((x) => [Number(x.n), x]));
    slice.forEach((p, i) => {
      const hit = !!said.get(i + 1)?.picture;
      const strong = galleryPages.has(`${b.id}:${p.page_number}`);
      const rawDet = Array.isArray(p.detected_images) && p.detected_images.length > 0;
      const weak = CANDIDATE_TYPES.includes(p.page_type) || /<detected-images>|<image-desc/.test(p.ocr?.data || '');
      rows.push({ book: b.id, title: (b.title || '').slice(0, 50), page: p.page_number, hit, strong, rawDet, weak,
        sheetOk: ask.ok, what: said.get(i + 1)?.what || null, page_type: p.page_type || null, inTok, outTok });
    });
    process.stderr.write(`\r${rows.length} pages screened · ${callsMade} sheets · $${spent.toFixed(3)}   `);
  }
}
await c.close();

// Score ONLY the pages whose sheet actually answered. A page on a failed sheet was never screened;
// counting it as a negative measures the API, not the idea.
const scored = rows.filter((r) => r.sheetOk);
const unscreened = rows.length - scored.length;
const tp = scored.filter((r) => r.hit && r.strong).length;
const fn = scored.filter((r) => !r.hit && r.strong).length;
const fp = scored.filter((r) => r.hit && !r.strong).length;
const fpWeak = scored.filter((r) => r.hit && !r.strong && r.weak).length;
const recall = tp + fn ? tp / (tp + fn) : 0;
const precision = tp + fp ? tp / (tp + fp) : 0;
fs.writeFileSync(`${OUT}.json`, JSON.stringify({ config: { PER_SHEET, CELL_PX, MODEL, N_BOOKS: books.length, promptV2: args.includes('--prompt-v2') }, spent, callsMade, failedSheets, rows }, null, 2));
console.log(`\n\n=== contact-sheet screen: ${PER_SHEET}/sheet at ${CELL_PX}px, ${books.length} books, ${rows.length} pages ===`);
console.log(`cost $${spent.toFixed(3)} over ${callsMade} sheets = $${(spent / Math.max(1, rows.length)).toFixed(6)}/page screened`);
if (failedSheets.length) {
  console.log(`\n!! ${failedSheets.length} sheets NEVER ANSWERED after ${MAX_ATTEMPTS} attempts, covering ${unscreened} pages — EXCLUDED from the rates below, not counted as negatives:`);
  failedSheets.slice(0, 8).forEach((f) => console.log(`   ${f.title} pp.${f.from}-${f.to} — ${f.why}`));
  if (failedSheets.length > 8) console.log(`   ... and ${failedSheets.length - 8} more`);
}
console.log(`pages actually screened: ${scored.length} of ${rows.length}`);
console.log(`strong positives (gallery_images rows): ${tp + fn}`);
console.log(`  RECALL    ${(100 * recall).toFixed(1)}%   (missed ${fn})`);
console.log(`  precision ${(100 * precision).toFixed(1)}%   (${fp} hits with no detection; ${fpWeak} of those OCR had flagged)`);
console.log(`\nDisagreements are NOT errors by assumption — sample the ${fp} unlabelled hits by eye before scoring them.`);
console.log(`rows → ${OUT}.json`);

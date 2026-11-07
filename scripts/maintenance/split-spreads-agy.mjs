#!/usr/bin/env node
// PRIOR ART: scripts/split-book.mjs — the split WRITER this drives, unchanged (Phase 1.3 runs it; it archives the
// spreads and inserts the leaves; `--positions-file` takes reviewed per-frame folds and then makes no Gemini API call).
// Its own detection cannot be used here: pixel + a paid gemini-3-flash-preview API sample, and the paid API is closed
// to every model but flash-lite. scripts/split-book-v2.mjs and scripts/workers/batch-split-bph.mjs are older writers
// with older detectors (#4796). scripts/lib/gutter-detect.mjs is the pixel detector used below. Nothing asked the CLI
// where a fold is, and nothing rendered a proposed cut for a by-eye check before the write. This adds those two steps.
/**
 * Split held spread books into one page per leaf, with the fold placed by two methods and checked by eye (#7454).
 *
 * WHO IT IS FOR: readers of the Arabic manuscripts held in `ocr-flash-cli-7075` (museumsofindia samples: Hidayah,
 * Mukhtasar-ul-Wiqayah, …). Each frame is a two-leaf spread, and the CLI OCR lane refuses a spread book: a plain read
 * of a spread puts both leaves on one page (#6948, #7454). Split first, then the lane reads the leaves.
 *
 *   propose  node --env-file=.env.production.local scripts/maintenance/split-spreads-agy.mjs propose --out=DIR
 *              [--hold=ocr-flash-cli-7075] [--book=ID,ID | --books-file=FILE] [--limit=N] [--concurrency=3]
 *            Per frame: the pixel detector (gutter-detect.mjs) and one `agy -p` call (gemini-3.8-flash-low, plan mode,
 *            the read_file tool gate, never auto-approve) asked how many leaves, where the fold is (0–1000) and which
 *            leaf is read first. Writes DIR/<book>/proposal.json, positions.json (split-book.mjs --positions-file
 *            format: { "<page_number>": fold % | null }) and one review image per frame (the frame with the cut, then
 *            the leaves exactly as split-book.mjs will crop them, in reading order). Writes nothing to Mongo or R2.
 *   screen   node scripts/maintenance/split-spreads-agy.mjs screen --out=DIR [--book=ID,ID] [--concurrency=4]
 *            After `propose --sheets` (#7605): one agy strip question per cut frame; the review then reads only the
 *            flagged, WHOLE and random-sample sheets it renders (see screen() below).
 *   apply    node --env-file=.env.production.local scripts/maintenance/split-spreads-agy.mjs apply --out=DIR
 *              --verdicts=FILE [--book=ID,ID] [--apply]
 *            Dry run unless --apply. A book is split only when EVERY frame has an `ok` row in FILE (JSONL
 *            {book_id, page_number, verdict: ok|bad, checked_by, note}, written by the person or session that opened
 *            the review images) and its proposal still matches the book (same frames, same image URLs). Runs
 *            split-book.mjs --gutter-only --positions-file --page-order=<proposal> --by=<checked_by>, then checks
 *            the result (one live page per expected leaf, every leaf from this run, every spread archived) and only
 *            then sets pipeline_auto.split_checked and leaves a book_events row. split-book.mjs itself clears
 *            needs_splitting; a book whose check fails is reported, and its frames are still archived, not deleted.
 *            `--stage` (#7605, build then swap): runs split-book.mjs --positions-file --stage instead (no --gutter-only):
 *            the leaves are built HIDDEN with the spread OCR cut at its <page-break/> onto the leaf DIR/<id>/text-sides.json
 *            (split-text-sides.mjs) says it was read from, the spreads stay live, and the
 *            check is one staged leaf per expected leaf with every frame still live. split-swap.mjs makes them live.
 *
 * THE RULE FOR THE CUT (decided on the #7454 census: a "confident" pixel cut on Hidayah Vol-II frame 2 sat at 398
 * with the fold at ~500): agy says one leaf → the frame stays whole. agy says two → the pixel cut when the pixel
 * detector is confident and within AGREE_TOL of agy, else agy's. agy unparseable → the pixel cut if confident, else
 * the frame is unresolved and the book is not proposed. Every case is then looked at; nothing is written on a
 * detector's word alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { detectGutterPixel } from '../lib/gutter-detect.mjs';
import { CLI_SAFE_ARGS, agyCall, installToolGate, gateCalls, unwrapRead, gatedImageCall } from '../lib/agy-cli.mjs';
import { stagedLeavesQuery } from '../lib/split-stage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MODEL = 'gemini-3.8-flash-low';
export const AGREE_TOL = 40;     // 0–1000: pixel and agy within 4% → use the pixel cut (it measures the image)
export const OVERLAP = 0.03;     // split-book.mjs's default overlap on each crop; the review images use the same
export const FOLD_MIN = 200, FOLD_MAX = 800; // split-book.mjs refuses a reviewed fold outside 20–80%
const RIGHT_FIRST = /arabic|hebrew|aramaic|syriac|persian|urdu|ottoman|chinese|japanese|korean|manchu/i; // as split-book.mjs

export const PROMPT = `The image ./frame.jpg in this directory is a photograph from a manuscript book: usually an open book showing two facing pages (leaves), sometimes a single leaf, or a leaf facing the inside of the binding. Open it with read_file (or view_file): that is the only tool available, and running commands, cropping or any other tool is disabled.

Answer three questions about its GEOMETRY. Do not transcribe any text.
1. leaves: how many pages of paper (leaves) lie side by side in the photograph, 1 or 2. Count a blank page as a leaf. Do not count binding cloth, a board, or the background.
2. fold: if there are 2 leaves, the horizontal position where they meet at the binding (the gutter, the fold, often a shadow or a crease), as a number N from 0 (the left edge of the image) to 1000 (the right edge). It may be far from the centre: look at the image, do not assume 500. If there is 1 leaf, null.
3. first: if there are 2 leaves, which one is read first, "right" or "left". If there is 1 leaf, null.

Write one line of JSON between two marker lines, <<<BEGIN>>> and <<<END>>>, like this:
<<<BEGIN>>>
{"leaves": 2, "fold": 512, "first": "right", "note": "two text pages"}
<<<END>>>
The note is at most ten words on what the image shows. Output nothing outside the markers.`;

/** Parse agy's answer. Returns { leaves, fold, first, note } or { problem }. */
export function parseGeometry(answer) {
  const m = String(answer || '').match(/\{[\s\S]*\}/);
  if (!m) return { problem: 'no JSON in the answer' };
  let j;
  try { j = JSON.parse(m[0]); } catch { return { problem: 'answer is not valid JSON' }; }
  const leaves = Number(j.leaves);
  if (leaves === 1) return { leaves: 1, fold: null, first: null, note: String(j.note || '').slice(0, 120) };
  if (leaves !== 2) return { problem: `leaves is ${JSON.stringify(j.leaves)}, not 1 or 2` };
  const fold = Number(j.fold);
  if (!(fold > 0 && fold < 1000)) return { problem: `fold ${JSON.stringify(j.fold)} is not inside 0–1000` };
  const first = j.first === 'left' || j.first === 'right' ? j.first : null;
  return { leaves: 2, fold: Math.round(fold), first, note: String(j.note || '').slice(0, 120) };
}

/**
 * The cut for one frame. `pix`: { pos (0–1000) | null, conf }; `agy`: parseGeometry() result or null.
 * Returns { fold: 0–1000 | null (keep whole) | undefined (unresolved), method, flags[] }.
 */
export function decideCut(pix, agy, { pageOrder = 'rtl' } = {}) {
  const flags = [];
  const pixPos = pix?.conf === 'high' && pix.pos != null ? pix.pos : null;
  if (!agy || agy.problem) {
    if (pixPos == null) return { fold: undefined, method: 'unresolved', flags: [`agy: ${agy?.problem || 'no answer'}`, 'pixel unsure'] };
    flags.push(`agy: ${agy?.problem || 'no answer'}`);
    return withRange({ fold: pixPos, method: 'pixel-only', flags });
  }
  if (agy.leaves === 1) {
    if (pixPos != null) flags.push(`pixel found a gap at ${pixPos}, agy says one leaf`);
    return { fold: null, method: 'agy-single', flags };
  }
  const expectFirst = pageOrder === 'rtl' ? 'right' : 'left';
  if (agy.first && agy.first !== expectFirst) flags.push(`agy reads ${agy.first} leaf first; the book order is ${pageOrder}`);
  if (pixPos != null && Math.abs(pixPos - agy.fold) <= AGREE_TOL) return withRange({ fold: pixPos, method: `agree(px${pixPos}/agy${agy.fold})`, flags });
  if (pixPos != null) flags.push(`pixel ${pixPos} and agy ${agy.fold} disagree`);
  return withRange({ fold: agy.fold, method: pixPos != null ? `agy-over-pixel(px${pixPos}/agy${agy.fold})` : `agy(${agy.fold})`, flags });
}
function withRange(d) {
  if (d.fold <= FOLD_MIN || d.fold >= FOLD_MAX) return { fold: undefined, method: `${d.method}:out-of-range`, flags: [...d.flags, `fold ${d.fold} outside ${FOLD_MIN}–${FOLD_MAX}`] };
  return d;
}

/** The two crops exactly as split-book.mjs makes them (Step 5), in the book's reading order. */
export function leafBoxes(fold, w, pageOrder = 'rtl') {
  const f = fold / 1000;
  const leftEnd = Math.round(Math.min(1, f + OVERLAP) * w);
  const rightStart = Math.round(Math.max(0, f - OVERLAP) * w);
  const boxes = { left: { left: 0, width: leftEnd }, right: { left: rightStart, width: w - rightStart } };
  return (pageOrder === 'rtl' ? ['right', 'left'] : ['left', 'right']).map((side) => ({ side, ...boxes[side] }));
}

/** The image split-book.mjs will cut for a never-split book: the page record's URL that carries the book id. */
export const frameUrl = (page, bookId) => [page.archived_photo, page.photo].find((u) => typeof u === 'string' && /^https?:\/\//.test(u) && u.includes(bookId)) || null;

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');

async function fetchBuf(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 2) throw e; await new Promise((s) => setTimeout(s, 2000 * (i + 1))); }
  }
}

async function askAgy(buf, wsRoot) {
  const ws = fs.mkdtempSync(path.join(wsRoot, 'agy-'));
  fs.writeFileSync(path.join(ws, 'frame.jpg'), buf);
  const log = installToolGate(ws, { task: 'geometry' });
  let r = await agyCall(['-p', PROMPT, '--model', MODEL, ...CLI_SAFE_ARGS], ws);
  let tries = 1;
  // One more call on an empty / unclean reply; never on quota (the caller stops).
  while (r.cls !== 'quota' && (r.cls || unwrapRead(r.text).problem) && tries < 2) { r = await agyCall(['-p', PROMPT, '--model', MODEL, ...CLI_SAFE_ARGS], ws); tries++; }
  const tools = gateCalls(log);
  fs.rmSync(ws, { recursive: true, force: true });
  const { text, problem } = unwrapRead(r.text);
  return { cls: r.cls, err: r.cls ? r.err : null, problem, raw: r.text?.slice(0, 600), parsed: r.cls ? { problem: r.cls } : parseGeometry(text), secs: r.secs, calls: tries, tools };
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
/** One review image: the frame with the cut and overlap band on top, the leaves as cropped below, in reading order. */
async function renderReview(buf, w, h, frame, pageOrder, file) {
  const TOP_W = 1400, topH = Math.round(h * TOP_W / w);
  const label = (t, width) => Buffer.from(`<svg width="${width}" height="34"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="24" font-size="20" font-family="sans-serif" fill="#000">${esc(t)}</text></svg>`);
  const parts = [];
  const overlays = [];
  if (typeof frame.fold === 'number') {
    const x = Math.round(frame.fold / 1000 * TOP_W), band = Math.round(OVERLAP * TOP_W);
    overlays.push({ input: Buffer.from(`<svg width="${TOP_W}" height="${topH}"><rect x="${x - band}" y="0" width="${2 * band}" height="${topH}" fill="red" fill-opacity="0.12"/><line x1="${x}" y1="0" x2="${x}" y2="${topH}" stroke="red" stroke-width="3"/></svg>`), top: 0, left: 0 });
  }
  const top = await sharp(buf).resize(TOP_W, topH).composite(overlays).jpeg({ quality: 80 }).toBuffer();
  parts.push({ input: label(`FRAME p.${frame.page_number}  ${frame.fold === null ? 'KEPT WHOLE (one leaf)' : `cut at ${frame.fold}/1000`}  [${frame.method}]  ${frame.flags.join('; ')}`, TOP_W) , h: 34 }, { input: top, h: topH });
  if (typeof frame.fold === 'number') {
    const boxes = leafBoxes(frame.fold, w, pageOrder);
    const LEAF_H = 900;
    const crops = await Promise.all(boxes.map(async (b) => {
      const c = await sharp(buf).extract({ left: b.left, top: 0, width: b.width, height: h }).resize(null, LEAF_H).jpeg({ quality: 80 }).toBuffer();
      return { b, c, cw: (await sharp(c).metadata()).width };
    }));
    const rowW = crops.reduce((s, x) => s + x.cw, 0) + 40;
    const row = await sharp({ create: { width: Math.max(rowW, TOP_W), height: LEAF_H + 34, channels: 3, background: '#666' } })
      .composite(crops.flatMap((x, i) => {
        const left = crops.slice(0, i).reduce((s, y) => s + y.cw, 0) + 40 * i;
        return [{ input: label(`LEAF ${i + 1} (${x.b.side} side${i === 0 ? ', read first' : ''})`, x.cw), top: 0, left }, { input: x.c, top: 34, left }];
      })).jpeg({ quality: 80 }).toBuffer();
    parts.push({ input: row, h: LEAF_H + 34, w: Math.max(rowW, TOP_W) });
  }
  const W = Math.max(TOP_W, ...parts.map((p) => p.w || 0));
  let y = 0;
  const comp = parts.map((p) => { const o = { input: p.input, top: y, left: 0 }; y += p.h; return o; });
  await sharp({ create: { width: W, height: y, channels: 3, background: '#fff' } }).composite(comp).jpeg({ quality: 78 }).toFile(file);
}

/**
 * SHEETS MODE (`propose --sheets`, #7605): for long bound books, where one agy call and one review image per frame
 * repeats the same fold a few hundred times (74 BPH books hold 10,303 frames).
 *  - Shape, against the book's own median frame: a frame under SINGLE_REL of it is one leaf (a cover, a single leaf),
 *    with no call; over WIDE_REL of it (a fold-out) agy is asked. Relative, not absolute: BPH spreads run from 1.4 to
 *    2.5 wide (the gated test, 2026-10-29: a 2.5:1 book whose one single leaf was 1.26:1). So a book whose first
 *    frames are single and whose later frames are spreads is decided frame by frame.
 *  - The book's fold: agy on SAMPLE evenly spaced spread-shaped frames. When their folds lie within FOLD_SPREAD of
 *    each other, every other spread-shaped frame takes their median with no call (`book-fold`): a bound book's fold
 *    does not move (agy 490–508 on two gate books), and the crop already overlaps 3% each side. When they do not
 *    agree, every spread-shaped frame is asked and decideCut() rules as in the per-frame mode.
 *  - The pixel detector is recorded but does not decide: on the gate books it was "high" confidence at 280–340 with the
 *    fold at ~504, on 19 of 41 frames.
 *  - Review: contact sheets of SHEET_N frames in page order (sheet-NN.jpg), each with the cut and the overlap band
 *    drawn. A verdict row may name a sheet instead of a page: {book_id, sheet, verdict, checked_by, bad_pages?} covers
 *    every frame on it, and a page row for a frame on that sheet overrides it (expandSheetVerdicts()).
 */
export const SINGLE_REL = 0.75, WIDE_REL = 1.4, FOLD_SPREAD = 30, SAMPLE = 8, SHEET_N = 20;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
/** 'single' | 'spread' | 'wide' for one frame, against the book's median aspect ratio. */
export function shapeOf(ar, medAr) {
  if (ar < SINGLE_REL * medAr) return 'single';
  if (ar > WIDE_REL * medAr) return 'wide';
  return 'spread';
}

/** Which frames sheets mode samples: SAMPLE spread-shaped frames, evenly spaced. */
export function sampleIndexes(ars, n = SAMPLE) {
  const medAr = median(ars);
  const spreadIdx = ars.map((ar, i) => (shapeOf(ar, medAr) === 'spread' ? i : -1)).filter((i) => i >= 0);
  if (spreadIdx.length <= n) return new Set(spreadIdx);
  return new Set(Array.from({ length: n }, (_, k) => spreadIdx[Math.floor(((k + 0.5) / n) * spreadIdx.length)]));
}

/** The book fold from the sample's folds, or null when there are too few or they do not agree. */
export function bookFoldOf(sampleFolds) {
  if (sampleFolds.length < 3 || Math.max(...sampleFolds) - Math.min(...sampleFolds) > FOLD_SPREAD) return null;
  return median(sampleFolds);
}

/** Sheets-mode cut for a frame that was not sampled. Returns decideCut()'s shape, or null = ask agy. */
export function shapeOrBookCut(ar, medAr, bookFold) {
  const shape = shapeOf(ar, medAr);
  if (shape === 'single') return { fold: null, method: `shape-single(ar${ar}/med${medAr})`, flags: [] };
  if (shape === 'wide' || bookFold == null) return null;
  return withRange({ fold: bookFold, method: `book-fold(${bookFold})`, flags: [] });
}

/**
 * Sheet-level verdict rows expanded to one per frame (a page row wins over its sheet's row).
 * With `screen` (screen.json from the screen stage): a `{book_id, screen_sheet, verdict, bad_pages?}` row covers the
 * frames on that screen sheet, and a `{book_id, screen_accept: true, checked_by}` row passes every frame the strip
 * screen passed, but only when every frame of the random sample sheet has an ok verdict: a miss in the sample means
 * the screen is not trusted for that book and its full sheets must be read.
 */
export function expandSheetVerdicts(proposal, verdicts, screen = null) {
  const id = proposal.book_id;
  const out = new Map(verdicts);
  const fill = (key, row, page) => { if (!verdicts.has(key)) out.set(key, { ...row, page_number: page, verdict: (row.bad_pages || []).includes(page) ? 'bad' : row.verdict }); };
  for (const f of proposal.frames) {
    const s = f.sheet != null && verdicts.get(`${id}:sheet${f.sheet}`);
    if (s) fill(`${id}:${f.page_number}`, s, f.page_number);
  }
  if (!screen) return out;
  for (const [name, pages] of Object.entries(screen.sheets || {})) {
    const s = verdicts.get(`${id}:screen:${name}`);
    if (s) for (const n of pages) fill(`${id}:${n}`, s, n);
  }
  const accept = verdicts.get(`${id}:screen-accept`);
  const sample = screen.sheets?.sample || [];
  if (accept && sample.every((n) => out.get(`${id}:${n}`)?.verdict === 'ok')) {
    for (const r of screen.frames) {
      if (r.on_gutter === true) fill(`${id}:${r.page_number}`, { verdict: 'ok', checked_by: `agy-strip-screen+${accept.checked_by}`, note: 'strip screen passed; sample sheet ok' }, r.page_number);
    }
  }
  return out;
}

export const STRIP_HALF = 150; // the screen's strip: fold ± 15% of the frame width
export const SCREEN_PROMPT = (f) => `This is a narrow vertical strip from the middle of a photographed open book: @./${f}
A red vertical line marks where the photograph will be cut into two pages. A correct cut runs down the gutter: the fold or shadow where the two pages meet.
Is the red line on the gutter? Answer "no" if it runs through a page (text or blank paper) with the fold visibly to one side of it.
Do not use any tool other than viewing the attached image. Reply with exactly one line of JSON and nothing else: {"on_gutter": true or false}`;

/** The screen's answer: true / false, or null when the reply did not say (a null is reviewed like a false). */
export function parseOnGutter(text) {
  const m = String(text || '').match(/"on_gutter"\s*:\s*(true|false)/);
  return m ? m[1] === 'true' : null;
}

/** A deterministic pick of up to n items, seeded by the book id, so a re-run draws the same sample. */
export function seededSample(items, n, seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n).sort((x, y) => x - y);
}

/** One contact sheet: SHEET_N thumbnails in a 5-wide grid, each with its cut, overlap band and a label. */
async function renderSheet(thumbs, file) {
  const COLS = 5, TW = 300, LBL = 30;
  const rows = [];
  for (let i = 0; i < thumbs.length; i += COLS) rows.push(thumbs.slice(i, i + COLS));
  const rowH = rows.map((r) => Math.max(...r.map((t) => t.th)) + LBL + 8);
  const comp = [];
  let y = 0;
  for (const [ri, r] of rows.entries()) {
    for (const [ci, t] of r.entries()) {
      const left = ci * (TW + 8);
      const ov = [];
      if (typeof t.fold === 'number') {
        const x = Math.round((t.fold / 1000) * TW), band = Math.round(OVERLAP * TW);
        ov.push({ input: Buffer.from(`<svg width="${TW}" height="${t.th}"><rect x="${x - band}" y="0" width="${2 * band}" height="${t.th}" fill="red" fill-opacity="0.15"/><line x1="${x}" y1="0" x2="${x}" y2="${t.th}" stroke="red" stroke-width="2"/></svg>`), top: 0, left: 0 });
      }
      const img = await sharp(t.buf).composite(ov).jpeg({ quality: 80 }).toBuffer();
      const color = t.asked ? '#06c' : '#000';
      const text = `p.${t.page_number} ${t.fold === null ? 'WHOLE' : t.fold === undefined ? 'UNRESOLVED' : t.fold} ${t.short}`;
      comp.push({ input: Buffer.from(`<svg width="${TW}" height="${LBL}"><rect width="100%" height="100%" fill="#fff"/><text x="4" y="21" font-size="17" font-family="sans-serif" fill="${color}">${esc(text)}</text></svg>`), top: y, left });
      comp.push({ input: img, top: y + LBL, left });
    }
    y += rowH[ri];
  }
  await sharp({ create: { width: COLS * (TW + 8), height: y, channels: 3, background: '#888' } }).composite(comp).jpeg({ quality: 78 }).toFile(file);
}

async function proposeSheets(db, book, pages, dir, wsRoot, conc) {
  const pageOrder = RIGHT_FIRST.test(String(book.language || '')) ? 'rtl' : 'ltr';
  const frames = pages.map((p) => ({ page_id: p.id, page_number: p.page_number, url: frameUrl(p, book.id) }));
  const bufs = new Array(frames.length);
  let quota = false, next = 0;
  // Pass 1, free: every frame's size, pixel cut and thumbnail.
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < frames.length) {
      const i = next++, f = frames[i];
      if (!f.url) { Object.assign(f, { fold: undefined, method: 'no-book-scoped-url', flags: ['no image URL carrying the book id'] }); continue; }
      try {
        const buf = await fetchBuf(f.url);
        const meta = await sharp(buf).metadata();
        Object.assign(f, { w: meta.width, h: meta.height, ar: +(meta.width / meta.height).toFixed(3) });
        const px = await detectGutterPixel(buf);
        f.pixel = { pos: px.column != null ? Math.round((px.column / meta.width) * 1000) : null, conf: px.confidence, reason: px.reason };
        bufs[i] = await sharp(buf).resize(300).jpeg({ quality: 80 }).toBuffer();
      } catch (e) { Object.assign(f, { fold: undefined, method: 'error', flags: [e.message?.slice(0, 120)] }); }
    }
  }));
  const ok = frames.map((f, i) => (f.ar != null ? i : -1)).filter((i) => i >= 0);
  const asked = new Set();
  const ask = async (i) => {
    const f = frames[i];
    asked.add(i);
    f.agy = await askAgy(await fetchBuf(f.url), wsRoot);
    if (f.agy.cls === 'quota') { quota = true; return; }
    // No pixel vote here: on the gate books its "agree within 4%" cut put p.65 at 468 with the fold at 504 (by eye).
    Object.assign(f, decideCut(null, f.agy.parsed, { pageOrder }));
  };
  const runAll = async (idx) => { let k = 0; await Promise.all(Array.from({ length: conc }, async () => { while (k < idx.length && !quota) await ask(idx[k++]); })); };
  // Pass 2: the sample sets the book's fold.
  const sample = [...sampleIndexes(ok.map((i) => frames[i].ar))].map((j) => ok[j]);
  await runAll(sample);
  if (quota) return { quota: true };
  const medAr = median(ok.map((i) => frames[i].ar));
  const bookFold = bookFoldOf(sample.map((i) => frames[i].agy?.parsed).filter((p) => p?.leaves === 2).map((p) => p.fold));
  // Pass 3: shape or the book fold where they settle it; agy for the rest.
  const rest = [];
  for (const i of ok) {
    if (asked.has(i)) continue;
    const c = shapeOrBookCut(frames[i].ar, medAr, bookFold);
    if (c) Object.assign(frames[i], c); else rest.push(i);
  }
  await runAll(rest);
  if (quota) return { quota: true };
  // Review sheets, in page order.
  frames.forEach((f, i) => { f.sheet = Math.floor(i / SHEET_N) + 1; });
  for (let s = 0; s * SHEET_N < frames.length; s++) {
    const thumbs = [];
    for (let i = s * SHEET_N; i < Math.min(frames.length, (s + 1) * SHEET_N); i++) {
      const f = frames[i];
      const buf = bufs[i] || (await sharp({ create: { width: 300, height: 200, channels: 3, background: '#400' } }).jpeg().toBuffer());
      thumbs.push({ buf, th: (await sharp(buf).metadata()).height, fold: f.fold, page_number: f.page_number, asked: asked.has(i), short: String(f.method || '').replace(/\(.*$/, '') });
    }
    await renderSheet(thumbs, path.join(dir, `sheet-${String(s + 1).padStart(2, '0')}.jpg`));
  }
  return { frames, pageOrder, bookFold, calls: asked.size };
}

async function propose(db) {
  const OUT = path.resolve(arg('out'));
  const SHEETS = process.argv.includes('--sheets');
  const hold = arg('hold') || 'ocr-flash-cli-7075';
  // --books-file=FILE (one id per line, #7605): a census-picked list, not a hold; the hold filter is then dropped.
  const booksFile = arg('books-file');
  const only = booksFile ? fs.readFileSync(booksFile, 'utf8').split(/\s+/).filter(Boolean) : arg('book')?.split(',');
  const limit = Number(arg('limit') || 0);
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  fs.mkdirSync(OUT, { recursive: true });
  const wsRoot = path.join(OUT, '.ws');
  fs.mkdirSync(wsRoot, { recursive: true });
  let books = await db.collection('books').find(
    { needs_splitting: true, ...(!booksFile && { 'pipeline_auto.hold.reason': hold }), ...(only && { id: { $in: only } }) },
    { projection: { id: 1, title: 1, language: 1, split_completed: 1, split_page_order: 1 } },
  ).sort({ id: 1 }).toArray();
  if (limit) books = books.slice(0, limit);
  console.log(`${books.length} needs_splitting books ${booksFile ? `from ${booksFile}` : `in hold ${hold}`}`);
  let quota = false;
  for (const book of books) {
    if (quota) break;
    const dir = path.join(OUT, book.id);
    if (fs.existsSync(path.join(dir, 'proposal.json'))) { console.log(`${book.id} already proposed`); continue; }
    if (book.split_completed === true) { console.log(`${book.id} split_completed is set: skipped`); continue; }
    const pageOrder = RIGHT_FIRST.test(String(book.language || '')) ? 'rtl' : 'ltr';
    const pages = await db.collection('pages').find({ book_id: book.id, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } }, { projection: { id: 1, page_number: 1, archived_photo: 1, photo: 1, split_from_spread: 1, crop: 1, cropped_photo: 1 } }).sort({ page_number: 1 }).toArray();
    if (pages.some((p) => p.split_from_spread || p.crop || p.cropped_photo)) { console.log(`${book.id} already carries split data: skipped`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    if (SHEETS) {
      const r = await proposeSheets(db, book, pages, dir, wsRoot, conc);
      if (r.quota) { quota = true; console.log(`QUOTA: stopping before ${book.id} is complete; re-run resumes`); fs.rmSync(dir, { recursive: true, force: true }); break; }
      const unresolved = r.frames.filter((f) => f.fold === undefined);
      const proposal = { book_id: book.id, title: book.title, language: book.language, page_order: r.pageOrder, model: MODEL, mode: 'sheets', book_fold: r.bookFold, agy_calls: r.calls, sheets: Math.ceil(r.frames.length / SHEET_N), at: new Date().toISOString(), frames: r.frames, unresolved: unresolved.length, leaves_expected: r.frames.reduce((s, f) => s + (typeof f.fold === 'number' ? 2 : 1), 0) };
      fs.writeFileSync(path.join(dir, 'proposal.json'), JSON.stringify(proposal, null, 1));
      if (!unresolved.length) fs.writeFileSync(path.join(dir, 'positions.json'), JSON.stringify(Object.fromEntries(r.frames.map((f) => [String(f.page_number), f.fold == null ? null : Math.round(f.fold) / 10]))));
      const t = {}; for (const f of r.frames) { const k = String(f.method || '').replace(/\(.*$/, ''); t[k] = (t[k] || 0) + 1; }
      console.log(`${book.id} ${String(book.title).slice(0, 40)}: ${r.frames.length} frames, ${r.calls} agy calls, book fold ${r.bookFold}, ${proposal.sheets} sheets, ${unresolved.length} unresolved ${JSON.stringify(t)}`);
      continue;
    }
    const frames = new Array(pages.length);
    let next = 0;
    const work = async () => {
      while (next < pages.length && !quota) {
        const i = next++, p = pages[i];
        const url = frameUrl(p, book.id);
        const f = { page_id: p.id, page_number: p.page_number, url };
        frames[i] = f;
        if (!url) { Object.assign(f, { fold: undefined, method: 'no-book-scoped-url', flags: ['no image URL carrying the book id'] }); continue; }
        try {
          const buf = await fetchBuf(url);
          const meta = await sharp(buf).metadata();
          Object.assign(f, { w: meta.width, h: meta.height, ar: +(meta.width / meta.height).toFixed(3) });
          const px = await detectGutterPixel(buf);
          f.pixel = { pos: px.column != null ? Math.round(px.column / meta.width * 1000) : null, conf: px.confidence, reason: px.reason };
          f.agy = await askAgy(buf, wsRoot);
          if (f.agy.cls === 'quota') { quota = true; f.fold = undefined; f.method = 'quota'; f.flags = [f.agy.err || 'quota']; break; }
          Object.assign(f, decideCut(f.pixel, f.agy.parsed, { pageOrder }));
          await renderReview(buf, meta.width, meta.height, f, pageOrder, path.join(dir, `review-p${String(p.page_number).padStart(3, '0')}.jpg`));
        } catch (e) {
          Object.assign(f, { fold: undefined, method: 'error', flags: [e.message?.slice(0, 120)] });
        }
      }
    };
    await Promise.all(Array.from({ length: conc }, work));
    if (quota) { console.log(`QUOTA: stopping before ${book.id} is complete; re-run resumes`); fs.rmSync(dir, { recursive: true, force: true }); break; }
    const unresolved = frames.filter((f) => f.fold === undefined);
    const positions = Object.fromEntries(frames.map((f) => [String(f.page_number), f.fold == null ? null : Math.round(f.fold) / 10]));
    const proposal = { book_id: book.id, title: book.title, language: book.language, page_order: pageOrder, model: MODEL, at: new Date().toISOString(), frames, unresolved: unresolved.length, leaves_expected: frames.reduce((s, f) => s + (typeof f.fold === 'number' ? 2 : 1), 0) };
    fs.writeFileSync(path.join(dir, 'proposal.json'), JSON.stringify(proposal, null, 1));
    if (!unresolved.length) fs.writeFileSync(path.join(dir, 'positions.json'), JSON.stringify(positions));
    console.log(`${book.id} ${String(book.title).slice(0, 40)}: ${frames.map((f) => `p${f.page_number}=${f.fold === null ? 'whole' : f.fold ?? 'UNRESOLVED'}${f.flags?.length ? '!' : ''}`).join(' ')}`);
  }
  fs.rmSync(wsRoot, { recursive: true, force: true });
  if (quota) process.exit(3);
}

/**
 * SCREEN (#7605): one agy strip question per cut frame, so the by-eye review reads only what the screen doubts.
 * On a planted control (one book, 20 frames, 4 shifted cuts of ≥45/1000 and one spread marked WHOLE) one zoomed strip
 * per call caught all 4 shifts with 1–2 false flags in 19 correct cuts; a whole contact sheet asked of agy caught 1–2.
 * WHOLE frames are never screened (a strip has no line); they go on their own sheet. Writes DIR/<book>/screen.json
 * and screen-<name>.jpg sheets: flagged-NN (screen said no, or did not answer), whole-NN, sample (20 random passed
 * frames, to measure what the screen misses). Resumable per frame; writes nothing to Mongo or R2.
 */
async function screen() {
  const OUT = path.resolve(arg('out'));
  const only = arg('book')?.split(',');
  const conc = Math.max(1, Math.min(6, Number(arg('concurrency') || 4)));
  const ids = fs.readdirSync(OUT).filter((d) => /^[0-9a-f]{24}$/.test(d) && (!only || only.includes(d)) && fs.existsSync(path.join(OUT, d, 'proposal.json')));
  fs.mkdirSync(path.join(OUT, '.ws'), { recursive: true });
  let quota = false, calls = 0;
  for (const id of ids) {
    if (quota) break;
    const dir = path.join(OUT, id);
    const proposal = JSON.parse(fs.readFileSync(path.join(dir, 'proposal.json'), 'utf8'));
    const file = path.join(dir, 'screen.json');
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (prev?.sheets) { console.log(`${id} already screened`); continue; }
    const done = new Map((prev?.frames || []).map((r) => [r.page_number, r]));
    const cut = proposal.frames.filter((f) => typeof f.fold === 'number' && !done.has(f.page_number));
    let k = 0;
    await Promise.all(Array.from({ length: conc }, async () => {
      while (k < cut.length && !quota) {
        const f = cut[k++];
        try {
          const buf = await fetchBuf(f.url);
          const m = await sharp(buf).metadata();
          const left = Math.max(0, Math.round(((f.fold - STRIP_HALF) / 1000) * m.width));
          const width = Math.min(m.width - left, Math.round(((2 * STRIP_HALF) / 1000) * m.width));
          const strip = await sharp(buf).extract({ left, top: 0, width, height: m.height }).resize(300).jpeg({ quality: 85 }).toBuffer();
          const sh = (await sharp(strip).metadata()).height;
          const x = Math.round((((f.fold / 1000) * m.width - left) / width) * 300);
          const img = await sharp(strip).composite([{ input: Buffer.from(`<svg width="300" height="${sh}"><line x1="${x}" y1="0" x2="${x}" y2="${sh}" stroke="red" stroke-width="2"/></svg>`), top: 0, left: 0 }]).jpeg().toBuffer();
          const r = await gatedImageCall(SCREEN_PROMPT, img, { model: MODEL, tmp: path.join(OUT, '.ws') });
          calls += r.calls;
          if (r.cls === 'quota') { quota = true; break; }
          done.set(f.page_number, { page_number: f.page_number, on_gutter: r.cls ? null : parseOnGutter(r.text), err: r.cls || undefined });
        } catch (e) { done.set(f.page_number, { page_number: f.page_number, on_gutter: null, err: e.message?.slice(0, 120) }); }
      }
    }));
    const frames = [...done.values()].sort((a, b) => a.page_number - b.page_number);
    if (quota) { fs.writeFileSync(file, JSON.stringify({ book_id: id, model: MODEL, frames }, null, 1)); console.log(`QUOTA: ${id} partly screened; re-run resumes`); break; }
    const flagged = frames.filter((r) => r.on_gutter !== true).map((r) => r.page_number);
    const whole = proposal.frames.filter((f) => f.fold === null).map((f) => f.page_number);
    const passed = frames.filter((r) => r.on_gutter === true).map((r) => r.page_number);
    const sheets = {};
    const chunk = (name, pages) => { for (let i = 0; i < pages.length; i += SHEET_N) sheets[`${name}-${String(i / SHEET_N + 1).padStart(2, '0')}`] = pages.slice(i, i + SHEET_N); };
    chunk('flagged', flagged);
    chunk('whole', whole);
    if (passed.length) sheets.sample = seededSample(passed, SHEET_N, id);
    for (const [name, pages] of Object.entries(sheets)) {
      const thumbs = [];
      for (const n of pages) {
        const f = proposal.frames.find((x) => x.page_number === n);
        const buf = await sharp(await fetchBuf(f.url)).resize(300).jpeg({ quality: 80 }).toBuffer();
        thumbs.push({ buf, th: (await sharp(buf).metadata()).height, fold: f.fold, page_number: n, asked: false, short: String(f.method || '').replace(/\(.*$/, '') });
      }
      await renderSheet(thumbs, path.join(dir, `screen-${name}.jpg`));
    }
    fs.writeFileSync(file, JSON.stringify({ book_id: id, model: MODEL, at: new Date().toISOString(), frames, sheets }, null, 1));
    console.log(`${id}: ${frames.length} cut frames screened, ${flagged.length} flagged, ${whole.length} whole, sheets ${Object.keys(sheets).join(' ')}`);
  }
  fs.rmSync(path.join(OUT, '.ws'), { recursive: true, force: true });
  console.log(`agy calls: ${calls}`);
  if (quota) process.exit(3);
}

/**
 * A new fold for a frame the check marked bad: `--page=N --fold=0–1000|whole --by=NAME`. Re-renders its review.
 * The method records `refold(<fold>, <by>)`, never "by-eye": a script also calls this (#7605 placed 85 folds with
 * agy and a book median), so whether an eye placed the fold is for `--by` to say.
 */
async function refold(db) {
  const OUT = path.resolve(arg('out'));
  const id = arg('book'), n = Number(arg('page')), by = arg('by'), foldArg = arg('fold');
  if (!id || !n || !by || !foldArg) { console.error('refold needs --book=ID --page=N --fold=0–1000|whole --by=NAME'); process.exit(2); }
  const file = path.join(OUT, id, 'proposal.json');
  const proposal = JSON.parse(fs.readFileSync(file, 'utf8'));
  const f = proposal.frames.find((x) => x.page_number === n);
  if (!f) { console.error(`no frame p.${n}`); process.exit(2); }
  const fold = foldArg === 'whole' ? null : Number(foldArg);
  if (fold !== null && !(fold > FOLD_MIN && fold < FOLD_MAX)) { console.error(`fold must be inside ${FOLD_MIN}–${FOLD_MAX}`); process.exit(2); }
  Object.assign(f, { fold, method: `refold(${fold ?? 'whole'}, ${by})`, flags: [...(f.flags || []), `was ${f.method}`] });
  const buf = await fetchBuf(f.url);
  const meta = await sharp(buf).metadata();
  await renderReview(buf, meta.width, meta.height, f, proposal.page_order, path.join(OUT, id, `review-p${String(n).padStart(3, '0')}.jpg`));
  proposal.unresolved = proposal.frames.filter((x) => x.fold === undefined).length;
  proposal.leaves_expected = proposal.frames.reduce((s, x) => s + (typeof x.fold === 'number' ? 2 : 1), 0);
  fs.writeFileSync(file, JSON.stringify(proposal, null, 1));
  if (!proposal.unresolved) fs.writeFileSync(path.join(OUT, id, 'positions.json'), JSON.stringify(Object.fromEntries(proposal.frames.map((x) => [String(x.page_number), x.fold == null ? null : Math.round(x.fold) / 10]))));
  console.log(`${id} p.${n}: ${f.method}`);
  void db;
}

export function readVerdicts(file) {
  const v = new Map();
  for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    const key = r.page_number != null ? r.page_number : r.screen_sheet != null ? `screen:${r.screen_sheet}` : r.screen_accept ? 'screen-accept' : `sheet${r.sheet}`;
    v.set(`${r.book_id}:${key}`, r); // the last row for a frame (or sheet) wins: a re-check replaces the first
  }
  return v;
}

/** Why a book's proposal may not be applied, or null. `verdicts`: readVerdicts(); `pages`: the book's live pages now. */
export function applyRefusal(proposal, verdicts, pages, bookId) {
  if (proposal.unresolved) return `${proposal.unresolved} frame(s) unresolved`;
  if (pages.length !== proposal.frames.length) return `book has ${pages.length} live pages, proposal has ${proposal.frames.length}`;
  for (const f of proposal.frames) {
    const p = pages.find((x) => x.page_number === f.page_number);
    if (!p || p.id !== f.page_id || frameUrl(p, bookId) !== f.url) return `p.${f.page_number} changed since the proposal`;
    const v = verdicts.get(`${bookId}:${f.page_number}`);
    if (!v) return `p.${f.page_number} has no verdict`;
    if (v.verdict !== 'ok') return `p.${f.page_number} verdict ${v.verdict}: ${v.note || ''}`;
    if (!v.checked_by) return `p.${f.page_number} verdict has no checked_by`;
  }
  return null;
}

async function apply(db) {
  const OUT = path.resolve(arg('out'));
  const APPLY = process.argv.includes('--apply');
  const STAGE = process.argv.includes('--stage');
  const verdicts = readVerdicts(arg('verdicts'));
  const only = arg('book')?.split(',');
  const ids = fs.readdirSync(OUT).filter((d) => /^[0-9a-f]{24}$/.test(d) && (!only || only.includes(d)));
  const report = [];
  for (const id of ids) {
    const proposal = JSON.parse(fs.readFileSync(path.join(OUT, id, 'proposal.json'), 'utf8'));
    const book = await db.collection('books').findOne({ id }, { projection: { id: 1, title: 1, needs_splitting: 1, split_completed: 1 } });
    if (!book?.needs_splitting || book.split_completed === true) { report.push({ id, result: 'skipped', why: 'no longer needs_splitting / already split' }); continue; }
    const pages = await db.collection('pages').find({ book_id: id, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } }, { projection: { id: 1, page_number: 1, archived_photo: 1, photo: 1 } }).sort({ page_number: 1 }).toArray();
    const screenFile = path.join(OUT, id, 'screen.json');
    const bookVerdicts = expandSheetVerdicts(proposal, verdicts, fs.existsSync(screenFile) ? JSON.parse(fs.readFileSync(screenFile, 'utf8')) : null);
    const why = applyRefusal(proposal, bookVerdicts, pages, id);
    if (why) { report.push({ id, result: 'refused', why }); console.log(`${id}: REFUSED — ${why}`); continue; }
    const by = [...new Set(proposal.frames.map((f) => bookVerdicts.get(`${id}:${f.page_number}`).checked_by))].join('+');
    const argv = [path.join(HERE, '..', 'split-book.mjs'), id, ...(STAGE ? ['--stage', ...(fs.existsSync(path.join(OUT, id, 'text-sides.json')) ? [`--text-sides=${path.join(OUT, id, 'text-sides.json')}`] : [])] : ['--gutter-only']), `--positions-file=${path.join(OUT, id, 'positions.json')}`, `--page-order=${proposal.page_order}`, `--by=${by}`, ...(APPLY ? [] : ['--dry-run'])];
    const r = spawnSync(process.execPath, argv, { encoding: 'utf8', env: process.env, timeout: 600_000 });
    fs.writeFileSync(path.join(OUT, id, APPLY ? 'split-apply.log' : 'split-dry.log'), `${r.stdout}\n${r.stderr}`);
    if (r.status !== 0) { report.push({ id, result: 'split-book failed', why: `exit ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').pop()}` }); console.log(`${id}: split-book exit ${r.status}`); continue; }
    if (!APPLY) { const n = (r.stdout.match(/^ {2}p\.\d+ /gm) || []).length; report.push({ id, result: n === proposal.leaves_expected ? 'dry-ok' : 'dry-mismatch', leaves: n, expected: proposal.leaves_expected }); continue; }
    if (STAGE) {
      // Staged, not swapped (#7605): every frame still live and unchanged, one hidden leaf per expected leaf.
      const staged = await db.collection('pages').find(stagedLeavesQuery(id), { projection: { id: 1, 'ocr.data': 1 } }).toArray();
      const stillLive = await db.collection('pages').countDocuments({ id: { $in: proposal.frames.map((f) => f.page_id) }, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } });
      const problems = [];
      if (staged.length !== proposal.leaves_expected) problems.push(`${staged.length} staged leaves, expected ${proposal.leaves_expected}`);
      if (stillLive !== proposal.frames.length) problems.push(`${stillLive}/${proposal.frames.length} frames still live`);
      if (problems.length) { report.push({ id, result: 'CHECK FAILED', why: problems.join('; ') }); console.log(`${id}: CHECK FAILED — ${problems.join('; ')}`); continue; }
      const withText = staged.filter((l) => l.ocr?.data).length;
      report.push({ id, result: 'staged', leaves: staged.length, with_text: withText, frames: proposal.frames.length });
      console.log(`${id}: staged ${proposal.frames.length} frames → ${staged.length} hidden leaves (${withText} with cut text), checked`);
      continue;
    }
    // The write is checked, not assumed (#3562): one live page per expected leaf, all from this run, every frame archived.
    const live = await db.collection('pages').find({ book_id: id, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } }, { projection: { id: 1, page_number: 1, split_from_spread: 1, split_method: 1, image_width: 1 } }).toArray();
    const archived = await db.collection('pages').countDocuments({ id: { $in: proposal.frames.map((f) => f.page_id) }, page_type: 'archived-spread', page_number: { $lt: 0 } });
    const after = await db.collection('books').findOne({ id }, { projection: { needs_splitting: 1, split_completed: 1 } });
    const problems = [];
    if (live.length !== proposal.leaves_expected) problems.push(`${live.length} live pages, expected ${proposal.leaves_expected}`);
    if (live.some((p) => p.split_from_spread !== true || !String(p.split_method || '').startsWith('reviewed'))) problems.push('a live page did not come from this split');
    if (archived !== proposal.frames.length) problems.push(`${archived}/${proposal.frames.length} frames archived`);
    if (after.needs_splitting !== false || after.split_completed !== true) problems.push('book flags not set by split-book.mjs');
    if (problems.length) { report.push({ id, result: 'CHECK FAILED', why: problems.join('; ') }); console.log(`${id}: CHECK FAILED — ${problems.join('; ')}`); continue; }
    // split_checked: the CLI OCR lane's spreadReason() treats a book with no crop data and no split_checked as possibly unsplit.
    await db.collection('books').updateOne({ id }, { $set: { 'pipeline_auto.split_checked': true } });
    await db.collection('book_events').insertOne({ book_id: id, type: 'spread_split', at: new Date(), source: 'split-spreads-agy', details: { issue: proposal.mode === 'sheets' ? 7605 : 7454, mode: proposal.mode || 'frames', frames: proposal.frames.length, leaves: live.length, checked_by: by, model: MODEL, methods: proposal.frames.map((f) => f.method) } });
    report.push({ id, result: 'split', leaves: live.length, frames: proposal.frames.length });
    console.log(`${id}: split ${proposal.frames.length} frames → ${live.length} pages, checked`);
  }
  fs.writeFileSync(path.join(OUT, APPLY ? (STAGE ? 'stage-report.json' : 'apply-report.json') : 'dry-report.json'), JSON.stringify(report, null, 1));
  const t = {}; for (const r of report) t[r.result] = (t[r.result] || 0) + 1;
  console.log(t);
}

async function main() {
  const stage = process.argv[2];
  if (!['propose', 'screen', 'apply', 'refold'].includes(stage) || !arg('out') || (stage === 'apply' && !arg('verdicts'))) {
    console.error('usage: split-spreads-agy.mjs propose --out=DIR [--sheets] [--hold=H] [--book=ID,.. | --books-file=FILE] [--limit=N] | screen --out=DIR [--book=ID,..] [--concurrency=4] | refold --out=DIR --book=ID --page=N --fold=F|whole --by=NAME | apply --out=DIR --verdicts=FILE [--book=ID,..] [--stage] [--apply]');
    process.exit(2);
  }
  if (stage === 'refold') return refold(null);
  if (stage === 'screen') return screen();
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  try { await (stage === 'propose' ? propose : apply)(client.db('bookstore')); } finally { await client.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();

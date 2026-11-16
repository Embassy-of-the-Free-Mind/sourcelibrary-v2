#!/usr/bin/env node
// PRIOR ART: scripts/split-pecha.mjs (#5771, PR #303/#310) — its R2 key scheme (cropped/<book>/<id>.jpg,
// pages/<book>/lf<id>.jpg), child shape (split_from_pecha, leaf_index, _orig_pn), parent archive (negative
// page_number, split_into) and vector withdrawal are kept here. It does not fit as-is: every frame costs an agy call,
// children get no text, and leaves are numbered in PHOTO order. scripts/eval/results/whish147-best-attempt-2026-10-22/
// leaf-split.mjs gives the text carry-over shape (ocr/translation per leaf, leaf_split provenance, recountBook,
// recordSweepAction); scripts/lib/split-stage.mjs (#7605) is why a frame whose text cannot be carried stays unsplit.
/**
 * split-pecha-eap — split EAP (British Library Endangered Archives) pecha photos, several loose leaves per frame, into
 * one page per leaf, in READING order, carrying each leaf's share of the stored read (#304).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/split-pecha-eap.mjs plan  --book=<id> [--out=DIR]
 *   node ... split-pecha-eap.mjs agy   --plan=DIR/<id>-plan.json          (resolve the frames the gap detector could not confirm)
 *   node ... split-pecha-eap.mjs apply --plan=DIR/<id>-plan.json [--execute]
 *   node ... split-pecha-eap.mjs recrop --plan=DIR/<id>-plan.json [--pages=PN,..] [--execute]   (re-cut applied leaves whose seam moved)
 *
 * PLAN ($0, no model). Per frame (a page with page_number > 0):
 *   - image: archived_photo, its pixel size checked against the frame's IIIF info.json maximum (iiif_info, and one live
 *     info.json per book). A copy smaller than the maximum is not cut ('smaller-than-iiif-max', listed).
 *   - leaves: findLeaves() (scripts/lib/pecha-leaves.mjs), the cloth gap between leaves, cut at the gap's emptiest row.
 *   - cross-check: ACCEPTED when no detector flag and the stored read's <leaf-break/> count + 1 equals the leaf count.
 *     1 leaf and a read without breaks goes to AGY as a cross-check (agy 1 = SINGLE). Otherwise AGY (no read) or UNSPLIT (read disagrees).
 *   - text: an accepted frame's leaves take the read cut at <leaf-break/>; the translation only when its own seams
 *     match. A frame whose served translation does not cut the same way stays UNSPLIT (build-then-swap, #7605: no
 *     reader loses text a split could not carry); it is listed for the leaf lanes.
 *   - order: recto/verso evidence per frame (folio label left of the margin rule), fitted along the book (fitSides).
 *     When the book's fit is clean (agree ≥ 0.9, ≥ half of frames confident, ≥ 10 confident, breaks ≤ 1 per 40
 *     frames), each recto frame followed by a verso frame with the same leaf count, both split, is read A.L1, B.L1,
 *     A.L2, B.L2 … (the photographer shot N rectos, turned the leaves in place, shot the N versos: v2#5771).
 *     Otherwise photo order (frame by frame, top to bottom). books.split_page_order records which, and why.
 *   - writes DIR/<id>-plan.json and contact sheets DIR/<id>-sheet-NN.jpg (cuts drawn, each leaf numbered by its
 *     reading position; green accepted, cyan agy, orange unsplit).
 * AGY. Frames marked 'agy' (no read, or a detector flag with no read) get one Gemini 3.8 Flash low box call each
 *   through the agy CLI (subscription). Accepted when the box count equals the gap count and no gap flag; else unsplit.
 * APPLY (writes only with --execute). Re-checks each frame (page_number, OCR and translation hashes, image size) against
 *   the plan; a changed frame stays unsplit and its pair partner falls back to photo order. Crops at full resolution,
 *   uploads three book-scoped keys per leaf, inserts the leaves, archives each parent (negative page_number,
 *   split_into; its text untouched), withdraws parent vectors, renumbers the book in reading order, recountBook,
 *   recordSweepAction. Resumable: a frame already split is reused.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { findLeaves, snapBoxes, inkOutside, rectoInk, inkOnset, rectoEvidence, fitSides } from '../lib/pecha-leaves.mjs';
import { countLeafBreaks, splitLeafUnits } from '../lib/leaf-break.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';
import { withdrawPageVectors } from '../lib/withdraw-page-vectors.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { markDisplay } from '../workers/lib/display-image.mjs';

const SWEEP = 'split-pecha-eap-304';
const ISSUE = 304;
const args = process.argv.slice(2);
const CMD = args[0];
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const EXECUTE = args.includes('--execute');
const OUT = arg('out') || path.join(process.env.JOB_SCRATCH || 'scripts/output', 'split-pecha-eap');
const CONC = +(arg('conc') || 4);
const BBOX_MODEL = 'gemini-3.8-flash-low';
const AGY_CONC = +(arg('agy-conc') || 3);
export const INK_OUTSIDE_MAX = 0.02; // text outside a leaf's box (inkOutside): above this the box dropped part of a leaf
// A leaf box reaching more than this share of the frame height past its own paper run (above or below) holds something
// the gap finder did not see as paper: cloth and archivist's label slips, or a small or narrow leaf (a fragment, a short
// leaf) that the read ALSO skipped, so gaps = read and the frame was accepted with two leaves in one crop (69e77aa6…,
// frame 126; 12 more frames in 4 books found by eye in the 349-frame tail over 0.3 of waves 3–5; the rest were labels
// and cloth). Such frames go to agy for the count. p99 of all leaves is 0.15; 1.7% of frames are over 0.25.
export const BOX_BEYOND_RUN_MAX = 0.25;
export function boxBeyondRun(leaves, H) {
  if (!leaves?.length || !H) return 0;
  return Math.max(0, ...leaves.filter((l) => l.run).map((l) => Math.max(l.run[0] - l.top, l.top + l.height - l.run[1]) / H));
}

export const ORDER_GATE = { agree: 0.9, confidentShare: 0.5, confidentMin: 10, breaksPer: 40, window: 20, pairMargin: 1.5 };
export function orderGate(fit, n) {
  const why = [];
  if (fit.agree < ORDER_GATE.agree) why.push(`agree ${fit.agree}`);
  if (fit.confident < Math.max(ORDER_GATE.confidentMin, n * ORDER_GATE.confidentShare)) why.push(`confident ${fit.confident}/${n}`);
  if (fit.breaks > Math.max(1, Math.floor(n / ORDER_GATE.breaksPer))) why.push(`breaks ${fit.breaks}`);
  return why.length ? why.join(', ') : null;
}

const leafCountOf = (text) => (text && String(text).trim() ? countLeafBreaks(text) + 1 : null);
// Raw translation.data on purpose (baselined, #5942): the split cuts the model's string at <leaf-break/> and carries each
// segment as the child's translation.data, notes included; the text accessor would drop the markup the cut needs.
const servedTranslation = (p) => (p.translation?.data && String(p.translation.data).trim() ? p.translation.data : null);

async function download(url) {
  let last;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      last = `HTTP ${r.status}`;
      if (r.status === 404) break;
    } catch (e) { last = e.message; }
    await new Promise((z) => setTimeout(z, 1500 * (t + 1)));
  }
  throw new Error(`download failed: ${last}`);
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/** Decide one frame from its detector result and its stored text. */
export function decideFrame({ n, flags, readLeaves, trLeaves, sizeOk, leaves, H }) {
  if (!sizeOk) return { status: 'unsplit', reason: 'smaller-than-iiif-max' };
  if (n === 0) return { status: 'unsplit', reason: 'no-leaf-found' };
  if (!flags.includes('box-beyond-run') && boxBeyondRun(leaves, H) > BOX_BEYOND_RUN_MAX) {
    return { ...decideFrame({ n, flags: [...flags, 'box-beyond-run'], readLeaves, trLeaves, sizeOk }), flags: [...flags, 'box-beyond-run'] };
  }
  const flagged = flags.length > 0;
  // One gap leaf and a read without breaks is still asked of agy: on dark (indigo, gold-ink) paper the gap finder sees
  // two stacked leaves as one run and the read skips the seam, so the two signals miss together (69e77a20…, frames
  // 82/90; the review caught it). agy 1 makes it SINGLE; agy 2+ goes the agy-counts-more-than-the-read way. ~0.3% of frames.
  if (n === 1 && !flagged && readLeaves === 1) return { status: 'agy', reason: 'one leaf, agy cross-check' };
  if (readLeaves == null) return { status: 'agy', reason: flagged ? `no read; ${flags.join(',')}` : 'no read' };
  if (flagged) return { status: 'agy', reason: `detector ${flags.join(',')}` };
  if (readLeaves !== n) return { status: 'agy', reason: `read has ${readLeaves} leaves, gaps ${n}` };
  if (trLeaves != null && trLeaves !== n) return { status: 'unsplit', reason: `translation has ${trLeaves} leaves, gaps ${n}` };
  return { status: 'accept', reason: 'gaps = read', carry: true };
}

const isSplit = (f) => f.status === 'accept' || f.status === 'accept-agy';

/** Reading order: list of units { frame: index, leaf: i|null } (leaf null = the frame itself, unsplit/single). */
export function readingOrder(frames, { usePairs, ok = () => true }) {
  const units = []; const pairs = [];
  const unitsOf = (k) => (isSplit(frames[k]) && ok(k) ? frames[k].leaves.map((_, i) => ({ frame: k, leaf: i })) : [{ frame: k, leaf: null }]);
  for (let k = 0; k < frames.length; k++) {
    const A = frames[k], B = frames[k + 1];
    // A pair also needs its own evidence: A clearly more recto than B. Where a book changes text (a new title leaf, a
    // mixed frame) the fit can stay in step while the photos do not, and a weak pair is read in photo order.
    if (usePairs && B && A.side === 'R' && B.side === 'V' && isSplit(A) && isSplit(B) && ok(k) && ok(k + 1) && A.leaves.length === B.leaves.length
      && (A.evidence ?? 0) - (B.evidence ?? 0) >= ORDER_GATE.pairMargin) {
      for (let i = 0; i < A.leaves.length; i++) units.push({ frame: k, leaf: i }, { frame: k + 1, leaf: i });
      pairs.push([k, k + 1]); k++; continue;
    }
    units.push(...unitsOf(k));
  }
  return { units, pairs };
}

// ── PLAN ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function analyseFrame(page) {
  // image-pick-ok: the whole unsplit frame is what gets cut into leaves (a split parent never reaches the planner)
  const src = page.archived_photo || page.photo;
  const rec = { page_id: page.id, pn: page.page_number, src, ocr_hash: page.ocr?.data ? contentHash(page.ocr.data) : null, tr_hash: servedTranslation(page) ? contentHash(page.translation.data) : null };
  rec.read_leaves = leafCountOf(page.ocr?.data);
  rec.tr_leaves = servedTranslation(page) ? leafCountOf(page.translation.data) : null;
  rec.iiif = page.iiif_info?.width ? [page.iiif_info.width, page.iiif_info.height] : null;
  try {
    const buf = await download(src);
    const r = await findLeaves(buf);
    rec.W = r.W; rec.H = r.H; rec.flags = r.flags; rec.cuts = r.cuts;
    rec.ink_out = r.leaves.length ? await inkOutside(buf, r.leaves) : [];
    if (rec.ink_out.some((v) => v > INK_OUTSIDE_MAX)) rec.flags = [...rec.flags, 'ink-outside'];
    rec.size_ok = !rec.iiif || (r.W >= rec.iiif[0] && r.H >= rec.iiif[1]);
    rec.leaves = r.leaves.map(({ left, top, width, height, run, paper_x }) => ({ left, top, width, height, run, paper_x }));
    rec.ink = []; rec.onset = [];
    for (const l of r.leaves) { rec.ink.push((await rectoInk(buf, l)).ink); rec.onset.push(await inkOnset(buf, l)); }
    Object.assign(rec, decideFrame({ n: r.leaves.length, flags: rec.flags, readLeaves: rec.read_leaves, trLeaves: rec.tr_leaves, sizeOk: rec.size_ok, leaves: rec.leaves, H: rec.H }));
    return { rec, buf };
  } catch (e) {
    Object.assign(rec, { status: 'unsplit', reason: `error: ${e.message.slice(0, 80)}`, leaves: [], flags: [], ink: [], onset: [] });
    return { rec, buf: null };
  }
}

/** BL's info.json for a page with no iiif_info, from its photo_original (images.eap.bl.uk/<coll>/<file>/<n>.jp2/...). */
export function blInfoUrl(photoOriginal) {
  const m = /^https?:\/\/images\.eap\.bl\.uk\/(.+?\.jp2)\//.exec(photoOriginal || '');
  return m ? `https://images.eap.bl.uk/${m[1]}/info.json` : null;
}

/**
 * Size check for a book whose pages carry no iiif_info (R2-only copies): BL's live maximum for the first, middle and
 * last frame against our copy of the same frame. Any frame smaller than BL's maximum marks every frame of the book
 * 'smaller-than-iiif-max' (fetch the full-size images first; Derek 2026-11-14).
 */
async function blSizeCheck(pages, recs) {
  if (pages.some((x) => x.iiif_info?.width)) return null;
  const pick = [...new Set([0, pages.length >> 1, pages.length - 1])].map((i) => pages[i]).filter(Boolean);
  const out = [];
  for (const p of pick) {
    const u = blInfoUrl(p.photo_original); const r = recs.find((x) => x.page_id === p.id);
    if (!u || !r?.W) { out.push({ page: p.page_number, error: u ? 'no copy' : 'no photo_original' }); continue; }
    try {
      const j = await (await fetch(u, { signal: AbortSignal.timeout(30000) })).json();
      out.push({ page: p.page_number, bl: [j.width, j.height], ours: [r.W, r.H], ok: r.W >= j.width && r.H >= j.height });
    } catch (e) { out.push({ page: p.page_number, error: e.message.slice(0, 60) }); }
  }
  return { frames: out, ok: out.length > 0 && out.every((x) => x.ok === true) };
}

async function liveIiifCheck(pages) {
  const p = pages.find((x) => x.iiif_info?.service_url);
  if (!p) return { checked: false };
  try {
    const u = p.iiif_info.service_url.replace(/^http:/, 'https:') + '/info.json';
    const j = await (await fetch(u, { signal: AbortSignal.timeout(30000) })).json();
    return { checked: true, page: p.page_number, live: [j.width, j.height], stored: [p.iiif_info.width, p.iiif_info.height], same: j.width === p.iiif_info.width && j.height === p.iiif_info.height };
  } catch (e) { return { checked: false, error: e.message }; }
}

/**
 * Two leaves that touch with no cloth between them make one paper run, and the stored read can merge them too, so
 * the gaps and the read agree on a wrong count (69e77a99…, frame 8). Such a leaf is about twice the book's usual
 * height: a split frame with a leaf over TALL_VS_BOOK × the book's median leaf height (share of the frame height,
 * over ≥8 split leaves) is left unsplit and listed. Measured on 5 review books: median 0.22–0.41, p90 ≤1.16× the
 * median, the merged leaf 2.05×.
 */
export const TALL_VS_BOOK = 1.5;
export function tallVsBook(frames) {
  const split = frames.filter((f) => /^accept/.test(f.status));
  const ht = (l, f) => ((l.run ? l.run[1] - l.run[0] : l.height) / f.H); // the paper run: boxes now reach the cuts and the frame edge
  const hs = split.flatMap((f) => f.leaves.map((l) => ht(l, f))).sort((a, b) => a - b);
  if (hs.length < 8) return 0;
  const med = hs[hs.length >> 1]; let n = 0;
  for (const f of split) if (f.leaves.some((l) => ht(l, f) > TALL_VS_BOOK * med)) { Object.assign(f, { status: 'unsplit', reason: `tall-vs-book (${f.reason || f.status})`, carry: false }); n++; }
  return n;
}

/**
 * A frame agy boxed into MORE leaves than the stored read counts, on touching leaves the gap finder saw as one run
 * (agyDecide keeps the clean snap as f.cand), is split when the book itself vouches for it: agy's count is the book's
 * usual count (the count on at least BOOK_MODE.share of the frames already split, n ≥ BOOK_MODE.min) and every snapped leaf
 * is within BOOK_MODE.height of the book's median leaf height, by paper run AND by box. A cut misplaced into the blank
 * between two lines leaves one leaf short and its neighbour long: 69e76154…, frame 62 at 0.73 (the review caught it). The read under-counts on sparse, title and faded leaves
 * (69e76154…: 58 of 114 frames held back, agy 4 on every one, four leaves by eye on all 30 of sheet 1). The leaves get
 * no text (the read disagrees): they go to the re-read lane, and every accept-agy frame goes to the review.
 */
export const BOOK_MODE = { min: 10, share: 0.6, height: [0.8, 1.3] };
export function bookModeAccept(frames) {
  const split = frames.filter((f) => isSplit(f) && f.leaves.length > 1);
  if (split.length < BOOK_MODE.min) return 0;
  const counts = {}; for (const f of split) counts[f.leaves.length] = (counts[f.leaves.length] || 0) + 1;
  const [mode, cnt] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (cnt / split.length < BOOK_MODE.share) return 0;
  const ht = (l, f) => ((l.run ? l.run[1] - l.run[0] : l.height) / f.H);
  const hb = (l, f) => l.height / f.H;
  const median = (h) => { const a = split.filter((f) => f.leaves.length === +mode).flatMap((f) => f.leaves.map((l) => h(l, f))).sort((x, y) => x - y); return a[a.length >> 1]; };
  const mr = median(ht), mb = median(hb); let n = 0;
  const within = (r) => r >= BOOK_MODE.height[0] && r <= BOOK_MODE.height[1];
  for (const f of frames) {
    if (f.status !== 'unsplit' || !f.cand || f.cand.leaves.length !== +mode) continue;
    if (!f.cand.leaves.every((l) => within(ht(l, f) / mr) && within(hb(l, f) / mb))) continue;
    Object.assign(f, f.cand, { status: 'accept-agy', reason: `agy ${mode} = book, read ${f.read_leaves}`, carry: false, gap_leaves: f.leaves.length });
    delete f.cand; n++;
  }
  return n;
}

export function orderPlan(plan) {
  const frames = plan.frames;
  const ev = rectoEvidence(frames.map((f) => ({ ink: f.ink, onset: f.onset })), { window: ORDER_GATE.window });
  const fit = fitSides(ev);
  frames.forEach((f, i) => { f.side = fit.sides[i]; f.evidence = +ev[i].toFixed(2); });
  const refusal = orderGate(fit, frames.length);
  const { units, pairs } = readingOrder(frames, { usePairs: !refusal });
  plan.order = { fit: { agree: fit.agree, confident: fit.confident, breaks: fit.breaks, frames: frames.length }, refusal, mode: refusal ? `photo: ${refusal}` : 'pecha-pairs', pairs: pairs.length };
  plan.units = units;
  return plan;
}

async function planBook(db, bookId) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, title: 1, tenantId: 1, visible: 1, split_completed: 1, split_page_order: 1 } });
  if (!book) throw new Error(`no book ${bookId}`);
  const Pages = db.collection('pages');
  const pages = await Pages.find({ book_id: bookId, page_number: { $gt: 0 } }).sort({ page_number: 1 }).toArray();
  if (pages.some((p) => p.split_from_pecha || p.split_from_spread || p.staged_split)) throw new Error('book already holds split leaves; plan the remaining frames by hand');
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const iiifLive = await liveIiifCheck(pages);
  const sheetsIn = [];
  const recs = await pool(pages, CONC, async (p) => {
    const { rec, buf } = await analyseFrame(p);
    if (buf) sheetsIn.push({ pn: rec.pn, thumb: await sharp(buf).resize({ width: 260 }).jpeg({ quality: 70 }).toBuffer() });
    return rec;
  });
  const blSize = await blSizeCheck(pages, recs);
  if (blSize && !blSize.ok) for (const r of recs) Object.assign(r, { size_ok: false, status: 'unsplit', reason: 'smaller-than-iiif-max' });
  tallVsBook(recs);
  const plan = orderPlan({ book_id: bookId, title: book.title, visible: book.visible, made_at: new Date().toISOString(), sweep: SWEEP, iiif_live: iiifLive, bl_size: blSize, frames: recs });
  plan.summary = summarise(plan);
  const file = path.join(OUT, `${bookId}-plan.json`);
  fs.writeFileSync(file, JSON.stringify(plan));
  await writeSheets(plan, sheetsIn);
  console.log(`[${bookId}] ${pages.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s  ${JSON.stringify(plan.summary)}  order=${plan.order.mode} pairs=${plan.order.pairs}`);
  return plan;
}

export function summarise(plan) {
  const s = { frames: plan.frames.length, accept: 0, 'accept-agy': 0, single: 0, agy: 0, unsplit: 0, leaves_new: 0, text_leaves: 0, tr_leaves: 0, reasons: {} };
  for (const f of plan.frames) {
    s[f.status]++;
    if (f.status === 'unsplit' || f.status === 'agy') { const r = f.reason.replace(/\d+/g, 'N'); s.reasons[r] = (s.reasons[r] || 0) + 1; }
    if (isSplit(f)) { s.leaves_new += f.leaves.length; if (f.carry) { s.text_leaves += f.leaves.length; if (f.tr_leaves) s.tr_leaves += f.leaves.length; } else s.reread_leaves = (s.reread_leaves || 0) + f.leaves.length; }
  }
  s.pages_after = plan.units ? plan.units.length : null;
  return s;
}

async function writeSheets(plan, thumbs) {
  const byPn = new Map(thumbs.map((t) => [t.pn, t.thumb]));
  const pos = new Map(); plan.units.forEach((u, i) => pos.set(`${u.frame}:${u.leaf}`, i + 1));
  const TW = 260, PER = 30, COLS = 6;
  const colour = { accept: '#33dd33', 'accept-agy': '#33dddd', single: '#ffffff', agy: '#ffdd00', unsplit: '#ff8800' };
  for (let s = 0; s * PER < plan.frames.length; s++) {
    const tiles = []; let rowH = 0;
    for (let k = s * PER; k < Math.min(plan.frames.length, (s + 1) * PER); k++) {
      const f = plan.frames[k], th0 = byPn.get(f.pn);
      const th = f.W ? Math.round(f.H * TW / f.W) : 100; rowH = Math.max(rowH, th + 34);
      const kx = f.W ? TW / f.W : 1; const c = colour[f.status];
      const rects = isSplit(f) || f.status === 'agy' || f.status === 'unsplit'
        ? (f.leaves || []).map((l, i) => `<rect x="${l.left * kx}" y="${l.top * kx}" width="${l.width * kx}" height="${l.height * kx}" fill="none" stroke="${c}" stroke-width="2"/><text x="${l.left * kx + 4}" y="${l.top * kx + 16}" fill="yellow" stroke="black" stroke-width="0.6" font-size="16" font-weight="bold" font-family="sans-serif">${isSplit(f) ? pos.get(`${k}:${i}`) ?? '?' : '·'}</text>`).join('')
        : `<text x="6" y="18" fill="yellow" font-size="16" font-weight="bold" font-family="sans-serif">${pos.get(`${k}:null`) ?? ''}</text>`;
      const label = `p${f.pn} ${f.side || ''}${f.evidence != null ? (f.evidence >= 0 ? '+' : '') + f.evidence : ''} ${f.status} ${f.status === 'accept' ? '' : f.reason}`.slice(0, 44);
      const svg = Buffer.from(`<svg width="${TW}" height="${th + 34}" xmlns="http://www.w3.org/2000/svg">${rects}<text x="3" y="${th + 15}" fill="${c}" font-size="12" font-family="sans-serif">${label.replace(/[<>&]/g, '')}</text></svg>`);
      const base = th0 || await sharp({ create: { width: TW, height: th, channels: 3, background: '#400' } }).jpeg().toBuffer();
      tiles.push(await sharp({ create: { width: TW, height: th + 34, channels: 3, background: '#222' } }).composite([{ input: base, top: 0, left: 0 }, { input: svg, top: 0, left: 0 }]).jpeg().toBuffer());
    }
    const rows = Math.ceil(tiles.length / COLS);
    const file = path.join(OUT, `${plan.book_id}-sheet-${String(s + 1).padStart(2, '0')}.jpg`);
    await sharp({ create: { width: COLS * (TW + 4), height: rows * (rowH + 4), channels: 3, background: '#000' } })
      .composite(tiles.map((t, i) => ({ input: t, left: (i % COLS) * (TW + 4), top: Math.floor(i / COLS) * (rowH + 4) }))).jpeg({ quality: 78 }).toFile(file);
  }
}

/**
 * One frame the gap finder could not confirm, given agy's boxes. The count to agree with is the read's leaf count when
 * there is a read (then the text is carried too), else the gap finder's own count. The cuts are agy's boxes snapped to
 * the paper profile (snapBoxes), or the gap leaves when the gap finder agrees and raised no flag.
 */
export async function agyDecide(f, boxes, cls, buf) {
  const d = await agyDecide1(f, boxes, cls, buf);
  return boxes ? { agy_boxes: boxes, ...d } : d;
}
export const OVERHANG_MAX = 0.03;
export function overhang(f, boxes) {
  if (!f.leaves?.length || !f.H || !boxes?.length) return false;
  const bx = [...boxes].sort((p, q) => p[0] - q[0]), L = f.leaves[f.leaves.length - 1];
  return (f.leaves[0].top - bx[0][0] * f.H / 1000) / f.H > OVERHANG_MAX || (bx[bx.length - 1][2] * f.H / 1000 - (L.top + L.height)) / f.H > OVERHANG_MAX;
}
export const GAP_LEAF_COVER_MIN = 0.2;
/** Index of the first gap leaf whose rows agy's boxes cover by less than GAP_LEAF_COVER_MIN, else -1. */
export function uncoveredGapLeaf(f, boxes) {
  if (!f.leaves?.length || !f.H || !boxes?.length) return -1;
  const bx = boxes.map((b) => [b[0] * f.H / 1000, b[2] * f.H / 1000]);
  return f.leaves.findIndex((l) => {
    const a = l.top, b = l.top + l.height;
    const cov = bx.reduce((s, [y0, y1]) => s + Math.max(0, Math.min(b, y1) - Math.max(a, y0)), 0);
    return l.height > 0 && cov / l.height < GAP_LEAF_COVER_MIN;
  });
}
async function agyDecide1(f, boxes, cls, buf) {
  if (!boxes) return { status: 'unsplit', reason: `agy ${cls || 'no boxes'}` };
  // agy answered with an empty array: no leaf seen (a blank or dark frame); the frame stays whole and is listed. Without
  // this the overhang check threw and the book's whole agy run was lost before the plan was saved (7 runs, w2/w3 logs).
  if (!boxes.length) return { status: 'unsplit', reason: 'agy 0 boxes' };
  const n = boxes.length;
  // The gap leaves can stop short of the frame's real top or bottom leaf when that leaf is underlit (the paper run ends
  // early): agy's outer box then reaches more than OVERHANG_MAX further, and the cut follows agy's snapped boxes, which
  // take the outer bounds from agy (69e76200…, frames 254/264/346/348: the last 4–5 lines of the bottom leaf were outside
  // every box; the review caught it). A tape or cloth flap inside agy's box only makes the leaf box a little larger.
  const gapOk = !f.flags.length, ovh = overhang(f, boxes);
  // With no read, the gap finder's count is the check, unless it flagged its own result: then the snap (a blank band
  // at every seam) is the second signal, and the leaves go to the re-read lane without text.
  const target = f.read_leaves ?? (gapOk ? f.leaves.length : n);
  // The clean gap finder and agy agree and the read counts FEWER leaves: the read skipped a title or blank leaf or joined
  // two (12/12 by eye, 20 review books). Split without text; the leaves go to the re-read lane. A read that counts MORE
  // than both is the merged-leaf direction and stays unsplit, as does a frame serving a translation.
  if (n !== target && gapOk && f.leaves.length === n && n > 1 && f.read_leaves != null && f.read_leaves < n && f.tr_leaves == null) {
    if (!ovh) return { status: 'accept-agy', reason: `agy ${n} = gaps, read ${f.read_leaves}`, carry: false };
    return snapAccept(buf, boxes, false, `agy ${n} = gaps, read ${f.read_leaves}, overhang`, f.leaves.length);
  }
  if (n !== target) {
    const d = { status: 'unsplit', reason: `agy ${n}, ${f.read_leaves != null ? 'read' : 'gaps'} ${target}${gapOk ? '' : ' ' + f.flags.join(',')}` };
    // agy counts MORE leaves than the read, on a frame whose leaves touch (no cloth gap): keep agy's cut as a candidate
    // when it snaps clean; bookModeAccept takes it if the count and leaf heights match the rest of the book.
    if (n > 1 && f.read_leaves != null && f.read_leaves < n && f.tr_leaves == null && buf) {
      const s = await snapBoxes(buf, boxes);
      const inkOut = await inkOutside(buf, s.leaves);
      if (!s.flags.length && !inkOut.some((v) => v > INK_OUTSIDE_MAX)) {
        d.cand = { leaves: s.leaves.map(({ left, top, width, height, run, paper_x }) => ({ left, top, width, height, run, paper_x })), ink: [], onset: [], seam_ink: s.seam_ink, ink_out: inkOut };
        for (const l of s.leaves) { d.cand.ink.push((await rectoInk(buf, l)).ink); d.cand.onset.push(await inkOnset(buf, l)); }
      }
    }
    return d;
  }
  // a frame the gap finder saw as one TALL run is kept whole and listed, even when agy and the read say one leaf: the
  // review found two stacked leaves on such frames (6a37022a…, frame 32; 6a37022c…, frame 17)
  if (n === 1) return gapOk ? { status: 'single', reason: 'one leaf (agy)' } : { status: 'unsplit', reason: `agy 1, read 1, ${f.flags.join(',')}` };
  // No read, and the gap finder saw ONE run where agy sees several: a folded sheet (a cover with its title cartouche, a
  // mandala or diagram sheet) looks exactly like two touching leaves, and agy cuts along the fold through the drawing
  // (69e761f7…, frames 296/299/301; 69e779fd…, frame 301; the review caught them). Of 44 such frames by eye, 17 were
  // folds and 15 two leaves; agy asked 'folded or two leaves?' called 8/10 touching text leaves folded. Kept whole, listed.
  if (f.read_leaves == null && f.leaves.length === 1 && n > 1) return { status: 'unsplit', reason: `agy ${n}, gaps 1, no read (fold or touching leaves)` };
  if (f.tr_leaves != null && f.tr_leaves !== n) return { status: 'unsplit', reason: `translation has ${f.tr_leaves} leaves, agy ${n}` };
  const carry = f.read_leaves === n;
  // The clean gap finder saw MORE leaves than agy and the read, and one gap leaf lies outside every agy box: agy and the
  // read both missed a leaf (a dark title leaf with one line, 69e77a38…, frame 77; the review caught it). Kept whole,
  // listed. Of 287 frames with more gap leaves than cut leaves, 6 had a gap leaf under 20% covered: this one and 5
  // archivist's lined-paper 'missing' slips, which are held too.
  const unboxed = uncoveredGapLeaf(f, boxes);
  if (gapOk && f.leaves.length > n && unboxed >= 0) return { status: 'unsplit', reason: `agy ${n}, gaps ${f.leaves.length}: gap leaf ${unboxed + 1} has no box` };
  if (gapOk && !ovh && f.leaves.length === n) return { status: 'accept-agy', reason: `agy ${n} = gaps`, carry };
  return snapAccept(buf, boxes, carry, `agy ${n} snapped${carry ? ' = read' : ''}${ovh ? ', overhang' : ''}`, f.leaves.length);
}

async function snapAccept(buf, boxes, carry, reason, gapLeaves) {
  const n = boxes.length;
  const s = await snapBoxes(buf, boxes);
  const inkOut = await inkOutside(buf, s.leaves);
  if (inkOut.some((v) => v > INK_OUTSIDE_MAX)) s.flags.push('ink-outside');
  if (s.flags.length) return { status: 'unsplit', reason: `agy ${n}, snap ${s.flags.join(',')}`, seam_ink: s.seam_ink, ink_out: inkOut };
  const leaves = s.leaves.map(({ left, top, width, height, run, paper_x }) => ({ left, top, width, height, run, paper_x }));
  const ink = [], onset = [];
  for (const l of s.leaves) { ink.push((await rectoInk(buf, l)).ink); onset.push(await inkOnset(buf, l)); }
  return { status: 'accept-agy', reason, carry, leaves, ink, onset, seam_ink: s.seam_ink, ink_out: inkOut, gap_leaves: gapLeaves };
}

// ── AGY ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function agyPlan(planFile) {
  const { gatedImageCall, firstJson } = await import('../lib/agy-cli.mjs');
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  // Frames planned before agy took the disagreements (and any not yet asked) are decided again from the stored detector result.
  for (const f of plan.frames) {
    if (f.agy_n !== undefined || !f.W || /^error/.test(f.reason || '')) continue;
    const d = decideFrame({ n: f.leaves.length, flags: f.flags, readLeaves: f.read_leaves, trLeaves: f.tr_leaves, sizeOk: f.size_ok, leaves: f.leaves, H: f.H });
    if (d.status !== f.status || d.status === 'agy' || d.carry) Object.assign(f, d);
  }
  // --resnap: decide again the frames agy already boxed (after a change to the snap), without a new call.
  // --boxes-from=OLD_PLAN: agy boxes from an earlier plan of the same book, matched by page id and image size.
  if (arg('boxes-from') && fs.existsSync(arg('boxes-from'))) {
    const old = new Map(JSON.parse(fs.readFileSync(arg('boxes-from'), 'utf8')).frames.filter((f) => f.agy_boxes).map((f) => [f.page_id, f]));
    for (const f of plan.frames) { const o = old.get(f.page_id); if (o && o.W === f.W && o.H === f.H && f.status === 'agy') f.agy_boxes = o.agy_boxes; }
  }
  // --keep-split (with --resnap, for a book already applied): frames already split stay exactly as applied; only the
  // frames kept whole are decided again, so a re-apply splits just those (a resumed apply finishes the book, #329).
  const keep = args.includes('--keep-split') ? new Map(plan.frames.filter(isSplit).map((f) => [f.page_id, JSON.parse(JSON.stringify(f))])) : new Map();
  const todo = plan.frames.filter((f) => !keep.has(f.page_id) && (f.status === 'agy' || (args.includes('--resnap') && f.agy_boxes)));
  const PROMPT = (f) => `This image shows one or more loose Tibetan manuscript leaves (pecha folios) — wide horizontal strips — photographed stacked vertically on a cloth: @./${f}
Return ONLY a JSON array of bounding boxes, one per DISTINCT physical leaf (not the background, not a colour card or measuring tape, not individual lines of text). Each box: {"box_2d":[ymin,xmin,ymax,xmax]} normalized 0-1000, top to bottom order. Do not use any tool other than viewing the attached image.`;
  let calls = 0, quota = false;
  await pool(todo, AGY_CONC, async (f) => {
    if (quota) return;
    const buf = await download(f.src);
    if (f.agy_boxes) { // boxed before (a re-plan carries them over, or --resnap): no new call
      const r = await findLeaves(buf); // the gap leaves again: an accepted frame's leaves are the snapped ones
      Object.assign(f, { flags: r.flags, leaves: r.leaves.map(({ left, top, width, height, run, paper_x }) => ({ left, top, width, height, run, paper_x })), ink: [], onset: [] });
      for (const l of r.leaves) { f.ink.push((await rectoInk(buf, l)).ink); f.onset.push(await inkOnset(buf, l)); }
      f.ink_out = r.leaves.length ? await inkOutside(buf, r.leaves) : [];
      if (f.ink_out.some((v) => v > INK_OUTSIDE_MAX)) f.flags.push('ink-outside');
      f.agy_n = f.agy_boxes.length; delete f.cand;
      Object.assign(f, await agyDecide(f, f.agy_boxes, null, buf)); return;
    }
    const small = await sharp(buf).resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const r = await gatedImageCall(PROMPT, small, { model: BBOX_MODEL, onCall: () => calls++ });
    if (r.cls === 'quota') { if (!quota) console.log(`agy quota after ${calls} calls; plan saved, rerun later`); quota = true; return; }
    const boxes = r.cls ? null : (firstJson(r.text, '[') || []).map((b) => b.box_2d).filter((b) => Array.isArray(b) && b.length === 4);
    f.agy_n = boxes ? boxes.length : null;
    Object.assign(f, await agyDecide(f, boxes, r.cls, buf));
  });
  plan.book_mode_accepted = bookModeAccept(plan.frames); tallVsBook(plan.frames);
  plan.frames = plan.frames.map((f) => keep.get(f.page_id) || f);
  orderPlan(plan); plan.summary = summarise(plan); plan.agy_calls = (plan.agy_calls || 0) + calls;
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const thumbs = [];
  await pool(plan.frames, CONC, async (f) => { if (f.W) thumbs.push({ pn: f.pn, thumb: await sharp(await download(f.src)).resize({ width: 260 }).jpeg({ quality: 70 }).toBuffer() }); });
  await writeSheets(plan, thumbs);
  console.log(`[${plan.book_id}] agy ${calls} calls; ${JSON.stringify(plan.summary)} order=${plan.order.mode}`);
}

// ── APPLY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function r2Client() {
  return new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
}
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

/** The child's ocr / translation objects for leaf i of an accepted frame. */
export function leafTexts(page, i, n, leafSplit) {
  const out = {};
  if (page.ocr?.data) {
    const seg = splitLeafUnits(page.ocr.data);
    if (seg.length !== n) throw new Error(`read cuts into ${seg.length}, not ${n}`);
    const engine = page.ocr.engine ? { ...page.ocr.engine } : undefined;
    if (engine?.leaf_seams) { engine.leaf_seams = undefined; delete engine.leaf_seams; }
    const lines = page.ocr.engine?.leaf_seams?.leaf_lines;
    out.ocr = { ...page.ocr, data: seg[i], content_hash: contentHash(seg[i]), ...(engine ? { engine } : {}), leaf_split: { ...leafSplit, ...(Array.isArray(lines) && lines.length === n ? { leaf_lines: lines[i] } : {}) } };
  }
  const tr = servedTranslation(page);
  if (tr) {
    const seg = splitLeafUnits(tr);
    if (seg.length !== n) throw new Error(`translation cuts into ${seg.length}, not ${n}`);
    out.translation = { ...page.translation, data: seg[i], content_hash: contentHash(seg[i]), leaf_split: leafSplit };
  }
  if (page.translation_withheld) out.translation_withheld = page.translation_withheld;
  return out;
}

async function applyPlan(db, planFile) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const bookId = plan.book_id;
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, tenantId: 1, title: 1 } });
  const Pages = db.collection('pages');
  const RUN = `${SWEEP}/${new Date().toISOString().slice(0, 19)}`;
  const live = await Pages.find({ book_id: bookId, page_number: { $gt: 0 } }, { projection: { id: 1 } }).toArray();
  const liveIds = new Set(live.map((p) => p.id));
  const planIds = new Set(plan.frames.map((f) => f.page_id));
  const resumed = plan.frames.filter((f) => !liveIds.has(f.page_id)).map((f) => f.page_id);
  const extra = [...liveIds].filter((id) => !planIds.has(id));
  // A resumed run: frames already archived by this sweep are fine; their leaves are the extra live pages.
  const resumedParents = resumed.length ? await Pages.find({ id: { $in: resumed }, book_id: bookId }).toArray() : [];
  const resumedLeafIds = new Set(resumedParents.flatMap((p) => p.split_into || []));
  const stray = extra.filter((id) => !resumedLeafIds.has(id));
  if (stray.length) throw new Error(`book has ${stray.length} live pages the plan does not know — re-plan`);
  if (resumedParents.some((p) => !p.split_into || p.page_number > 0)) throw new Error('a planned frame left the live pages without being split by this sweep — re-plan');
  const todo = plan.frames.map((f, k) => ({ f, k })).filter(({ f }) => isSplit(f));
  console.log(`[${bookId}] ${EXECUTE ? 'EXECUTE' : 'DRY'} ${RUN}: ${todo.length} frames to split (${resumedParents.length} already split), order ${plan.order.mode}`);
  if (!EXECUTE) { console.log(JSON.stringify(plan.summary)); return; }

  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'split-start', detail: { run: RUN, issue: ISSUE, plan: path.basename(planFile), summary: plan.summary, order: plan.order } });
  const r2 = r2Client();
  const put = async (key, buf) => {
    assertBookScopedKey(key, bookId, SWEEP);
    for (let t = 0; ; t++) {
      try { await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400, s-maxage=86400' })); return `${R2_PUBLIC}/${key}`; }
      catch (e) { if (t >= 4) throw e; await new Promise((z) => setTimeout(z, 3000 * (t + 1))); }
    }
  };
  const ok = new Set(); const failed = {}; const parents = []; let bytes = 0, newLeaves = 0;
  const byId = new Map(resumedParents.map((p) => [p.id, p]));
  await pool(todo, CONC, async ({ f, k }) => {
    if (byId.has(f.page_id)) { if ((byId.get(f.page_id).split_into || []).length === f.leaves.length) ok.add(k); else failed[f.pn] = 'resumed with another leaf count'; return; }
    const page = await Pages.findOne({ id: f.page_id, book_id: bookId });
    // A book this sweep already split was renumbered, so a frame it kept whole may sit at any live page number then.
    const moved = page && (byId.size ? page.page_number < 1 : page.page_number !== f.pn);
    const why = !page ? 'gone' : moved ? `page_number ${page.page_number}` : page.split_into ? 'already split'
      : (page.ocr?.data ? contentHash(page.ocr.data) : null) !== f.ocr_hash ? 'ocr changed since plan'
      : (servedTranslation(page) ? contentHash(page.translation.data) : null) !== f.tr_hash ? 'translation changed since plan' : null;
    if (why) { failed[f.pn] = why; return; }
    let buf;
    try { buf = await download(f.src); } catch (e) { failed[f.pn] = e.message; return; }
    const meta = await sharp(buf).metadata();
    if (meta.width !== f.W || meta.height !== f.H) { failed[f.pn] = `image ${meta.width}x${meta.height} ≠ plan`; return; }
    const now = new Date(); const children = [];
    try {
      for (let i = 0; i < f.leaves.length; i++) {
        const { left, top, width, height } = f.leaves[i];
        const id = new ObjectId().toHexString();
        const leafBuf = await sharp(buf).extract({ left, top, width, height }).jpeg({ quality: 92, progressive: true }).toBuffer();
        const disp = width > 2000 ? await sharp(leafBuf).resize({ width: 2000 }).jpeg({ quality: 88, progressive: true }).toBuffer() : leafBuf;
        const thumb = await sharp(leafBuf).resize({ width: 150 }).jpeg({ quality: 60 }).toBuffer();
        const full = await put(`cropped/${bookId}/${id}.jpg`, leafBuf);
        const display = await put(`pages/${bookId}/lf${id}.jpg`, await markDisplay(disp, { bookId, pageNumber: id }));
        const th = await put(`pages/${bookId}/lf${id}-thumb.jpg`, thumb);
        bytes += leafBuf.length + disp.length + thumb.length;
        const leafSplit = { from_page: page.id, from_page_number: f.pn, leaf: i, of: f.leaves.length, side: f.side, run: RUN, issue: ISSUE };
        const texts = f.carry ? leafTexts(page, i, f.leaves.length, leafSplit) : (page.translation_withheld ? { translation_withheld: page.translation_withheld } : {});
        children.push({
          _id: new ObjectId(id), id, book_id: bookId, ...(page.tenantId ? { tenantId: page.tenantId } : book.tenantId ? { tenantId: book.tenantId } : {}),
          page_number: 0, split_from_pecha: page.id, leaf_index: i, _orig_pn: f.pn,
          photo: display, display_photo: display, archived_photo: full, thumbnail: th, image_thumb: th,
          photo_original: page.photo_original || page.archived_photo || page.photo, // image-pick-ok: the parent is an unsplit frame (split_into checked above)
          image_width: width, image_height: height, page_type: page.page_type || 'text', ...(page.script_type ? { script_type: page.script_type } : {}),
          ...texts,
          field_provenance: { photo: { source: 'r2', method: f.status === 'accept' ? 'pecha-gaps+read-seams' : f.agy_boxes ? 'agy-boxes+paper-seam-snap' : 'pecha-gaps+agy-count', engine: f.status === 'accept' ? 'pecha-leaves.mjs' : `pecha-leaves.mjs + agy:${BBOX_MODEL}`, from_image: f.src, from_size: [f.W, f.H], iiif_max: f.iiif, crop: { left, top, width, height }, run: RUN, issue: ISSUE, date: now } },
          created_at: now, updated_at: now,
        });
      }
    } catch (e) { failed[f.pn] = `build: ${e.message.slice(0, 80)}`; return; }
    await Pages.insertMany(children);
    await Pages.updateOne({ id: page.id, page_number: page.page_number }, { $set: { page_number: -f.pn, split_into: children.map((c) => c.id), updated_at: now } });
    parents.push(page.id); ok.add(k); newLeaves += children.length;
  });
  if (parents.length) await withdrawPageVectors(parents, { reason: 'archived', writer: SWEEP });

  // Reading order over what actually split: a frame that failed falls back to itself, and its pair to photo order.
  const { units, pairs } = readingOrder(plan.frames, { usePairs: !plan.order.refusal, ok: (k) => ok.has(k) });
  const ids = plan.frames.map((f) => f.page_id);
  const parentDocs = await Pages.find({ id: { $in: ids }, book_id: bookId }, { projection: { id: 1, split_into: 1, page_number: 1 } }).toArray();
  const pmap = new Map(parentDocs.map((p) => [p.id, p]));
  const seq = units.map((u) => { const p = pmap.get(plan.frames[u.frame].page_id); return u.leaf == null ? p.id : p.split_into[u.leaf]; });
  if (new Set(seq).size !== seq.length || seq.some((x) => !x)) throw new Error('reading order holds a duplicate or missing page — not renumbering');
  const liveNow = await Pages.countDocuments({ book_id: bookId, $or: [{ page_number: { $gt: 0 } }, { split_from_pecha: { $exists: true }, page_number: 0 }] });
  if (liveNow !== seq.length) throw new Error(`book has ${liveNow} live pages, order has ${seq.length} — not renumbering`);
  await Pages.bulkWrite(seq.map((id, i) => ({ updateOne: { filter: { id, book_id: bookId }, update: { $set: { page_number: i + 1, updated_at: new Date() } } } })));
  const mode = plan.order.refusal ? plan.order.mode : (Object.keys(failed).length ? `pecha-pairs (${pairs.length} pairs; ${Object.keys(failed).length} frames kept whole)` : 'pecha-pairs');
  const exceptions = plan.frames.filter((f, k) => (f.status === 'unsplit' || f.status === 'agy') || (isSplit(f) && !ok.has(k))).length;
  await db.collection('books').updateOne({ id: bookId }, { $set: { split_completed: true, needs_splitting: false, split_geometry: 'pecha-vertical-multileaf', split_page_order: mode, updated_at: new Date() } });
  const rc = await recountBook(db, bookId, { reason: SWEEP });
  const result = { run: RUN, issue: ISSUE, frames_split: ok.size, leaves_new: newLeaves, failed, pairs: pairs.length, pages_after: seq.length, exceptions, r2_bytes: bytes, order: mode };
  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'split', detail: result });
  fs.writeFileSync(planFile.replace(/-plan\.json$/, '-applied.json'), JSON.stringify({ ...result, seq }, null, 1));
  console.log(`[${bookId}] applied: ${JSON.stringify(result)} recount pages_count=${rc?.after?.pages_count ?? '?'}`);
}

// ── REORDER ───────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * A book already split in PHOTO order (the 2026-11-13 pilot, split-pecha.mjs): read the side evidence from the archived
 * parent frames, apply the same gate and pair rule, and renumber the existing leaves. A frame takes part in a pair only
 * when the gap finder sees exactly as many leaves as the frame was split into (so gap leaf i is child leaf i).
 */
export function expandUnits(units, frames) {
  return units.flatMap((u) => (u.leaf == null ? frames[u.frame].children.map((_, i) => ({ frame: u.frame, leaf: i })) : [u]));
}

async function reorderBook(db, bookId) {
  const Pages = db.collection('pages');
  const parents = await Pages.find({ book_id: bookId, page_number: { $lt: 0 }, split_into: { $exists: true } }).sort({ page_number: -1 }).toArray();
  const leaves = await Pages.find({ book_id: bookId, page_number: { $gt: 0 } }, { projection: { id: 1, page_number: 1, split_from_pecha: 1, leaf_index: 1 } }).toArray();
  const leafById = new Map(leaves.map((p) => [p.id, p]));
  if (!parents.length) throw new Error('no split parents');
  if (leaves.some((p) => !p.split_from_pecha)) throw new Error('book holds live pages that are not pecha leaves — reorder by hand');
  if (parents.some((p) => p.split_into.some((id) => !leafById.has(id)))) throw new Error('a parent names a leaf that is not live');
  if (leaves.length !== parents.reduce((s, p) => s + p.split_into.length, 0)) throw new Error('leaf count differs from parents\' split_into');
  fs.mkdirSync(OUT, { recursive: true });
  const thumbs = [];
  const frames = await pool(parents, CONC, async (p) => {
    // image-pick-ok: the archived parent's whole frame is what the gap finder must read to match its leaves
    const src = p.archived_photo || p.photo;
    const children = [...p.split_into].sort((a, b) => leafById.get(a).leaf_index - leafById.get(b).leaf_index);
    const f = { page_id: p.id, pn: -p.page_number, src, children };
    try {
      const buf = await download(src);
      const r = await findLeaves(buf);
      Object.assign(f, { W: r.W, H: r.H, flags: r.flags, leaves: r.leaves.map(({ left, top, width, height }) => ({ left, top, width, height })), ink: [], onset: [] });
      for (const l of r.leaves) { f.ink.push((await rectoInk(buf, l)).ink); f.onset.push(await inkOnset(buf, l)); }
      const match = !r.flags.length && r.leaves.length === children.length && children.length > 1;
      Object.assign(f, match ? { status: 'accept', reason: 'gaps = split' } : { status: 'unsplit', reason: `gaps ${r.leaves.length}${r.flags.length ? ' ' + r.flags.join(',') : ''}, split ${children.length}` });
      thumbs.push({ pn: f.pn, thumb: await sharp(buf).resize({ width: 260 }).jpeg({ quality: 70 }).toBuffer() });
    } catch (e) { Object.assign(f, { status: 'unsplit', reason: `error: ${e.message.slice(0, 60)}`, leaves: [], flags: [], ink: [], onset: [] }); }
    return f;
  });
  const plan = orderPlan({ book_id: bookId, mode: 'reorder', made_at: new Date().toISOString(), frames });
  plan.units = expandUnits(plan.units, frames);
  const seq = plan.units.map((u) => frames[u.frame].children[u.leaf]);
  if (new Set(seq).size !== seq.length || seq.length !== leaves.length) throw new Error('order is not a permutation of the live leaves');
  const moved = seq.filter((id, i) => leafById.get(id).page_number !== i + 1).length;
  plan.summary = { frames: frames.length, match: frames.filter((f) => f.status === 'accept').length, leaves: seq.length, moved, order: plan.order.mode, pairs: plan.order.pairs };
  const file = path.join(OUT, `${bookId}-reorder.json`);
  fs.writeFileSync(file, JSON.stringify({ ...plan, seq }));
  await writeSheets(plan, thumbs);
  console.log(`[${bookId}] reorder ${EXECUTE ? 'EXECUTE' : 'DRY'}: ${JSON.stringify(plan.summary)}`);
  if (!EXECUTE) return;
  const before = leaves.slice().sort((a, b) => a.page_number - b.page_number).map((p) => p.id);
  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'reorder', detail: { issue: ISSUE, order: plan.order, moved, before } });
  await Pages.bulkWrite(seq.map((id, i) => ({ updateOne: { filter: { id, book_id: bookId, split_from_pecha: { $exists: true } }, update: { $set: { page_number: i + 1, updated_at: new Date() } } } })));
  await db.collection('books').updateOne({ id: bookId }, { $set: { split_page_order: plan.order.mode, updated_at: new Date() } });
  await recountBook(db, bookId, { reason: SWEEP });
  console.log(`[${bookId}] renumbered ${seq.length} leaves (${moved} moved)`);
}

// ── RECROP ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * A book already applied whose seams moved after the split (a snap fix, #355; a seam moved by hand): re-cut only the
 * leaves whose crop changed, from the same parent frame, under NEW book-scoped keys (<id>-rN), so no CDN copy of the old
 * crop is served. The leaf keeps its id, page number and text: a seam moving inside the gap or off a line does not change
 * which leaf the read's segment belongs to. Run it on the plan after `agy --plan=P --resnap` (or a hand edit).
 */
export const RECROP_TOL_PX = 3;
export function cropMoves(children, leaves, tol = RECROP_TOL_PX) {
  return children.map((c, i) => {
    const a = c.field_provenance?.photo?.crop, b = leaves[i];
    if (!a || !b) return { i, moved: false, why: 'no stored crop' };
    const moved = ['left', 'top', 'width', 'height'].some((k) => Math.abs(a[k] - b[k]) > tol) || Math.abs(a.top + a.height - b.top - b.height) > tol;
    return { i, moved, from: { left: a.left, top: a.top, width: a.width, height: a.height }, to: { left: b.left, top: b.top, width: b.width, height: b.height } };
  });
}

async function recropBook(db, planFile) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const bookId = plan.book_id;
  const Pages = db.collection('pages');
  const pns = arg('pages') ? new Set(arg('pages').split(',').map(Number)) : null;
  const frames = plan.frames.filter((f) => isSplit(f) && (!pns || pns.has(f.pn)));
  const RUN = `${SWEEP}-recrop/${new Date().toISOString().slice(0, 19)}`;
  const r2 = r2Client();
  const put = async (key, buf) => {
    assertBookScopedKey(key, bookId, SWEEP);
    for (let t = 0; ; t++) {
      try { await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400, s-maxage=86400' })); return `${R2_PUBLIC}/${key}`; }
      catch (e) { if (t >= 4) throw e; await new Promise((z) => setTimeout(z, 3000 * (t + 1))); }
    }
  };
  const done = [], skipped = {};
  for (const f of frames) {
    const parent = await Pages.findOne({ id: f.page_id, book_id: bookId }, { projection: { id: 1, split_into: 1, page_number: 1 } });
    if (!parent?.split_into) { if (pns) skipped[f.pn] = 'not split'; continue; }
    // A seam moved by hand was cut as the person set it; a resnap recomputes the leaves and would undo it.
    if (f.manual_seam && !pns) { skipped[f.pn] = 'manual seam (name it in --pages to recrop)'; continue; }
    const children = (await Pages.find({ id: { $in: parent.split_into }, book_id: bookId }).toArray()).sort((a, b) => a.leaf_index - b.leaf_index);
    if (children.length !== f.leaves.length) { skipped[f.pn] = `split into ${children.length}, plan has ${f.leaves.length}`; continue; }
    const moves = cropMoves(children, f.leaves).filter((m) => m.moved);
    if (!moves.length) continue;
    let buf;
    try { buf = await download(f.src); } catch (e) { skipped[f.pn] = e.message; continue; }
    const meta = await sharp(buf).metadata();
    if (meta.width !== f.W || meta.height !== f.H) { skipped[f.pn] = `image ${meta.width}x${meta.height} ≠ plan`; continue; }
    console.log(`  p${f.pn}: leaves ${moves.map((m) => `${m.i + 1} ${m.from.top}-${m.from.top + m.from.height} → ${m.to.top}-${m.to.top + m.to.height}`).join('; ')}`);
    if (!EXECUTE) { done.push({ pn: f.pn, leaves: moves.map((m) => m.i) }); continue; }
    for (const m of moves) {
      const c = children[m.i]; const { left, top, width, height } = m.to; const now = new Date();
      const prior = c.field_provenance?.photo?.recrops || [];
      const v = `r${prior.length + 1}`;
      const leafBuf = await sharp(buf).extract({ left, top, width, height }).jpeg({ quality: 92, progressive: true }).toBuffer();
      const disp = width > 2000 ? await sharp(leafBuf).resize({ width: 2000 }).jpeg({ quality: 88, progressive: true }).toBuffer() : leafBuf;
      const thumb = await sharp(leafBuf).resize({ width: 150 }).jpeg({ quality: 60 }).toBuffer();
      const full = await put(`cropped/${bookId}/${c.id}-${v}.jpg`, leafBuf);
      const display = await put(`pages/${bookId}/lf${c.id}-${v}.jpg`, await markDisplay(disp, { bookId, pageNumber: c.id }));
      const th = await put(`pages/${bookId}/lf${c.id}-${v}-thumb.jpg`, thumb);
      const recrop = { from: m.from, old: { photo: c.photo, archived_photo: c.archived_photo, thumbnail: c.thumbnail }, run: RUN, reason: arg('reason') || 'seam re-snapped', issue: ISSUE, date: now };
      const r = await Pages.updateOne({ id: c.id, book_id: bookId, split_from_pecha: parent.id, archived_photo: c.archived_photo }, { $set: {
        photo: display, display_photo: display, archived_photo: full, thumbnail: th, image_thumb: th, image_width: width, image_height: height,
        'field_provenance.photo.crop': m.to, 'field_provenance.photo.recrops': [...prior, recrop], updated_at: now } });
      if (!r.modifiedCount) throw new Error(`leaf ${c.id} changed under the recrop`);
    }
    done.push({ pn: f.pn, leaves: moves.map((m) => m.i) });
  }
  const result = { run: RUN, frames: done.length, leaves: done.reduce((s, d) => s + d.leaves.length, 0), done, skipped };
  if (EXECUTE && done.length) await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'recrop', detail: { ...result, issue: ISSUE, plan: path.basename(planFile) } });
  console.log(`[${bookId}] recrop ${EXECUTE ? 'EXECUTE' : 'DRY'}: ${result.frames} frames, ${result.leaves} leaves${Object.keys(skipped).length ? ` skipped ${JSON.stringify(skipped)}` : ''}`);
}

/**
 * A book split before the margin bridge (paperColumns): its leaf boxes can stop at the text block's border line and cut
 * off the folio label in the margin. For every split frame, the x extent is measured again, and the plan's leaves get
 * the LIVE crop's rows with the x extent only ever widened (min/max with the live crop), never narrowed; with agy boxes
 * it reaches no further than agy's box ±3% of the width. Then `recrop --pages=` the frames it lists. Writes the plan.
 */
export const WIDEN_AGY_PAD = 0.03;
// a side that widens by less than this is cloth beyond the paper's edge, not a cut-off margin: not worth a re-cut
export const WIDEN_MIN = 0.02;
export function widenX(live, measured, W, agyBoxes) {
  let L = Math.min(live.left, measured[0]), R = Math.max(live.left + live.width, measured[1]);
  if (agyBoxes?.length) {
    const ax0 = Math.min(...agyBoxes.map((b) => b[1])) * W / 1000 - WIDEN_AGY_PAD * W, ax1 = Math.max(...agyBoxes.map((b) => b[3])) * W / 1000 + WIDEN_AGY_PAD * W;
    L = Math.min(live.left, Math.max(L, Math.round(ax0))); R = Math.max(live.left + live.width, Math.min(R, Math.round(ax1)));
  }
  L = Math.max(0, L); R = Math.min(W, R);
  return { left: L, width: R - L };
}
async function widenBook(db, planFile) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const bookId = plan.book_id, Pages = db.collection('pages');
  const out = [], skipped = {}, shortOut = [];
  await pool(plan.frames.filter(isSplit), CONC, async (f) => {
    if (f.manual_seam) { skipped[f.pn] = 'manual seam'; return; }
    const parent = await Pages.findOne({ id: f.page_id, book_id: bookId }, { projection: { split_into: 1 } });
    // a frame not split yet (the book is not applied): the plan's own leaves are widened, and apply cuts them
    const children = parent?.split_into
      ? (await Pages.find({ id: { $in: parent.split_into }, book_id: bookId }, { projection: { id: 1, leaf_index: 1, 'field_provenance.photo.crop': 1 } }).toArray()).sort((a, b) => a.leaf_index - b.leaf_index)
      : f.leaves.map(({ left, top, width, height }) => ({ field_provenance: { photo: { crop: { left, top, width, height } } } }));
    if (children.length !== f.leaves.length || children.some((c) => !c.field_provenance?.photo?.crop)) { skipped[f.pn] = 'children ≠ plan leaves'; return; }
    let buf; try { buf = await download(f.src); } catch (e) { skipped[f.pn] = e.message; return; }
    const r = await findLeaves(buf);
    if (r.W !== f.W || r.H !== f.H) { skipped[f.pn] = 'image size ≠ plan'; return; }
    if (!r.leaves.length) return;
    // a frame split on gaps alone whose outer leaf now flags short: it may have lost its last lines; agy decides (repair)
    if (r.flags.includes('short-outer') && !f.agy_boxes) shortOut.push(f.pn);
    const measured = [r.leaves[0].left, r.leaves[0].left + r.leaves[0].width];
    let moved = false; const before = f.leaves;
    f.leaves = children.map((c, i) => {
      const live = c.field_provenance.photo.crop, x = widenX(live, measured, f.W, f.agy_boxes);
      if (live.left - x.left > WIDEN_MIN * f.W || x.left + x.width - live.left - live.width > WIDEN_MIN * f.W) moved = true;
      return { ...f.leaves[i], left: x.left, width: x.width, top: live.top, height: live.height };
    });
    if (!moved) f.leaves = before;
    if (moved) { f.widened = { date: new Date().toISOString(), issue: ISSUE }; out.push(f.pn); }
  });
  out.sort((a, b) => a - b); shortOut.sort((a, b) => a - b);
  if (out.length) fs.writeFileSync(planFile, JSON.stringify(plan));
  console.log(`[${bookId}] widen: ${out.length} frames${out.length ? ` --pages=${out.join(',')}` : ''}${shortOut.length ? ` short-outer=${shortOut.join(',')}` : ''}${Object.keys(skipped).length ? ` skipped ${JSON.stringify(skipped)}` : ''}`);
}

async function main() {
  if (!['plan', 'agy', 'apply', 'reorder', 'recrop', 'widen'].includes(CMD)) { console.error('usage: split-pecha-eap.mjs plan --book=ID | agy --plan=FILE | apply --plan=FILE [--execute] | reorder --book=ID [--execute] | recrop --plan=FILE [--pages=PN,..] [--execute] | widen --plan=FILE'); process.exit(1); }
  if (CMD === 'agy') return agyPlan(arg('plan'));
  const client = await MongoClient.connect(process.env.MONGODB_URI, { maxPoolSize: 8 });
  const db = client.db('bookstore');
  try {
    if (CMD === 'plan') for (const b of (arg('book') || '').split(',').filter(Boolean)) await planBook(db, b);
    else if (CMD === 'reorder') await reorderBook(db, arg('book'));
    else if (CMD === 'recrop') await recropBook(db, arg('plan'));
    else if (CMD === 'widen') await widenBook(db, arg('plan'));
    else await applyPlan(db, arg('plan'));
  } finally { await client.close(); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

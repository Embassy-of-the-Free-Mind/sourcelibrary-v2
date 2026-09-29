#!/usr/bin/env node
/**
 * Identify benchmark (#3193): measures "photo of an artwork -> the right library
 * image" retrieval quality. Regression-test this whenever /api/identify, the CLIP
 * index, or the gallery text embeddings change.
 *
 * Method: sample N indexed gallery images, distort each into a simulated "wall
 * photo" (downscale, rotate, wall-colored padding, JPEG q65), then rank the true
 * image against a pool of distractor images through each retrieval path:
 *   B      CLIP on illustration crops (what clip_embeddings holds after the
 *          --fix-gallery-crops re-embed)
 *   C1     Gemini describe -> text-embed query = title+author+desc+terms
 *   C2     query = catalog_description only (hallucinated titles poison C1)
 *   C3     confidence-gated: title/author included only when confidence=high
 *   C4     C3 described by gemini-3-flash-preview instead of flash-lite
 *   Rtext  Gemini visual rerank of C3 top-20 (photo vs candidate thumbnails)
 *   Rclip  Gemini visual rerank of B top-20
 *   Runion rerank of union(B top-10, C3 top-10)  <- the production design
 *
 * Query-side cropping variants (#4237 — the wall photos are built with KNOWN
 * padding geometry, which doubles as bbox ground truth):
 *   BboxAcc    IoU of the describe call's artwork_bbox against ground truth
 *   Bcrop      CLIP retrieval on the bbox crop of the wall photo
 *   RunionCrop rerank of union(Bcrop top-10, C3 top-10) — proposed production
 *   RcropPhoto Runion's candidate set, but the CROP as the query image
 *
 * Stronger-matcher variants (#3193 Phase 2) — `--matchers=name=url,...` points
 * at scripts/eval/identify-matcher-server.mjs instances (DINOv2-small, SigLIP2);
 * each server returns one or more embedding variants and every variant gets:
 *   M_<v>      retrieval on the wall photo (compare with B)
 *   Mcrop_<v>  retrieval on the bbox crop (compare with Bcrop)
 *   RunionCrop_<v>  rerank of union(Mcrop_<v> top-10, C3 top-10), for the
 *              variants named in --matcher-rerank=<v>,<v>
 *
 * Strata. `main` is the original design (one image per book, wall recipe) and is
 * the only stratum the top-level numbers describe. `--hard` adds the two failure
 * kinds the 2026-09-26/27 sample tests left over, which `main` cannot express:
 *   shear     the same main targets photographed with a 12% affine shear, dark
 *             wall, blur (the sample test's `skew` recipe)
 *   siblings  targets from books with many illustrations, with up to 60 of the
 *             book's OTHER illustrations added to the pool as distractors
 *   named     the three known misses by id (Aldrovandi serpents: sibling woodcuts;
 *             Musaeum metallicum + Rehe palace plans: shear), siblings included
 *
 * `--set=<results.json>` re-runs the pool and targets of an earlier run, so a
 * rerank-only pass or a re-measure compares like with like.
 *
 * Baseline 2026-07-18 (n=24, pool=400): B 17/24 top-1, C2 20/24,
 * Rtext 24/24, Runion 23/24. Full history in issue #3193 and EXPERIMENTS.md.
 *
 * Usage (macOS only — image distortion shells out to `sips`):
 *   node --env-file=.env.production.local scripts/eval/identify-bench.mjs \
 *     [--pool=400] [--targets=24] [--skip-rerank] [--hard] [--siblings=8] \
 *     [--matchers=dinov2=http://localhost:3461,siglip2=http://localhost:3462] \
 *     [--matcher-rerank=dinov2_gem,siglip2] [--set=<earlier results.json>]
 *
 * Cost: ~$0.02-0.10 in Gemini calls per plain run; --hard with matcher reranks
 * ~$0.5-1. Writes results + wall photos to scripts/output/identify-bench/
 * (gitignored).
 */

import { MongoClient } from 'mongodb';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const sharp = createRequire(import.meta.url)('sharp');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(REPO, 'scripts', 'output', 'identify-bench');
const IMG_DIR = path.join(DIR, 'wall-photos');
fs.mkdirSync(IMG_DIR, { recursive: true });

const CLIP = process.env.CLIP_URL || 'http://46.224.122.120:3456/clip';
const GK = process.env.GEMINI_API_KEY;
if (!GK || !process.env.MONGODB_URI) { console.error('missing GEMINI_API_KEY or MONGODB_URI'); process.exit(1); }

const arg = (name, dflt) => parseInt(process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || '') || dflt;
const POOL_SIZE = arg('pool', 400), N_TARGETS = arg('targets', 24);
const SKIP_RERANK = process.argv.includes('--skip-rerank');
const HARD = process.argv.includes('--hard');
const N_SIBLING_BOOKS = arg('siblings', 8);
const strArg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
const MATCHERS = strArg('matchers').split(',').filter(Boolean).map(s => { const [name, url] = s.split('='); return { name, url }; });
const MATCHER_RERANK = strArg('matcher-rerank').split(',').filter(Boolean);
const SET_FILE = strArg('set');
// Known misses from the 2026-09-26/27 sample tests (#3193).
const NAMED_HARD = ['69bd9eaef6d63c919747bf16-0', '6958e972813ea03889c33710-0', '6992f3fac8c6ac61574e7352-0'];
const SIBLING_CAP = 60;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function cos(a, b) { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na) * Math.sqrt(nb)); }

// Every request carries a timeout: a dropped connection otherwise hangs the run
// forever with the socket still ESTABLISHED (2026-09-28, a 1,200-image pool
// stalled 30+ min in one CLIP batch). A timeout is retried like any failure.
async function fetchJson(url, opts = {}, retries = 3, timeoutMs = 300000) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`${r.status} ${await r.text().then(t => t.slice(0, 150))}`);
      return await r.json();
    } catch (e) { if (i >= retries) throw e; await new Promise(r => setTimeout(r, 2500 * (i + 1))); }
  }
}
async function gemini(model, parts, retries = 3) {
  const d = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GK}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1 } }),
  }, retries);
  const txt = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const m = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((m?.[1] || txt).trim());
}
async function runPool(jobs, width) {
  const q = [...jobs];
  await Promise.all(Array.from({ length: width }, async () => { while (q.length) await q.shift()(); }));
}

// ---- 1. Sample ----
const mc = await MongoClient.connect(process.env.MONGODB_URI);
const gi = mc.db('bookstore').collection('gallery_images');
const PROJ = { id: 1, book_id: 1, book_title: 1, book_author: 1, extracted_url: 1, thumbnail_url: 1, description: 1, type: 1, gallery_quality: 1 };
const GOOD = { extracted_url: { $ne: null }, thumbnail_url: { $ne: null }, description: { $type: 'string', $ne: '' }, book_visible: true, gallery_quality: { $gte: 0.5 } };
const pool = [];
// Each target: the gallery doc plus { stratum, recipe, key }. `key` names the
// wall-photo files; main keeps the historical t<i> names.
let targets = [];
async function siblingsOf(bookId, exceptId) {
  return gi.aggregate([{ $match: { ...GOOD, book_id: bookId, id: { $ne: exceptId } } }, { $sample: { size: SIBLING_CAP } }, { $project: PROJ }]).toArray();
}
if (SET_FILE) {
  const prev = JSON.parse(fs.readFileSync(SET_FILE, 'utf8'));
  const docs = await gi.find({ id: { $in: prev.poolIds } }, { projection: PROJ }).toArray();
  const byId = new Map(docs.map(d => [d.id, d]));
  for (const id of prev.poolIds) if (byId.has(id)) pool.push(byId.get(id));
  const specs = prev.targetSpecs || prev.targetIds.map((id, i) => ({ id, stratum: 'main', recipe: 'wall', key: `t${i}` }));
  targets = specs.filter(s => byId.has(s.id)).map(s => ({ ...byId.get(s.id), stratum: s.stratum, recipe: s.recipe, key: s.key }));
  log(`--set ${path.basename(SET_FILE)}: pool ${pool.length}/${prev.poolIds.length}, targets ${targets.length}/${specs.length}`);
} else {
  const sample = await gi.aggregate([{ $match: GOOD }, { $sample: { size: 900 } }, { $project: PROJ }]).toArray();
  const seen = new Set();
  for (const g of sample) { if (seen.has(g.book_id)) continue; seen.add(g.book_id); pool.push(g); if (pool.length >= POOL_SIZE) break; }
  const hi = pool.filter(p => p.gallery_quality >= 0.8), lo = pool.filter(p => p.gallery_quality < 0.8);
  const main = [...hi.slice(0, N_TARGETS / 2), ...lo.slice(0, N_TARGETS / 2)];
  targets = main.map((g, i) => ({ ...g, stratum: 'main', recipe: 'wall', key: `t${i}` }));
  if (HARD) {
    targets.push(...main.map((g, i) => ({ ...g, stratum: 'shear', recipe: 'shear', key: `s${i}` })));
    // Sibling stratum: books with many illustrations, NOT already in the pool.
    const rich = await gi.aggregate([
      { $match: GOOD },
      { $group: { _id: '$book_id', n: { $sum: 1 } } },
      { $match: { n: { $gte: 6 } } },
      { $sample: { size: N_SIBLING_BOOKS * 3 } },
    ]).toArray();
    const sibBooks = rich.map(r => r._id).filter(b => !seen.has(b)).slice(0, N_SIBLING_BOOKS);
    for (const [j, bookId] of sibBooks.entries()) {
      const [t] = await gi.aggregate([{ $match: { ...GOOD, book_id: bookId } }, { $sample: { size: 1 } }, { $project: PROJ }]).toArray();
      if (!t) continue;
      pool.push(t, ...await siblingsOf(bookId, t.id));
      targets.push({ ...t, stratum: 'siblings', recipe: 'wall', key: `b${j}` });
    }
    for (const [j, id] of NAMED_HARD.entries()) {
      const t = await gi.findOne({ id }, { projection: PROJ });
      if (!t) { log(`named hard case ${id} not found`); continue; }
      if (pool.some(p => p.id === t.id)) continue;
      pool.push(t, ...await siblingsOf(t.book_id, t.id));
      targets.push({ ...t, stratum: 'named', recipe: j === 0 ? 'wall' : 'shear', key: `n${j}` });
    }
  }
}
await mc.close();
{ const ids = new Set(); for (let i = pool.length - 1; i >= 0; i--) { if (ids.has(pool[i].id)) pool.splice(i, 1); else ids.add(pool[i].id); } }
const STRATA = [...new Set(targets.map(t => t.stratum))];
log(`pool=${pool.length} targets=${targets.length} (${STRATA.map(s => `${s} ${targets.filter(t => t.stratum === s).length}`).join(', ')})`);

// ---- 2. Wall photos ----
// Cached by key, but targets are RE-SAMPLED each run — an id sidecar forces a
// rebuild when the cached photo belongs to a previous run's target (#4237).
// `shear` is the 2026-09-26 sample test's skew recipe (sharp affine; no bbox
// ground truth, so its IoU is not scored).
const DARK = '#4a4540';
for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  const clean = path.join(IMG_DIR, `${t.key}-clean.jpg`), wall = path.join(IMG_DIR, `${t.key}-wall.jpg`), meta = path.join(IMG_DIR, `${t.key}-meta.json`);
  const deg = 3 + (i % 4);
  const cachedId = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')).id : null;
  if (!fs.existsSync(wall) || cachedId !== String(t.id)) {
    fs.writeFileSync(clean, Buffer.from(await (await fetch(t.extracted_url, { signal: AbortSignal.timeout(60000) })).arrayBuffer()));
    if (t.recipe === 'shear') {
      await sharp(clean).resize(900).affine([[1, 0.12], [0.05, 0.94]], { background: DARK }).rotate(-2, { background: DARK })
        .extend({ top: 100, bottom: 100, left: 80, right: 80, background: DARK }).blur(0.7).modulate({ brightness: 0.88 }).jpeg({ quality: 58 }).toFile(wall);
    } else {
      execSync(`sips -Z 900 "${clean}" --out "${wall}" >/dev/null 2>&1 && sips -r ${deg} --padColor B0A898 "${wall}" >/dev/null 2>&1 && sips -p 1300 1050 --padColor A29988 "${wall}" >/dev/null 2>&1 && sips -s format jpeg -s formatOptions 65 "${wall}" >/dev/null 2>&1`, { shell: '/bin/zsh' });
    }
    fs.writeFileSync(meta, JSON.stringify({ id: String(t.id) }));
  }
  t.wallFile = wall;
  t.wallB64 = fs.readFileSync(wall).toString('base64');
  if (t.recipe !== 'wall') { const wm = await sharp(wall).metadata(); t.wallW = wm.width; t.wallH = wm.height; t.gtBbox = null; continue; }

  // Ground-truth artwork bbox in the wall canvas: the clean image is downscaled
  // to max-side 900, rotated by `deg`, then center-padded — all deterministic,
  // so the rotated rect's bounds ARE the truth (#4237). Canvas dims are
  // MEASURED from the file, never assumed: `sips -p` is <height> <width>, and
  // hardcoding them transposed produced out-of-bounds crops on the first run.
  const wm = await sharp(wall).metadata();
  t.wallW = wm.width; t.wallH = wm.height;
  const cm = await sharp(clean).metadata();
  const s = Math.min(1, 900 / Math.max(cm.width, cm.height));
  const w0 = Math.round(cm.width * s), h0 = Math.round(cm.height * s);
  const th = (deg * Math.PI) / 180;
  const w1 = w0 * Math.cos(th) + h0 * Math.sin(th);
  const h1 = w0 * Math.sin(th) + h0 * Math.cos(th);
  t.gtBbox = { x: (t.wallW - w1) / 2, y: (t.wallH - h1) / 2, w: w1, h: h1 };
}
log('wall photos ready');

// ---- 3. CLIP pool + queries (for B and Rclip/Runion) ----
const poolClip = new Map();
for (let i = 0; i < pool.length; i += 25) {
  const batch = pool.slice(i, i + 25);
  const resp = await fetchJson(`${CLIP}/embed-images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: batch.map(b => b.extracted_url) }) });
  resp.results.forEach((r, j) => { if (r.embedding) poolClip.set(batch[j].id, r.embedding); });
}
log(`clip pool: ${poolClip.size}`);
for (const t of targets) {
  const r = await fetchJson(`${CLIP}/embed-image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: t.wallB64, mime_type: 'image/jpeg' }) });
  t.wallClip = r.embedding;
}
log('clip queries done');

function rankList(queryEmb, embMap) {
  const scored = [];
  for (const [id, emb] of embMap) scored.push([id, cos(queryEmb, emb)]);
  scored.sort((x, y) => y[1] - x[1]);
  return scored;
}
for (const t of targets) {
  t.clipRanked = rankList(t.wallClip, poolClip);
  t.B = t.clipRanked.findIndex(s => s[0] === t.id) + 1 || null;
}

// ---- 4. Describe with both models ----
const DP = `You are an art historian identifying a photographed print, engraving, or book illustration. Return JSON only:
{
 "title": "best guess at the title of this specific work OR the book it appears in; null if not reasonably sure",
 "author": "best guess at artist/author; null if not reasonably sure",
 "confidence": "high | medium | low — high ONLY if you recognize this specific work or can read text that names it",
 "visible_text": "transcription of any legible text/captions/inscriptions in the image, null if none",
 "catalog_description": "one-to-three sentence museum-catalog description of what is depicted: scene, figures, objects, style, technique",
 "search_terms": ["3-5 search terms"],
 "artwork_bbox": "[ymin, xmin, ymax, xmax] — bounding box of the artwork/illustration ITSELF within the photograph, in normalized 0-1000 coordinates, excluding wall, frame, mat, and background padding; null if the artwork fills nearly the whole photo"
}`;
await runPool(targets.map((t, i) => async () => {
  try { t.lite = await gemini('gemini-3.1-flash-lite', [{ text: DP }, { inline_data: { mime_type: 'image/jpeg', data: t.wallB64 } }]); } catch (e) { t.lite = null; log(`lite ${i} FAIL ${e.message.slice(0, 80)}`); }
  try { t.flash = await gemini('gemini-3-flash-preview', [{ text: DP }, { inline_data: { mime_type: 'image/jpeg', data: t.wallB64 } }]); } catch (e) { t.flash = null; log(`flash ${i} FAIL ${e.message.slice(0, 80)}`); }
  log(`describe ${i}: lite=${t.lite?.confidence} "${(t.lite?.title || '').slice(0, 35)}" | flash=${t.flash?.confidence} "${(t.flash?.title || '').slice(0, 35)}"`);
}), 4);

// ---- 4b. Bbox accuracy + query-side crops (#4237) ----
function parseBbox(raw) {
  // Model may return the array directly or as a string like "[y,x,y,x]".
  let a = raw;
  if (typeof a === 'string') { try { a = JSON.parse(a.replace(/[^\d,.[\]-]/g, '')); } catch { return null; } }
  if (!Array.isArray(a) || a.length !== 4 || a.some(v => typeof v !== 'number' || !isFinite(v))) return null;
  const [ymin, xmin, ymax, xmax] = a;
  if (!(ymax > ymin && xmax > xmin) || ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) return null;
  return { ymin, xmin, ymax, xmax };
}
function bboxToPixels(b, W, H) {
  return { x: (b.xmin / 1000) * W, y: (b.ymin / 1000) * H, w: ((b.xmax - b.xmin) / 1000) * W, h: ((b.ymax - b.ymin) / 1000) * H };
}
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}
for (const t of targets) {
  for (const src of ['lite', 'flash']) {
    const b = parseBbox(t[src]?.artwork_bbox);
    t[src + 'Iou'] = b && t.gtBbox ? +iou(bboxToPixels(b, t.wallW, t.wallH), t.gtBbox).toFixed(3) : null;
  }
}
// Crop the wall photo by the LITE bbox (production uses the identification
// call, which is flash-lite). Guards mirror the proposed route change: 4%
// margin, clamp, reject boxes covering <8% or >95% of the frame. Fallback on
// any failure is the uncropped photo, so Bcrop degrades to B rather than dying.
for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  const b = parseBbox(t.lite?.artwork_bbox);
  t.cropUsed = false;
  t.cropB64 = t.wallB64;
  if (b) {
    const p = bboxToPixels(b, t.wallW, t.wallH);
    const mx = p.w * 0.04, my = p.h * 0.04;
    const left = Math.max(0, Math.round(p.x - mx)), top = Math.max(0, Math.round(p.y - my));
    const width = Math.min(t.wallW - left, Math.round(p.w + 2 * mx)), height = Math.min(t.wallH - top, Math.round(p.h + 2 * my));
    const frac = (width * height) / (t.wallW * t.wallH);
    if (frac >= 0.08 && frac <= 0.95 && width > 40 && height > 40) {
      try {
        const buf = await sharp(t.wallFile).extract({ left, top, width, height }).jpeg({ quality: 85 }).toBuffer();
        fs.writeFileSync(path.join(IMG_DIR, `${t.key}-crop.jpg`), buf);
        t.cropB64 = buf.toString('base64');
        t.cropUsed = true;
      } catch (e) { log(`crop ${i} FAIL ${e.message.slice(0, 60)}`); }
    }
  }
}
for (const t of targets) {
  const r = await fetchJson(`${CLIP}/embed-image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: t.cropB64, mime_type: 'image/jpeg' }) });
  t.cropClip = r.embedding;
  t.cropRanked = rankList(t.cropClip, poolClip);
  t.Bcrop = t.cropRanked.findIndex(s => s[0] === t.id) + 1 || null;
}
log(`crops ready (used=${targets.filter(t => t.cropUsed).length}/${targets.length})`);

// ---- 4c. Stronger-matcher variants (#3193 Phase 2) ----
// Same pool, same wall photos, same crops as B/Bcrop — only the model differs.
// Servers run concurrently (one per model); each is sequential inside.
const matcherPools = new Map(); // variant -> Map(id -> emb)
const matcherHealth = {};
await Promise.all(MATCHERS.map(async m => {
  const post = (route, body) => fetchJson(`${m.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t0 = Date.now();
  for (let i = 0; i < pool.length; i += 25) {
    const batch = pool.slice(i, i + 25);
    const resp = await post('/embed-images', { urls: batch.map(b => b.extracted_url) });
    resp.results.forEach((r, j) => {
      for (const [v, emb] of Object.entries(r.embeddings || {})) {
        if (!matcherPools.has(v)) matcherPools.set(v, new Map());
        matcherPools.get(v).set(batch[j].id, emb);
      }
    });
    if (i % 200 === 0) log(`${m.name} pool ${i + batch.length}/${pool.length}`);
  }
  for (const t of targets) {
    t.mWall = { ...t.mWall, ...(await post('/embed-image', { base64: t.wallB64, mime_type: 'image/jpeg' })).embeddings };
    t.mCrop = { ...t.mCrop, ...(await post('/embed-image', { base64: t.cropB64, mime_type: 'image/jpeg' })).embeddings };
  }
  matcherHealth[m.name] = { ...(await fetchJson(`${m.url}/health`)), wall_seconds: Math.round((Date.now() - t0) / 1000) };
  log(`${m.name} done: ${JSON.stringify(matcherHealth[m.name])}`);
}));
const VARIANTS = [...matcherPools.keys()];
// Rank every model over the SAME candidate set: drop pool images any model
// failed to embed, and recompute B/Bcrop over what is left.
if (VARIANTS.length) {
  const missing = [...poolClip.keys()].filter(id => VARIANTS.some(v => !matcherPools.get(v).has(id)));
  for (const id of missing) poolClip.delete(id);
  for (const v of VARIANTS) for (const id of matcherPools.get(v).keys()) if (!poolClip.has(id)) matcherPools.get(v).delete(id);
  if (missing.length) log(`dropped ${missing.length} pool images not embedded by every model`);
  for (const t of targets) {
    t.clipRanked = rankList(t.wallClip, poolClip); t.B = t.clipRanked.findIndex(s => s[0] === t.id) + 1 || null;
    t.cropRanked = rankList(t.cropClip, poolClip); t.Bcrop = t.cropRanked.findIndex(s => s[0] === t.id) + 1 || null;
  }
}
for (const t of targets) {
  t.M = {}; t.Mcrop = {}; t.mCropRanked = {};
  for (const v of VARIANTS) {
    const poolV = matcherPools.get(v);
    t.M[v] = rankList(t.mWall[v], poolV).findIndex(s => s[0] === t.id) + 1 || null;
    t.mCropRanked[v] = rankList(t.mCrop[v], poolV);
    t.Mcrop[v] = t.mCropRanked[v].findIndex(s => s[0] === t.id) + 1 || null;
  }
  delete t.mWall; delete t.mCrop;
}
if (VARIANTS.length) log(`matcher variants ranked: ${VARIANTS.join(', ')} (pool coverage ${VARIANTS.map(v => matcherPools.get(v).size).join('/')} of ${pool.length})`);

// ---- 5. Text embeddings ----
async function embedTexts(texts, taskType) {
  const out = [];
  for (let i = 0; i < texts.length; i += 90) {
    const chunk = texts.slice(i, i + 90);
    const d = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${GK}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: chunk.map(text => ({ model: 'models/gemini-embedding-001', content: { parts: [{ text: text || ' ' }] }, taskType, outputDimensionality: 768 })) }),
    });
    out.push(...d.embeddings.map(e => e.values));
  }
  return out;
}
const poolTextEmb = await embedTexts(pool.map(p => `${p.description}${p.type ? '. Type: ' + p.type : ''}`), 'RETRIEVAL_DOCUMENT');
const poolText = new Map(pool.map((p, i) => [p.id, poolTextEmb[i]]));
log('pool text embedded');

const qBuilders = {
  C1: g => g ? [g.title, g.author, g.catalog_description, ...(g.search_terms || [])].filter(Boolean).join('. ') : '',
  C2: g => g?.catalog_description || '',
  C3: g => g ? (g.confidence === 'high'
    ? [g.title, g.author, g.catalog_description, ...(g.search_terms || [])].filter(Boolean).join('. ')
    : [g.catalog_description, ...(g.search_terms || [])].filter(Boolean).join('. ')) : '',
};
const variants = [['C1', 'lite', 'C1'], ['C2', 'lite', 'C2'], ['C3', 'lite', 'C3'], ['C4', 'flash', 'C3']];
for (const [name, src, builder] of variants) {
  const queries = targets.map(t => qBuilders[builder](t[src]));
  const qEmb = await embedTexts(queries, 'RETRIEVAL_QUERY');
  targets.forEach((t, i) => {
    const ranked = rankList(qEmb[i], poolText);
    t[name] = ranked.findIndex(s => s[0] === t.id) + 1 || null;
    if (name === 'C3') t.c3Ranked = ranked;
  });
  log(`${name} done`);
}

// ---- 6. Visual rerank ----
const thumbCache = new Map();
async function thumbB64(p) {
  if (thumbCache.has(p.id)) return thumbCache.get(p.id);
  try {
    const buf = Buffer.from(await (await fetch(p.thumbnail_url, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
    const v = buf.toString('base64');
    thumbCache.set(p.id, v);
    return v;
  } catch { thumbCache.set(p.id, null); return null; }
}
const poolById = new Map(pool.map(p => [p.id, p]));
async function rerank(t, candidateIds, label, queryB64 = t.wallB64) {
  const cands = candidateIds.map(id => poolById.get(id)).filter(Boolean);
  const parts = [{ text: `The FIRST image is a visitor's photograph of an artwork or book illustration. The following ${cands.length} numbered images are candidate matches from a library catalog. Identify which candidate shows THE SAME work (same plate/engraving/illustration, allowing for photo distortion, framing, and print-state differences). Return JSON only: {"best": <candidate number 1-${cands.length}, or null if none is the same work>, "sure": true|false}` },
  { inline_data: { mime_type: 'image/jpeg', data: queryB64 } }];
  const kept = [];
  for (const c of cands) {
    const b = await thumbB64(c);
    if (!b) continue;
    kept.push(c);
    parts.push({ text: `Candidate ${kept.length}:` }, { inline_data: { mime_type: 'image/jpeg', data: b } });
  }
  try {
    const r = await gemini('gemini-3-flash-preview', parts);
    const pick = r.best != null ? kept[r.best - 1] : null;
    return { hit: pick?.id === t.id, picked: pick?.id || null, sure: !!r.sure, inSet: kept.some(c => c.id === t.id) };
  } catch (e) { return { hit: false, picked: null, err: e.message.slice(0, 80), inSet: kept.some(c => c.id === t.id) }; }
}
const NO_RERANK = { hit: false, inSet: false, skipped: true };
const top10 = ranked => ranked.slice(0, 10).map(s => s[0]);
for (const t of targets) { for (const k of ['Rclip', 'Rtext', 'Runion', 'RunionCrop', 'RcropPhoto']) t[k] = NO_RERANK; t.RunionCropM = {}; }
if (!SKIP_RERANK) {
  // The legacy five reranks run on `main` only when no matcher is under test
  // (they are the 2026-07 design comparison). A matcher run reranks every
  // stratum with RunionCrop — the production shape — plus one union per
  // --matcher-rerank variant, so the only difference is the retrieval model.
  const legacy = !MATCHERS.length;
  await runPool(targets.map((t, i) => async () => {
    const unionCrop = [...new Set([...top10(t.cropRanked), ...top10(t.c3Ranked)])];
    if (legacy && t.stratum === 'main') {
      const union = [...new Set([...top10(t.clipRanked), ...top10(t.c3Ranked)])];
      t.Rclip = await rerank(t, t.clipRanked.slice(0, 20).map(s => s[0]), 'Rclip');
      t.Rtext = await rerank(t, t.c3Ranked.slice(0, 20).map(s => s[0]), 'Rtext');
      t.Runion = await rerank(t, union, 'Runion');
      t.RcropPhoto = await rerank(t, union, 'RcropPhoto', t.cropB64);
    }
    t.RunionCrop = await rerank(t, unionCrop, 'RunionCrop');
    for (const v of MATCHER_RERANK) {
      if (!t.mCropRanked[v]) continue;
      t.RunionCropM[v] = await rerank(t, [...new Set([...top10(t.mCropRanked[v]), ...top10(t.c3Ranked)])], `RunionCrop_${v}`);
    }
    log(`rerank ${i} [${t.stratum}]: unionCrop=${t.RunionCrop.hit}${MATCHER_RERANK.map(v => ` ${v}=${t.RunionCropM[v]?.hit}`).join('')}${legacy && t.stratum === 'main' ? ` clip=${t.Rclip.hit} text=${t.Rtext.hit} union=${t.Runion.hit} cropPhoto=${t.RcropPhoto.hit}` : ''}`);
  }), 3);
}

// ---- 7. Report ----
function stats(ranks) {
  const valid = ranks.filter(r => r != null);
  return { top1: valid.filter(r => r === 1).length, top5: valid.filter(r => r <= 5).length, top20: valid.filter(r => r <= 20).length, mrr: +(ranks.reduce((s, r) => s + (r ? 1 / r : 0), 0) / ranks.length).toFixed(3) };
}
// Top-level numbers describe `main` only, so they stay comparable with every
// earlier run; the hard strata are reported under `strata`.
const mainT = targets.filter(t => t.stratum === 'main');
const meanIou = src => {
  const vals = mainT.map(t => t[src + 'Iou']).filter(v => v != null);
  return { returned: vals.length, mean: vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(3) : null, ge05: vals.filter(v => v >= 0.5).length };
};
const hits = (ts, k) => ts.filter(t => t[k].hit).length;
function stratumReport(ts) {
  const r = {
    n: ts.length,
    B_clip: stats(ts.map(t => t.B)),
    Bcrop_clip: stats(ts.map(t => t.Bcrop)),
    C3_text: stats(ts.map(t => t.C3)),
  };
  for (const v of VARIANTS) {
    r[`M_${v}`] = stats(ts.map(t => t.M[v]));
    r[`Mcrop_${v}`] = stats(ts.map(t => t.Mcrop[v]));
  }
  if (!SKIP_RERANK) {
    r.RunionCrop = { top1: hits(ts, 'RunionCrop'), recall: ts.filter(t => t.RunionCrop.inSet).length, sure: ts.filter(t => t.RunionCrop.hit && t.RunionCrop.sure).length };
    for (const v of MATCHER_RERANK) {
      const rs = ts.map(t => t.RunionCropM[v]).filter(Boolean);
      r[`RunionCrop_${v}`] = { top1: rs.filter(x => x.hit).length, recall: rs.filter(x => x.inSet).length, sure: rs.filter(x => x.hit && x.sure).length };
    }
  }
  return r;
}
const report = {
  poolSize: poolClip.size,
  matchers: matcherHealth,
  BboxAcc_lite: meanIou('lite'),
  BboxAcc_flash: meanIou('flash'),
  crops_used: mainT.filter(t => t.cropUsed).length,
  B_clip_crop: stats(mainT.map(t => t.B)),
  Bcrop_clip_on_crop: stats(mainT.map(t => t.Bcrop)),
  C1_baseline_concat: stats(mainT.map(t => t.C1)),
  C2_desc_only: stats(mainT.map(t => t.C2)),
  C3_confidence_gated: stats(mainT.map(t => t.C3)),
  C4_flash_model: stats(mainT.map(t => t.C4)),
  Rclip_rerank_top1: hits(mainT, 'Rclip'),
  Rtext_rerank_top1: hits(mainT, 'Rtext'),
  Runion_rerank_top1: hits(mainT, 'Runion'),
  Runion_candidate_recall: mainT.filter(t => t.Runion.inSet).length,
  RunionCrop_rerank_top1: hits(mainT, 'RunionCrop'),
  RunionCrop_candidate_recall: mainT.filter(t => t.RunionCrop.inSet).length,
  RunionCrop_sure: mainT.filter(t => t.RunionCrop.hit && t.RunionCrop.sure).length,
  Runion_sure: mainT.filter(t => t.Runion.hit && t.Runion.sure).length,
  RcropPhoto_rerank_top1: hits(mainT, 'RcropPhoto'),
  strata: Object.fromEntries(STRATA.map(s => [s, stratumReport(targets.filter(t => t.stratum === s))])),
  perTarget: targets.map((t, i) => ({
    i, key: t.key, stratum: t.stratum, recipe: t.recipe, id: t.id,
    q: t.gallery_quality, book: (t.book_title || '').slice(0, 40), desc: (t.description || '').slice(0, 50),
    B: t.B, Bcrop: t.Bcrop, M: t.M, Mcrop: t.Mcrop, liteIou: t.liteIou, flashIou: t.flashIou, cropUsed: t.cropUsed,
    C1: t.C1, C2: t.C2, C3: t.C3, C4: t.C4,
    Rclip: t.Rclip.hit, Rtext: t.Rtext.hit, Runion: t.Runion.hit, unionHadIt: t.Runion.inSet,
    RunionCrop: t.RunionCrop.hit, RunionCropHadIt: t.RunionCrop.inSet,
    RunionCropM: Object.fromEntries(Object.entries(t.RunionCropM).map(([v, r]) => [v, { hit: r.hit, inSet: r.inSet, sure: r.sure }])),
    RcropPhoto: t.RcropPhoto.hit,
    lite_conf: t.lite?.confidence, lite_title: t.lite?.title?.slice(0, 40), flash_conf: t.flash?.confidence, flash_title: t.flash?.title?.slice(0, 40),
    visible_text: (t.lite?.visible_text || '').slice(0, 60),
  })),
};
report.poolIds = pool.map(p => p.id);
report.targetIds = mainT.map(t => t.id);
report.targetSpecs = targets.map(t => ({ id: t.id, stratum: t.stratum, recipe: t.recipe, key: t.key }));
const outFile = path.join(DIR, `results-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`\nresults -> ${outFile}`);
console.log('==== SUMMARY main (n=' + mainT.length + ', pool=' + poolClip.size + ') ====');
for (const k of ['B_clip_crop', 'Bcrop_clip_on_crop', 'C1_baseline_concat', 'C2_desc_only', 'C3_confidence_gated', 'C4_flash_model']) {
  const s = report[k];
  console.log(`${k}: top1=${s.top1} top5=${s.top5} top20=${s.top20} mrr=${s.mrr}`);
}
console.log(`BboxAcc: lite mean IoU=${report.BboxAcc_lite.mean} (>=0.5: ${report.BboxAcc_lite.ge05}/${report.BboxAcc_lite.returned} returned) | flash mean IoU=${report.BboxAcc_flash.mean} (>=0.5: ${report.BboxAcc_flash.ge05}/${report.BboxAcc_flash.returned}) | crops used ${report.crops_used}/${mainT.length}`);
if (!SKIP_RERANK && !MATCHERS.length) {
  const n = mainT.length;
  console.log(`Rerank top-1 accuracy: Rclip=${report.Rclip_rerank_top1}/${n} Rtext=${report.Rtext_rerank_top1}/${n} Runion=${report.Runion_rerank_top1}/${n} (union recall ${report.Runion_candidate_recall}/${n})`);
  console.log(`Crop variants: RunionCrop=${report.RunionCrop_rerank_top1}/${n} (recall ${report.RunionCrop_candidate_recall}, sure ${report.RunionCrop_sure} vs Runion sure ${report.Runion_sure}) | RcropPhoto=${report.RcropPhoto_rerank_top1}/${n}`);
}
if (VARIANTS.length || HARD || SET_FILE) {
  console.log('==== STRATA (top1/top5 of n) ====');
  for (const [s, r] of Object.entries(report.strata)) {
    const cells = Object.entries(r).filter(([k]) => k !== 'n').map(([k, v]) => `${k} ${v.top1}${v.top5 != null ? '/' + v.top5 : ` (recall ${v.recall})`}`);
    console.log(`${s} n=${r.n}: ${cells.join(' | ')}`);
  }
}

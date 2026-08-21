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
 * Baseline 2026-07-18 (n=24, pool=400): B 17/24 top-1, C2 20/24,
 * Rtext 24/24, Runion 23/24. Full history in issue #3193.
 *
 * Usage (macOS only — image distortion shells out to `sips`):
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/eval/identify-bench.mjs [--pool=400] [--targets=24] [--skip-rerank]
 *
 * Cost: ~$0.02-0.10 in Gemini calls per run. Writes results + wall photos to
 * scripts/output/identify-bench/ (gitignored).
 */

import { MongoClient } from 'mongodb';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function cos(a, b) { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na) * Math.sqrt(nb)); }

async function fetchJson(url, opts = {}, retries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, opts);
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
const sample = await gi.aggregate([
  { $match: { extracted_url: { $ne: null }, thumbnail_url: { $ne: null }, description: { $type: 'string', $ne: '' }, book_visible: true, gallery_quality: { $gte: 0.5 } } },
  { $sample: { size: 900 } },
  { $project: { id: 1, book_id: 1, book_title: 1, book_author: 1, extracted_url: 1, thumbnail_url: 1, description: 1, type: 1, gallery_quality: 1 } },
]).toArray();
await mc.close();
const seen = new Set(); const pool = [];
for (const g of sample) { if (seen.has(g.book_id)) continue; seen.add(g.book_id); pool.push(g); if (pool.length >= POOL_SIZE) break; }
const hi = pool.filter(p => p.gallery_quality >= 0.8), lo = pool.filter(p => p.gallery_quality < 0.8);
const targets = [...hi.slice(0, N_TARGETS / 2), ...lo.slice(0, N_TARGETS / 2)];
log(`pool=${pool.length} targets=${targets.length}`);

// ---- 2. Wall photos ----
for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  const clean = path.join(IMG_DIR, `t${i}-clean.jpg`), wall = path.join(IMG_DIR, `t${i}-wall.jpg`);
  if (!fs.existsSync(wall)) {
    fs.writeFileSync(clean, Buffer.from(await (await fetch(t.extracted_url)).arrayBuffer()));
    const deg = 3 + (i % 4);
    execSync(`sips -Z 900 "${clean}" --out "${wall}" >/dev/null 2>&1 && sips -r ${deg} --padColor B0A898 "${wall}" >/dev/null 2>&1 && sips -p 1300 1050 --padColor A29988 "${wall}" >/dev/null 2>&1 && sips -s format jpeg -s formatOptions 65 "${wall}" >/dev/null 2>&1`, { shell: '/bin/zsh' });
  }
  t.wallFile = wall;
  t.wallB64 = fs.readFileSync(wall).toString('base64');
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
 "search_terms": ["3-5 search terms"]
}`;
await runPool(targets.map((t, i) => async () => {
  try { t.lite = await gemini('gemini-3.1-flash-lite', [{ text: DP }, { inline_data: { mime_type: 'image/jpeg', data: t.wallB64 } }]); } catch (e) { t.lite = null; log(`lite ${i} FAIL ${e.message.slice(0, 80)}`); }
  try { t.flash = await gemini('gemini-3-flash-preview', [{ text: DP }, { inline_data: { mime_type: 'image/jpeg', data: t.wallB64 } }]); } catch (e) { t.flash = null; log(`flash ${i} FAIL ${e.message.slice(0, 80)}`); }
  log(`describe ${i}: lite=${t.lite?.confidence} "${(t.lite?.title || '').slice(0, 35)}" | flash=${t.flash?.confidence} "${(t.flash?.title || '').slice(0, 35)}"`);
}), 4);

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
    const buf = Buffer.from(await (await fetch(p.thumbnail_url)).arrayBuffer());
    const v = buf.toString('base64');
    thumbCache.set(p.id, v);
    return v;
  } catch { thumbCache.set(p.id, null); return null; }
}
const poolById = new Map(pool.map(p => [p.id, p]));
async function rerank(t, candidateIds, label) {
  const cands = candidateIds.map(id => poolById.get(id)).filter(Boolean);
  const parts = [{ text: `The FIRST image is a visitor's photograph of an artwork or book illustration. The following ${cands.length} numbered images are candidate matches from a library catalog. Identify which candidate shows THE SAME work (same plate/engraving/illustration, allowing for photo distortion, framing, and print-state differences). Return JSON only: {"best": <candidate number 1-${cands.length}, or null if none is the same work>, "sure": true|false}` },
  { inline_data: { mime_type: 'image/jpeg', data: t.wallB64 } }];
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
if (SKIP_RERANK) {
  for (const t of targets) { t.Rclip = { hit: false, inSet: false }; t.Rtext = { hit: false, inSet: false }; t.Runion = { hit: false, inSet: false }; }
} else {
  await runPool(targets.map((t, i) => async () => {
    const clipTop = t.clipRanked.slice(0, 20).map(s => s[0]);
    const textTop = t.c3Ranked.slice(0, 20).map(s => s[0]);
    const union = [...new Set([...t.clipRanked.slice(0, 10).map(s => s[0]), ...t.c3Ranked.slice(0, 10).map(s => s[0])])];
    t.Rclip = await rerank(t, clipTop, 'Rclip');
    t.Rtext = await rerank(t, textTop, 'Rtext');
    t.Runion = await rerank(t, union, 'Runion');
    log(`rerank ${i}: clip=${t.Rclip.hit} text=${t.Rtext.hit} union=${t.Runion.hit} (inSet: ${t.Rclip.inSet}/${t.Rtext.inSet}/${t.Runion.inSet})`);
  }), 3);
}

// ---- 7. Report ----
function stats(ranks) {
  const valid = ranks.filter(r => r != null);
  return { top1: valid.filter(r => r === 1).length, top5: valid.filter(r => r <= 5).length, top20: valid.filter(r => r <= 20).length, mrr: +(ranks.reduce((s, r) => s + (r ? 1 / r : 0), 0) / ranks.length).toFixed(3) };
}
const report = {
  poolSize: poolClip.size,
  B_clip_crop: stats(targets.map(t => t.B)),
  C1_baseline_concat: stats(targets.map(t => t.C1)),
  C2_desc_only: stats(targets.map(t => t.C2)),
  C3_confidence_gated: stats(targets.map(t => t.C3)),
  C4_flash_model: stats(targets.map(t => t.C4)),
  Rclip_rerank_top1: targets.filter(t => t.Rclip.hit).length,
  Rtext_rerank_top1: targets.filter(t => t.Rtext.hit).length,
  Runion_rerank_top1: targets.filter(t => t.Runion.hit).length,
  Runion_candidate_recall: targets.filter(t => t.Runion.inSet).length,
  perTarget: targets.map((t, i) => ({
    i, q: t.gallery_quality, book: (t.book_title || '').slice(0, 40), desc: (t.description || '').slice(0, 50),
    B: t.B, C1: t.C1, C2: t.C2, C3: t.C3, C4: t.C4,
    Rclip: t.Rclip.hit, Rtext: t.Rtext.hit, Runion: t.Runion.hit, unionHadIt: t.Runion.inSet,
    lite_conf: t.lite?.confidence, lite_title: t.lite?.title?.slice(0, 40), flash_conf: t.flash?.confidence, flash_title: t.flash?.title?.slice(0, 40),
    visible_text: (t.lite?.visible_text || '').slice(0, 60),
  })),
};
report.poolIds = pool.map(p => p.id);
report.targetIds = targets.map(t => t.id);
const outFile = path.join(DIR, `results-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`\nresults -> ${outFile}`);
console.log('==== SUMMARY (n=' + targets.length + ', pool=' + poolClip.size + ') ====');
for (const k of ['B_clip_crop', 'C1_baseline_concat', 'C2_desc_only', 'C3_confidence_gated', 'C4_flash_model']) {
  const s = report[k];
  console.log(`${k}: top1=${s.top1} top5=${s.top5} top20=${s.top20} mrr=${s.mrr}`);
}
if (!SKIP_RERANK) {
  console.log(`Rerank top-1 accuracy: Rclip=${report.Rclip_rerank_top1}/${targets.length} Rtext=${report.Rtext_rerank_top1}/${targets.length} Runion=${report.Runion_rerank_top1}/${targets.length} (union recall ${report.Runion_candidate_recall}/${targets.length})`);
}

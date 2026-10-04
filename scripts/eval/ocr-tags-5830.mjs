#!/usr/bin/env node
/**
 * How much Gemini does an open-engine OCR lane (GLM-OCR / Paddle / Kraken: plain text) need to keep the page
 * structure tags our Standard OCR v19.1 writes? (#5830). The spec is scripts/eval/PREREGISTRATION-ocr-tags-5830.md;
 * this file implements it and nothing else.
 *
 * PRIOR ART: scripts/eval/ocr-v18-ab.mjs (#4195): stageSubmit / stagePoll (REST Batch upload, create, collect,
 * logUsage), the production OCR request shape (SAFETY, OCR_GENERATION_CONFIG, LANGUAGE_INSTRUCTION, docContext,
 * the 1500 px resize) and makeResolver are imported, not rewritten. Its stageBuild is not reusable: it sends one
 * image and one prompt per arm, and arm T here sends per-page GLM text, arm L a 512 px image. #5660 round 3
 * (scripts/gpu/ocr-bakeoff-r3-5660/) produced the GLM text and JPEGs read here; it scored CER with tags stripped.
 *
 * Never writes to `pages`, `books` or `prompts`. Batch jobs are registered in `batch_jobs` as `external_eval`.
 *   --draw                       pages.jsonl (Mongo read-only, for title/author/year/language)
 *   --build                      requests-{R,R2,T,L}.jsonl + estimate.json
 *   --submit --approved-usd=N    one Batch job per arm, registered in batch_jobs
 *   --poll                       collect; exit 0 when all terminal
 *   --build-l2 / --submit-l2 --approved-usd=N / --poll   the image-desc pass on pages L flags
 *   --eye                        the 20-page by-eye sample → WORK/eye/
 *   --score                      → scripts/eval/results/ocr-tags-5830.json
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-tags-5830.mjs --draw
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  stageSubmit, stagePoll, makeResolver, readJsonl, writeJsonl, md5, r4, shuffle,
  SAFETY, OCR_GENERATION_CONFIG, LANGUAGE_INSTRUCTION, docContext, MODEL,
} from './ocr-v18-ab.mjs';
import { makeRng } from './lib/paired-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);

const SEED = 5830;
const WORK = '/root/claude-jobs/ocr-tags-5830-work';
const BENCH = '/root/r3-bench-5660/glm-ocr';
const STRATA = ['eebo-tcp-5488', 'english-ia-5124'];
const V19_ID = '6ac02220413a82637da889bb';
const CAP_USD = 1;
const RESULTS_JSON = path.join(__dirname, 'results/ocr-tags-5830.json');
const RESULTS_DIR = path.join(__dirname, 'results/ocr-tags-5830');
const P_TAGS = path.join(__dirname, 'prompts/ocr-tags-only-5830.txt');
const P_LOW = path.join(__dirname, 'prompts/ocr-lowres-classify-5830.txt');
const P_DESC = path.join(__dirname, 'prompts/ocr-image-desc-only-5830.txt');
const F = (n) => path.join(WORK, n);
const MAIN = { work: WORK, arms: ['R', 'R2', 'T', 'L'], k: 1, jobName: 'ocr-tags-5830', endpoint: 'eval/ocr-tags-5830', capUsd: CAP_USD };
const L2CFG = { ...MAIN, arms: ['L2'] };

// ───────────────────────────── draw ─────────────────────────────
async function stageDraw() {
  fs.mkdirSync(WORK, { recursive: true });
  const { withMongo } = await import('../lib/mongo.mjs');
  const skipped = [];
  const out = [];
  await withMongo(async (db) => {
    const resolve = makeResolver(db, (stratum, reason, what) => skipped.push({ stratum, reason, ...what }));
    for (const s of STRATA) {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, `benchmark/${s}.json`), 'utf8'));
      for (const r of d.rows || d.pages) {
        const glm = path.join(BENCH, s, 'out/glm-ocr', `${r.slug}.txt`);
        const jpg = path.join(BENCH, s, `${r.slug}.jpg`);
        if (!fs.existsSync(glm) || !fs.existsSync(jpg)) { skipped.push({ stratum: s, reason: 'no-glm-output', slug: r.slug }); continue; }
        const row = await resolve(s, { book_id: r.book_id, page_number: r.page_number }, {});
        out.push({ uid: r.slug, stratum: s, book_id: row?.book_id || r.book_id, page_number: r.page_number, jpg, glm,
          title: row?.title || r.title || r.catalogue?.title || null, author: row?.author || r.catalogue?.author || null,
          year: row?.year || r.year || r.catalogue?.published || null,
          language: row?.language || r.language || r.catalogue?.language || null });
      }
    }
  });
  writeJsonl(F('pages.jsonl'), out);
  fs.writeFileSync(F('draw-log.json'), JSON.stringify({ n: out.length, by_stratum: out.reduce((a, p) => ((a[p.stratum] = (a[p.stratum] || 0) + 1), a), {}), skipped }, null, 1));
  console.log(`draw: ${out.length} pages; skipped ${skipped.length}`);
}

// ───────────────────────────── build ─────────────────────────────
async function img(file, maxPx, always = false) {
  const sharp = (await import('sharp')).default;
  let buf = fs.readFileSync(file);
  if (always || buf.length > 100_000) buf = await sharp(buf).resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { mimeType: 'image/jpeg', data: buf.toString('base64'), bytes: buf.length };
}
const part = (i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } });
const TAGS_CONFIG = { temperature: 0.1, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } };
const LOW_CONFIG = { temperature: 0.1, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 }, mediaResolution: 'MEDIA_RESOLUTION_LOW' };

async function estimate(reqs, outAvg) {
  const { priceFor, BATCH_MULTIPLIER } = await import('../lib/model-pricing.mjs');
  const pr = priceFor(MODEL);
  let inTok = 0, n = 0;
  for (const [tin] of reqs) { inTok += tin; n++; }
  return { requests: n, in_tokens: inTok, usd: BATCH_MULTIPLIER * ((inTok / 1e6) * pr.input + ((n * outAvg) / 1e6) * pr.output) };
}

async function stageBuild() {
  const pages = readJsonl(F('pages.jsonl'));
  const { withMongo } = await import('../lib/mongo.mjs');
  const { ObjectId } = await import('mongodb');
  let v19;
  await withMongo(async (db) => { v19 = await db.collection('prompts').findOne({ _id: new ObjectId(V19_ID) }); });
  if (!v19?.content || v19.version !== 19.1 || !v19.is_default) throw new Error('v19.1 default prompt row not found');
  const v19Text = v19.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
  const tagsPrompt = fs.readFileSync(P_TAGS, 'utf8'), lowPrompt = fs.readFileSync(P_LOW, 'utf8');
  const streams = Object.fromEntries(MAIN.arms.map((a) => [a, fs.createWriteStream(F(`requests-${a}.jsonl`))]));
  const est = { R: [], R2: [], T: [], L: [] };
  for (const p of pages) {
    const full = await img(p.jpg, 1500), low = await img(p.jpg, 512, true);
    const glm = fs.readFileSync(p.glm, 'utf8');
    const rText = `${v19Text}${docContext(p)}`.trim();
    const R = { contents: [{ parts: [{ text: rText }, part(full)] }], safetySettings: SAFETY, generationConfig: OCR_GENERATION_CONFIG };
    for (const a of ['R', 'R2']) { streams[a].write(JSON.stringify({ key: `${a}:${p.uid}:1`, request: R }) + '\n'); est[a].push([Math.ceil(rText.length / 3.5) + 1100]); }
    const tText = `${tagsPrompt}${glm.trim() || '(empty)'}`;
    streams.T.write(JSON.stringify({ key: `T:${p.uid}:1`, request: { contents: [{ parts: [part(full), { text: tText }] }], safetySettings: SAFETY, generationConfig: TAGS_CONFIG } }) + '\n');
    est.T.push([Math.ceil(tText.length / 3.5) + 1100]);
    streams.L.write(JSON.stringify({ key: `L:${p.uid}:1`, request: { contents: [{ parts: [part(low), { text: lowPrompt }] }], safetySettings: SAFETY, generationConfig: LOW_CONFIG } }) + '\n');
    est.L.push([Math.ceil(lowPrompt.length / 3.5) + 300]);
  }
  await Promise.all(Object.values(streams).map((s) => new Promise((res) => s.end(res))));
  const parts = { R: await estimate(est.R, 900), R2: await estimate(est.R2, 900), T: await estimate(est.T, 400), L: await estimate(est.L, 40) };
  const usd = Object.values(parts).reduce((s, x) => s + x.usd, 0);
  const out = { at: new Date().toISOString(), model: MODEL, usd: r4(usd), parts,
    prompts: { R: { source: `prompts ${V19_ID} v${v19.version}`, content_hash: v19.content_hash, md5: md5(v19.content) }, T: { source: path.relative(path.join(__dirname, '../..'), P_TAGS), md5: md5(tagsPrompt) }, L: { source: path.relative(path.join(__dirname, '../..'), P_LOW), md5: md5(lowPrompt) } },
    generation: { R: OCR_GENERATION_CONFIG, T: TAGS_CONFIG, L: LOW_CONFIG }, image: { R_T: 'fit 1500 px when > 100 KB (production)', L: 'fit 512 px always' } };
  fs.writeFileSync(F('estimate.json'), JSON.stringify(out, null, 1));
  fs.writeFileSync(F('estimate-main.json'), JSON.stringify(out, null, 1));
  console.log(`build: ${pages.length} pages; ESTIMATE $${out.usd}`, JSON.stringify(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r4(v.usd)]))));
}

/** L verdict → does L2 run? (prereg: medium or large, or significance high) */
function lFlags(text) {
  const m = (text || '').match(/<illustration\b([^>]*)\/?>/i);
  const a = attrs(m?.[1] || '');
  return { size: a.size || null, significance: a.significance || null, present: !!a.size && a.size !== 'none', l2: ['medium', 'large'].includes(a.size) || a.significance === 'high' };
}

async function stageBuildL2() {
  const pages = new Map(readJsonl(F('pages.jsonl')).map((p) => [p.uid, p]));
  const prompt = fs.readFileSync(P_DESC, 'utf8');
  const s = fs.createWriteStream(F('requests-L2.jsonl'));
  const est = [];
  for (const r of readJsonl(F('reads.jsonl')).filter((x) => x.arm === 'L')) {
    if (!lFlags(r.text).l2) continue;
    const p = pages.get(r.uid);
    s.write(JSON.stringify({ key: `L2:${p.uid}:1`, request: { contents: [{ parts: [part(await img(p.jpg, 1500)), { text: prompt }] }], safetySettings: SAFETY, generationConfig: TAGS_CONFIG } }) + '\n');
    est.push([Math.ceil(prompt.length / 3.5) + 1100]);
  }
  await new Promise((res) => s.end(res));
  const e = await estimate(est, 200);
  fs.writeFileSync(F('estimate.json'), JSON.stringify({ at: new Date().toISOString(), model: MODEL, usd: r4(e.usd), parts: { L2: e }, prompt: { source: path.relative(path.join(__dirname, '../..'), P_DESC), md5: md5(prompt) } }, null, 1));
  console.log(`build-l2: ${e.requests} pages; ESTIMATE $${r4(e.usd)}`);
}

/** #5771: a hand-submitted Batch unknown to batch_jobs is an orphan, and the sweeper cancels it. */
async function registerJobs() {
  const rec = JSON.parse(fs.readFileSync(F('batch.json'), 'utf8'));
  const { withMongo } = await import('../lib/mongo.mjs');
  await withMongo(async (db) => {
    for (const j of rec.jobs) {
      await db.collection('batch_jobs').updateOne({ gemini_job_name: j.job_name }, { $setOnInsert: {
        id: `ocr-tags-5830-${j.arm}`, job_name: j.job_name, gemini_job_name: j.job_name, status: 'external_eval', type: 'eval', model: j.model,
        page_count: j.requests, created_at: new Date(j.submitted_at), updated_at: new Date(), issue: 5830,
        note: 'hand-submitted eval Batch (scripts/eval/ocr-tags-5830.mjs); results go to files only, never to pages' } }, { upsert: true });
      console.log(`registered ${j.arm} ${j.job_name} as external_eval`);
    }
  });
}

// ───────────────────────────── tags ─────────────────────────────
const NAMES = ['scan-quality', 'language', 'script', 'page-type', 'columns', 'page-num', 'header', 'sig', 'meta', 'warning', 'vocab', 'margin', 'gloss', 'insert', 'unclear', 'note', 'term', 'image-desc', 'lacuna'];
const PRESENCE = ['page-num', 'header', 'sig', 'meta', 'margin', 'gloss', 'insert', 'image-desc', 'image-desc-high', 'warning', 'unclear', 'term', 'vocab'];
const INLINE = ['margin', 'gloss', 'insert', 'image-desc'];
export function attrs(s) { const o = {}; for (const m of (s || '').matchAll(/([a-z-]+)="([^"]*)"/gi)) o[m[1].toLowerCase()] = m[2]; return o; }
const TAG_RE = new RegExp(`<(${NAMES.join('|')})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'gi');
const stripTags = (s) => s.replace(TAG_RE, ' ').replace(/<[^>]+>/g, ' ');
export const norm = (s) => (s || '').toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

/** Parse a tagged output: tags (with the body-text fraction before each) and the body text. */
export function parse(t) {
  t = t || '';
  const body = norm(stripTags(t));
  const tags = [];
  for (const m of t.matchAll(TAG_RE)) {
    const before = norm(stripTags(t.slice(0, m.index)));
    tags.push({ name: m[1].toLowerCase(), attrs: attrs(m[2]), content: m[3].trim(), pos: body.length ? before.length / body.length : 0 });
  }
  return { tags: tags.filter((x) => x.content || x.name === 'image-desc'), body, colBreak: /<column-break\s*\/?>/i.test(t) };
}
const first = (P, n) => P.tags.find((x) => x.name === n)?.content ?? null;
const all = (P, n) => P.tags.filter((x) => x.name === n);

function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export const sim = (a, b) => { a = norm(a).slice(0, 300); b = norm(b).slice(0, 300); const m = Math.max(a.length, b.length); return m ? 1 - lev(a, b) / m : 1; };
const pnum = (s) => (norm(s).match(/^(\d+|[iuxlcdm]+)$/) ? norm(s).replace(/^0+/, '') : null);
const LANGS = ['english', 'latin', 'french', 'german', 'greek', 'hebrew', 'italian', 'spanish', 'dutch', 'welsh', 'scots', 'arabic'];
const langNorm = (s) => { const l = (s || '').toLowerCase(); let best = null, at = Infinity; for (const n of LANGS) { const i = l.indexOf(n); if (i >= 0 && i < at) { best = n; at = i; } } return best || (l.match(/\p{L}+/u) || [null])[0]; };
const isMulti = (P) => P.colBreak || Number(first(P, 'columns')) >= 2;

/** Greedy one-to-one match of arm instances to reference instances. */
function match(armT, refT, name) {
  const pairs = [];
  for (let i = 0; i < armT.length; i++) for (let j = 0; j < refT.length; j++) {
    const s = name === 'page-num' ? (pnum(armT[i].content) && pnum(armT[i].content) === pnum(refT[j].content) ? 1 : 0) : sim(armT[i].content, refT[j].content);
    if (s >= (name === 'page-num' ? 1 : 0.5)) pairs.push([s, i, j]);
  }
  pairs.sort((a, b) => b[0] - a[0]);
  const ui = new Set(), uj = new Set(), out = [];
  for (const [s, i, j] of pairs) { if (ui.has(i) || uj.has(j)) continue; ui.add(i); uj.add(j); out.push({ s, a: armT[i], r: refT[j] }); }
  return out;
}

/** Where does a T anchor sit in the GLM text (fraction), or null. */
function anchorPos(anchor, glmNorm) {
  const a = norm(anchor);
  if (!a || !glmNorm.length) return null;
  const i = glmNorm.indexOf(a);
  if (i >= 0) return i / glmNorm.length;
  let best = 0, at = -1;
  for (let k = 0; k + a.length <= glmNorm.length; k += 2) { const s = 1 - lev(a, glmNorm.slice(k, k + a.length)) / a.length; if (s > best) { best = s; at = k; } }
  return best >= 0.7 ? at / glmNorm.length : null;
}

/** D: $0 rules over the GLM text and the catalogue language. */
export function deterministic(glm, catalogueLang) {
  const lines = (glm || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const tags = [{ name: 'language', content: catalogueLang || '' }, { name: 'script', content: 'printed' }, { name: 'page-type', content: 'text' }];
  const NUM = /^(\d{1,4}|[ivxlc]{1,7})$/i;
  const l1 = lines[0] || '';
  if (l1 && l1.length <= 70) {
    const toks = l1.split(/\s+/);
    if (toks.length === 1 && NUM.test(l1.replace(/[.,]/g, ''))) tags.push({ name: 'page-num', content: l1 });
    else if (toks.length > 1 && (NUM.test(toks[0].replace(/[.,]/g, '')) || NUM.test(toks.at(-1).replace(/[.,]/g, '')))) {
      const lead = NUM.test(toks[0].replace(/[.,]/g, ''));
      tags.push({ name: 'page-num', content: lead ? toks[0] : toks.at(-1) });
      const rest = (lead ? toks.slice(1) : toks.slice(0, -1)).join(' ');
      if ((rest.match(/\p{L}/gu) || []).length >= 3) tags.push({ name: 'header', content: rest });
    }
  }
  const last = lines.length > 1 ? lines.at(-1) : '';
  if (/^[A-Z][a-z]?\s?[0-9ivx]{0,3}$/.test(last) && last.length <= 6) tags.push({ name: 'sig', content: last });
  return { tags: tags.filter((x) => x.content).map((x) => ({ ...x, attrs: {}, pos: 0 })), body: norm(glm), colBreak: false };
}

// ───────────────────────────── score ─────────────────────────────
const prf = (tp, fp, fn) => { const p = tp + fp ? tp / (tp + fp) : null, r = tp + fn ? tp / (tp + fn) : null; return { p: r4(p), r: r4(r), f1: p != null && r != null && p + r ? r4((2 * p * r) / (p + r)) : null, tp, fp, fn }; };
const has = (P, n) => n === 'image-desc-high' ? all(P, 'image-desc').some((x) => /high/i.test(x.attrs.significance || '')) : all(P, n).length > 0;

function compare(arm, pairs, { anchors = false } = {}) {
  const res = { n_pages: pairs.length, labels: {}, presence: {}, instances: {}, value_accuracy: {}, image_desc: {}, anchors: {} };
  for (const [lab, fn] of [['page-type', (P) => first(P, 'page-type')?.toLowerCase().trim()], ['language', (P) => langNorm(first(P, 'language'))], ['script', (P) => first(P, 'script')?.toLowerCase().trim()], ['scan-quality', (P) => first(P, 'scan-quality')?.toLowerCase().trim()]]) {
    const v = pairs.map(({ A, R }) => [fn(A), fn(R)]).filter(([a, r]) => a && r);
    res.labels[lab] = { n: v.length, accuracy: v.length ? r4(v.filter(([a, r]) => a === r).length / v.length) : null };
  }
  const nt = { tp: 0, fp: 0, fn: 0 }, mc = { tp: 0, fp: 0, fn: 0 };
  for (const { A, R } of pairs) {
    const a = first(A, 'page-type'), r = first(R, 'page-type');
    if (a && r) { const ax = a.trim() !== 'text', rx = r.trim() !== 'text'; if (ax && rx) nt.tp++; else if (ax) nt.fp++; else if (rx) nt.fn++; }
    const am = isMulti(A), rm = isMulti(R); if (am && rm) mc.tp++; else if (am) mc.fp++; else if (rm) mc.fn++;
  }
  res.labels['page-type-not-text'] = prf(nt.tp, nt.fp, nt.fn);
  res.labels['columns-multi'] = prf(mc.tp, mc.fp, mc.fn);
  for (const n of PRESENCE) {
    let tp = 0, fp = 0, fn = 0;
    for (const { A, R } of pairs) { const a = has(A, n), r = has(R, n); if (a && r) tp++; else if (a) fp++; else if (r) fn++; }
    res.presence[n] = prf(tp, fp, fn);
  }
  const anc = { found: 0, correct: 0, n: 0 };
  for (const n of ['page-num', 'header', 'sig', 'margin', 'insert']) {
    let m = 0, na = 0, nr = 0, hi = 0;
    for (const { A, R, glmNorm } of pairs) {
      const at = all(A, n), rt = all(R, n); na += at.length; nr += rt.length;
      const mm = match(at, rt, n); m += mm.length; hi += mm.filter((x) => x.s >= 0.8).length;
      if (anchors && (n === 'margin' || n === 'insert')) for (const x of mm) { anc.n++; const pos = anchorPos(x.a.attrs.anchor, glmNorm); if (pos != null) { anc.found++; if (Math.abs(pos - x.r.pos) <= 0.15) anc.correct++; } }
    }
    res.instances[n] = { p: na ? r4(m / na) : null, r: nr ? r4(m / nr) : null, matched: m, n_arm: na, n_ref: nr };
    if (n !== 'page-num') res.value_accuracy[n] = m ? r4(hi / m) : null;
  }
  // image-desc: count-matched; attributes on in-order pairs; anchors for T
  let ia = 0, ir = 0, im = 0, typeEq = 0, sigEq = 0, pairsN = 0;
  for (const { A, R, glmNorm } of pairs) {
    const at = all(A, 'image-desc'), rt = all(R, 'image-desc'); ia += at.length; ir += rt.length; im += Math.min(at.length, rt.length);
    for (let i = 0; i < Math.min(at.length, rt.length); i++) {
      pairsN++; if ((at[i].attrs.type || '') === (rt[i].attrs.type || '')) typeEq++; if ((at[i].attrs.significance || '') === (rt[i].attrs.significance || '')) sigEq++;
      if (anchors) { anc.n++; const pos = at[i].attrs.anchor === '' && rt[i].pos > 0.85 ? 1 : anchorPos(at[i].attrs.anchor, glmNorm); if (pos != null) { anc.found++; if (Math.abs(pos - rt[i].pos) <= 0.15) anc.correct++; } }
    }
  }
  res.image_desc = { p: ia ? r4(im / ia) : null, r: ir ? r4(im / ir) : null, n_arm: ia, n_ref: ir, type_agree: pairsN ? r4(typeEq / pairsN) : null, significance_agree: pairsN ? r4(sigEq / pairsN) : null };
  if (anchors) res.anchors = { n: anc.n, found: anc.n ? r4(anc.found / anc.n) : null, correct: anc.n ? r4(anc.correct / anc.n) : null };
  return res;
}

function stageScore() {
  const pages = readJsonl(F('pages.jsonl'));
  const reads = new Map(); for (const r of readJsonl(F('reads.jsonl'))) reads.set(`${r.arm}:${r.uid}`, r);
  const rec = JSON.parse(fs.readFileSync(F('batch.json'), 'utf8'));
  const ok = (arm, uid) => { const r = reads.get(`${arm}:${uid}`); return r && (r.outcome === 'text' || r.outcome === 'truncated') ? r : null; };
  const outcomes = {}; for (const r of reads.values()) outcomes[`${r.arm}:${r.outcome}`] = (outcomes[`${r.arm}:${r.outcome}`] || 0) + 1;
  const base = pages.filter((p) => ok('R', p.uid)).map((p) => { const glm = fs.readFileSync(p.glm, 'utf8'); return { p, R: parse(ok('R', p.uid).text), glm, glmNorm: norm(glm) }; });
  const mk = (fn) => base.map((b) => { const A = fn(b); return A ? { ...b, A } : null; }).filter(Boolean);
  const Lp = (b) => { const r = ok('L', b.p.uid); if (!r) return null; const f = lFlags(r.text); const pt = (r.text.match(/<page-type>\s*([^<]*?)\s*<\/page-type>/i) || [])[1];
    return { f, P: { tags: [...(pt ? [{ name: 'page-type', content: pt, attrs: {} }] : []), ...(f.present ? [{ name: 'image-desc', content: '', attrs: { size: f.size, significance: f.significance } }] : [])], body: '', colBreak: false } }; };
  const arms = {
    R2: compare('R2', mk((b) => ok('R2', b.p.uid) && parse(ok('R2', b.p.uid).text))),
    D: compare('D', mk((b) => deterministic(b.glm, b.p.language))),
    L: compare('L', mk((b) => Lp(b)?.P)),
    'L+L2': compare('L+L2', mk((b) => { const l = Lp(b); if (!l) return null; const r2 = ok('L2', b.p.uid);
      const tags = [...l.P.tags.filter((x) => x.name === 'page-type'), ...(r2 ? parse(r2.text).tags.filter((x) => x.name === 'image-desc') : [])]; return { tags, body: '', colBreak: false }; })),
    T: compare('T', mk((b) => ok('T', b.p.uid) && parse(ok('T', b.p.uid).text)), { anchors: true }),
  };
  // what any $0 method over GLM text could recover: R's furniture values present anywhere in GLM text
  const bound = {};
  for (const n of ['header', 'page-num', 'sig', 'margin']) {
    let k = 0, tot = 0;
    for (const b of base) for (const x of all(b.R, n)) { tot++; const v = norm(x.content); if (v.length >= (n === 'page-num' ? 1 : 3) && (n === 'page-num' ? new RegExp(`(^|\\D)${v}(\\D|$)`).test(b.glm.toLowerCase().replace(/ſ/g, 's')) : b.glmNorm.includes(v))) k++; }
    bound[n] = { in_glm: k, of: tot, share: tot ? r4(k / tot) : null };
  }
  // cost per arm from measured tokens
  const cost = {};
  for (const j of rec.jobs) {
    const rows = [...reads.values()].filter((r) => r.arm === j.arm);
    const inT = rows.reduce((s, r) => s + r.inTok, 0), outT = rows.reduce((s, r) => s + r.outTok, 0);
    cost[j.arm] = { job: j.job_name, requests: rows.length, in_tokens: inT, out_tokens: outT, mean_in: r4(inT / rows.length), mean_out: r4(outT / rows.length), cost_usd: r4(j.cost_usd),
      usd_per_1000_requests: r4((j.cost_usd / rows.length) * 1000), usd_per_1000_pages: r4((j.cost_usd / pages.length) * 1000) };
  }
  // by-eye: R vs the image
  let eye = null;
  const eyeF = path.join(RESULTS_DIR, 'eye-truth.json');
  if (fs.existsSync(eyeF)) {
    const truth = JSON.parse(fs.readFileSync(eyeF, 'utf8')).pages;
    const fields = { page_type: (P) => first(P, 'page-type')?.trim(), page_num: (P) => pnum(first(P, 'page-num') || '') || null, header: (P) => (first(P, 'header') ? true : false), sig: (P) => (first(P, 'sig') ? true : false), margin_count: (P) => all(P, 'margin').length, illustration: (P) => all(P, 'image-desc').some((x) => /high/i.test(x.attrs.significance || '') || /large|medium/i.test(x.attrs.size || '')), multi_column: (P) => isMulti(P) };
    eye = { n: truth.length, label: 'read from image', fields: {}, errors: [] };
    for (const [f, fn] of Object.entries(fields)) {
      let agree = 0, n = 0;
      for (const t of truth) { const b = base.find((x) => x.p.uid === t.uid); if (!b || t[f] === undefined) continue; n++; const rv = fn(b.R), tv = f === 'page_num' ? (t[f] == null ? null : pnum(String(t[f]))) : t[f];
        if (rv === tv) agree++; else eye.errors.push({ uid: t.uid, field: f, reference: rv, image: tv, note: t.note || null }); }
      eye.fields[f] = { n, reference_correct: n ? r4(agree / n) : null };
    }
  }
  const est = JSON.parse(fs.readFileSync(F('estimate-main.json'), 'utf8'));
  const actual = rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0);
  const result = { issue: 5830, preregistration: 'scripts/eval/PREREGISTRATION-ocr-tags-5830.md', measure: 'agreement', at: new Date().toISOString(), model: MODEL,
    prompts: est.prompts, generation: est.generation, image: est.image, pages: { drawn: pages.length, scored: base.length }, run_outcomes: outcomes,
    reference_positive_pages: Object.fromEntries(PRESENCE.map((n) => [n, base.filter((b) => has(b.R, n)).length])),
    l2_pages: [...reads.values()].filter((r) => r.arm === 'L2').length,
    arms, zero_cost_bound: bound, cost, spend_usd: r4(actual), eye,
    per_page: base.map((b) => ({ uid: b.p.uid, stratum: b.p.stratum, book_id: b.p.book_id, page_number: b.p.page_number, glm_chars: b.glm.length,
      R: Object.fromEntries(['page-type', 'page-num', 'header', 'sig', 'language'].map((n) => [n, first(b.R, n)])), R_margins: all(b.R, 'margin').length, R_images: all(b.R, 'image-desc').length })) };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(RESULTS_DIR, 'reads.jsonl.gz'), zlib.gzipSync(fs.readFileSync(F('reads.jsonl'))));
  writeJsonl(path.join(RESULTS_DIR, 'pages.jsonl'), pages);
  console.log(JSON.stringify({ outcomes, pages: result.pages, cost, spend: result.spend_usd, bound }, null, 1));
  for (const [a, r] of Object.entries(arms)) {
    console.log(`\n== ${a} (n=${r.n_pages})  labels ${JSON.stringify(Object.fromEntries(Object.entries(r.labels).map(([k, v]) => [k, v.accuracy ?? v.f1])))}`);
    console.log('   presence F1', JSON.stringify(Object.fromEntries(Object.entries(r.presence).map(([k, v]) => [k, `${v.f1} (p${v.p} r${v.r})`]))));
    console.log('   instances', JSON.stringify(r.instances), '\n   value', JSON.stringify(r.value_accuracy), '\n   image_desc', JSON.stringify(r.image_desc), r.anchors.n ? `\n   anchors ${JSON.stringify(r.anchors)}` : '');
  }
  if (eye) console.log('\neye:', JSON.stringify(eye.fields));
}

// ───────────────────────────── eye sample ─────────────────────────────
async function stageEye() {
  const sharp = (await import('sharp')).default;
  const pages = readJsonl(F('pages.jsonl'));
  const reads = new Map(readJsonl(F('reads.jsonl')).filter((r) => r.arm === 'R').map((r) => [r.uid, r]));
  const rng = makeRng(SEED);
  const pick = STRATA.flatMap((s) => shuffle(pages.filter((p) => p.stratum === s && reads.get(p.uid)?.text).sort((a, b) => a.uid.localeCompare(b.uid)), rng).slice(0, 10));
  fs.mkdirSync(F('eye'), { recursive: true });
  const list = [];
  for (const p of pick) {
    const out = F(`eye/${p.uid}.jpg`);
    await sharp(p.jpg).resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(out);
    list.push({ uid: p.uid, stratum: p.stratum, image: out });
  }
  fs.writeFileSync(F('eye/list.json'), JSON.stringify(list, null, 1));
  console.log(list.map((x) => x.uid).join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const STAGES = {
    draw: stageDraw, build: stageBuild,
    submit: async () => { await stageSubmit(MAIN); await registerJobs(); },
    poll: async () => process.exit((await stagePoll({ ...MAIN, arms: ['R', 'R2', 'T', 'L', 'L2'] })) ? 0 : 1),
    'build-l2': stageBuildL2,
    'submit-l2': async () => { await stageSubmit(L2CFG); await registerJobs(); },
    eye: stageEye, score: stageScore,
  };
  const stage = Object.keys(STAGES).find((s) => flag(s));
  if (!stage) { console.error(`usage: --${Object.keys(STAGES).join(' | --')}`); process.exit(2); }
  await STAGES[stage]();
}

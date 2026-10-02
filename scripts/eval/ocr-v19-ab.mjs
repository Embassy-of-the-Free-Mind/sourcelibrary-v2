#!/usr/bin/env node
/**
 * OCR prompt v19 confirmatory run (#4195): screen, label by eye, four arms (v16, v16 again, v18, v19), report.
 * The spec is scripts/eval/PREREGISTRATION-ocr-v19-showthrough.md, including its dated amendments.
 *
 * PRIOR ART: scripts/eval/ocr-v18-ab.mjs (#4195): the production Batch request, image fetch, submit / poll,
 * per-run outcomes and the stats helpers are imported from it, not copied. This file adds only what v19 needs:
 * the screen, the labelling hand-off, the W / T / S3 / S5 draw, arm C, the 1/k floor rule and context echo.
 *
 * Stages (WORK defaults to /root/claude-jobs/ocr-v19-ab-work; never writes to `pages` or `prompts`):
 *   --screen-draw             Mongo READ-ONLY: the #4149 FABRICATED rows + v0.4 blank_page → WORK/screen/pages.jsonl
 *   --screen-build            one v16 request per pool page              → WORK/screen/requests-S.jsonl, estimate.json
 *   --screen-submit --approved-usd=N
 *   --screen-poll             exit 0 when the screen job is collected
 *   --qualify                 body > 20 letters → WORK/to-label.jsonl, plus images to WORK/eye/ for labelling by eye
 *   (labels: scripts/eval/dataset/ocr-v19-labels.jsonl, written by hand from the images, committed before --submit)
 *   --draw                    W / T / S3 / S5 from the labels             → WORK/pages.jsonl, WORK/draw-log.json
 *   --build | --submit --approved-usd=N | --poll | --score     → scripts/eval/results/ocr-v19-ab-2026-10.json
 *
 * v19.1 follow-up (PREREGISTRATION-ocr-v19-1-stamps.md): arms D (v19.1) and A3 (v16 control) on the same 195 pages,
 * scored with the v19 run's A / A2 / B / C reads (WORK191 defaults to /root/claude-jobs/ocr-v19-1-work):
 *   --v191-build | --v191-submit --approved-usd=N | --v191-poll | --v191-score   → scripts/eval/results/ocr-v19-1-2026-10.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bodyText, declaredBlank } from './blank-page-study.mjs';
import { makeRng, binomTwoSided, mean } from './lib/paired-stats.mjs';
import {
  SEED, MODEL, V04, REF_5250, readJsonl, writeJsonl, r4, shuffle, letters, makeResolver, loadPrompts,
  stageBuild, stageSubmit, stagePoll, runOutcomes, wilson, quantile, median, sd,
} from './ocr-v18-ab.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;

const K = 3;
const ARMS = ['A', 'A2', 'B', 'C'];
const CAP_USD = 6; // the whole run: screen + arms
const WORK = opt('work', '/root/claude-jobs/ocr-v19-ab-work');
const SCREEN = path.join(WORK, 'screen');
const CANDIDATES = { B: path.join(__dirname, '../../prompts/ocr/standard-ocr-v18-candidate.md'), C: path.join(__dirname, '../../prompts/ocr/standard-ocr-v19-candidate.md') };
const CORPUS_4149 = opt('corpus', '/root/claude-jobs/fabricated-ocr-corpus-2026-08-21.jsonl');
const LABELS = path.join(__dirname, 'dataset/ocr-v19-labels.jsonl');
const V18_PAGES = path.join(__dirname, 'results/ocr-v18-ab-2026-10/pages.jsonl');
const V18_RESULTS = path.join(__dirname, 'results/ocr-v18-ab-2026-10.json');
const RESULTS_JSON = path.join(__dirname, 'results/ocr-v19-ab-2026-10.json');
const RESULTS_DIR = path.join(__dirname, 'results/ocr-v19-ab-2026-10');
const F = (n) => path.join(WORK, n);
const SCREEN_CFG = { work: SCREEN, arms: ['S'], k: 1, jobName: 'ocr-v19-ab-4195-screen', endpoint: 'eval/ocr-v19-ab-4195', capUsd: CAP_USD };
const ARMS_CFG = { work: WORK, arms: ARMS, k: K, jobName: 'ocr-v19-ab-4195', endpoint: 'eval/ocr-v19-ab-4195', capUsd: CAP_USD };

/** One row per book, books in seeded order, until n are accepted (ocr-v18-ab's drawPerBook, over resolved rows). */
function perBook(rows, n) {
  const rng = makeRng(SEED);
  const byBook = new Map();
  for (const r of rows) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
  const got = [];
  for (const bid of shuffle([...byBook.keys()].sort(), rng)) {
    if (got.length >= n) break;
    const opts = byBook.get(bid).sort((a, b) => a.page_number - b.page_number);
    got.push(opts[Math.floor(rng() * opts.length)]);
  }
  return got;
}

// ───────────────────────────── screen ─────────────────────────────
async function stageScreenDraw() {
  fs.mkdirSync(SCREEN, { recursive: true });
  const { withMongo } = await import('../lib/mongo.mjs');
  const log = { seed: SEED, skipped: {} };
  const skip = (s, reason, what) => ((log.skipped[s] ||= []).push({ reason, ...what }));
  const corpus = [];
  for (const l of fs.readFileSync(CORPUS_4149, 'utf8').split('\n')) { if (!l.trim()) continue; try { corpus.push(JSON.parse(l)); } catch { log.unparseable = (log.unparseable || 0) + 1; } }
  const fab = corpus.filter((r) => r.verdict === 'FABRICATED');
  const v04 = readJsonl(V04).filter((x) => (x.difficulty || []).includes('blank_page'));
  log.pool = { fabricated_4149: fab.length, v04_blank_page: v04.length };
  const out = new Map();
  await withMongo(async (db) => {
    const resolve = makeResolver(db, skip);
    for (const r of fab) {
      const row = await resolve('screen', { book_id: r.book_id, page_number: r.page }, { pool: '4149', ink_coverage: r.ink_coverage, corpus_model: r.model });
      if (row && !out.has(row.uid)) out.set(row.uid, row);
    }
    for (const r of v04) {
      const row = await resolve('screen', { book_id: r.book_id, page_id: r.page_id, page_number: r.page_number }, { pool: 'v0.4', slug: r.slug });
      if (!row) continue;
      if (out.has(row.uid)) out.get(row.uid).also_v04 = r.slug; else out.set(row.uid, row);
    }
  });
  writeJsonl(path.join(SCREEN, 'pages.jsonl'), [...out.values()]);
  log.resolved = out.size;
  log.skipped_counts = Object.fromEntries(Object.entries(log.skipped).map(([s, l]) => [s, l.reduce((a, x) => ((a[x.reason] = (a[x.reason] || 0) + 1), a), {})]));
  fs.writeFileSync(path.join(SCREEN, 'draw-log.json'), JSON.stringify(log, null, 1));
  console.log('screen pool:', JSON.stringify(log.pool), 'resolved', out.size, 'skipped', JSON.stringify(log.skipped_counts));
}

async function stageScreenBuild() {
  const p = await loadPrompts({});
  await stageBuild({ ...SCREEN_CFG, prompts: { S: p.A } });
}

/** Screen reads → qualifying pages; write the labelling list and the images to view. */
async function stageQualify() {
  const sharp = (await import('sharp')).default;
  const pages = readJsonl(path.join(SCREEN, 'pages.jsonl'));
  const reads = new Map(readJsonl(path.join(SCREEN, 'reads.jsonl')).map((r) => [r.uid, r]));
  const list = [];
  for (const p of pages) {
    const r = reads.get(p.uid);
    const L = r?.text ? letters(bodyText(r.text)) : null;
    const qualifies = L != null && L > 20;
    const isV04 = p.pool === 'v0.4' || !!p.also_v04;
    if (!qualifies && !isV04) continue;
    list.push({ uid: p.uid, book_id: p.book_id, page_number: p.page_number, image: p.image, pool: p.pool, v04: isV04, qualifies, screen_outcome: r?.outcome || 'missing', screen_body_letters: L });
  }
  fs.mkdirSync(F('eye'), { recursive: true });
  for (const x of list) {
    const f = F(`eye/${x.uid}.jpg`);
    if (fs.existsSync(f)) continue;
    try {
      const res = await fetch(x.image, { signal: AbortSignal.timeout(60000) });
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(f);
      // contrast-stretched copy: faint show-through and pencil are easier to see; the label is still of this image
      await sharp(buf).resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true }).normalise().jpeg({ quality: 85 }).toFile(F(`eye/${x.uid}.n.jpg`));
    } catch (e) { x.eye_error = String(e.message || e).slice(0, 120); }
  }
  writeJsonl(F('to-label.jsonl'), list);
  console.log(`to label: ${list.length} (qualifying ${list.filter((x) => x.qualifies).length}, v0.4 ${list.filter((x) => x.v04).length}, both ${list.filter((x) => x.v04 && x.qualifies).length}); screen pages ${pages.length}, reads ${reads.size}; eye errors ${list.filter((x) => x.eye_error).length}`);
}

// ───────────────────────────── draw ─────────────────────────────
async function stageDraw() {
  const labels = new Map(readJsonl(LABELS).map((l) => [l.uid, l]));
  const list = readJsonl(F('to-label.jsonl'));
  const screenPages = new Map(readJsonl(path.join(SCREEN, 'pages.jsonl')).map((p) => [p.uid, p]));
  const missing = list.filter((x) => !labels.has(x.uid)).map((x) => x.uid);
  if (missing.length) throw new Error(`${missing.length} pages unlabelled, e.g. ${missing.slice(0, 3)}`);
  const row = (x, stratum) => ({ ...screenPages.get(x.uid), stratum, label: labels.get(x.uid).label, label_note: labels.get(x.uid).note, qualifies: x.qualifies, v04: x.v04 });
  const W = perBook(list.filter((x) => x.qualifies && labels.get(x.uid).label === 'white').map((x) => row(x, 'W')), 40);
  const T = perBook(list.filter((x) => (x.qualifies || x.v04) && labels.get(x.uid).label === 'show-through').map((x) => row(x, 'T')), 40);
  const inkNew = list.filter((x) => labels.get(x.uid).label === 'real-ink').map((x) => row(x, 'S3'));
  const v18 = readJsonl(V18_PAGES);
  const v18S3 = v18.filter((p) => p.stratum === 'S3').map((p) => ({ ...p, source: `v18 S3: ${p.source}` }));
  const s3Seen = new Set(v18S3.map((p) => p.uid));
  const S3 = [...v18S3, ...inkNew.filter((p) => !s3Seen.has(p.uid)).map((p) => ({ ...p, source: `v19 label real-ink (${p.pool})` }))];
  const abst = new Set(JSON.parse(fs.readFileSync(V18_RESULTS, 'utf8')).strata.S5.abstained);
  const refs = new Map(readJsonl(REF_5250).map((r) => [r.slug, r]));
  const S5 = v18.filter((p) => p.stratum === 'S5' && !abst.has(p.uid)).map(({ ref_chars, ...p }) => ({ ...p, ref: refs.get(p.slug)?.ref }));
  if (S5.some((p) => !p.ref)) throw new Error('S5 reference missing');
  const out = [...W, ...T, ...S3, ...S5];
  const dup = out.map((p) => p.uid).filter((u, i, a) => a.indexOf(u) !== i);
  if (dup.length) throw new Error(`page in two strata (request keys are per uid): ${dup}`);
  writeJsonl(F('pages.jsonl'), out);
  const log = { seed: SEED, counts: out.reduce((a, r) => ((a[r.stratum] = (a[r.stratum] || 0) + 1), a), {}),
    labels: [...labels.values()].reduce((a, l) => ((a[l.label] = (a[l.label] || 0) + 1), a), {}),
    eligible: { W: list.filter((x) => x.qualifies && labels.get(x.uid).label === 'white').length, T: list.filter((x) => (x.qualifies || x.v04) && labels.get(x.uid).label === 'show-through').length, S3_new_real_ink: inkNew.length } };
  fs.writeFileSync(F('draw-log.json'), JSON.stringify(log, null, 1));
  console.log('draw:', JSON.stringify(log));
}

// ───────────────────────────── score ─────────────────────────────
const STOP = new Set('with from that this have their were which into upon über eine einer eines oder sive pour dans avec dans sont nach quae quod quam sunt atque etiam ipsius book books volume tome tomus band part pars libri liber vols edition editio author auteur anonymous unknown texte text works opera omnia'.split(' '));
const tokens = (s) => new Set((s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 4 && !STOP.has(t)));
const headerText = (t) => [...(t || '').matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)].map((m) => m[1]).join(' ');
/** Context echo (diagnostic): a run's header or body shares a 4+-letter token with the book's title or author. */
function contextEcho(page, text) {
  const ctx = tokens(`${page.title || ''} ${page.author || ''}`);
  if (!ctx.size || !text) return 0;
  for (const t of tokens(`${headerText(text)} ${bodyText(text)}`)) if (ctx.has(t)) return 1;
  return 0;
}

const OUTCOME_OF = { W: 'fabricated', T: 'fabricated', S3: 'false_blank', S5: 'wcer' };
const STRATA = ['W', 'T', 'S3', 'S5'];

function stageScore() {
  const pages = readJsonl(F('pages.jsonl'));
  const imgs = new Map(readJsonl(F('images.jsonl')).map((m) => [m.uid + ':' + m.stratum, m]));
  const img = (p) => imgs.get(p.uid + ':' + p.stratum);
  const reads = new Map();
  for (const r of readJsonl(F('reads.jsonl'))) reads.set(`${r.arm}:${r.uid}:${r.k}`, r);
  const rec = JSON.parse(fs.readFileSync(F('batch.json'), 'utf8'));
  const screenRec = JSON.parse(fs.readFileSync(path.join(SCREEN, 'batch.json'), 'utf8'));
  const est = JSON.parse(fs.readFileSync(F('estimate.json'), 'utf8'));
  const live = pages.filter((p) => img(p) && !img(p).fetch_error);
  const dropped = pages.filter((p) => !img(p) || img(p).fetch_error).map((p) => ({ uid: p.uid, stratum: p.stratum, reason: img(p)?.fetch_error || 'no image row' }));

  // A page uid can sit in two strata only if a v18 S3 page was relabelled; requests are keyed by uid, so reads are shared.
  const per = new Map(); const runCounts = {};
  const key = (p) => `${p.stratum}:${p.uid}`;
  for (const p of live) {
    const byArm = {};
    for (const arm of ARMS) {
      const runs = [];
      for (let k = 1; k <= K; k++) {
        const r = reads.get(`${arm}:${p.uid}:${k}`);
        const c = `${arm}:${r ? r.outcome : 'missing'}`; runCounts[c] = (runCounts[c] || 0) + 1;
        if (!r) continue;
        const o = runOutcomes(p, r); if (!o) continue;
        if (p.stratum === 'W' || p.stratum === 'T') o.context_echo = contextEcho(p, r.text);
        runs.push({ k, ...o });
      }
      const m = {}, s = {};
      for (const f of [OUTCOME_OF[p.stratum], 'blank_recall', 'context_echo', 'loop', 'declared_blank', 'body_letters']) {
        const v = runs.map((r) => r[f]).filter((x) => x != null); m[f] = v.length ? mean(v) : null; s[f] = v.length ? sd(v) : null;
      }
      if (p.stratum === 'S5') m.aligned_runs = runs.filter((r) => r.aligned).length;
      byArm[arm] = { n_runs: runs.length, mean: m, sd: s, page_types: runs.map((r) => r.page_type) };
    }
    per.set(key(p), byArm);
  }

  const val = (p, arm, f) => per.get(key(p))[arm]?.mean[f];
  /** Paired comparison x vs y over pages; positive d = y lower. A page counts only if |d| ≥ thr (the floor rule). */
  function compare(ps, x, y, f, thr) {
    const both = ps.filter((p) => val(p, x, f) != null && val(p, y, f) != null);
    const d = both.map((p) => val(p, x, f) - val(p, y, f));
    const lower = d.filter((v) => v >= thr - 1e-9).length, higher = d.filter((v) => v <= -thr + 1e-9).length;
    return { n: d.length, mean: r4(mean(d)), median: r4(median(d)), y_lower: lower, y_higher: higher, ties: d.length - lower - higher, sign_p: r4(binomTwoSided(lower, lower + higher)) };
  }
  const stratumPages = {}; const strata = {};
  for (const S of STRATA) {
    const f = OUTCOME_OF[S];
    const sp = live.filter((p) => p.stratum === S);
    const abstained = [];
    const eligible = S === 'S5' ? sp.filter((p) => { const ok = (per.get(key(p)).A.mean.aligned_runs || 0) >= 2; if (!ok) abstained.push(p.uid); return ok; }) : sp;
    stratumPages[S] = eligible;
    const aa = eligible.filter((p) => val(p, 'A', f) != null && val(p, 'A2', f) != null).map((p) => Math.abs(val(p, 'A', f) - val(p, 'A2', f)));
    const floor = aa.length ? r4(quantile(aa, 0.9)) : null;
    const thr = floor > 0 ? floor : 1 / K; // pre-registration: a 0 floor becomes one run in three
    const armMean = (a, g = f) => { const v = eligible.map((p) => val(p, a, g)).filter((x) => x != null); return v.length ? r4(mean(v)) : null; };
    const spread = (a) => { const v = eligible.map((p) => per.get(key(p))[a]?.sd[f]).filter((x) => x != null); return v.length ? r4(mean(v)) : null; };
    strata[S] = {
      outcome: f, n_pages: sp.length, n_scored: eligible.length, abstained, noise_floor_p90_abs_A_A2: floor, page_threshold: r4(thr),
      aa_identical: aa.filter((x) => x === 0).length, aa_pages: aa.length,
      arms: Object.fromEntries(ARMS.map((a) => [a, { mean: armMean(a), spread_k: spread(a), declared_blank: armMean(a, 'declared_blank'), ...(S === 'W' || S === 'T' ? { blank_recall: armMean(a, 'blank_recall'), context_echo: armMean(a, 'context_echo') } : {}) }])),
      A_vs_A2: compare(eligible, 'A', 'A2', f, thr), A_vs_C: compare(eligible, 'A', 'C', f, thr), A_vs_B: compare(eligible, 'A', 'B', f, thr), B_vs_C: compare(eligible, 'B', 'C', f, thr),
    };
  }
  // primary: W ∪ T pooled
  const WT = [...stratumPages.W, ...stratumPages.T];
  const wtFloor = quantile(WT.filter((p) => val(p, 'A', 'fabricated') != null && val(p, 'A2', 'fabricated') != null).map((p) => Math.abs(val(p, 'A', 'fabricated') - val(p, 'A2', 'fabricated'))), 0.9);
  const wtThr = wtFloor > 0 ? wtFloor : 1 / K;
  const pooled = { n_pages: WT.length, noise_floor_p90_abs_A_A2: r4(wtFloor), page_threshold: r4(wtThr),
    arms: Object.fromEntries(ARMS.map((a) => [a, r4(mean(WT.map((p) => val(p, a, 'fabricated')).filter((x) => x != null)))])) };
  for (const [x, y] of [['A', 'A2'], ['A', 'B'], ['A', 'C'], ['B', 'C']]) pooled[`${x}_vs_${y}`] = compare(WT, x, y, 'fabricated', wtThr);

  const loop = {};
  for (const arm of ARMS) {
    let k = 0, n = 0;
    for (const p of live) { const a = per.get(key(p))[arm]; if (!a?.n_runs) continue; n += a.n_runs; k += Math.round(a.mean.loop * a.n_runs); }
    loop[arm] = wilson(k, n);
  }

  // Context echo: also over runs that fabricated (where an echo is a sign of writing from the book's identity)
  const echo = {};
  for (const arm of ARMS) {
    let n = 0, e = 0, nf = 0, ef = 0;
    for (const p of WT) for (let k = 1; k <= K; k++) {
      const r = reads.get(`${arm}:${p.uid}:${k}`); if (!r?.text) continue;
      const c = contextEcho(p, r.text); n++; e += c;
      if (letters(bodyText(r.text)) > 20) { nf++; ef += c; }
    }
    echo[arm] = { runs: n, echo: e, rate: r4(e / n), fabricated_runs: nf, echo_in_fabricated: ef, rate_in_fabricated: nf ? r4(ef / nf) : null };
  }

  const decide = (X) => {
    const c = pooled[`A_vs_${X}`], t = strata.T[`A_vs_${X}`], s3 = strata.S3, s5 = strata.S5;
    const s5d = s5[`A_vs_${X}`];
    const s5lim = Math.max(s5.noise_floor_p90_abs_A_A2 || 0, 0.01);
    const ok = (...xs) => xs.every((x) => x != null && !Number.isNaN(x)); // a missing arm or stratum fails its clause
    return {
      1: { name: 'W ∪ T fabricated falls (primary)', test: `mean(A−${X}) ${c.mean} > 0 AND sign p ${c.sign_p} < 0.05 (${c.y_lower} better / ${c.y_higher} worse / ${c.ties} tie)`, pass: ok(c.mean) && c.mean > 0 && c.sign_p < 0.05 },
      2: { name: 'T: better on more pages than worse', test: `${t.y_lower} better > ${t.y_higher} worse`, pass: t.n > 0 && t.y_lower > t.y_higher },
      3: { name: 'S3 false-blank guard', test: `${X} ${s3.arms[X].mean} ≤ A ${s3.arms.A.mean} + 0.05`, pass: ok(s3.arms[X].mean, s3.arms.A.mean) && s3.arms[X].mean <= s3.arms.A.mean + 0.05 + 1e-12 },
      4: { name: 'S5 windowed-CER guard', test: `median(${X}−A) ${r4(-s5d.median)} ≤ max(floor ${s5.noise_floor_p90_abs_A_A2}, 0.01)`, pass: ok(s5d.median) && -s5d.median <= s5lim + 1e-12 },
      5: { name: 'loop guard', test: `${X} Wilson lo ${loop[X].lo} ≤ A Wilson hi ${loop.A.hi}`, pass: ok(loop[X].lo, loop.A.hi) && loop[X].lo <= loop.A.hi },
    };
  };
  const clausesC = decide('C'), clausesB = decide('B');
  const passC = Object.values(clausesC).every((c) => c.pass), passB = Object.values(clausesB).every((c) => c.pass);
  const recommendation = passC ? 'v19' : passB ? 'v18' : 'not established';

  const firstText = (p, arm) => { for (let k = 1; k <= K; k++) { const r = reads.get(`${arm}:${p.uid}:${k}`); if (r?.text) return r.text; } return ''; };
  const examples = [];
  for (const p of live) {
    const a = per.get(key(p)); const link = p.book_id ? `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}` : p.image;
    const ex = (kind) => examples.push({ kind, stratum: p.stratum, uid: p.uid, link, label_note: p.label_note, title: p.title, A: firstText(p, 'A').replace(/\s+/g, ' ').slice(0, 320), B: firstText(p, 'B').replace(/\s+/g, ' ').slice(0, 260), C: firstText(p, 'C').replace(/\s+/g, ' ').slice(0, 320),
      fabricated: Object.fromEntries(ARMS.map((x) => [x, r4(a[x].mean.fabricated ?? a[x].mean.false_blank)])) });
    if ((p.stratum === 'W' || p.stratum === 'T') && a.A.mean.fabricated === 1 && a.A2.mean.fabricated === 1 && a.C.mean.fabricated === 0) ex(a.B.mean.fabricated === 1 ? 'fixed-by-C-not-B' : 'fixed-by-C');
    if ((p.stratum === 'W' || p.stratum === 'T') && a.C.mean.fabricated === 1) ex('C-still-fabricates');
    if (p.stratum === 'S3' && a.C.mean.false_blank > a.A.mean.false_blank) ex('over-decline-under-C');
  }

  const sum = (r) => r.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0);
  const result = {
    issue: 4195, preregistration: 'scripts/eval/PREREGISTRATION-ocr-v19-showthrough.md', at: new Date().toISOString(), model: MODEL, k: K, seed: SEED,
    prompts: est.prompts, generation: est.generation, image: est.image,
    batch_jobs: [...screenRec.jobs.map((j) => ({ ...j, arm: `screen-${j.arm}` })), ...rec.jobs].map(({ arm, job_name, requests, outcomes, in_tokens, out_tokens, cost_usd, terminal_state }) => ({ arm, job_name, requests, outcomes, in_tokens, out_tokens, cost_usd: r4(cost_usd), terminal_state })),
    cancelled_jobs: (rec.cancelled || []).map(({ arm, job_name, terminal_state, note }) => ({ arm, job_name, terminal_state, note })),
    cost: { screen_usd: r4(sum(screenRec)), arms_estimate_usd: est.usd, arms_usd: r4(sum(rec)), actual_usd: r4(sum(screenRec) + sum(rec)), cap_usd: CAP_USD },
    pages: { drawn: pages.length, live: live.length, dropped_image_fetch: dropped },
    run_outcomes: runCounts, primary_W_T: pooled, strata, loop, context_echo: echo,
    decision: { C: { clauses: clausesC, all_pass: passC }, B: { clauses: clausesB, all_pass: passB }, recommendation },
    examples,
    per_page: live.map((p) => ({ uid: p.uid, stratum: p.stratum, book_id: p.book_id, page_number: p.page_number, source: p.source || p.pool, label: p.label, label_note: p.label_note, language: p.language,
      arms: Object.fromEntries(ARMS.map((a) => [a, { n_runs: per.get(key(p))[a].n_runs, ...Object.fromEntries(Object.entries(per.get(key(p))[a].mean).map(([k, v]) => [k, r4(v)])), page_types: per.get(key(p))[a].page_types }])) })),
  };
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(result, null, 1));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'reads.jsonl.gz'), zlib.gzipSync(fs.readFileSync(F('reads.jsonl'))));
  fs.writeFileSync(path.join(RESULTS_DIR, 'screen-reads.jsonl.gz'), zlib.gzipSync(fs.readFileSync(path.join(SCREEN, 'reads.jsonl'))));
  writeJsonl(path.join(RESULTS_DIR, 'pages.jsonl'), pages.map(({ ref, ...p }) => ({ ...p, ref_chars: ref ? ref.length : undefined })));
  fs.copyFileSync(F('draw-log.json'), path.join(RESULTS_DIR, 'draw-log.json'));
  fs.copyFileSync(path.join(SCREEN, 'draw-log.json'), path.join(RESULTS_DIR, 'screen-draw-log.json'));

  console.log(`\n== OCR v19 confirmatory (#4195)  ${MODEL} k=${K}  pages ${live.length} (dropped ${dropped.length})  cost $${result.cost.actual_usd}`);
  console.log('run outcomes:', JSON.stringify(runCounts));
  console.log(`\n[W∪T] n=${WT.length} fabricated ${ARMS.map((a) => `${a} ${pooled.arms[a]}`).join('  ')}  floor ${pooled.noise_floor_p90_abs_A_A2} thr ${pooled.page_threshold}`);
  for (const c of ['A_vs_A2', 'A_vs_B', 'A_vs_C', 'B_vs_C']) console.log(`   ${c}: ${JSON.stringify(pooled[c])}`);
  for (const [S, s] of Object.entries(strata)) {
    console.log(`\n[${S}] ${s.outcome} n=${s.n_scored}/${s.n_pages} floor ${s.noise_floor_p90_abs_A_A2} thr ${s.page_threshold} (A=A2 on ${s.aa_identical}/${s.aa_pages})`);
    for (const a of ARMS) console.log(`   ${a.padEnd(3)} ${JSON.stringify(s.arms[a])}`);
    for (const c of ['A_vs_A2', 'A_vs_B', 'A_vs_C', 'B_vs_C']) console.log(`   ${c}: ${JSON.stringify(s[c])}`);
  }
  console.log('\nloop:', ARMS.map((a) => `${a} ${loop[a].k}/${loop[a].n} [${loop[a].lo}, ${loop[a].hi}]`).join('  '));
  console.log('context echo:', JSON.stringify(echo));
  for (const [X, cl] of [['C', clausesC], ['B', clausesB]]) { console.log(`\ndecision ${X}:`); for (const [i, c] of Object.entries(cl)) console.log(`  ${i}. ${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.test}`); }
  console.log(`  → ${recommendation}`);
  console.log(`examples: ${JSON.stringify(examples.reduce((a, e) => ((a[e.kind] = (a[e.kind] || 0) + 1), a), {}))}`);
}

// ───────────────────────────── v19.1 (PREREGISTRATION-ocr-v19-1-stamps.md) ─────────────────────────────
// Two new arms on the v19 run's exact 195 pages: D = v19.1, A3 = v16 again (a contemporaneous control).
// A, A2, B, C are reused from the v19 run's committed reads, never re-run. No screen, no relabelling.
const V191 = {
  work: opt('work191', '/root/claude-jobs/ocr-v19-1-work'), arms: ['D', 'A3'], k: K, jobName: 'ocr-v19-1-4195', endpoint: 'eval/ocr-v19-1-4195', capUsd: 3,
  candidate: path.join(__dirname, '../../prompts/ocr/standard-ocr-v19-1-candidate.md'),
  results: path.join(__dirname, 'results/ocr-v19-1-2026-10.json'), resultsDir: path.join(__dirname, 'results/ocr-v19-1-2026-10'),
  stampWords: path.join(__dirname, 'dataset/ocr-v19-1-stamp-words.json'),
};
const G = (n) => path.join(V191.work, n);
const STAMP_RE = /mirror|show-?through|bleed|reversed|behind|other side|verso|recto/i; // Amendment 1.1

async function stageBuild191() {
  fs.mkdirSync(V191.work, { recursive: true });
  const pages = readJsonl(F('pages.jsonl')); // the v19 run's draw, with S5 refs
  const prior = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8')).per_page.map((p) => `${p.stratum}:${p.uid}`).sort();
  const mine = pages.map((p) => `${p.stratum}:${p.uid}`).sort();
  if (JSON.stringify(prior) !== JSON.stringify(mine)) throw new Error('WORK/pages.jsonl is not the v19 run\'s scored page set');
  writeJsonl(G('pages.jsonl'), pages);
  const p = await loadPrompts({ D: V191.candidate });
  await stageBuild({ ...V191, prompts: { D: p.D, A3: { ...p.A } } });
  // the same images as v19? (a changed image would make A3-vs-A drift an input change, not model drift)
  const before = new Map(readJsonl(F('images.jsonl')).map((m) => [m.uid, m.image_hash]));
  const changed = readJsonl(G('images.jsonl')).filter((m) => !m.fetch_error && before.get(m.uid) !== m.image_hash).map((m) => m.uid);
  fs.writeFileSync(G('image-drift.json'), JSON.stringify({ changed }, null, 1));
  console.log(`images changed since the v19 run: ${changed.length}`);
}

const fold = (s) => ` ${(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

function stageScore191() {
  const ALL = ['A', 'A2', 'A3', 'B', 'C', 'D'];
  const NAME = { A: 'v16', A2: 'v16 again', A3: 'v16 (contemporaneous)', B: 'v18', C: 'v19', D: 'v19.1' };
  const pages = readJsonl(G('pages.jsonl'));
  const reads = new Map();
  const old = zlib.gunzipSync(fs.readFileSync(path.join(RESULTS_DIR, 'reads.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const r of old) if (['A', 'A2', 'B', 'C'].includes(r.arm)) reads.set(`${r.arm}:${r.uid}:${r.k}`, r);
  for (const r of readJsonl(G('reads.jsonl'))) reads.set(`${r.arm}:${r.uid}:${r.k}`, r);
  const rec = JSON.parse(fs.readFileSync(G('batch.json'), 'utf8'));
  const est = JSON.parse(fs.readFileSync(G('estimate.json'), 'utf8'));
  const imgDrift = JSON.parse(fs.readFileSync(G('image-drift.json'), 'utf8'));
  const v19 = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));

  const key = (p) => `${p.stratum}:${p.uid}`;
  const per = new Map(); const runCounts = {};
  for (const p of pages) {
    const byArm = {};
    for (const arm of ALL) {
      const runs = [];
      for (let k = 1; k <= K; k++) {
        const r = reads.get(`${arm}:${p.uid}:${k}`);
        const c = `${arm}:${r ? r.outcome : 'missing'}`; runCounts[c] = (runCounts[c] || 0) + 1;
        if (!r) continue;
        const o = runOutcomes(p, r); if (!o) continue;
        runs.push({ k, ...o });
      }
      const m = {};
      for (const f of [OUTCOME_OF[p.stratum], 'blank_recall', 'loop', 'declared_blank', 'body_letters']) {
        const v = runs.map((r) => r[f]).filter((x) => x != null); m[f] = v.length ? mean(v) : null;
      }
      if (p.stratum === 'S5') m.aligned_runs = runs.filter((r) => r.aligned).length;
      byArm[arm] = { n_runs: runs.length, mean: m, page_types: runs.map((r) => r.page_type) };
    }
    per.set(key(p), byArm);
  }
  const val = (p, arm, f) => per.get(key(p))[arm]?.mean[f];
  function compare(ps, x, y, f, thr) {
    const both = ps.filter((p) => val(p, x, f) != null && val(p, y, f) != null);
    const d = both.map((p) => val(p, x, f) - val(p, y, f));
    const lower = d.filter((v) => v >= thr - 1e-9).length, higher = d.filter((v) => v <= -thr + 1e-9).length;
    return { n: d.length, mean: r4(mean(d)), median: r4(median(d)), y_lower: lower, y_higher: higher, ties: d.length - lower - higher, sign_p: r4(binomTwoSided(lower, lower + higher)) };
  }

  // strata and thresholds exactly as the v19 run (S5 eligibility from A's alignment; floor from A vs A2)
  const stratumPages = {}, thrOf = {}, floorOf = {};
  for (const S of STRATA) {
    const f = OUTCOME_OF[S];
    const sp = pages.filter((p) => p.stratum === S);
    stratumPages[S] = S === 'S5' ? sp.filter((p) => (per.get(key(p)).A.mean.aligned_runs || 0) >= 2) : sp;
    const aa = stratumPages[S].filter((p) => val(p, 'A', f) != null && val(p, 'A2', f) != null).map((p) => Math.abs(val(p, 'A', f) - val(p, 'A2', f)));
    floorOf[S] = aa.length ? r4(quantile(aa, 0.9)) : null;
    thrOf[S] = floorOf[S] > 0 ? floorOf[S] : 1 / K;
    if (floorOf[S] !== v19.strata[S].noise_floor_p90_abs_A_A2 || stratumPages[S].length !== v19.strata[S].n_scored) throw new Error(`${S}: reused A/A2 do not reproduce the v19 run's floor or n`);
  }

  // drift check (Amendment 1.3): A3 vs A, before D is scored
  const drift = { by_stratum: {}, differ: 0, pages: 0 };
  for (const S of STRATA) {
    const f = OUTCOME_OF[S]; const ps = stratumPages[S].filter((p) => val(p, 'A', f) != null && val(p, 'A3', f) != null);
    const n = ps.filter((p) => Math.abs(val(p, 'A', f) - val(p, 'A3', f)) >= thrOf[S] - 1e-9).length;
    const aa = ps.filter((p) => val(p, 'A2', f) != null && Math.abs(val(p, 'A', f) - val(p, 'A2', f)) >= thrOf[S] - 1e-9).length;
    drift.by_stratum[S] = { pages: ps.length, A_A3_differ: n, A_A2_differ: aa, threshold: r4(thrOf[S]), A_vs_A3: compare(ps, 'A', 'A3', f, thrOf[S]) };
    drift.differ += n; drift.pages += ps.length;
  }
  drift.share = r4(drift.differ / drift.pages); drift.drift = drift.share > 0.10; drift.baseline = drift.drift ? 'A3' : 'A';
  const Z = drift.baseline;

  const strata = {};
  for (const S of STRATA) {
    const f = OUTCOME_OF[S]; const el = stratumPages[S];
    const armMean = (a, g = f) => { const v = el.map((p) => val(p, a, g)).filter((x) => x != null); return v.length ? r4(mean(v)) : null; };
    strata[S] = { outcome: f, n_scored: el.length, noise_floor_p90_abs_A_A2: floorOf[S], page_threshold: r4(thrOf[S]),
      arms: Object.fromEntries(ALL.map((a) => [a, { mean: armMean(a), declared_blank: armMean(a, 'declared_blank'), ...(S === 'W' || S === 'T' ? { blank_recall: armMean(a, 'blank_recall') } : {}) }])) };
    for (const y of ['A2', 'A3', 'B', 'C', 'D']) strata[S][`A_vs_${y}`] = compare(el, 'A', y, f, thrOf[S]);
    for (const [x, y] of [['A3', 'D'], ['B', 'D'], ['C', 'D']]) strata[S][`${x}_vs_${y}`] = compare(el, x, y, f, thrOf[S]);
  }
  const WT = [...stratumPages.W, ...stratumPages.T];
  const wtFloor = quantile(WT.map((p) => Math.abs(val(p, 'A', 'fabricated') - val(p, 'A2', 'fabricated'))), 0.9);
  const wtThr = wtFloor > 0 ? wtFloor : 1 / K;
  const pooled = { n_pages: WT.length, noise_floor_p90_abs_A_A2: r4(wtFloor), page_threshold: r4(wtThr),
    arms: Object.fromEntries(ALL.map((a) => [a, r4(mean(WT.map((p) => val(p, a, 'fabricated')).filter((x) => x != null)))])) };
  for (const y of ['A2', 'A3', 'B', 'C', 'D']) pooled[`A_vs_${y}`] = compare(WT, 'A', y, 'fabricated', wtThr);
  for (const [x, y] of [['A3', 'D'], ['B', 'D'], ['C', 'D']]) pooled[`${x}_vs_${y}`] = compare(WT, x, y, 'fabricated', wtThr);

  const loop = {};
  for (const arm of ALL) {
    let k = 0, n = 0;
    for (const p of pages) { const a = per.get(key(p))[arm]; if (!a?.n_runs) continue; n += a.n_runs; k += Math.round(a.mean.loop * a.n_runs); }
    loop[arm] = wilson(k, n);
  }

  const decide = (X, base) => {
    const c = pooled[`${base}_vs_${X}`], t = strata.T[`${base}_vs_${X}`], s3 = strata.S3, s5 = strata.S5, s5d = s5[`${base}_vs_${X}`];
    const s5lim = Math.max(s5.noise_floor_p90_abs_A_A2 || 0, 0.01);
    const ok = (...xs) => xs.every((x) => x != null && !Number.isNaN(x));
    return {
      1: { name: 'W ∪ T fabricated falls (primary)', test: `mean(${base}−${X}) ${c.mean} > 0 AND sign p ${c.sign_p} < 0.05 (${c.y_lower} better / ${c.y_higher} worse / ${c.ties} tie)`, pass: ok(c.mean) && c.mean > 0 && c.sign_p < 0.05 },
      2: { name: 'T: better on more pages than worse', test: `${t.y_lower} better > ${t.y_higher} worse`, pass: t.n > 0 && t.y_lower > t.y_higher },
      3: { name: 'S3 false-blank guard', test: `${X} ${s3.arms[X].mean} ≤ ${base} ${s3.arms[base].mean} + 0.05`, pass: ok(s3.arms[X].mean, s3.arms[base].mean) && s3.arms[X].mean <= s3.arms[base].mean + 0.05 + 1e-12 },
      4: { name: 'S5 windowed-CER guard', test: `median(${X}−${base}) ${r4(-s5d.median)} ≤ max(floor ${s5.noise_floor_p90_abs_A_A2}, 0.01)`, pass: ok(s5d.median) && -s5d.median <= s5lim + 1e-12 },
      5: { name: 'loop guard', test: `${X} Wilson lo ${loop[X].lo} ≤ ${base} Wilson hi ${loop[base].hi}`, pass: ok(loop[X].lo, loop[base].hi) && loop[X].lo <= loop[base].hi },
    };
  };
  const clausesD = decide('D', Z);
  const passD = Object.values(clausesD).every((c) => c.pass);
  const vsB = pooled.B_vs_D; // positive = D lower = D better
  const notWorseThanB = !(vsB.y_higher > vsB.y_lower);
  const recommendation = passD && notWorseThanB ? 'v19.1' : 'v18';

  // stamp capture (Amendment 1.1–1.2)
  const words = JSON.parse(fs.readFileSync(V191.stampWords, 'utf8')).pages;
  const stampPages = stratumPages.S3.filter((p) => p.label === 'real-ink' && /v19 label/.test(p.source || '') && STAMP_RE.test(p.label_note || ''));
  if (stampPages.length !== 20) throw new Error(`stamp pages ${stampPages.length}, expected 20`);
  const stamp = { pages: stampPages.length, scored_pages: 0, arms: {}, per_page: [] };
  const scored = stampPages.filter((p) => words[p.uid]); stamp.scored_pages = scored.length;
  const hit = (p, arm, k) => { const r = reads.get(`${arm}:${p.uid}:${k}`); if (!r?.text) return 0; const b = fold(bodyText(r.text)); return words[p.uid].some((w) => b.includes(fold(w))) ? 1 : 0; };
  for (const arm of ALL) {
    let h = 0, n = 0; for (const p of scored) for (let k = 1; k <= K; k++) { n++; h += hit(p, arm, k); }
    stamp.arms[arm] = { runs: n, captured: h, share: r4(h / n), false_blank: r4(mean(stampPages.map((p) => val(p, arm, 'false_blank')))) };
  }
  for (const p of scored) stamp.per_page.push({ uid: p.uid, link: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`, words: words[p.uid],
    captured: Object.fromEntries(ALL.map((a) => [a, [1, 2, 3].map((k) => hit(p, a, k)).reduce((s, x) => s + x, 0)])) });

  const firstText = (p, arm) => { for (let k = 1; k <= K; k++) { const r = reads.get(`${arm}:${p.uid}:${k}`); if (r?.text) return r.text; } return ''; };
  const examples = [];
  for (const p of pages) {
    const a = per.get(key(p)); const f = OUTCOME_OF[p.stratum]; const link = `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`;
    const ex = (kind) => examples.push({ kind, stratum: p.stratum, uid: p.uid, link, label_note: p.label_note, title: p.title,
      outcome: Object.fromEntries(ALL.map((x) => [x, r4(a[x].mean[f])])), ...Object.fromEntries(['A', 'B', 'C', 'D'].map((x) => [x, firstText(p, x).replace(/\s+/g, ' ').slice(0, 360)])) });
    if (p.stratum === 'S3' && a.C.mean.false_blank > a.A.mean.false_blank && a.D.mean.false_blank < a.C.mean.false_blank) ex('C-over-declined-D-keeps');
    if (p.stratum === 'S3' && a.D.mean.false_blank > a[Z].mean.false_blank) ex('over-decline-under-D');
    if ((p.stratum === 'W' || p.stratum === 'T') && a.D.mean.fabricated < a.B.mean.fabricated) ex('D-better-than-B');
    if ((p.stratum === 'W' || p.stratum === 'T') && a.D.mean.fabricated > a.C.mean.fabricated) ex('D-worse-than-C');
  }

  const v19Cost = v19.cost;
  const actual = rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0);
  const result = {
    issue: 4195, preregistration: 'scripts/eval/PREREGISTRATION-ocr-v19-1-stamps.md', at: new Date().toISOString(), model: MODEL, k: K, seed: SEED,
    arms: NAME, reused_from: 'scripts/eval/results/ocr-v19-ab-2026-10.json (arms A, A2, B, C; reads in results/ocr-v19-ab-2026-10/reads.jsonl.gz)',
    prompts: { ...v19.prompts, ...est.prompts }, generation: est.generation, image: est.image, image_drift_since_v19: imgDrift,
    batch_jobs: rec.jobs.map(({ arm, job_name, requests, outcomes, in_tokens, out_tokens, cost_usd, terminal_state }) => ({ arm, job_name, requests, outcomes, in_tokens, out_tokens, cost_usd: r4(cost_usd), terminal_state })),
    cost: { estimate_usd: est.usd, actual_usd: r4(actual), cap_usd: V191.capUsd, v19_run_reused_usd: v19Cost.actual_usd },
    run_outcomes: runCounts, drift, primary_W_T: pooled, strata, loop, stamp_capture: stamp,
    decision: { baseline: Z, D: { clauses: clausesD, all_pass: passD }, D_not_worse_than_B_on_WT: { test: `B_vs_D: D better ${vsB.y_lower} / worse ${vsB.y_higher} / tie ${vsB.ties}, sign p ${vsB.sign_p}`, pass: notWorseThanB }, recommendation },
    examples,
    per_page: pages.map((p) => ({ uid: p.uid, stratum: p.stratum, book_id: p.book_id, page_number: p.page_number, label: p.label, label_note: p.label_note,
      arms: Object.fromEntries(ALL.map((a) => [a, { n_runs: per.get(key(p))[a].n_runs, ...Object.fromEntries(Object.entries(per.get(key(p))[a].mean).map(([k, v]) => [k, r4(v)])), page_types: per.get(key(p))[a].page_types }])) })),
  };
  fs.writeFileSync(V191.results, JSON.stringify(result, null, 1));
  fs.mkdirSync(V191.resultsDir, { recursive: true });
  fs.writeFileSync(path.join(V191.resultsDir, 'reads.jsonl.gz'), zlib.gzipSync(fs.readFileSync(G('reads.jsonl'))));

  console.log(`\n== OCR v19.1 (#4195) ${MODEL} k=${K} pages ${pages.length} cost $${result.cost.actual_usd}  images changed since v19: ${imgDrift.changed.length}`);
  console.log('run outcomes:', JSON.stringify(runCounts));
  console.log(`\ndrift: ${drift.differ}/${drift.pages} = ${drift.share} → baseline ${Z}`, JSON.stringify(drift.by_stratum));
  console.log(`\n[W∪T] n=${WT.length} fabricated ${ALL.map((a) => `${a} ${pooled.arms[a]}`).join('  ')} thr ${pooled.page_threshold}`);
  for (const c of Object.keys(pooled).filter((x) => x.includes('_vs_'))) console.log(`   ${c}: ${JSON.stringify(pooled[c])}`);
  for (const [S, s] of Object.entries(strata)) {
    console.log(`\n[${S}] ${s.outcome} n=${s.n_scored} floor ${s.noise_floor_p90_abs_A_A2} thr ${s.page_threshold}`);
    for (const a of ALL) console.log(`   ${a.padEnd(3)} ${JSON.stringify(s.arms[a])}`);
    for (const c of Object.keys(s).filter((x) => x.includes('_vs_'))) console.log(`   ${c}: ${JSON.stringify(s[c])}`);
  }
  console.log('\nloop:', ALL.map((a) => `${a} ${loop[a].k}/${loop[a].n} [${loop[a].lo}, ${loop[a].hi}]`).join('  '));
  console.log('stamp capture:', JSON.stringify(stamp.arms));
  console.log(`\ndecision D (baseline ${Z}):`); for (const [i, c] of Object.entries(clausesD)) console.log(`  ${i}. ${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.test}`);
  console.log(`  not worse than v18 on W∪T: ${notWorseThanB ? 'PASS' : 'FAIL'} ${result.decision.D_not_worse_than_B_on_WT.test}`);
  console.log(`  → ${recommendation}`);
  console.log(`examples: ${JSON.stringify(examples.reduce((a, e) => ((a[e.kind] = (a[e.kind] || 0) + 1), a), {}))}`);
}

const STAGES = {
  'v191-build': stageBuild191, 'v191-submit': () => stageSubmit(V191), 'v191-poll': async () => process.exit((await stagePoll(V191)) ? 0 : 1), 'v191-score': stageScore191,
  'screen-draw': stageScreenDraw, 'screen-build': stageScreenBuild,
  'screen-submit': () => stageSubmit(SCREEN_CFG), 'screen-poll': async () => process.exit((await stagePoll(SCREEN_CFG)) ? 0 : 1),
  qualify: stageQualify, draw: stageDraw,
  build: async () => stageBuild({ ...ARMS_CFG, prompts: await loadPrompts(CANDIDATES) }),
  submit: () => stageSubmit(ARMS_CFG), poll: async () => process.exit((await stagePoll(ARMS_CFG)) ? 0 : 1),
  score: stageScore,
};
const stage = Object.keys(STAGES).find((s) => flag(s));
if (!stage) { console.error(`usage: --${Object.keys(STAGES).join(' | --')}`); process.exit(2); }
await STAGES[stage]();

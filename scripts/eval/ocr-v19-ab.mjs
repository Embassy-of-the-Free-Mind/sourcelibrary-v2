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
import { bodyText, declaredBlank, TAGGED } from './blank-page-study.mjs';
import { makeRng, binomTwoSided, mean } from './lib/paired-stats.mjs';
import {
  SEED, MODEL, V04, REF_5250, readJsonl, writeJsonl, r4, shuffle, letters, makeResolver, loadPrompts, md5, LANGUAGE_INSTRUCTION, BAD_LANG,
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
  // Post hoc (found after D was scored): bodyText's generic `<[^>]+>` strip reads the centring markers `->LINE<-` as a tag,
  // so `<- BS 100 1912 Cop. 2 ->` between two centred lines is deleted. `body_loose` strips only real tags and the markers.
  const bodyLoose = (t) => (t || '').replace(TAGGED, ' ').replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/gi, ' ').replace(/->|<-/g, ' ');
  const hit = (p, arm, k, body = bodyText) => { const r = reads.get(`${arm}:${p.uid}:${k}`); if (!r?.text) return 0; const b = fold(body(r.text)); return words[p.uid].some((w) => b.includes(fold(w))) ? 1 : 0; };
  for (const arm of ALL) {
    let h = 0, hl = 0, n = 0; for (const p of scored) for (let k = 1; k <= K; k++) { n++; h += hit(p, arm, k); hl += hit(p, arm, k, bodyLoose); }
    stamp.arms[arm] = { runs: n, captured: h, share: r4(h / n), captured_body_loose_post_hoc: hl, share_body_loose_post_hoc: r4(hl / n), false_blank: r4(mean(stampPages.map((p) => val(p, arm, 'false_blank')))) };
  }
  const sumK = (p, a, body) => [1, 2, 3].map((k) => hit(p, a, k, body)).reduce((s, x) => s + x, 0);
  for (const p of scored) stamp.per_page.push({ uid: p.uid, link: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`, words: words[p.uid],
    captured: Object.fromEntries(ALL.map((a) => [a, sumK(p, a, bodyText)])), captured_body_loose_post_hoc: Object.fromEntries(ALL.map((a) => [a, sumK(p, a, bodyLoose)])) });

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

// ───────────────────────────── v20 tags (PREREGISTRATION-ocr-v20-tags.md) ─────────────────────────────
// Four fresh arms (D = v19.1, D2 = v19.1 again, E = v19.1 + tag wording, F = E − the "too cautious" sentence) on the
// v19 run's 195 pages plus two new strata: PN (printed page numbers) and LG (language labels).
const V20 = {
  work: opt('work20', '/root/claude-jobs/ocr-v20-work'), arms: ['D', 'D2', 'E', 'F'], k: K, jobName: 'ocr-v20-tags-4195', endpoint: 'eval/ocr-v20-tags-4195', capUsd: 8,
  base: path.join(__dirname, '../../prompts/ocr/standard-ocr-v19-1-candidate.md'), baseMd5: '9d8f959e053491362b2c4acec1e20c9a',
  E: path.join(__dirname, '../../prompts/ocr/standard-ocr-v20-E-candidate.md'), F: path.join(__dirname, '../../prompts/ocr/standard-ocr-v20-F-candidate.md'),
  v19pages: opt('v19pages', F('pages.jsonl')), v19images: opt('v19images', F('images.jsonl')),
  keyCheck: path.join(__dirname, 'dataset/ocr-v20-pn-key-check.jsonl'),
  results: path.join(__dirname, 'results/ocr-v20-tags-2026-10.json'), resultsDir: path.join(__dirname, 'results/ocr-v20-tags-2026-10'),
};
const H = (n) => path.join(V20.work, n);

/** Replace exactly once, or throw (ocr-prompt-v17-lacuna.mjs's rule: a prompt edit that misses is worse than one that fails). */
function once(text, find, replace, label) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] anchor matched ${n}x, expected 1: ${find.slice(0, 100)}`);
  return text.replace(find, replace);
}
const V20_EDITS = [
  ['item 6 line 1', 'Transcribe this historical manuscript page to Markdown.', 'Transcribe this historical page to Markdown.'],
  ['item 6 context', 'transcribing public domain manuscripts (16th-18th century) from institutional archives', 'transcribing public domain books and manuscripts from institutional archives'],
  ['item 4 language', '- <language>X</language> — the detected language of this page (REQUIRED — always identify the language)',
    '- <language>X</language> — the primary language of this page\'s text, by its standard English name (REQUIRED). Examples: Latin, German, Ancient Greek, Hebrew, Arabic, Persian, Ottoman Turkish, Punjabi, Sanskrit, Classical Chinese, Japanese. Name the LANGUAGE, never the script or writing system (Punjabi, not Gurmukhi; Persian, not Arabic script; Japanese, not Kanji). Give ONE language: the one most of the text is in.'],
  ['item 6 script', '- <script>printed|handwritten|mixed</script> — whether the text is typeset, handwritten, or mixed (REQUIRED)',
    '- <script>printed|handwritten|mixed</script> — how the text was made (REQUIRED). printed = set in type, cut on a woodblock (xylograph), engraved or lithographed; handwritten = written by hand, including text brush-written on pre-printed ruled paper or forms; mixed = both on this page'],
  ['item 2 page-num', '- <page-num>N</page-num> — visible page/folio numbers (NOT in body text)',
    '- <page-num>N</page-num> — the page or folio number printed or written on THIS page, exactly as it appears: arabic (123), roman (xiv), or a folio with its side (12r, 12v). Omit the tag if no number is visible. Never work it out from a neighbouring page, the scan order or the book\'s structure, and never use a chapter, section, plate or signature number (NOT in body text)'],
  ['item 1 sig', '- <sig>X</sig> — printer\'s marks like A2, B1 (NOT in body text)', '- <sig>X</sig> — printer\'s signature marks, transcribed exactly as printed on THIS page (NOT in body text)'],
];
const V20_F_EDIT = ['item 5', ' If you are marking more than ~20% of words as unclear, you are being too cautious.', ''];

function stageCandidates20() {
  const base = fs.readFileSync(V20.base, 'utf8');
  if (md5(base) !== V20.baseMd5) throw new Error(`v19.1 file md5 ${md5(base)} != ${V20.baseMd5}`);
  let e = base;
  for (const [label, a, b] of V20_EDITS) e = once(e, a, b, label);
  const f = once(e, V20_F_EDIT[1], V20_F_EDIT[2], V20_F_EDIT[0]);
  fs.writeFileSync(V20.E, e); fs.writeFileSync(V20.F, f);
  console.log(`E md5 ${md5(e)} (${e.length} chars)  F md5 ${md5(f)} (${f.length} chars)  base ${base.length}`);
}

const LG_TARGETS = [
  ['greek', /^(ancient |classical |koine |byzantine )?greek/i, 4], ['arabic', /^arabic/i, 3], ['persian', /^(persian|farsi)/i, 3], ['hebrew', /^hebrew/i, 3],
  ['chinese', /^(classical |literary )?chinese/i, 3], ['japanese', /^japanese/i, 3], ['sanskrit', /^sanskrit/i, 3], ['punjabi', /^(punjabi|panjabi)/i, 2],
  ['ottoman', /^ottoman/i, 2], ['armenian', /^armenian/i, 2], ['slavonic', /^(old church slavonic|church slavonic|russian)/i, 2],
  ['mixed', /,/, 5], ['latin', /^latin$/i, 2], ['german', /^german$/i, 2], ['french', /^french$/i, 1],
];
const PN_TARGET = { online: 30, misread: 20 };

async function stageDraw20() {
  fs.mkdirSync(V20.work, { recursive: true });
  const { withMongo } = await import('../lib/mongo.mjs');
  const { pageNumberBreaks, pageNumMisreads, parsePageNum, NON_TEXT_TYPES } = await import('../lib/page-integrity.mjs');
  const { toLanguageCodes } = await import('../lib/language-normalize.mjs');
  const core = readJsonl(V20.v19pages);
  const prior = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8')).per_page.map((p) => `${p.stratum}:${p.uid}`).sort();
  if (JSON.stringify(prior) !== JSON.stringify(core.map((p) => `${p.stratum}:${p.uid}`).sort())) throw new Error('v19pages is not the v19 run\'s scored page set');
  const log = { seed: SEED, pn: { books_scanned: 0, picked: { online: 0, misread: 0 } }, lg: {}, skipped: {} };
  const skip = (stratum, reason, what) => ((log.skipped[stratum] ||= []).push({ reason, ...what }));
  const used = new Set(core.map((p) => p.book_id));
  const out = [];
  const rng = makeRng(SEED);
  await withMongo(async (db) => {
    const resolve = makeResolver(db, skip);
    // PN: seeded order over every eligible book id (no $sample: it cannot be seeded)
    const ids = (await db.collection('books').find({ visible: true, pages_count: { $gte: 60, $lte: 800 } }, { projection: { id: 1, language: 1 } }).toArray())
      .filter((b) => b.id && !BAD_LANG.test(String(b.language || ''))).map((b) => b.id).sort();
    const order = shuffle(ids, rng);
    for (const bid of order) {
      if (log.pn.picked.online >= PN_TARGET.online && log.pn.picked.misread >= PN_TARGET.misread) break;
      if (used.has(bid) || log.pn.books_scanned >= 600) continue;
      log.pn.books_scanned++;
      const pages = await db.collection('pages').find({ book_id: bid }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
      const rows = pages.filter((p) => typeof p.ocr?.data === 'string').map((p) => ({ p: p.page_number, ocr: p.ocr.data, type: p.page_type || null }));
      if (rows.length < 40) continue;
      const pnb = pageNumberBreaks(rows);
      const okKinds = new Set(Object.entries(pnb.kinds).filter(([k, v]) => (k === 'arabic' || k === 'roman') && v.judged && v.rate === 1).map(([k]) => k));
      if (!okKinds.size) continue;
      const lo = rows[Math.floor(rows.length * 0.1)].p, hi = rows[Math.floor(rows.length * 0.9)].p;
      const textish = (r) => r && !NON_TEXT_TYPES.has(r.type) && r.p >= lo && r.p <= hi;
      let cands = [];
      if (log.pn.picked.misread < PN_TARGET.misread) {
        const byP = new Map(rows.map((r) => [r.p, r]));
        cands = pageNumMisreads(rows).filter((m) => okKinds.has(m.numbering) && textish(byP.get(m.p)) && m.expected > 0)
          .map((m) => ({ page_number: m.p, key: { kind: m.numbering, value: m.expected, printed: m.expectedPrinted, source: 'misread', cause: m.cause, stored_tag: m.tag } }));
      }
      if (!cands.length && log.pn.picked.online < PN_TARGET.online) {
        for (let i = 1; i + 1 < rows.length; i++) {
          const [a, b, c] = [rows[i - 1], rows[i], rows[i + 1]];
          if (!textish(b) || b.p - a.p !== 1 || c.p - b.p !== 1) continue;
          const [va, vb, vc] = [a, b, c].map((r) => parsePageNum(r.ocr));
          if (!va || !vb || !vc || !okKinds.has(vb.kind) || va.kind !== vb.kind || vc.kind !== vb.kind || vb.span !== 1) continue;
          if (vb.value - va.value !== 1 || vc.value - vb.value !== 1) continue;
          cands.push({ page_number: b.p, key: { kind: vb.kind, value: vb.value, printed: (b.ocr.match(/<page-num>([\s\S]*?)<\/page-num>/i) || [])[1]?.trim(), source: 'online' } });
        }
      }
      if (!cands.length) continue;
      const pick = cands[Math.floor(rng() * cands.length)];
      const row = await resolve('PN', { book_id: bid, page_number: pick.page_number }, { key: pick.key });
      if (!row) continue;
      out.push(row); used.add(bid); log.pn.picked[pick.key.source]++;
      if (out.length % 10 === 0) console.log(`  PN ${JSON.stringify(log.pn.picked)} after ${log.pn.books_scanned} books`);
    }
    // LG: per target, seeded order over matching books; one interior text page with > 400 chars of stored OCR
    const all = await db.collection('books').find({ visible: true, pages_count: { $gt: 20 } }, { projection: { id: 1, language: 1, languages: 1, pages_count: 1 } }).toArray();
    for (const [name, re, n] of LG_TARGETS) {
      const pool = all.filter((b) => b.id && typeof b.language === 'string' && re.test(b.language.trim()) && !BAD_LANG.test(b.language) && (name === 'mixed' || !b.language.includes(',') || ['greek', 'arabic', 'persian', 'hebrew', 'chinese', 'japanese', 'sanskrit', 'punjabi', 'ottoman', 'armenian', 'slavonic'].includes(name)))
        .map((b) => b.id).sort();
      const byId = new Map(all.map((b) => [b.id, b]));
      let got = 0; log.lg[name] = { pool: pool.length, picked: 0 };
      for (const bid of shuffle(pool, rng)) {
        if (got >= n) break;
        if (used.has(bid)) continue;
        const b = byId.get(bid);
        const pages = await db.collection('pages').find({ book_id: bid, page_number: { $gte: Math.floor(b.pages_count * 0.2), $lte: Math.ceil(b.pages_count * 0.8) } }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1 } }).limit(60).toArray();
        const ok = pages.filter((p) => typeof p.ocr?.data === 'string' && p.ocr.data.length > 400 && !NON_TEXT_TYPES.has(p.page_type));
        if (!ok.length) continue;
        const pg = ok[Math.floor(rng() * ok.length)];
        const codes = [...new Set([...toLanguageCodes(b.language).codes, ...(Array.isArray(b.languages) ? b.languages.flatMap((x) => toLanguageCodes(x).codes) : [])])];
        if (!codes.length) { skip('LG', 'catalogue-language-unresolved', { book_id: bid, language: b.language }); continue; }
        const row = await resolve('LG', { book_id: bid, page_number: pg.page_number }, { lg_target: name, key_codes: codes, catalogue_language: b.language, catalogue_languages: b.languages || null });
        if (!row) continue;
        out.push(row); used.add(bid); got++;
      }
      log.lg[name].picked = got;
    }
  });
  writeJsonl(H('pages.jsonl'), [...core, ...out]);
  log.counts = [...core, ...out].reduce((a, r) => ((a[r.stratum] = (a[r.stratum] || 0) + 1), a), {});
  log.skipped_counts = Object.fromEntries(Object.entries(log.skipped).map(([s, l]) => [s, l.reduce((a, x) => ((a[x.reason] = (a[x.reason] || 0) + 1), a), {})]));
  fs.writeFileSync(H('draw-log.json'), JSON.stringify(log, null, 1));
  console.log('draw:', JSON.stringify(log.counts), 'pn:', JSON.stringify(log.pn), 'lg:', JSON.stringify(log.lg), 'skipped:', JSON.stringify(log.skipped_counts));
}

/** PN key check by eye: write every misread page's image and 10 on-line pages' images to WORK/eye-pn/. */
async function stageEye20() {
  const sharp = (await import('sharp')).default;
  const pn = readJsonl(H('pages.jsonl')).filter((p) => p.stratum === 'PN');
  const rng = makeRng(SEED + 1);
  const online = shuffle(pn.filter((p) => p.key.source === 'online'), rng).slice(0, 10).map((p) => p.uid);
  const list = pn.filter((p) => p.key.source === 'misread' || online.includes(p.uid));
  fs.mkdirSync(H('eye-pn'), { recursive: true });
  for (const p of list) {
    const res = await fetch(p.image, { signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(await res.arrayBuffer());
    await sharp(buf).resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(H(`eye-pn/${p.uid}.jpg`));
  }
  writeJsonl(H('eye-pn/list.jsonl'), list.map((p) => ({ uid: p.uid, book_id: p.book_id, page_number: p.page_number, key: p.key })));
  console.log(`eye-pn: ${list.length} images (misread ${list.filter((p) => p.key.source === 'misread').length}, online ${online.length})`);
}

async function stageBuild20() {
  const checked = fs.existsSync(V20.keyCheck) ? readJsonl(V20.keyCheck) : null;
  if (!checked) throw new Error(`${V20.keyCheck} missing: check the PN keys by eye first (pre-registration)`);
  const bad = new Set(checked.filter((c) => c.uid && !c.key_ok).map((c) => c.uid));
  const all = readJsonl(H('pages.jsonl'));
  const pages = all.filter((p) => !(p.stratum === 'PN' && bad.has(p.uid)));
  fs.writeFileSync(H('pages-built-from.json'), JSON.stringify({ drawn: all.length, dropped_pn_bad_key: [...bad] }, null, 1));
  // stageBuild reads WORK/pages.jsonl: keep the drawn file aside, build from the checked set
  if (!fs.existsSync(H('pages-drawn.jsonl'))) fs.copyFileSync(H('pages.jsonl'), H('pages-drawn.jsonl'));
  writeJsonl(H('pages.jsonl'), pages);
  const sub = (t) => t.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
  const arm = (file) => { const c = fs.readFileSync(file, 'utf8'); return { text: sub(c), source: path.relative(path.join(__dirname, '../..'), file), content_hash: md5(c) }; };
  const D = arm(V20.base);
  if (D.content_hash !== V20.baseMd5) throw new Error('v19.1 file changed');
  const { withMongo } = await import('../lib/mongo.mjs');
  await withMongo(async (db) => {
    const live = await db.collection('prompts').findOne({ type: 'ocr', is_default: true });
    if (live?.content_hash !== V20.baseMd5) throw new Error(`live OCR default is ${live?.version} (${live?.content_hash}), not v19.1`);
  });
  await stageBuild({ ...V20, prompts: { D, D2: D, E: arm(V20.E), F: arm(V20.F) } });
  const before = new Map(readJsonl(V20.v19images).map((m) => [m.uid, m.image_hash]));
  const changed = readJsonl(H('images.jsonl')).filter((m) => !m.fetch_error && before.has(m.uid) && before.get(m.uid) !== m.image_hash).map((m) => m.uid);
  fs.writeFileSync(H('image-drift.json'), JSON.stringify({ changed }, null, 1));
  console.log(`core images changed since the v19 run: ${changed.length}`);
}

const unclearCount = (t) => ((t || '').match(/<unclear>/gi) || []).length;
const tagVal = (t, tag) => ((t || '').match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*<\\/${tag}>`, 'i')) || [])[1] ?? null;

async function stageScore20() {
  const { parsePageNum } = await import('../lib/page-integrity.mjs');
  const { toLanguageCodes, sameLanguage } = await import('../lib/language-normalize.mjs');
  const ARMS20 = V20.arms;
  const pages = readJsonl(H('pages.jsonl'));
  const imgs = new Map(readJsonl(H('images.jsonl')).map((m) => [m.uid, m]));
  const live = pages.filter((p) => imgs.get(p.uid) && !imgs.get(p.uid).fetch_error);
  const reads = new Map(readJsonl(H('reads.jsonl')).map((r) => [`${r.arm}:${r.uid}:${r.k}`, r]));
  const rec = JSON.parse(fs.readFileSync(H('batch.json'), 'utf8'));
  const est = JSON.parse(fs.readFileSync(H('estimate.json'), 'utf8'));
  const key = (p) => `${p.stratum}:${p.uid}`;
  const OUT20 = { ...OUTCOME_OF, PN: 'pn_correct', LG: 'lg_match' };
  const per = new Map(); const runCounts = {}; const labels = {};
  for (const p of live) {
    const byArm = {};
    for (const arm of ARMS20) {
      const runs = [];
      for (let k = 1; k <= K; k++) {
        const r = reads.get(`${arm}:${p.uid}:${k}`);
        const c = `${arm}:${r ? r.outcome : 'missing'}`; runCounts[c] = (runCounts[c] || 0) + 1;
        if (!r) continue;
        const o = runOutcomes(p, r); if (!o) continue;
        const t = r.text || '';
        o.unclear = unclearCount(t);
        o.script = tagVal(t, 'script');
        if (p.stratum === 'PN') {
          const raw = tagVal(t, 'page-num'); const v = raw == null ? null : parsePageNum(`<page-num>${raw}</page-num>`);
          o.pn_absent = raw == null ? 1 : 0;
          o.pn_correct = v && v.kind === p.key.kind && v.value === p.key.value ? 1 : 0;
          o.pn_raw = raw;
        }
        if (p.stratum === 'LG') {
          const raw = tagVal(t, 'language'); const codes = raw ? toLanguageCodes(raw).codes : [];
          o.lg_resolved = codes.length ? 1 : 0;
          o.lg_match = codes.some((c) => p.key_codes.some((kc) => sameLanguage(c, kc))) ? 1 : 0;
          (labels[arm] ||= {})[raw ?? '(none)'] = ((labels[arm] ||= {})[raw ?? '(none)'] || 0) + 1;
          o.lg_raw = raw;
        }
        runs.push({ k, ...o });
      }
      const m = {};
      for (const f of [OUT20[p.stratum], 'blank_recall', 'loop', 'declared_blank', 'body_letters', 'unclear', 'pn_absent', 'lg_resolved']) {
        const v = runs.map((r) => r[f]).filter((x) => x != null); m[f] = v.length ? mean(v) : null;
      }
      if (p.stratum === 'S5') m.aligned_runs = runs.filter((r) => r.aligned).length;
      byArm[arm] = { n_runs: runs.length, mean: m, raws: runs.map((r) => r.pn_raw ?? r.lg_raw ?? null), scripts: runs.map((r) => r.script), page_types: runs.map((r) => r.page_type) };
    }
    per.set(key(p), byArm);
  }
  const val = (p, arm, f) => per.get(key(p))[arm]?.mean[f];
  /** x vs y; `lower` = pages where y is better (lower when lowerBetter, higher otherwise). */
  function compare(ps, x, y, f, thr, lowerBetter = true) {
    const both = ps.filter((p) => val(p, x, f) != null && val(p, y, f) != null);
    const d = both.map((p) => (lowerBetter ? 1 : -1) * (val(p, x, f) - val(p, y, f)));
    const better = d.filter((v) => v >= thr - 1e-9).length, worse = d.filter((v) => v <= -thr + 1e-9).length;
    return { n: d.length, mean_gain: r4(mean(d)), median_gain: r4(median(d)), y_better: better, y_worse: worse, ties: d.length - better - worse, sign_p: r4(binomTwoSided(better, better + worse)) };
  }
  const floorOf = (ps, f) => { const aa = ps.filter((p) => val(p, 'D', f) != null && val(p, 'D2', f) != null).map((p) => Math.abs(val(p, 'D', f) - val(p, 'D2', f))); const q = aa.length ? quantile(aa, 0.9) : null; return { floor: r4(q), thr: q > 0 ? q : 1 / K }; };
  const SP = {};
  for (const S of [...STRATA, 'PN', 'LG']) {
    const sp = live.filter((p) => p.stratum === S);
    SP[S] = S === 'S5' ? sp.filter((p) => (per.get(key(p)).D.mean.aligned_runs || 0) >= 2) : sp;
  }
  const lowerBetter = { fabricated: true, false_blank: true, wcer: true, pn_correct: false, lg_match: false, lg_resolved: false };
  const strata = {};
  for (const S of [...STRATA, 'PN', 'LG']) {
    const f = OUT20[S]; const el = SP[S]; const fl = floorOf(el, f); const ufl = floorOf(el, 'unclear');
    const armMean = (a, g = f) => { const v = el.map((p) => val(p, a, g)).filter((x) => x != null); return v.length ? r4(mean(v)) : null; };
    strata[S] = { outcome: f, n_pages: live.filter((p) => p.stratum === S).length, n_scored: el.length, floor_p90_abs_D_D2: fl.floor, page_threshold: r4(fl.thr), unclear_floor: ufl.floor,
      arms: Object.fromEntries(ARMS20.map((a) => [a, { mean: armMean(a), unclear: armMean(a, 'unclear'), ...(S === 'PN' ? { absent: armMean(a, 'pn_absent') } : {}), ...(S === 'LG' ? { resolved: armMean(a, 'lg_resolved') } : {}) }])) };
    for (const [x, y] of [['D', 'D2'], ['D', 'E'], ['D', 'F'], ['E', 'F']]) strata[S][`${x}_vs_${y}`] = compare(el, x, y, f, fl.thr, lowerBetter[f]);
    if (S === 'LG') { const rf = floorOf(el, 'lg_resolved'); strata.LG.D_vs_E_resolved = compare(el, 'D', 'E', 'lg_resolved', rf.thr, false); strata.LG.D_vs_F_resolved = compare(el, 'D', 'F', 'lg_resolved', rf.thr, false); }
    strata[S].E_vs_F_unclear_up = compare(el, 'E', 'F', 'unclear', ufl.thr, false); // y_better = pages where F marks MORE unclear
  }
  const WT = [...SP.W, ...SP.T]; const wfl = floorOf(WT, 'fabricated');
  const pooled = { n_pages: WT.length, floor: wfl.floor, thr: r4(wfl.thr), arms: Object.fromEntries(ARMS20.map((a) => [a, r4(mean(WT.map((p) => val(p, a, 'fabricated')).filter((x) => x != null)))])) };
  for (const [x, y] of [['D', 'D2'], ['D', 'E'], ['D', 'F'], ['E', 'F']]) pooled[`${x}_vs_${y}`] = compare(WT, x, y, 'fabricated', wfl.thr);
  const loop = {};
  for (const arm of ARMS20) { let k = 0, n = 0; for (const p of live) { const a = per.get(key(p))[arm]; if (!a?.n_runs) continue; n += a.n_runs; k += Math.round(a.mean.loop * a.n_runs); } loop[arm] = wilson(k, n); }

  const ok = (...xs) => xs.every((x) => x != null && !Number.isNaN(x));
  const guards = (X) => {
    const c = pooled[`D_vs_${X}`], s3 = strata.S3, s5 = strata.S5, s5d = s5[`D_vs_${X}`];
    const s5lim = Math.max(s5.floor_p90_abs_D_D2 || 0, 0.01);
    return {
      G1: { name: 'W ∪ T fabricated: not more pages worse than better', test: `${c.y_better} better / ${c.y_worse} worse / ${c.ties} tie (p ${c.sign_p})`, pass: c.y_worse <= c.y_better },
      G2: { name: 'S3 false blank ≤ D + 0.05', test: `${X} ${s3.arms[X].mean} vs D ${s3.arms.D.mean}`, pass: ok(s3.arms[X].mean, s3.arms.D.mean) && s3.arms[X].mean <= s3.arms.D.mean + 0.05 + 1e-12 },
      G3: { name: 'S5 windowed CER: median(X−D) ≤ max(floor, 0.01)', test: `median ${r4(-s5d.median_gain)} vs ${s5lim}`, pass: ok(s5d.median_gain) && -s5d.median_gain <= s5lim + 1e-12 },
      G4: { name: 'loop: X Wilson lo ≤ D Wilson hi', test: `${loop[X].lo} ≤ ${loop.D.hi}`, pass: ok(loop[X].lo, loop.D.hi) && loop[X].lo <= loop.D.hi },
    };
  };
  const gE = guards('E'), gF = guards('F');
  const pn = strata.PN.D_vs_E, lgm = strata.LG.D_vs_E, lgr = strata.LG.D_vs_E_resolved;
  const P1 = { name: 'PN: E better on more pages, sign p < 0.10', test: `${pn.y_better} better / ${pn.y_worse} worse (p ${pn.sign_p})`, pass: pn.y_better > pn.y_worse && pn.sign_p < 0.10 };
  const P2 = { name: 'LG: match or resolved better on more pages, sign p < 0.10', test: `match ${lgm.y_better}/${lgm.y_worse} (p ${lgm.sign_p}); resolved ${lgr.y_better}/${lgr.y_worse} (p ${lgr.sign_p})`,
    pass: (lgm.y_better > lgm.y_worse && lgm.sign_p < 0.10) || (lgr.y_better > lgr.y_worse && lgr.sign_p < 0.10) };
  const gEpass = Object.values(gE).every((g) => g.pass), gFpass = Object.values(gF).every((g) => g.pass);
  const verdictE = !gEpass ? `not E (${Object.entries(gE).filter(([, g]) => !g.pass).map(([k]) => k).join(', ')})` : P1.pass || P2.pass ? 'E' : 'E safe, not shown to help';
  const s3u = strata.S3.E_vs_F_unclear_up, s5 = strata.S5;
  const fs5d = s5.E_vs_F;
  const Fc = {
    guards: { name: 'F passes G1–G4 vs D', pass: gFpass },
    s3_unclear_up: { name: 'S3: F marks more <unclear> than E on more pages than fewer', test: `${s3u.y_better} up / ${s3u.y_worse} down`, pass: s3u.y_better > s3u.y_worse },
    s5_unclear: { name: 'S5 mean <unclear>: F ≤ E + floor', test: `F ${s5.arms.F.unclear} vs E ${s5.arms.E.unclear} + ${s5.unclear_floor}`, pass: ok(s5.arms.F.unclear, s5.arms.E.unclear) && s5.arms.F.unclear <= s5.arms.E.unclear + (s5.unclear_floor || 0) + 1e-12 },
    s5_cer: { name: 'S5 windowed CER: median(F−E) ≤ max(floor, 0.01)', test: `median ${r4(-fs5d.median_gain)}`, pass: ok(fs5d.median_gain) && -fs5d.median_gain <= Math.max(s5.floor_p90_abs_D_D2 || 0, 0.01) + 1e-12 },
  };
  const verdictF = Object.values(Fc).every((c) => c.pass) ? 'F over E' : 'not F';

  const distinct = Object.fromEntries(ARMS20.map((a) => [a, Object.keys(labels[a] || {}).length]));
  const scriptDist = Object.fromEntries(ARMS20.map((a) => [a, live.filter((p) => p.stratum === 'PN' || p.stratum === 'LG').flatMap((p) => per.get(key(p))[a].scripts).reduce((o, s) => ((o[s ?? '(none)'] = (o[s ?? '(none)'] || 0) + 1), o), {})]));
  const examples = [];
  for (const p of live) {
    const a = per.get(key(p)); const link = `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`;
    if (p.stratum === 'PN' && a.E.mean.pn_correct > a.D.mean.pn_correct) examples.push({ kind: 'PN-fixed-by-E', link, key: p.key, D: a.D.raws, E: a.E.raws });
    if (p.stratum === 'PN' && a.E.mean.pn_correct < a.D.mean.pn_correct) examples.push({ kind: 'PN-worse-under-E', link, key: p.key, D: a.D.raws, E: a.E.raws });
    if (p.stratum === 'LG' && a.E.mean.lg_match > a.D.mean.lg_match) examples.push({ kind: 'LG-fixed-by-E', link, catalogue: p.catalogue_language, D: a.D.raws, E: a.E.raws });
    if (p.stratum === 'LG' && a.E.mean.lg_match < a.D.mean.lg_match) examples.push({ kind: 'LG-worse-under-E', link, catalogue: p.catalogue_language, D: a.D.raws, E: a.E.raws });
    if ((p.stratum === 'W' || p.stratum === 'T') && a.E.mean.fabricated > a.D.mean.fabricated) examples.push({ kind: 'WT-worse-under-E', link, D: a.D.mean.fabricated, E: a.E.mean.fabricated });
    if (p.stratum === 'S3' && a.E.mean.false_blank > a.D.mean.false_blank) examples.push({ kind: 'S3-worse-under-E', link, D: a.D.mean.false_blank, E: a.E.mean.false_blank });
  }
  const actual = rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0);
  const result = {
    issue: 4195, preregistration: 'scripts/eval/PREREGISTRATION-ocr-v20-tags.md', at: new Date().toISOString(), model: MODEL, k: K, seed: SEED,
    arms: { D: 'v19.1', D2: 'v19.1 again', E: 'v19.1 + items 1, 2, 4, 6', F: 'E + item 5' }, prompts: est.prompts, generation: est.generation, image: est.image,
    image_drift_since_v19: JSON.parse(fs.readFileSync(H('image-drift.json'), 'utf8')), pages_built_from: JSON.parse(fs.readFileSync(H('pages-built-from.json'), 'utf8')),
    batch_jobs: rec.jobs.map(({ arm, job_name, requests, outcomes, in_tokens, out_tokens, cost_usd, terminal_state }) => ({ arm, job_name, requests, outcomes, in_tokens, out_tokens, cost_usd: r4(cost_usd), terminal_state })),
    cost: { estimate_usd: est.usd, actual_usd: r4(actual), cap_usd: V20.capUsd }, run_outcomes: runCounts,
    primary_W_T: pooled, strata, loop, lg_distinct_labels: distinct, lg_labels: labels, script_values_pn_lg: scriptDist,
    decision: { E: { guards: gE, P1, P2, verdict: verdictE }, F: { clauses: Fc, verdict: verdictF } },
    examples,
    per_page: live.map((p) => ({ uid: p.uid, stratum: p.stratum, book_id: p.book_id, page_number: p.page_number, key: p.key || p.key_codes || null,
      arms: Object.fromEntries(ARMS20.map((a) => [a, { n_runs: per.get(key(p))[a].n_runs, ...Object.fromEntries(Object.entries(per.get(key(p))[a].mean).map(([k, v]) => [k, r4(v)])), raws: per.get(key(p))[a].raws, page_types: per.get(key(p))[a].page_types }])) })),
  };
  fs.writeFileSync(V20.results, JSON.stringify(result, null, 1));
  fs.mkdirSync(V20.resultsDir, { recursive: true });
  fs.writeFileSync(path.join(V20.resultsDir, 'reads.jsonl.gz'), zlib.gzipSync(fs.readFileSync(H('reads.jsonl'))));
  writeJsonl(path.join(V20.resultsDir, 'pages.jsonl'), pages.map(({ ref, ...p }) => ({ ...p, ref_chars: ref ? ref.length : undefined })));
  fs.copyFileSync(H('draw-log.json'), path.join(V20.resultsDir, 'draw-log.json'));

  console.log(`\n== OCR v20 tags (#4195) ${MODEL} k=${K} pages ${live.length} cost $${result.cost.actual_usd}`);
  console.log('run outcomes:', JSON.stringify(runCounts));
  console.log(`\n[W∪T] n=${WT.length} fabricated ${ARMS20.map((a) => `${a} ${pooled.arms[a]}`).join('  ')} thr ${pooled.thr}`);
  for (const c of ['D_vs_D2', 'D_vs_E', 'D_vs_F', 'E_vs_F']) console.log(`   ${c}: ${JSON.stringify(pooled[c])}`);
  for (const [S, s] of Object.entries(strata)) {
    console.log(`\n[${S}] ${s.outcome} n=${s.n_scored}/${s.n_pages} floor ${s.floor_p90_abs_D_D2} thr ${s.page_threshold}`);
    for (const a of ARMS20) console.log(`   ${a.padEnd(3)} ${JSON.stringify(s.arms[a])}`);
    for (const c of Object.keys(s).filter((x) => x.includes('_vs_'))) console.log(`   ${c}: ${JSON.stringify(s[c])}`);
  }
  console.log('\nloop:', ARMS20.map((a) => `${a} ${loop[a].k}/${loop[a].n} [${loop[a].lo}, ${loop[a].hi}]`).join('  '));
  console.log('LG distinct labels:', JSON.stringify(distinct));
  console.log('\nE:'); for (const [i, c] of Object.entries({ ...gE, P1, P2 })) console.log(`  ${i}. ${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.test}`);
  console.log(`  → ${verdictE}`);
  console.log('F:'); for (const [i, c] of Object.entries(Fc)) console.log(`  ${i}. ${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.test ? ': ' + c.test : ''}`);
  console.log(`  → ${verdictF}`);
  console.log(`examples: ${JSON.stringify(examples.reduce((a, e) => ((a[e.kind] = (a[e.kind] || 0) + 1), a), {}))}`);
}

const STAGES = {
  'v20-candidates': stageCandidates20, 'v20-draw': stageDraw20, 'v20-eye': stageEye20, 'v20-build': stageBuild20,
  'v20-submit': () => stageSubmit(V20), 'v20-poll': async () => process.exit((await stagePoll(V20)) ? 0 : 1), 'v20-score': stageScore20,
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

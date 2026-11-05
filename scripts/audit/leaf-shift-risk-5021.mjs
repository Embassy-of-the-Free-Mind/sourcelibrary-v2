#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-leaf-shift.mjs (#5021) — the per-BOOK number-vote audit; its loadBook is not
// exported and drops the fields a per-page score needs (translation.source, edited_by, the block a page was written in),
// so this has its own loader in the same shape and calls the same classifier (scripts/lib/leaf-shift.mjs classifyBook,
// numbers + names + absorption). scripts/audit/leaf-alignment-screen.mjs (#7866) screens OCR text against IMAGES for
// wrong-leaf transcriptions, not English against its leaf. Nothing scored every translated PAGE for shift risk.
/**
 * leaf-shift-risk-5021 — a $0 per-page risk score for "this page's English belongs to a neighbouring leaf" (#5021).
 * READ-ONLY on Mongo (secondary preferred); writes files under --out only.
 *
 *   features --out DIR [--shard i/n] [--labels-books f.json] [--as-of ISO]
 *       every live translated book (visible, pages_count > 0, pages_translated > 0); one line per book into
 *       DIR/features.s<i>.jsonl: per translated page the stored-field features below. Books listed in
 *       --labels-books (the 2026-11-03 Opus-labelled ones) have their English rebuilt as of --as-of from
 *       page_revisions (they were contained after the labels were taken). Resumable per book.
 *   fit --out DIR --labels f.jsonl [--scores-out f.tsv.gz]
 *       logistic regression on the labelled pages; odds ratios per factor; score every page; top-k% shares.
 *
 * Features per page (all from stored fields, no model):
 *   blk   size of the write block: consecutive page_numbers whose translation.updated_at is within 2 s of the
 *         previous page's (one block call writes its pages milliseconds apart; scripts/lib/leaf-shift.mjs)
 *   pos   position in that block (0-based); odd  a short or odd page (page type index/plate/…, or source < 300
 *         chars, or English < 120 chars) EARLIER in the same block; own/two  absorption residuals: log EN − k − log SRC
 *         and log EN − k − log(SRC + SRC(next)), k the book's median log(EN/SRC); abs  the page absorbs
 *         (absorptionsOf's two thresholds, same block as n+1); absB  an absorbing page earlier in the block;
 *   cls   number vote (own/next/prev/mixed/none); nm  name vote where the numbers are silent; run  inside a gappy run
 *   pv, model, human (translation.source manual/human or edited_by: never contained, never screened).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { classifyBook, ABSORB_OWN_MIN, ABSORB_TWO_MAX, ABSORB_SRC_MIN, ABSORB_SAME_BLOCK_MS } from '../lib/leaf-shift.mjs';
import { scriptOf, CASELESS_LABEL } from './translation-leaf-shift.mjs';

const argv = process.argv.slice(2);
const MODE = argv[0];
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', `${process.env.JOB_SCRATCH || '/tmp'}/leaf-shift-risk`));
const ODD_TYPES = new Set(['index', 'errata', 'title-page', 'blank', 'bibliography', 'contents', 'toc', 'glossary', 'apparatus', 'illustration', 'plate', 'map', 'figure', 'cover', 'endpaper', 'digitizer-insert', 'archived-spread', 'notes', 'footnotes']);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

async function loadBook(db, bookId, asOf) {
  let pages = await db.collection('pages')
    .find({ book_id: bookId, page_number: { $gte: 0 } }, { projection: { _id: 1, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1, 'translation.model': 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation_withheld.updated_at': 1 } })
    .sort({ page_number: 1 }).toArray();
  if (asOf) {
    const ids = pages.map((p) => p.id || String(p._id));
    const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'translation', created_at: { $gt: asOf } }, { projection: { page_id: 1, data: 1, prompt_version: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
    const first = new Map();
    for (const r of revs) if (!first.has(r.page_id)) first.set(r.page_id, r);
    for (const p of pages) {
      const r = first.get(p.id || String(p._id));
      // A revision row holds the value it REPLACED: the first one after as-of is the text as of then.
      if (r && typeof r.data === 'string') p.translation = { ...(p.translation || {}), data: r.data, prompt_version: r.prompt_version ?? p.translation?.prompt_version, updated_at: p.translation?.updated_at ?? p.translation_withheld?.updated_at, restored: true };
    }
  }
  return pages.map((p) => ({
    page_number: p.page_number, ocr: typeof p.ocr?.data === 'string' ? p.ocr.data : '', tr: typeof p.translation?.data === 'string' ? p.translation.data : '',
    pv: p.translation?.prompt_version != null ? String(p.translation.prompt_version).replace(/^v/i, '') : null, model: p.translation?.model || null,
    page_type: p.page_type ?? null, updated: p.translation?.updated_at ? new Date(p.translation.updated_at).toISOString() : null,
    human: ['human', 'manual'].includes(p.translation?.source) || !!p.translation?.edited_by,
  }));
}

/** Per-page features of one book (see the header). */
export function bookFeatures(pages) {
  const res = classifyBook(pages, { rule: 'gappy', names: true, absorb: true });
  const rowOf = new Map(res.rows.map((x) => [x.page_number, x]));
  const byPn = new Map(pages.map((p) => [p.page_number, p]));
  const textLike = (p) => p.tr && !ODD_TYPES.has(p.page_type) && p.ocr.length >= ABSORB_SRC_MIN;
  const ratios = pages.filter(textLike).map((p) => Math.log(p.tr.length / p.ocr.length)).sort((a, b) => a - b);
  const k = ratios.length >= 5 ? ratios[Math.floor(ratios.length / 2)] : null;
  const inRun = new Map();
  for (const r of res.runs) for (let p = r.start; p <= r.end; p++) inRun.set(p, `${r.dir}${r.strong ? 'A' : 'B'}`);
  // Blocks: chains of consecutive page_numbers written within ABSORB_SAME_BLOCK_MS of each other.
  const tr = pages.filter((p) => p.tr);
  const blockOf = new Map();
  let blk = [];
  const blocks = [];
  for (const p of tr) {
    const last = blk[blk.length - 1];
    if (last && p.page_number === last.page_number + 1 && p.updated && last.updated && Math.abs(Date.parse(p.updated) - Date.parse(last.updated)) <= ABSORB_SAME_BLOCK_MS) blk.push(p);
    else { if (blk.length) blocks.push(blk); blk = [p]; }
  }
  if (blk.length) blocks.push(blk);
  const out = [];
  for (const b of blocks) {
    let oddSeen = false, absSeen = false;
    b.forEach((p, i) => {
      const r = rowOf.get(p.page_number);
      const N = byPn.get(p.page_number + 1);
      const own = k != null && p.ocr.length >= 50 ? Math.log(p.tr.length) - k - Math.log(p.ocr.length) : null;
      const two = own != null && N?.ocr ? Math.log(p.tr.length) - k - Math.log(p.ocr.length + N.ocr.length) : null;
      const sameBlockNext = i + 1 < b.length;
      const abs = textLike(p) && sameBlockNext && own != null && two != null && Math.abs(own) > ABSORB_OWN_MIN && Math.abs(two) < ABSORB_TWO_MAX;
      const odd = ODD_TYPES.has(p.page_type) || p.ocr.length < ABSORB_SRC_MIN || p.tr.length < 120;
      out.push({ p: p.page_number, pv: p.pv, m: p.model, en: p.tr.length, src: p.ocr.length, ty: p.page_type, blk: b.length, pos: i, odd: oddSeen ? 1 : 0, self: odd ? 1 : 0, own: r2(own), two: r2(two), abs: abs ? 1 : 0, absB: absSeen ? 1 : 0, cls: r?.cls ?? 'none', nm: r?.nameCls ?? null, run: inRun.get(p.page_number) || null, ...(p.human ? { h: 1 } : {}) });
      if (odd) oddSeen = true;
      if (abs) absSeen = true;
    });
  }
  return { k: r2(k), pages: out };
}

async function features() {
  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred', maxPoolSize: 6, compressors: ['zlib'] });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  fs.mkdirSync(OUT, { recursive: true });
  const [SI, SN] = arg('shard', '0/1').split('/').map(Number);
  const file = path.join(OUT, `features.s${SI}.jsonl`);
  const labelled = new Set(arg('labels-books') ? JSON.parse(fs.readFileSync(arg('labels-books'), 'utf8')) : []);
  const asOf = arg('as-of') ? new Date(arg('as-of')) : null;
  const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).b; } catch { return null; } }) : []);
  try {
    const all = await db.collection('books').find({ pages_translated: { $gt: 0 }, visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, title: 1, language: 1 } }).sort({ _id: 1 }).toArray();
    const mine = all.filter((_, i) => i % SN === SI).filter((b) => !done.has(b.id || String(b._id)));
    console.error(`shard ${SI}/${SN}: ${all.length} books in frame, ${mine.length} to do`);
    let n = 0;
    const worker = async () => {
      for (let b = mine.shift(); b; b = mine.shift()) {
        const id = b.id || String(b._id);
        try {
          const pages = await loadBook(db, id, labelled.has(id) ? asOf : null);
          const f = bookFeatures(pages);
          const sc = scriptOf(pages.filter((p) => p.tr).slice(0, 200).map((p) => p.ocr.slice(0, 1200)).join('\n'));
          fs.appendFileSync(file, JSON.stringify({ b: id, lang: b.language ?? null, script: sc.script, caseless: CASELESS_LABEL.test(String(b.language || '')), k: f.k, pages: f.pages }) + '\n');
        } catch (e) { fs.appendFileSync(path.join(OUT, `errors.s${SI}.log`), `${id}\t${e.message}\n`); }
        if (++n % 200 === 0) console.error(`  s${SI}: ${n}`);
      }
    };
    await Promise.all(Array.from({ length: Number(arg("concurrency", "4")) }, worker));
    console.error(`DONE s${SI}: ${n}`);
  } finally { await client.close(); }
}

// ---------------------------------------------------------------- fit
export const FACTORS = [
  ['block_era', (p) => (p.pv === '10' || p.pv === '11' ? 1 : 0)],
  ['v1_v6', (p) => (p.pv === '1' || p.pv === '6' ? 1 : 0)],
  ['single_page_lane', (p) => (/^(2|5)(\.|$)/.test(p.pv || '') ? 1 : 0)],
  ['multi_page_block', (p) => (p.blk >= 2 ? 1 : 0)],
  ['pos_in_block_ge2', (p) => (p.pos >= 2 ? 1 : 0)],
  ['odd_page_earlier_in_block', (p) => p.odd],
  ['absorbing_page_earlier_in_block', (p) => p.absB],
  ['absorbs_own_plus_next', (p) => p.abs],
  ['length_collapse', (p) => (p.own != null && p.own < -0.5 ? 1 : 0)],
  ['length_swell', (p) => (p.own != null && p.own > 0.5 ? 1 : 0)],
  ['number_vote_neighbour', (p) => (p.cls === 'next' || p.cls === 'prev' ? 1 : 0)],
  ['number_vote_own', (p) => (p.cls === 'own' ? 1 : 0)],
  ['name_vote_neighbour', (p) => (p.cls === 'none' && (p.nm === 'next' || p.nm === 'prev') ? 1 : 0)],
  ['in_gappy_run', (p) => (p.run ? 1 : 0)],
  ['flash_lite_31', (p) => (/3\.1-flash-lite/.test(p.m || '') ? 1 : 0)],
];

/** Newton–Raphson logistic regression with a small ridge (λ), no intercept penalty. */
export function logistic(X, y, { lambda = 1, iters = 30 } = {}) {
  const d = X[0].length + 1;
  let w = new Array(d).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const x = [1, ...X[i]];
      const z = x.reduce((s, v, j) => s + v * w[j], 0);
      const pr = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < d; a++) {
        g[a] += (pr - y[i]) * x[a];
        if (!x[a]) continue;
        for (let b = 0; b < d; b++) H[a][b] += pr * (1 - pr) * x[a] * x[b];
      }
    }
    for (let a = 1; a < d; a++) { g[a] += lambda * w[a]; H[a][a] += lambda; }
    H[0][0] += 1e-6;
    // Solve H · step = g (Gauss–Jordan).
    const M = H.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < d; c++) {
      let piv = c;
      for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const v = M[c][c] || 1e-12;
      for (let j = c; j <= d; j++) M[c][j] /= v;
      for (let r = 0; r < d; r++) if (r !== c && M[r][c]) { const f = M[r][c]; for (let j = c; j <= d; j++) M[r][j] -= f * M[c][j]; }
    }
    const step = M.map((row) => row[d]);
    w = w.map((v, j) => v - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return w;
}

async function* bookLines() {
  for (const f of fs.readdirSync(OUT).filter((x) => /^features\.s\d+\.jsonl$/.test(x)).sort()) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(OUT, f)), crlfDelay: Infinity });
    for await (const l of rl) { if (!l) continue; try { yield JSON.parse(l); } catch { /* torn line */ } }
  }
}

async function fit() {
  // labels: {book_id, page, y: 1|0, arm, language}
  const labels = new Map();
  for (const l of fs.readFileSync(arg('labels'), 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); labels.set(`${j.book_id}:${j.page}`, j); }
  const lab = [];
  for await (const b of bookLines()) for (const p of b.pages) { const L = labels.get(`${b.b}:${p.p}`); if (L) lab.push({ ...p, y: L.y, arm: L.arm, lang: b.lang }); }
  const out = { labelled: lab.length, positives: lab.filter((r) => r.y).length, missing: labels.size - lab.length, models: {} };
  for (const [name, cols] of [['all', FACTORS], ['no_number_vote', FACTORS.filter(([n]) => !/number_vote|gappy_run/.test(n))]]) {
    const X = lab.map((r) => cols.map(([, f]) => f(r)));
    const w = logistic(X, lab.map((r) => r.y));
    out.models[name] = { intercept: r2(w[0]), odds: Object.fromEntries(cols.map(([n], j) => [n, { or: r2(Math.exp(w[j + 1])), coef: r2(w[j + 1]), labelled_with: lab.filter((r) => cols[j][1](r)).length }])) };
  }
  // Univariate odds (the plain 2×2 per factor, with a 0.5 continuity correction) as a cross-check.
  out.univariate = Object.fromEntries(FACTORS.map(([n, f]) => {
    const a = lab.filter((r) => f(r) && r.y).length + 0.5, b = lab.filter((r) => f(r) && !r.y).length + 0.5, c = lab.filter((r) => !f(r) && r.y).length + 0.5, d = lab.filter((r) => !f(r) && !r.y).length + 0.5;
    return [n, { or: r2((a * d) / (b * c)), pos_with: a - 0.5, neg_with: b - 0.5 }];
  }));
  // Score every page with each model; top-k% shares of labelled positives.
  const scoresOut = arg('scores-out');
  const gz = scoresOut ? zlib.createGzip() : null;
  if (gz) gz.pipe(fs.createWriteStream(scoresOut));
  const sc = { all: [], no_number_vote: [] };
  const posScore = { all: [], no_number_vote: [] };
  const score = (w, cols, p) => 1 / (1 + Math.exp(-(w.intercept + cols.reduce((s, [n, f]) => s + w.odds[n].coef * f(p), 0))));
  const colsOf = { all: FACTORS, no_number_vote: FACTORS.filter(([n]) => !/number_vote|gappy_run/.test(n)) };
  if (gz) gz.write('book_id\tpage\tscore\tscore_no_numbers\tlang\n');
  for await (const b of bookLines()) for (const p of b.pages) {
    if (p.h) continue;
    const s1 = score(out.models.all, colsOf.all, p), s2 = score(out.models.no_number_vote, colsOf.no_number_vote, p);
    sc.all.push(s1); sc.no_number_vote.push(s2);
    const L = labels.get(`${b.b}:${p.p}`);
    if (L?.y) { posScore.all.push(s1); posScore.no_number_vote.push(s2); }
    if (gz) gz.write(`${b.b}\t${p.p}\t${s1.toFixed(5)}\t${s2.toFixed(5)}\t${b.lang ?? ''}\n`);
  }
  if (gz) await new Promise((r) => gz.end(r));
  out.pages_scored = sc.all.length;
  out.top_share = {};
  for (const m of Object.keys(sc)) {
    const sorted = Float64Array.from(sc[m]).sort().reverse();
    out.top_share[m] = Object.fromEntries([0.01, 0.05, 0.1].map((q) => { const cut = sorted[Math.floor(sorted.length * q)]; return [`top${q * 100}%`, { cut: +cut.toFixed(5), positives_in: posScore[m].filter((s) => s > cut).length, of: posScore[m].length, share: r2(posScore[m].filter((s) => s > cut).length / posScore[m].length) }]; }));
  }
  fs.writeFileSync(path.join(OUT, 'fit.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (MODE === 'features') await features();
  else if (MODE === 'fit') await fit();
  else throw new Error('mode: features | fit');
}

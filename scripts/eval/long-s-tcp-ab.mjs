#!/usr/bin/env node
/**
 * long-s-tcp-ab.mjs — does one prompt line stop the OCR reading long s (ſ) as f? (#5488)
 *
 * PRIOR ART: en-ocr-reference-5124.mjs (paid OCR arms over referenced English pages, realtime, a cost cap,
 * outputs recorded with prompt hash) and lib/production-prompt.mjs `withIntervention` (an intervention is
 * sited at an anchor of the LIVE prompt or the run stops). Those pages are 1800s+ English with no long s;
 * this needs pages that print ſ and a reference that keeps it, which is EEBO-TCP (same edition, keyed from
 * the same microfilm as our bim_ scans; built by build-edition-refs.mjs's window cut).
 *
 * Measured first (scratch analysis 2026-10-01, 72 TCP books, 494 pages): production median windowed char
 * accuracy 95.9% after cleaning artefacts; 486 word substitutions were ſ read as f ("fo", "muft", "fhall"),
 * 12% of all substitutions. Live prompt v16 says nothing about long s.
 *
 * PREREGISTERED (before any call):
 *   pages   2 per book over the TCP list, drawn by seed 5488 from pages whose production text aligns
 *           (overlap ≥ 0.35, guard passes); the TCP window is FIXED per page (located with the production
 *           text) and shared by all arms.
 *   arms    A  = live prompt, production flash model, temperature 0, thinking budget 0
 *           A2 = A repeated (noise floor: read first; if A-vs-A2 moves as much as A-vs-B, no claim)
 *           B  = live prompt + LONG_S_LINE at the abbreviation anchor
 *           LA / LB = A / B on the flash-lite model (production's OCR engine under OCR_LITE_ONLY), added after
 *           A/A2/B showed the line cut RECITATION refusals (24 vs 5 pages, p=0.0006)
 *   primary per-page count of long-s misreads (`longSErrors`: a reference word with a medial s whose
 *           output has it as f), B vs A, paired sign test over pages with any difference
 *   second  windowed char accuracy (lib/metrics.mjs), B vs A, paired; A vs A2 alongside
 *   cap     --max-cost (default $4) across all arms
 *
 *   node --env-file=.env.production.local scripts/eval/long-s-tcp-ab.mjs --tcp-dir=<dir with tcp-list.tsv + tcp/*.txt>
 *        --stage=draw|run|report [--arm=A|A2|B] [--max-cost=4] [--concurrency=4]
 *
 * Writes results/long-s-tcp-ab/{draw.json,outputs-<arm>.jsonl,report.json} — model outputs of public-domain
 * pages and scores; the TCP text itself is CC0 and is not copied here beyond what draw.json needs (none).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { cutEditionWindow, foldedWords } from './lib/edition-window.mjs';
import { scoreAgainstReference, normalizeForScript, agreementWords } from './lib/metrics.mjs';
import { getProductionOcrPrompt, withIntervention } from './lib/production-prompt.mjs';
import { runGemini, fetchImage } from './lib/runners.mjs';
import { binomTwoSided } from './lib/paired-stats.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { OCR_MODEL_FLASH, OCR_MODEL_LITE } from '../lib/ocr-routing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const TCP_DIR = arg('tcp-dir'); const STAGE = arg('stage', 'report'); const ARM = arg('arm', 'A');
const MAX_COST = +arg('max-cost', 4); const CONC = +arg('concurrency', 4); const SEED = 5488; const PER_BOOK = 2;
const OUT = path.join(HERE, 'results', 'long-s-tcp-ab'); fs.mkdirSync(OUT, { recursive: true });
const ANCHOR = '**Medieval abbreviation handling:**';
// LONG_S_LINE_S keeps production's convention (v16 writes long s as plain s; it never outputs ſ).
export const LONG_S_LINE_S = '**Long s (ſ):** In print before about 1800 the long s (ſ) is the letter s, not f. It has no crossbar, or only a nub on the left side of the stem; f has a full crossbar. Transcribe it as an ordinary s. Never output f for a long s: "so", "must", "shall", "first", "these" — not "fo", "muft", "fhall", "firft", "thefe".';
export const LONG_S_LINE = '**Long s (ſ):** In print before about 1800 the long s (ſ) is the letter s, not f. It has no crossbar, or only a nub on the left side of the stem; f has a full crossbar. Transcribe it as ſ. Never output f for a long s: "ſo", "muſt", "ſhall", "firſt", "theſe" — not "fo", "muft", "fhall", "firft", "thefe".';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const tcpList = () => fs.readFileSync(path.join(TCP_DIR, 'tcp-list.tsv'), 'utf8').trim().split('\n').map(l => l.split('\t')).map(([url, book, cell]) => ({ tcp: path.basename(url, '.xml'), book, cell }));
const editionCache = new Map();
function edition(tcp) { if (!editionCache.has(tcp)) { const t = fs.readFileSync(path.join(TCP_DIR, 'tcp', `${tcp}.txt`), 'utf8'); editionCache.set(tcp, { text: t, words: foldedWords(t, 'latin') }); } return editionCache.get(tcp); }
function windowFor(d) { const e = edition(d.tcp); return e.text.slice(d.from_char, d.to_char); }

// Long-s misreads: a reference word with a NON-FINAL s (printed as ſ before ~1800; only 16 of 72 TCP texts
// keep the ſ glyph, the rest normalise it to s) whose output has every such s as f ("must" → "muft").
// Counted against output words as a multiset, so one misread is matched once.
export function longSErrors(refText, outText) {
  const words = t => (t.normalize('NFC').toLowerCase().replace(/ſ/g, 's').match(/\p{L}+/gu) || []);
  const outCounts = new Map(); for (const w of words(outText)) outCounts.set(w, (outCounts.get(w) || 0) + 1);
  let errors = 0, opportunities = 0;
  for (const w of words(refText)) {
    if (!/s(?=\p{L})/u.test(w)) continue;          // no medial s, so no long s
    opportunities++;
    const misread = w.replace(/s(?=\p{L})/gu, 'f');
    if (outCounts.get(misread) > 0) { errors++; outCounts.set(misread, outCounts.get(misread) - 1); }
  }
  return { errors, opportunities };
}

async function stageDraw(db) {
  const r = rng(SEED); const draw = [];
  for (const { tcp, book, cell } of tcpList()) {
    const e = edition(tcp);
    const pages = await db.collection('pages').find({ book_id: book, 'ocr.data': { $type: 'string' } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1 } }).sort({ page_number: 1 }).toArray();
    const ok = [];
    for (const p of pages) {
      const cut = cutEditionWindow(e.words, e.text, p.ocr.data, 'latin'); if (!cut || cut.overlap < 0.35) continue;
      if (!scoreAgainstReference(cut.window, p.ocr.data, 'latin').aligned) continue;
      ok.push({ tcp, book, cell, page: p.page_number, production_model: p.ocr.model || null, from_char: cut.from_char, to_char: cut.to_char });
    }
    for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
    draw.push(...ok.slice(0, PER_BOOK));
  }
  fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, per_book: PER_BOOK, pages: draw.length, books: new Set(draw.map(d => d.book)).size, draw }, null, 1) + '\n');
  console.log(`drew ${draw.length} pages from ${new Set(draw.map(d => d.book)).size} books`);
}

async function stageRun(db) {
  const { draw } = JSON.parse(fs.readFileSync(path.join(OUT, 'draw.json'), 'utf8'));
  const live = await getProductionOcrPrompt(db);
  const MODEL = ARM.startsWith('L') ? OCR_MODEL_LITE : OCR_MODEL_FLASH;
  const prompt = ARM.endsWith('B') ? withIntervention(live.text, ANCHOR, LONG_S_LINE) : ARM.endsWith('C') ? withIntervention(live.text, ANCHOR, LONG_S_LINE_S) : live.text;
  const hash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
  const outFile = path.join(OUT, `outputs-${ARM}.jsonl`);
  const done = new Set(readJsonl(outFile).filter(o => o.text != null).map(o => `${o.book}:${o.page}`));
  let spent = ['A', 'A2', 'B', 'LA', 'LB', 'LC'].flatMap(a => readJsonl(path.join(OUT, `outputs-${a}.jsonl`))).reduce((s, o) => s + (o.cost_usd || 0), 0);
  console.log(`arm ${ARM} model ${MODEL} prompt v${live.version} ${hash}; ${draw.length} pages, ${done.size} done, $${spent.toFixed(3)} spent`);
  const queue = draw.filter(d => !done.has(`${d.book}:${d.page}`));
  const one = async (d) => {
    if (spent >= MAX_COST) return;
    const row = { arm: ARM, book: d.book, page: d.page, model: MODEL, prompt_version: live.version, prompt_hash: hash, params: { temperature: 0, thinkingBudget: 0, maxTokens: 8000 }, at: new Date().toISOString() };
    try {
      const page = await db.collection('pages').findOne({ book_id: d.book, page_number: d.page });
      const url = getPageSource(page); if (!url) throw new Error('no image source');
      const buf = await fetchImage(url);
      const res = await runGemini(MODEL, buf, prompt, { temperature: 0, maxTokens: 8000, thinkingBudget: 0, endpoint: 'eval/long-s-tcp-ab', usageType: 'ocr' });
      spent += res.costUsd || 0;
      Object.assign(row, { image_url: url, finish_reason: res.finishReason, cost_usd: +(res.costUsd || 0).toFixed(6), text: res.text || '' });
    } catch (e) { row.error = String(e.message || e).slice(0, 200); }
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
  };
  for (let i = 0; i < queue.length; i += CONC) { await Promise.all(queue.slice(i, i + CONC).map(one)); process.stdout.write(`\r  ${Math.min(i + CONC, queue.length)}/${queue.length} $${spent.toFixed(3)}`); }
  console.log(`\narm ${ARM}: $${spent.toFixed(3)} total across arms`);
}

function stageReport() {
  const { draw } = JSON.parse(fs.readFileSync(path.join(OUT, 'draw.json'), 'utf8'));
  const ARMS = ['A', 'A2', 'B', 'LA', 'LB', 'LC'].filter(a => fs.existsSync(path.join(OUT, `outputs-${a}.jsonl`)));
  const rows = Object.fromEntries(ARMS.map(a => [a, new Map(readJsonl(path.join(OUT, `outputs-${a}.jsonl`)).map(o => [`${o.book}:${o.page}`, o]))]));
  // Refusals: paired over every drawn page (a refusal is an outcome, not a missing value).
  const refused = (a, k) => !rows[a].get(k)?.text;
  const refusalPair = (x, y) => { let xo = 0, yo = 0, both = 0; for (const d of draw) { const k = `${d.book}:${d.page}`; const rx = refused(x, k), ry = refused(y, k); if (rx && ry) both++; else if (rx) xo++; else if (ry) yo++; } return { refused_first_only: xo, refused_second_only: yo, both, p: +binomTwoSided(Math.min(xo, yo), xo + yo).toFixed(5) }; };
  // Accuracy and long-s errors: paired over pages where BOTH arms of a pair returned text.
  const scored = new Map();
  const score = (a, d) => { const key = `${a}:${d.book}:${d.page}`; if (!scored.has(key)) { const ref = windowFor(d); const t = rows[a].get(`${d.book}:${d.page}`).text; const s = scoreAgainstReference(ref, t, 'latin'); scored.set(key, { acc: s.charAccuracyWindowed ?? 0, longs_err: longSErrors(ref, t).errors, longs_opp: longSErrors(ref, t).opportunities }); } return scored.get(key); };
  const textPair = (x, y) => {
    const ds = [], ls = []; let lx = 0, ly = 0, opp = 0;
    for (const d of draw) { const k = `${d.book}:${d.page}`; if (refused(x, k) || refused(y, k)) continue; const a = score(x, d), b = score(y, d); ds.push(b.acc - a.acc); ls.push(a.longs_err - b.longs_err); lx += a.longs_err; ly += b.longs_err; opp += a.longs_opp; }
    const sign = arr => { const w = arr.filter(v => v > 0).length, l = arr.filter(v => v < 0).length; return { better: w, worse: l, tied: arr.length - w - l, p: +binomTwoSided(Math.min(w, l), w + l).toFixed(4) }; };
    const sorted = [...ds].sort((p, q) => p - q);
    return { pages: ds.length, accuracy: { ...sign(ds), median_delta: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(4) : null }, long_s_errors: { first: lx, second: ly, opportunities: opp, pages: sign(ls) } };
  };
  const report = { drawn: draw.length, refusals: Object.fromEntries(ARMS.map(a => [a, draw.filter(d => refused(a, `${d.book}:${d.page}`)).length])) };
  for (const [x, y] of [['A', 'A2'], ['A', 'B'], ['LA', 'LB'], ['LA', 'LC'], ['A', 'LA']]) if (ARMS.includes(x) && ARMS.includes(y)) report[`${x}_vs_${y}`] = { refusals: refusalPair(x, y), ...textPair(x, y) };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report, null, 1));
}

// ── Inertness check (no reference needed): on strata the line should NOT touch, B must differ from A no
// more than A differs from its own repeat. Flash-lite, 40 books per stratum, one random OCR'd page each.
const INERT_STRATA = [
  { key: 'english-1850-1899', language: /^english/i, from: 1850, to: 1899 },
  { key: 'latin-1500-1599', language: /^latin/i, from: 1500, to: 1599 },
  { key: 'german-1600-1799', language: /^german/i, from: 1600, to: 1799 },
];
async function stageDrawInert(db) {
  const r = rng(SEED + 1); const draw = [];
  for (const st of INERT_STRATA) {
    const books = await db.collection('books').aggregate([
      { $match: { visible: true, pages_count: { $gt: 20 }, language: st.language } },
      { $project: { id: 1, published: 1 } }]).toArray();
    const inRange = books.filter(b => { const y = +(String(b.published || '').match(/\b1[4-9]\d\d\b/) || [0])[0]; return y >= st.from && y <= st.to; });
    for (let i = inRange.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [inRange[i], inRange[j]] = [inRange[j], inRange[i]]; }
    let n = 0;
    for (const b of inRange) {
      if (n >= 40) break;
      const pages = await db.collection('pages').find({ book_id: b.id, 'ocr.data': { $type: 'string' } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
      const textual = pages.filter(p => p.ocr.data.replace(/<[^>]+>[^<]*<\/[^>]+>/g, '').length > 800);
      if (!textual.length) continue;
      draw.push({ stratum: st.key, book: b.id, page: textual[Math.floor(r() * textual.length)].page_number }); n++;
    }
  }
  fs.writeFileSync(path.join(OUT, 'draw-inert.json'), JSON.stringify({ seed: SEED + 1, draw }, null, 1) + '\n');
  console.log(`inert draw: ${draw.length} pages`, JSON.stringify(Object.fromEntries(INERT_STRATA.map(s => [s.key, draw.filter(d => d.stratum === s.key).length]))));
}
async function stageRunInert(db, arm) {
  const { draw } = JSON.parse(fs.readFileSync(path.join(OUT, 'draw-inert.json'), 'utf8'));
  const live = await getProductionOcrPrompt(db);
  const prompt = arm === 'IB' ? withIntervention(live.text, ANCHOR, LONG_S_LINE) : arm === 'IC' ? withIntervention(live.text, ANCHOR, LONG_S_LINE_S) : live.text;
  const outFile = path.join(OUT, `inert-${arm}.jsonl`);
  const done = new Set(readJsonl(outFile).map(o => `${o.book}:${o.page}`));
  let spent = readJsonl(outFile).reduce((s, o) => s + (o.cost_usd || 0), 0);
  const queue = draw.filter(d => !done.has(`${d.book}:${d.page}`));
  const one = async (d) => {
    if (spent >= MAX_COST) return;
    const row = { arm, stratum: d.stratum, book: d.book, page: d.page, model: OCR_MODEL_LITE, prompt_version: live.version };
    try {
      const page = await db.collection('pages').findOne({ book_id: d.book, page_number: d.page });
      const buf = await fetchImage(getPageSource(page));
      const res = await runGemini(OCR_MODEL_LITE, buf, prompt, { temperature: 0, maxTokens: 8000, thinkingBudget: 0, endpoint: 'eval/long-s-tcp-ab', usageType: 'ocr' });
      spent += res.costUsd || 0; Object.assign(row, { finish_reason: res.finishReason, cost_usd: +(res.costUsd || 0).toFixed(6), text: res.text || '' });
    } catch (e) { row.error = String(e.message || e).slice(0, 200); }
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
  };
  for (let i = 0; i < queue.length; i += CONC) await Promise.all(queue.slice(i, i + CONC).map(one));
  console.log(`inert ${arm}: ${queue.length} pages, $${spent.toFixed(3)}`);
}
const INERT_B = arg('inert-b', 'IB');
function stageReportInert() {
  const { draw } = JSON.parse(fs.readFileSync(path.join(OUT, 'draw-inert.json'), 'utf8'));
  const get = a => new Map(readJsonl(path.join(OUT, `inert-${a}.jsonl`)).map(o => [`${o.book}:${o.page}`, o]));
  const IA = get('IA'), IA2 = get('IA2'), IB = fs.existsSync(path.join(OUT, `inert-${INERT_B}.jsonl`)) ? get(INERT_B) : new Map();
  const out = {};
  for (const st of INERT_STRATA) {
    const ds = draw.filter(d => d.stratum === st.key); const noise = [], effect = []; const ref = { IA: 0, IA2: 0, IB: 0 }; let longS = { IA: 0, IB: 0 };
    for (const d of ds) {
      const k = `${d.book}:${d.page}`; const a = IA.get(k), a2 = IA2.get(k), b = IB.get(k);
      for (const [n, m] of [['IA', a], ['IA2', a2], ['IB', b]]) if (!m?.text) ref[n]++;
      if (a?.text) longS.IA += (a.text.match(/ſ/g) || []).length; if (b?.text) longS.IB += (b.text.match(/ſ/g) || []).length;
      if (a?.text && a2?.text && b?.text) { noise.push(1 - agreementWords(a.text, a2.text)); effect.push(1 - agreementWords(a.text, b.text)); }
    }
    const med = xs => { const s = [...xs].sort((p, q) => p - q); return s.length ? +s[Math.floor(s.length / 2)].toFixed(4) : null; };
    const mean = xs => xs.length ? +(xs.reduce((p, q) => p + q, 0) / xs.length).toFixed(4) : null;
    let w = 0, l = 0; for (let i = 0; i < noise.length; i++) { if (effect[i] > noise[i]) w++; else if (effect[i] < noise[i]) l++; }
    out[st.key] = { pages: ds.length, compared: noise.length, refusals: ref, glyph_long_s_in_output: longS,
      word_disagreement: { A_vs_A2_noise: { median: med(noise), mean: mean(noise) }, A_vs_B: { median: med(effect), mean: mean(effect) }, pages_B_moved_more: w, pages_B_moved_less: l, p: +binomTwoSided(Math.min(w, l), w + l).toFixed(4) } };
  }
  fs.writeFileSync(path.join(OUT, 'report-inert.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out, null, 1));
}

if (STAGE.endsWith('inert')) {
  const c = STAGE === 'report-inert' ? null : await MongoClient.connect(process.env.MONGODB_URI);
  try { if (STAGE === 'draw-inert') await stageDrawInert(c.db('bookstore')); else if (STAGE === 'run-inert') await stageRunInert(c.db('bookstore'), ARM); else stageReportInert(); }
  finally { await c?.close(); }
  process.exit(0);
}
if (!TCP_DIR && STAGE !== 'report') { console.error('--tcp-dir required'); process.exit(1); }
const client = STAGE === 'report' ? null : await MongoClient.connect(process.env.MONGODB_URI);
try {
  if (STAGE === 'draw') await stageDraw(client.db('bookstore'));
  else if (STAGE === 'run') await stageRun(client.db('bookstore'));
  else { if (!TCP_DIR) { console.error('--tcp-dir required for report (TCP windows)'); process.exit(1); } stageReport(); }
} finally { await client?.close(); }

#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/translation-page-break-fix-ab.mjs and translation-batch-shadow-judge.mjs
 * (blind pairwise judges with a same-arm control — both judge TEXT against TEXT for one source
 * and arm pair fixed by the study; neither varies the OCR SOURCE under a fixed translator, which
 * is this question); scripts/eval/translation-model-ab.mjs (varies the model, not the source, and
 * has no same-arm control — #5127). Prompt assembly is translate-core's, not a copy.
 *
 * #5568 test 2 — does OCR quality survive translation? The SAME production translation prompt and
 * model, fed four sources for the same page: lite OCR (L), PaddleOCR-VL (P), the aligned Kanripo
 * page (K), Paddle + a 句讀 punctuation pass (PP); P is translated twice (P2) for the sampling
 * floor. A blind judge sees the page IMAGE and two translations (A/B randomised per pair), and says
 * whether they differ materially and which is more faithful (TIE allowed). Controls: byte-identical
 * pairs, and a test-retest with A/B swapped. Preregistration: PREREGISTRATION-chinese-skqs-5568.md.
 *
 * Reads Mongo (books, prompts) only. Writes files under --dir only. Gemini via gemini-script-client
 * (thinking 0, metered). Hard stop at --cap dollars.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-skqs-5568-translate-judge.mjs translate|judge|score
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { connect, disconnect } from './lib/sampling.mjs';
import { makeRng, binomTwoSided } from './lib/paired-stats.mjs';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { costOf } from '../lib/model-pricing.mjs';
import { loadTranslationPrompts, buildTranslationPrompt, getTranslateModelForBook, SAFETY_SETTINGS, contentHash } from '../lib/translate-core.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';
import { drawSample, han, cer, wilson } from './zh-skqs-5568-kanripo.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const DIR = argOf('dir', '/root/zh-skqs-5568');
const BENCH = argOf('bench', '/root/ocr-bench/images/chinese-cohort-5547');
const CAP = +argOf('cap', 4.5);
const JUDGE = 'gemini-3-flash-preview';
const ENDPOINT = 'scripts/eval/zh-skqs-5568-translate-judge.mjs';
const T = path.join(DIR, 'test2');
fs.mkdirSync(T, { recursive: true });

const ledgerFile = path.join(T, 'spend.jsonl');
const spent = () => (fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).reduce((s, r) => s + r.usd, 0) : 0);
async function call(opts, tag) {
  if (spent() > CAP) throw new Error(`cap $${CAP} reached`);
  let last;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await callGemini({ endpoint: ENDPOINT, type: 'eval', triggeredBy: 'eval-5568', ...opts });
      const usd = costOf(opts.model, r.inputTokens, r.outputTokens);
      fs.appendFileSync(ledgerFile, JSON.stringify({ tag, model: opts.model, in: r.inputTokens, out: r.outputTokens, usd, at: new Date().toISOString() }) + '\n');
      return r;
    } catch (e) { last = e; await new Promise(r => setTimeout(r, 4000 * (t + 1))); }
  }
  throw last;
}
async function pool(items, n, fn) {
  const q = [...items]; const out = [];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const it = q.shift(); out.push(await fn(it)); } }));
  return out;
}
const readOut = (engine, slug) => { try { return fs.readFileSync(path.join(BENCH, 'out', engine, `${slug}.txt`), 'utf8').trim(); } catch { return null; } };
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);

// ── 句讀 pass ──
const PUNCT_PROMPT = `Add punctuation (句讀) to the classical Chinese text below, for a reader.
Rules: insert only punctuation marks (。，、；：？！「」『』《》·); do NOT change, add, remove or reorder any Chinese character, even one you believe is a scribal error; keep the line breaks; output only the punctuated text, nothing else.

Text:
`;

async function translate() {
  const { picked } = drawSample();
  const align = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DIR, 'align.json'), 'utf8')).rows.map(r => [r.slug, r]));
  const { db } = await connect();
  const prompts = await loadTranslationPrompts(db);
  const books = Object.fromEntries((await db.collection('books').find({ id: { $in: picked.map(p => p.book_id) } }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, image_source: 1 } }).toArray()).map(b => [b.id, b]));
  await disconnect();
  const pagesFile = path.join(T, 'sources.json');
  const sources = fs.existsSync(pagesFile) ? JSON.parse(fs.readFileSync(pagesFile, 'utf8')) : {};
  // sources: L, P, K (aligned only), PP (validated)
  await pool(picked, 6, async (p) => {
    if (sources[p.slug]) return;
    const s = { L: readOut('gemini-3.1-flash-lite', p.slug), P: readOut('paddleocr-vl-1.6', p.slug) };
    const a = align[p.slug];
    if (a?.aligned) s.K = fs.readFileSync(path.join(DIR, 'kanripo-pages', `${p.slug}.txt`), 'utf8').trim();
    const r = await call({ model: 'gemini-3.1-flash-lite', prompt: PUNCT_PROMPT + s.P, temperature: 0, maxOutputTokens: 4096 }, `punct:${p.slug}`);
    const pp = r.text.trim();
    const drift = cer(han(pp), han(s.P));
    s.PP_check = { han_cer_vs_P: +drift.toFixed(4), punct_added: (pp.match(/[。，、；：？！「」『』《》]/g) || []).length };
    if (drift <= 0.02 && s.PP_check.punct_added > 0) s.PP = pp; else s.PP_rejected = pp;
    sources[p.slug] = { ...s, book_id: p.book_id };
  });
  fs.writeFileSync(pagesFile, JSON.stringify(sources, null, 1));

  const trFile = path.join(T, 'translations.json');
  const tr = fs.existsSync(trFile) ? JSON.parse(fs.readFileSync(trFile, 'utf8')) : {};
  const jobs = [];
  for (const p of picked) for (const arm of ['L', 'P', 'P2', 'K', 'PP']) {
    const src = arm === 'P2' ? sources[p.slug].P : sources[p.slug][arm];
    if (!src || tr[`${p.slug}|${arm}`]) continue;
    jobs.push({ p, arm, src });
  }
  console.log(`${jobs.length} translations to run; spent so far $${spent().toFixed(3)}`);
  await pool(jobs, 6, async ({ p, arm, src }) => {
    const book = { ...books[p.book_id], language: books[p.book_id]?.language || 'Chinese' };
    const { prompt, promptRef } = buildTranslationPrompt({ prompts, book, ocrText: src, previousTranslation: null });
    const model = getTranslateModelForBook(book);
    // the worker's cap: max(4096, ocr chars + 1200), ≤ 32768
    const maxOutputTokens = Math.min(32768, Math.max(4096, src.length + 1200));
    const r = await call({ model, prompt, temperature: 1, maxOutputTokens, safetySettings: SAFETY_SETTINGS }, `translate:${p.slug}:${arm}`);
    tr[`${p.slug}|${arm}`] = { text: r.text, model, prompt_version: promptRef.version, prompt_sent_hash: contentHash(prompt), source_hash: contentHash(src), finish: r.finishReason };
    fs.writeFileSync(trFile, JSON.stringify(tr, null, 1));
  });
  console.log(`done; spent $${spent().toFixed(3)}`);
}

// ── judge ──
const JUDGE_PROMPT = (a, b) => `You are checking English translations of one page of a classical Chinese book. The page image is attached; it is the only authority. Two translations, A and B, follow. They may have been made from different transcriptions of the page.

Answer two questions.
1. MATERIAL: would a reader take away something different from A than from B about what THIS PAGE says? Material = a different name, title, number, date, term or claim; a sentence or entry present in one and absent from the other; a reversed or substantially different meaning; text from outside the page. NOT material: wording, style, word order, romanisation, punctuation, formatting, notes or summaries that do not change what the page is said to say.
2. BETTER: which is more faithful to the page image — A, B, or TIE (no meaningful difference in faithfulness, or you cannot tell)?

Reply with JSON only: {"material": "yes"|"no", "differences": "<one sentence naming the main material difference, or empty>", "better": "A"|"B"|"TIE"}

=== Translation A ===
${a}

=== Translation B ===
${b}`;

const clean = t => stripEditorialWrappers(String(t || '')).trim();

function buildPairs() {
  const { picked } = drawSample();
  const tr = JSON.parse(fs.readFileSync(path.join(T, 'translations.json'), 'utf8'));
  const has = (s, a) => !!tr[`${s}|${a}`];
  const pairs = [];
  for (const p of picked) {
    const s = p.slug;
    for (const [x, y, kind] of [['L', 'P', 'L-P'], ['P', 'K', 'P-K'], ['L', 'K', 'L-K'], ['P', 'PP', 'P-PP'], ['P', 'P2', 'P-P2']]) {
      if (has(s, x) && has(s, y)) pairs.push({ id: `${s}|${kind}`, slug: s, kind, x, y });
    }
  }
  const rng = makeRng(55680);
  const ctrlPages = [...picked].sort(() => 0).filter(p => has(p.slug, 'P'));
  const ctrl = [];
  const left = [...ctrlPages];
  while (ctrl.length < 10 && left.length) ctrl.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  for (const p of ctrl) pairs.push({ id: `${p.slug}|P-P-identical`, slug: p.slug, kind: 'P-P-identical', x: 'P', y: 'P' });
  const retestPool = pairs.filter(q => ['L-P', 'P-K', 'P-PP'].includes(q.kind));
  const rl = [...retestPool];
  const retest = [];
  while (retest.length < 12 && rl.length) retest.push(rl.splice(Math.floor(rng() * rl.length), 1)[0]);
  for (const q of retest) pairs.push({ ...q, id: `${q.id}|retest`, retest_of: q.id });
  // A/B per pair from its own seed (sha of the id), so regenerating the packet cannot shift any pair
  for (const q of pairs) {
    const flip = parseInt(sha(q.retest_of || q.id).slice(0, 8), 16) % 2 === 1;
    const swap = q.retest_of ? !flip : flip;
    q.A = swap ? q.y : q.x; q.B = swap ? q.x : q.y;
    q.textA = clean(tr[`${q.slug}|${q.A}`].text); q.textB = clean(tr[`${q.slug}|${q.B}`].text);
    q.hashA = sha(q.textA); q.hashB = sha(q.textB);
  }
  return pairs;
}

// POST-HOC (not preregistered; added after the first pass showed a B-position bias of 111:57 and a
// 28:12 A/B imbalance on P-PP): every main pair judged again with A and B swapped, written to its own
// file. A verdict that survives both orders is kept; one that flips with position counts as a TIE.
function swappedPairs() {
  return buildPairs().filter(q => !q.retest_of && q.kind !== 'P-P-identical').map(q => ({ ...q, id: `${q.id}|swap`, swap_of: q.id, A: q.B, B: q.A, textA: q.textB, textB: q.textA, hashA: q.hashB, hashB: q.hashA }));
}

async function judge(swap = false) {
  const pairs = swap ? swappedPairs() : buildPairs();
  const outFile = path.join(T, swap ? 'judgements-swap.jsonl' : 'judgements.jsonl');
  const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
  const todo = pairs.filter(q => !done.has(q.id));
  // random call order
  const rng = makeRng(5568 * 7);
  for (let i = todo.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [todo[i], todo[j]] = [todo[j], todo[i]]; }
  fs.writeFileSync(path.join(T, swap ? 'packet-swap.json' : 'packet.json'), JSON.stringify(pairs.map(({ textA, textB, ...q }) => q), null, 1));
  console.log(`${todo.length} judgements to run (${pairs.length} in packet); spent $${spent().toFixed(3)}`);
  await pool(todo, 6, async (q) => {
    const img = fs.readFileSync(path.join(BENCH, `${q.slug}.jpg`));
    const r = await call({ model: JUDGE, prompt: JUDGE_PROMPT(q.textA, q.textB), imageParts: [img], temperature: 0, maxOutputTokens: 1024 }, `judge:${q.id}`);
    let v = null;
    try { v = JSON.parse(r.text.replace(/^```(?:json)?|```$/gm, '').trim()); } catch { v = { parse_error: r.text.slice(0, 300) }; }
    const better = v.better === 'A' ? q.A : v.better === 'B' ? q.B : v.better === 'TIE' ? 'TIE' : null;
    fs.appendFileSync(outFile, JSON.stringify({ id: q.id, slug: q.slug, kind: q.kind, retest_of: q.retest_of || null, A: q.A, B: q.B, hashA: q.hashA, hashB: q.hashB, material: v.material ?? null, better_raw: v.better ?? null, better, differences: v.differences ?? null, parse_error: v.parse_error ?? null }) + '\n');
  });
  console.log(`done; spent $${spent().toFixed(3)}`);
}

function mcnemar(b, c) { return binomTwoSided(Math.min(b, c), b + c); }

function score() {
  const J = fs.readFileSync(path.join(T, 'judgements.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const main = J.filter(j => !j.retest_of);
  const byKind = k => main.filter(j => j.kind === k);
  const ctrl = byKind('P-P-identical');
  const res = { cost_usd: +spent().toFixed(3), judgements: J.length, parse_errors: J.filter(j => j.parse_error).length };
  res.control_identical = { n: ctrl.length, tie_and_not_material: ctrl.filter(j => j.better === 'TIE' && j.material === 'no').length };
  // retest
  const orig = Object.fromEntries(main.map(j => [j.id, j]));
  const rt = J.filter(j => j.retest_of).map(j => ({ a: orig[j.retest_of], b: j })).filter(x => x.a);
  res.retest = { n: rt.length, material_agree: rt.filter(x => x.a.material === x.b.material).length, better_agree: rt.filter(x => x.a.better === x.b.better).length, both_agree: rt.filter(x => x.a.material === x.b.material && x.a.better === x.b.better).length };
  res.retest.material_agreement = rt.length ? +(res.retest.material_agree / rt.length).toFixed(3) : null;
  res.judge_valid = res.control_identical.tie_and_not_material >= 9 && (res.retest.material_agreement ?? 0) >= 0.75;
  res.kinds = {};
  for (const k of ['L-P', 'P-K', 'L-K', 'P-PP', 'P-P2']) {
    const js = byKind(k);
    const mat = js.filter(j => j.material === 'yes').length;
    const [x, y] = k.split('-');
    const wx = js.filter(j => j.better === x).length, wy = js.filter(j => j.better === y).length, ties = js.filter(j => j.better === 'TIE').length;
    res.kinds[k] = { n: js.length, material: mat, material_rate: js.length ? +(mat / js.length).toFixed(3) : null, material_wilson: wilson(mat, js.length), [`${x}_better`]: wx, [`${y}_better`]: wy, TIE: ties, sign_p: wx + wy ? +binomTwoSided(Math.min(wx, wy), wx + wy).toFixed(4) : null };
  }
  // paired McNemar: material on L-P vs material on P-P2, same pages
  const m = s => Object.fromEntries(byKind(s).map(j => [j.slug, j.material === 'yes']));
  const mLP = m('L-P'), mPP2 = m('P-P2'), mPK = m('P-K');
  const pair = (A, B) => { let b = 0, c = 0, n = 0; for (const s of Object.keys(A)) if (s in B) { n++; if (A[s] && !B[s]) b++; if (!A[s] && B[s]) c++; } return { n, only_first: b, only_floor: c, p: +mcnemar(b, c).toFixed(4) }; };
  res.T2a_LP_vs_floor = pair(mLP, mPP2);
  res.T2b_PK_vs_floor = pair(mPK, mPP2);
  const r = res.kinds;
  res.rules = res.judge_valid ? {
    T2a_ocr_engine_changes_english: (r['L-P'].material_rate - r['P-P2'].material_rate) >= 0.15 && res.T2a_LP_vs_floor.p < 0.05,
    T2b_kanripo_improves_over_paddle: r['P-K'].K_better > r['P-K'].P_better && r['P-K'].sign_p < 0.05 && (r['P-K'].material_rate - r['P-P2'].material_rate) >= 0.15,
    T2c_punctuation_pass: r['P-PP'].PP_better > r['P-PP'].P_better && r['P-PP'].sign_p < 0.05 && r['P-PP'].PP_better >= 2 * r['P-PP'].P_better,
  } : 'judge-noise-limited: no rule fires';
  const src = JSON.parse(fs.readFileSync(path.join(T, 'sources.json'), 'utf8'));
  res.punct_pass = { valid: Object.values(src).filter(s => s.PP).length, rejected: Object.values(src).filter(s => s.PP_rejected).length, han_cer_median: (() => { const xs = Object.values(src).map(s => s.PP_check?.han_cer_vs_P).filter(x => x != null).sort((a, b) => a - b); return xs[Math.floor((xs.length - 1) / 2)]; })() };
  res.examples_material_LP = byKind('L-P').filter(j => j.material === 'yes').slice(0, 8).map(j => ({ slug: j.slug, better: j.better, differences: j.differences }));
  res.examples_material_PK = byKind('P-K').filter(j => j.material === 'yes').slice(0, 6).map(j => ({ slug: j.slug, better: j.better, differences: j.differences }));
  fs.writeFileSync(path.join(T, 'score.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
}

function scoreBoth() {
  const rd = f => fs.readFileSync(path.join(T, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const first = Object.fromEntries(rd('judgements.jsonl').filter(j => !j.retest_of && j.kind !== 'P-P-identical').map(j => [j.id, j]));
  const second = rd('judgements-swap.jsonl');
  const out = { n_pairs: second.length, position: {}, kinds: {} };
  const all = [...Object.values(first), ...second];
  out.position = { A: all.filter(j => j.better_raw === 'A').length, B: all.filter(j => j.better_raw === 'B').length, TIE: all.filter(j => j.better_raw === 'TIE').length };
  for (const k of ['L-P', 'P-K', 'L-K', 'P-PP', 'P-P2']) {
    const [x, y] = k.split('-');
    const rows = second.filter(j => j.kind === k).map(j => ({ a: first[j.id.replace(/\|swap$/, '')], b: j })).filter(r => r.a);
    const verdict = r => (r.a.better === r.b.better ? r.a.better : 'TIE');
    const wx = rows.filter(r => verdict(r) === x).length, wy = rows.filter(r => verdict(r) === y).length;
    const matBoth = rows.filter(r => r.a.material === 'yes' && r.b.material === 'yes').length;
    const matEither = rows.filter(r => r.a.material === 'yes' || r.b.material === 'yes').length;
    out.kinds[k] = { n: rows.length, order_consistent_better: rows.filter(r => r.a.better === r.b.better).length, [`${x}_both_orders`]: wx, [`${y}_both_orders`]: wy, TIE_or_flip: rows.length - wx - wy, sign_p: wx + wy ? +binomTwoSided(Math.min(wx, wy), wx + wy).toFixed(4) : null, material_both_orders: matBoth, material_both_rate: rows.length ? +(matBoth / rows.length).toFixed(3) : null, material_both_wilson: wilson(matBoth, rows.length), material_either: matEither, material_order_agreement: +(rows.filter(r => r.a.material === r.b.material).length / rows.length).toFixed(3) };
  }
  // material (both orders) on L-P vs P-P2, same pages
  const mb = k => Object.fromEntries(second.filter(j => j.kind === k).map(j => { const a = first[j.id.replace(/\|swap$/, '')]; return [j.slug, a.material === 'yes' && j.material === 'yes']; }));
  const A = mb('L-P'), B = mb('P-P2'), K = mb('P-K');
  const mc = (X, Y) => { let b = 0, c = 0; for (const s of Object.keys(X)) if (s in Y) { if (X[s] && !Y[s]) b++; if (!X[s] && Y[s]) c++; } return { only_first: b, only_floor: c, p: +binomTwoSided(Math.min(b, c), b + c).toFixed(4) }; };
  out.LP_vs_floor_both_orders = mc(A, B);
  out.PK_vs_floor_both_orders = mc(K, B);
  out.cost_usd = +spent().toFixed(3);
  fs.writeFileSync(path.join(T, 'score-both-orders.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

if (CMD === 'translate') await translate();
else if (CMD === 'judge') await judge();
else if (CMD === 'judge-swap') await judge(true);
else if (CMD === 'score-both') scoreBoth();
else if (CMD === 'score') score();
else { console.error('usage: translate | judge | score'); process.exit(1); }

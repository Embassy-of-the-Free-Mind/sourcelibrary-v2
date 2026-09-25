#!/usr/bin/env node
/**
 * Per-language OCR lane suitability — may language L run on gemini-3.1-flash-lite
 * (or Cloud Vision) instead of gemini-3-flash-preview? Executes
 * PREREGISTRATION-per-language-ocr-suitability.md (routing issue #4729),
 * decision rule fixed there, including its 2026-09-11 pre-run amendments.
 *
 * PRIOR ART: google-vision-baseline.mjs (single-arm runner over the pinned set;
 * this generalises it to N arms over a SAMPLED set and scores by agreement, not
 * reference), tesseract-baseline.mjs (fetch+run+score shape), stats-cross-model.mjs
 * (paired stats over observations — not used: this study's unit is a language,
 * not a page, and its pages have no reference), lib/sampling.mjs (samples from a
 * curated corpus registry, not "every language with >=20 books").
 *
 * Phases (each resumable; raw outputs are the durable artifact):
 *   --phase=sample  draw n books/language, one interior page each, seed 4729
 *   --phase=run     run the arms, checkpoint every call, hard stop at --cap USD
 *   --phase=score   agreement vs the incumbent, catastrophic tail, invention judge,
 *                   Tibetan Derge identity (clawdbot, window=2), verdicts, allowlist diff
 *
 *   node --env-file=.env.production.local scripts/eval/per-language-suitability.mjs \
 *       --phase=sample [--n=20] [--languages=Latin,Greek] [--min-books=20]
 *       --phase=run    [--cap=30] [--concurrency=4] [--arms=flash,lite,vision]
 *       --phase=score  [--judge-cap=300] [--no-judge] [--no-tibetan]
 *
 * Read-only against Mongo. Spend: Gemini per call (metered from usageMetadata),
 * Vision units (free tier), Claude judge calls (metered).
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getPageSource } from '../lib/page-image-url.mjs';
import { agreementPrimary, scriptClassOf, stripWrappers, levenshtein, deEntity } from './lib/metrics.mjs';
import { runGemini, runGoogleVision, fetchImage } from './lib/runners.mjs';
import { getProductionOcrPrompt } from './lib/production-prompt.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PHASE = args.phase || 'sample';
const DATE = args.date || '2026-09-11';
const SEED = 4729;
const N = +(args.n || 20);
const MIN_BOOKS = +(args['min-books'] || 20);
const CAP_USD = +(args.cap || 30);
const CONC = +(args.concurrency || 4);
const R = p => path.join(__dirname, 'results', p);
const SAMPLE = R(`per-language-suitability-sample-${DATE}.json`);
const RAW = R(`per-language-suitability-raw-${DATE}.jsonl`);
const JUDGE = R(`per-language-suitability-judge-${DATE}.jsonl`);
const OUT = R(`per-language-suitability-${DATE}.json`);
const REPORT = R(`per-language-suitability-${DATE}.md`);
const IMG_CACHE = path.join(process.env.CLAUDE_JOB_DIR || '/tmp', 'pls-images');
const PROGRESS = R(`per-language-suitability-progress-${DATE}.txt`);

// ── arms ───────────────────────────────────────────────────────────
// @tb0 = thinkingBudget 0 set explicitly (CLAUDE.md rule); July arms did not, so
// these rows must not be pooled with July observations.
const ARMS = {
  flash:  { model: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview@tb0', runs: 2 },
  lite:   { model: 'gemini-3.1-flash-lite',  label: 'gemini-3.1-flash-lite@tb0',  runs: 2 },
  vision: { model: 'google-vision',          label: 'google-vision',              runs: 1 },
};
const ARM_KEYS = (args.arms || 'flash,lite,vision').split(',');

// ── language folding ───────────────────────────────────────────────
// books.language is free text (language-fields.md). Fold codes and duplicate
// multi-value strings; exclude placeholders and bilingual containers. The fold
// table is written into the sample file so the roll-up is auditable.
const CODE = {
  lat: 'Latin', la: 'Latin', ger: 'German', deu: 'German', de: 'German', grc: 'Greek', ell: 'Greek', el: 'Greek',
  eng: 'English', en: 'English', fre: 'French', fra: 'French', fr: 'French', ita: 'Italian', it: 'Italian',
  spa: 'Spanish', es: 'Spanish', por: 'Portuguese', pt: 'Portuguese', dut: 'Dutch', nld: 'Dutch', nl: 'Dutch',
  rus: 'Russian', ru: 'Russian', heb: 'Hebrew', he: 'Hebrew', ara: 'Arabic', ar: 'Arabic', per: 'Persian', fas: 'Persian',
  chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', jpn: 'Japanese', ja: 'Japanese', kor: 'Korean', ko: 'Korean',
  san: 'Sanskrit', sa: 'Sanskrit', tib: 'Tibetan', bod: 'Tibetan', bo: 'Tibetan', hye: 'Armenian', arm: 'Armenian', hy: 'Armenian',
  syr: 'Syriac', gez: "Ge'ez", pli: 'Pali', jav: 'Javanese', may: 'Malay', msa: 'Malay', hin: 'Hindi', ota: 'Ottoman Turkish',
  'classical chinese': 'Chinese', 'ancient greek': 'Greek', 'middle english': 'Middle English', 'ottoman turkish': 'Ottoman Turkish',
};
const EXCLUDE = new Set(['und', 'unknown', 'auto-detect', 'not applicable', 'multiple', 'n/a', '', 'none']);
// Inscription corpora: 1–2 pages/book, not served by the OCR lane (pre-registered exclusion).
const INSCRIPTION = new Set(['Parthian', 'Sogdian', 'Sumerian', 'Middle Persian', 'Old Turkic', 'Demotic', 'Egyptian hieroglyphs', 'Akkadian', 'Bactrian', 'Khotanese']);
function fold(raw) {
  if (raw == null) return null;
  const parts = String(raw).split(/\s*;\s*/).map(p => p.replace(/\s*\(script\)\s*/gi, '').trim()).filter(Boolean);
  const folded = new Set(parts.map(p => {
    const k = p.toLowerCase();
    if (EXCLUDE.has(k)) return null;
    if (CODE[k]) return CODE[k];
    if (/-/.test(p) && !/^[A-Z][a-z']+$/.test(p)) return null; // Latin-German etc.
    return p.replace(/(^|\s)\w/g, c => c.toUpperCase());
  }));
  folded.delete(null);
  if (folded.size !== 1) return null;
  const L = [...folded][0];
  return [...INSCRIPTION].some(x => x.toLowerCase() === L.toLowerCase()) ? null : L;
}

// Deterministic PRNG (Mulberry32) so the draw reproduces from the script alone.
function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const strHash = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const readJsonl = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const log = s => { console.log(s); fs.appendFileSync(PROGRESS, `${new Date().toISOString()} ${s}\n`); };

async function mongo() { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return { c, db: c.db(process.env.MONGODB_DB || 'bookstore') }; }

const VISION_HINT = { Latin: 'la', German: 'de', Greek: 'el', Hebrew: 'he', Armenian: 'hy', Chinese: 'zh-Hant', Tibetan: 'bo', English: 'en', French: 'fr', Italian: 'it', Spanish: 'es', Portuguese: 'pt', Dutch: 'nl', Russian: 'ru', Japanese: 'ja', Korean: 'ko', Arabic: 'ar', Persian: 'fa', Sanskrit: 'sa', Hindi: 'hi', Syriac: 'syr', Javanese: 'jv', Malay: 'ms', Pali: 'pi', "Ge'ez": 'am', 'Ottoman Turkish': 'ota', 'Middle English': 'en' };

// ═══════════════════════════════════════════════════════════════════
if (PHASE === 'sample') {
  const { c, db } = await mongo();
  const B = db.collection('books'), P = db.collection('pages');
  const agg = await B.aggregate([{ $match: { pages_count: { $gt: 0 } } }, { $group: { _id: '$language', n: { $sum: 1 } } }]).toArray();
  const foldTable = {}; const byLang = {};
  for (const a of agg) { const L = fold(a._id); foldTable[String(a._id)] = L; if (L) (byLang[L] ??= []).push(String(a._id)); }
  let langs = Object.keys(byLang);
  if (args.languages) langs = langs.filter(l => args.languages.split(',').includes(l));
  const sample = { date: DATE, seed: SEED, n: N, min_books: MIN_BOOKS, fold_table: foldTable, languages: {} };
  for (const L of langs.sort()) {
    const raws = byLang[L];
    const ids = (await B.find({ language: { $in: raws }, pages_count: { $gt: 0 } }, { projection: { id: 1, _id: 0, pages_count: 1, title: 1 } }).toArray())
      .filter(b => b.id).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (ids.length < MIN_BOOKS) { log(`  skip ${L}: ${ids.length} books < ${MIN_BOOKS}`); continue; }
    const rnd = mulberry32(SEED ^ strHash(L));
    const order = [...ids]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const pages = []; let misses = 0;
    for (const b of order) {
      if (pages.length >= N) break;
      const lo = Math.max(1, Math.floor(b.pages_count * 0.1)), hi = Math.max(lo, Math.floor(b.pages_count * 0.9));
      const pn = lo + Math.floor(rnd() * (hi - lo + 1));
      const pg = await P.findOne({ book_id: b.id, page_number: pn });
      const url = pg ? getPageSource(pg) : null;
      if (!url) { misses += 1; continue; }
      pages.push({ book_id: b.id, page_number: pn, pages_count: b.pages_count, title: (b.title || '').slice(0, 80), url });
    }
    sample.languages[L] = { raw_labels: raws, books: ids.length, misses, pages };
    log(`  ${L.padEnd(18)} books=${String(ids.length).padStart(6)} sampled=${pages.length} misses=${misses}`);
  }
  await c.close();
  fs.writeFileSync(SAMPLE, JSON.stringify(sample, null, 1));
  const tot = Object.values(sample.languages).reduce((s, l) => s + l.pages.length, 0);
  log(`sample: ${Object.keys(sample.languages).length} languages, ${tot} pages → ${SAMPLE}`);
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════
if (PHASE === 'run') {
  const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const { c, db } = await mongo();
  const prompt = await getProductionOcrPrompt(db);
  await c.close();
  log(`prompt ${prompt.name} v${prompt.version} ${prompt.content_hash || ''}`);
  fs.mkdirSync(IMG_CACHE, { recursive: true });
  // --retry-exceptions: rows that failed before the model was called (image fetch
  // 429/timeouts — Gallica rate-limits, mostly) are re-run; their old rows stay in
  // the file and the scorer takes the LAST row per (page, arm, run).
  const prior = readJsonl(RAW);
  const done = new Set(prior.filter(r => !(args['retry-exceptions'] && r.finish_reason === 'EXCEPTION')).map(r => `${r.book_id}|${r.page_number}|${r.arm}|${r.run}`));
  let spent = readJsonl(RAW).reduce((s, r) => s + (r.cost_usd || 0), 0);
  let units = 0, consecutive429 = 0, stopped = false;
  const jobs = [];
  for (const [L, info] of Object.entries(sample.languages)) {
    if (args.languages && !args.languages.split(',').includes(L)) continue;
    for (const pg of info.pages) for (const k of ARM_KEYS) for (let run = 1; run <= ARMS[k].runs; run++) {
      if (!done.has(`${pg.book_id}|${pg.page_number}|${k}|${run}`)) jobs.push({ L, pg, k, run });
    }
  }
  // --reverse: walk the languages last-to-first so a second process can share the
  // run with the first without either paying for the same call twice.
  if (args.reverse) jobs.reverse();
  log(`run: ${jobs.length} calls pending, $${spent.toFixed(2)} already spent, cap $${CAP_USD}${args.reverse ? ' (reverse order)' : ''}`);
  const imgCache = new Map();
  // One fetch per page even with N arms in flight, and a politeness gap on hosts
  // that 429 (Gallica): 429s are an image-fetch failure that hits every arm equally
  // and silently drops the page from the study.
  const inflight = new Map(); let lastSlowHost = 0;
  async function image(pg) {
    const f = path.join(IMG_CACHE, `${pg.book_id}-${pg.page_number}.jpg`);
    if (!fs.existsSync(f)) {
      if (!inflight.has(f)) inflight.set(f, (async () => {
        if (/gallica\.bnf\.fr|e-rara|digitale-sammlungen/.test(pg.url)) { const wait = lastSlowHost + 2500 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); lastSlowHost = Date.now(); }
        fs.writeFileSync(f, await fetchImage(pg.url, 90000));
      })().finally(() => inflight.delete(f)));
      await inflight.get(f);
    }
    let buf = fs.readFileSync(f);
    if (buf.length > 9 * 1024 * 1024) { // Vision's request ceiling; Gemini tokens don't depend on bytes
      const s = f.replace(/\.jpg$/, '.small.jpg');
      if (!fs.existsSync(s)) execFileSync('magick', [f, '-resize', '3000x3000>', '-quality', '90', s]);
      buf = fs.readFileSync(s);
    }
    return buf;
  }
  let i = 0;
  async function worker() {
    while (i < jobs.length && !stopped) {
      const j = jobs[i++];
      const arm = ARMS[j.k];
      let row = { lang: j.L, book_id: j.pg.book_id, page_number: j.pg.page_number, arm: j.k, model: arm.label, run: j.run, prompt_version: prompt.version, date: DATE };
      try {
        const buf = await image(j.pg);
        if (j.k === 'vision') {
          const v = await runGoogleVision(buf, { languageHints: VISION_HINT[j.L] ? [VISION_HINT[j.L]] : [] });
          units += 1;
          row = { ...row, text: v.text, finish_reason: v.error ? 'ERROR' : 'STOP', cost_usd: 0, vision_confidence: v.meanConfidence, detected_languages: v.detectedLanguages.map(d => d.languageCode), ms: v.elapsed };
        } else {
          const g = await runGemini(arm.model, buf, prompt.text, { temperature: 0, maxTokens: 8000, thinking: false, thinkingBudgetZero: true });
          row = { ...row, text: g.text, finish_reason: g.finishReason, input_tokens: g.inputTokens, output_tokens: g.outputTokens, thinking_tokens: g.thinkingTokens, cost_usd: +g.costUsd.toFixed(5), ms: g.durationMs };
          spent += g.costUsd;
        }
        consecutive429 = 0;
      } catch (e) {
        const msg = String(e.message || e);
        row = { ...row, text: '', finish_reason: 'EXCEPTION', error: msg.slice(0, 200), cost_usd: 0 };
        if (/Rate limited|429/.test(msg)) { consecutive429 += 1; if (consecutive429 >= 8) { log('ABORT: 8 consecutive 429s — key pool exhausted, stopping (guard travels with the file)'); stopped = true; } await new Promise(r => setTimeout(r, 5000)); }
      }
      fs.appendFileSync(RAW, JSON.stringify(row) + '\n');
      if (spent >= CAP_USD) { log(`STOP: spend $${spent.toFixed(2)} reached cap $${CAP_USD}`); stopped = true; }
      if (i % 25 === 0) log(`  ${i}/${jobs.length} calls, $${spent.toFixed(2)} Gemini, ${units} Vision units`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  log(`run ${stopped ? 'STOPPED' : 'complete'}: ${i}/${jobs.length} calls this session, $${spent.toFixed(2)} Gemini total, ${units} Vision units`);
  process.exit(stopped ? 3 : 0);
}

// ═══════════════════════════════════════════════════════════════════
if (PHASE === 'score') {
  const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  const raw = readJsonl(RAW);
  // Primary agreement = CHARACTER agreement on letters+marks (1 - Levenshtein/max, first
  // 3000 chars). The word metric in lib/metrics.mjs turns combining marks into separators
  // (non-latin-text-operations.md), which shredded Devanagari, Syriac and Ethiopic output
  // into sub-floor fragments and read as ~0 agreement. Amendment 6.
  // AGREE_X: calibrated on the pinned set — p25 of lite<->flash charM agreement among pages
  // whose reference-CER gap is <= 1pp (0.956; beyond-1pp pages: median 0.52, max 0.97).
  // CATA_AGREE sits at the beyond-1pp median.
  const AGREE_X = 0.956, Y_RATE = 0.10, COVERAGE_FLOOR = 0.8, CATA_AGREE = 0.5, STABLE_SELF = 0.8;
  const charsM = t => [...deEntity(stripWrappers(t || '')).toLowerCase().replace(/[^\p{L}\p{M}]/gu, '')].slice(0, 3000);
  const agreeM = (a, b) => { const A = charsM(a), B = charsM(b); if (!A.length && !B.length) return null; if (!A.length || !B.length) return 0; return 1 - levenshtein(A, B) / Math.max(A.length, B.length); };
  // stripWrappers() removes the editorial blocks it knows; the OCR prompt has since
  // grown <image-desc> (a prose description of an illustration — measured 88 of 584
  // lite outputs) and inline <foreign>. Neither is page text: an image caption the
  // engine WROTE must not reach the invention judge as a span to check.
  const clean = t => stripWrappers(t || '').replace(/<image-desc[^>]*>[\s\S]*?<\/image-desc>/gi, '').replace(/<\/?foreign[^>]*>/gi, '');
  const key = r => `${r.book_id}|${r.page_number}`;
  const byPage = {};
  // Last NON-exception row per (page, arm, run) wins; an exception row only stands
  // if no run ever succeeded (a --retry-exceptions pass appends after failures, and
  // a failing-fast process can append exceptions AFTER a sibling's good rows).
  for (const r of raw) {
    const slot = ((byPage[key(r)] ??= { lang: r.lang, book_id: r.book_id, page_number: r.page_number, arms: {} }).arms[r.arm] ??= {});
    if (r.finish_reason !== 'EXCEPTION' || !slot[r.run]) slot[r.run] = r;
  }

  // ── invention candidates + judge ───────────────────────────────
  // A span in the cheaper arm's output that appears in NEITHER flash run. Spans are
  // ≥8 word tokens (spaced scripts) / ≥20 letters (spaceless). Judged by a vision
  // model against the page image; verdicts persisted with the span.
  const judged = Object.fromEntries(readJsonl(JUDGE).map(j => [`${j.book_id}|${j.page_number}|${j.arm}|${j.span.slice(0, 40)}`, j]));
  let judgeSpend = readJsonl(JUDGE).reduce((s, j) => s + (j.cost_usd || 0), 0), judgeCalls = 0;
  const JUDGE_CAP = +(args['judge-cap'] || 300);
  const toks = (t, spaceless) => (spaceless ? [...clean(t).replace(/[^\p{L}]/gu, '')] : clean(t).toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1));
  function novelSpans(armText, refTexts) {
    const spaceless = scriptClassOf(armText) === 'spaceless';
    const A = toks(armText, spaceless); const MIN = spaceless ? 20 : 8;
    const refSet = new Set(); const K = spaceless ? 6 : 3;
    for (const rt of refTexts) { const T = toks(rt, spaceless); for (let i = 0; i + K <= T.length; i++) refSet.add(T.slice(i, i + K).join(spaceless ? '' : ' ')); }
    const spans = []; let cur = [];
    for (let i = 0; i < A.length; i++) {
      const g = A.slice(i, i + K).join(spaceless ? '' : ' ');
      if (i + K <= A.length && !refSet.has(g)) cur.push(A[i]); else { if (cur.length >= MIN) spans.push(cur.join(spaceless ? '' : ' ')); cur = []; }
    }
    if (cur.length >= MIN) spans.push(cur.join(spaceless ? '' : ' '));
    return spans.sort((a, b) => b.length - a.length).slice(0, 2);
  }
  async function judge(page, arm, span) {
    const k = `${page.book_id}|${page.page_number}|${arm}|${span.slice(0, 40)}`;
    if (judged[k]) return judged[k];
    if (args['no-judge'] || judgeCalls >= JUDGE_CAP) return null;
    if (args['judge-langs'] && !args['judge-langs'].split(',').includes(page.lang)) return null;
    const f = path.join(IMG_CACHE, `${page.book_id}-${page.page_number}.jpg`);
    if (!fs.existsSync(f)) return null;
    // The judge reads a 1400px copy (~150 KB) — enough to see whether a span is on the
    // page, and ~10x less upload than the archived master.
    const fj = f.replace(/\.jpg$/, '.judge.jpg');
    if (!fs.existsSync(fj)) execFileSync('magick', [f, '-resize', '1400x1400>', '-quality', '80', fj]);
    const buf = fs.readFileSync(fj);
    const prompt = `You are checking an OCR transcript against the page image. Below is a span of text that one OCR engine produced for this page but a second engine did not. Look at the page and decide whether this span is actually printed or written on the page (allow ordinary OCR-level character errors, abbreviation expansion, and different reading order). Answer with ONE JSON object only: {"present": "yes" | "partly" | "no", "reason": "<one sentence>"}. "no" means the span is NOT on the page — the engine invented it or copied it from elsewhere.\n\nSPAN:\n${span.slice(0, 600)}`;
    let r;
    // thinkingBudgetZero is load-bearing: without it Gemini 3 spends the whole
    // maxTokens budget thinking and returns NO text (71/72 verdicts "unparsed").
    try { r = await runGemini('gemini-3-flash-preview', buf, prompt, { temperature: 0, maxTokens: 400, thinking: false, thinkingBudgetZero: true }); r.text = r.text || ''; }
    catch (e) { return { present: 'error', reason: String(e.message).slice(0, 120), cost_usd: 0 }; }
    judgeCalls += 1;
    const cost = r.costUsd || 0;
    judgeSpend += cost;
    let v = { present: 'unparsed', reason: r.text.slice(0, 200) };
    try { v = JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]); } catch { /* keep unparsed */ }
    const row = { book_id: page.book_id, page_number: page.page_number, lang: page.lang, arm, span: span.slice(0, 600), present: v.present, reason: v.reason, judge: 'gemini-3-flash-preview', cost_usd: +cost.toFixed(5) };
    fs.appendFileSync(JUDGE, JSON.stringify(row) + '\n'); judged[k] = row;
    return row;
  }

  // ── per-page scoring ───────────────────────────────────────────
  const pages = [];
  for (const page of Object.values(byPage)) {
    const f1 = page.arms.flash?.[1], f2 = page.arms.flash?.[2];
    const ft = [f1, f2].filter(r => r && r.finish_reason !== 'EXCEPTION' && r.text != null).map(r => clean(r.text));
    const self = ft.length === 2 ? agreeM(ft[0], ft[1]) : null;
    const flashChars = ft.length ? mean(ft.map(t => t.length)) : 0;
    // A page the incumbent could not read (both runs empty: RECITATION refusal, or a
    // blank-page tag pair) is UNJUDGEABLE for the comparison — it is not a lite failure
    // and not a lite success (non-latin-text-operations.md: an empty comparable set is
    // unjudged). Counted separately as flash_unreadable.
    const flashUnreadable = ft.length === 2 && flashChars < 20;
    const out = { lang: page.lang, book_id: page.book_id, page_number: page.page_number, flash_self_agreement: self == null ? null : +self.toFixed(4), flash_chars: Math.round(flashChars), flash_finish: [f1?.finish_reason, f2?.finish_reason], flash_unreadable: flashUnreadable, arms: {} };
    for (const k of ARM_KEYS) {
      if (k === 'flash') continue;
      const runs = Object.values(page.arms[k] || {}).filter(r => r.finish_reason !== 'EXCEPTION' && r.text != null);
      const texts = runs.map(r => clean(r.text));
      if (!texts.length) { out.arms[k] = { runs: 0, not_run: true }; continue; }
      const agr = texts.length && ft.length ? mean(texts.flatMap(t => ft.map(f => agreeM(t, f) ?? 0))) : null;
      const agrWord = texts.length && ft.length ? mean(texts.flatMap(t => ft.map(f => agreementPrimary(t, f) ?? 0))) : null;
      const chars = texts.length ? mean(texts.map(t => t.length)) : 0;
      const covered = flashChars > 0 && chars >= 0.5 * flashChars;
      const empty = !texts.some(t => t.trim().length > 0);
      const gap = self != null && agr != null ? +((self - agr) * 100).toFixed(2) : null; // pp, positive = arm below the incumbent's own ceiling
      const spans = texts.length && ft.length ? novelSpans(texts[0], ft) : [];
      let invention = null; const verdicts = [];
      for (const s of spans) { const v = await judge(page, k, s); if (v) verdicts.push({ span: s.slice(0, 80), present: v.present }); if (v?.present === 'no') invention = true; }
      if (invention == null && spans.length && verdicts.length) invention = false;
      // Runaway generation: MAX_TOKENS with output far longer than the incumbent's is a
      // repetition loop (measured: 18,888 chars on a page flash read in 1,707) — its own class.
      const loop = runs.some(r => r.finish_reason === 'MAX_TOKENS') && flashChars > 0 && chars > 2.5 * flashChars;
      const catastrophic = empty || loop || (self != null && self >= STABLE_SELF && agr != null && agr < CATA_AGREE) || invention === true;
      out.arms[k] = { runs: runs.length, agreement_with_flash: agr == null ? null : +agr.toFixed(4), agreement_word: agrWord == null ? null : +agrWord.toFixed(4), gap_pp: gap, chars: Math.round(chars), covered, empty, finish: runs.map(r => r.finish_reason), self_agreement: texts.length === 2 ? +(agreeM(texts[0], texts[1]) ?? 0).toFixed(4) : null, novel_spans: spans.length, judge: verdicts, invention, loop, catastrophic };
    }
    pages.push(out);
  }

  // ── Tibetan: Derge identity on clawdbot, window=2 ──────────────
  let tibetan = null;
  const tibPages = pages.filter(p => p.lang === 'Tibetan');
  if (tibPages.length && !args['no-tibetan']) {
    const rows = [];
    for (const page of Object.values(byPage).filter(p => p.lang === 'Tibetan'))
      for (const k of ARM_KEYS) for (const r of Object.values(page.arms[k] || {})) if (r.text) rows.push({ id: `${r.book_id}_${String(r.page_number).padStart(5, '0')}`, arm: `${k}${r.run}`, text: clean(r.text) });
    const tmp = R(`per-language-suitability-tibetan-${DATE}.jsonl`);
    fs.writeFileSync(tmp, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const host = process.env.CLAWDBOT || 'root@46.224.122.120';
    try {
      // --tibetan-scores=<local jsonl> skips the ~10-min remote step (scp the pages
      // file up, run the scorer detached on clawdbot, scp pls-scores.jsonl back).
      const scored = args['tibetan-scores']
        ? fs.readFileSync(args['tibetan-scores'], 'utf8')
        : (execFileSync('scp', ['-q', tmp, `${host}:/root/tibetan-eval/pls-pages.jsonl`]),
           execFileSync('ssh', ['-o', 'BatchMode=yes', host, 'cd /root/tibetan-eval && python3 kanjur_align.py score --index etext-index-full.pkl --pages pls-pages.jsonl --out pls-scores.jsonl --window 2 >/dev/null 2>&1; cat pls-scores.jsonl'], { maxBuffer: 64 * 1024 * 1024 }).toString());
      scored.split('\n').filter(Boolean).map(l => JSON.parse(l)).forEach(s => { const p = tibPages.find(p => `${p.book_id}_${String(p.page_number).padStart(5, '0')}` === s.id); if (p) ((p.derge ??= {})[s.arm] = { identity: s.identity ?? null, retrieval: s.retrieval ?? null }); });
      const armMed = {}, armRet = {};
      for (const k of ARM_KEYS) {
        const vs = tibPages.flatMap(p => Object.entries(p.derge || {}).filter(([a]) => a.startsWith(k)).map(([, v]) => v));
        armMed[k] = +(median(vs.map(v => v.identity).filter(v => v != null)) ?? 0).toFixed(3);
        armRet[k] = +(median(vs.map(v => v.retrieval).filter(v => v != null)) ?? 0).toFixed(3);
      }
      // The Derge index covers the Kanjur. A random Tibetan book (rNying ma rgyud 'bum, terma,
      // grammars) retrieves nothing, and identity at the retrieval floor is UNJUDGEABLE, not a score.
      const applicable = Math.max(...Object.values(armRet)) >= 0.05;
      tibetan = { instrument: 'kanjur_align.py score --window 2 (clawdbot, 2026-09-11 fix)', applicable, reason: applicable ? null : 'sampled books are not Kanjur — retrieval at floor for every arm; identity is unjudgeable (non-latin-text-operations.md). Only the #4523 pilot Kanjur (vision-vs-gemini-2026-09-11) carries a Derge number.', median_identity: armMed, median_retrieval: armRet, pages: tibPages.length };
    } catch (e) { tibetan = { error: String(e.message).slice(0, 200) }; }
  }

  // ── verdicts per (arm, language) ───────────────────────────────
  const byLang = {};
  for (const p of pages) (byLang[p.lang] ??= []).push(p);
  const verdicts = {};
  for (const [L, ps] of Object.entries(byLang)) {
    const usable = ps.filter(p => p.flash_self_agreement != null && !p.flash_unreadable);
    const V = { n: ps.length, n_usable: usable.length, flash_unreadable_pages: ps.filter(p => p.flash_unreadable).length, flash_self_agreement_median: +(median(usable.map(p => p.flash_self_agreement)) ?? 0).toFixed(3), flash_unstable_pages: ps.filter(p => p.flash_self_agreement != null && p.flash_self_agreement < STABLE_SELF).length, arms: {} };
    for (const k of ARM_KEYS) {
      if (k === 'flash') continue;
      const A = usable.map(p => p.arms[k]).filter(a => a && !a.not_run);
      const agrs = A.map(a => a.agreement_with_flash).filter(x => x != null);
      const cata = A.filter(a => a.catastrophic).length;
      const covered = A.filter(a => a.covered).length;
      const inv = A.filter(a => a.invention === true).length;
      const loops = A.filter(a => a.loop).length;
      const refusals = A.filter(a => a.empty).length;
      const unjudged = A.filter(a => a.novel_spans > 0 && a.invention == null).length;
      const med = median(agrs);
      const r1 = med != null && med >= AGREE_X, r2 = A.length ? cata / A.length <= Y_RATE : false, r3 = inv === 0, r4 = A.length ? covered / A.length >= COVERAGE_FLOOR : false;
      let verdict, reason;
      if (A.length < Math.min(N, 10)) { verdict = 'undecided'; reason = `only ${A.length} scorable pages`; }
      else if (unjudged > 0 && r1 && r2 && r4) { verdict = 'undecided'; reason = `${unjudged} novel spans not judged (judge cap)`; }
      else if (r1 && r2 && r3 && r4) { verdict = 'allowed'; reason = 'passes all four rules'; }
      else { verdict = 'flash only'; reason = [!r1 && `median agreement ${med?.toFixed(3)} < ${AGREE_X}`, !r2 && `catastrophic ${cata}/${A.length} > ${Y_RATE * 100}%`, !r3 && `invention on ${inv} page(s) — veto`, !r4 && `coverage ${covered}/${A.length} < ${COVERAGE_FLOOR * 100}%`].filter(Boolean).join('; '); }
      V.arms[k] = { n: A.length, median_agreement: med == null ? null : +med.toFixed(3), catastrophic: cata, catastrophic_rate: A.length ? +(cata / A.length).toFixed(3) : null, loop_pages: loops, empty_pages: refusals, invention_pages: inv, unjudged_spans_pages: unjudged, covered, coverage: A.length ? +(covered / A.length).toFixed(3) : null, rules: { X: r1, Y: r2, invention_veto: r3, coverage: r4 }, verdict, reason };
    }
    verdicts[L] = V;
  }

  // ── diff against the current allowlist ─────────────────────────
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'translate-core.mjs'), 'utf8');
  const m = src.match(/LATIN_SCRIPT_LANGUAGES = new Set\(\[([\s\S]*?)\]\)/);
  const allow = new Set((m ? m[1] : '').match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '').toLowerCase()) || []);
  const differences = [];
  for (const [L, V] of Object.entries(verdicts)) {
    const onLite = allow.has(L.toLowerCase());
    const v = V.arms.lite?.verdict;
    if (onLite && v === 'flash only') differences.push({ language: L, allowlist: 'lite', measured: v, reason: V.arms.lite.reason, action: 'REMOVE from LATIN_SCRIPT_LANGUAGES (or stratify)' });
    else if (onLite && v === 'undecided') differences.push({ language: L, allowlist: 'lite', measured: v, reason: V.arms.lite.reason, action: 'on lite today without a passing measurement' });
    else if (!onLite && v === 'allowed') differences.push({ language: L, allowlist: 'flash', measured: v, reason: V.arms.lite.reason, action: 'ADD to the lite allowlist' });
  }

  const spend = { gemini_usd: +raw.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(2), vision_units: raw.filter(r => r.arm === 'vision' && r.finish_reason !== 'EXCEPTION').length, judge_usd: +judgeSpend.toFixed(2), judge_calls_total: Object.keys(judged).length };
  const result = { date: DATE, seed: SEED, rule: { AGREE_X, Y_RATE, COVERAGE_FLOOR, CATA_AGREE, STABLE_SELF }, arms: Object.fromEntries(ARM_KEYS.map(k => [k, ARMS[k]])), spend, sample_file: path.basename(SAMPLE), raw_file: path.basename(RAW), verdicts, differences_from_allowlist: differences, tibetan, pages };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));

  const lines = []; const say = s => { lines.push(s); console.log(s); };
  say(`# Per-language OCR lane suitability (${DATE}) — agreement with the incumbent, calibrated by its own repeat agreement`);
  say(''); say(`Rule: lite allowed iff median char agreement with flash ≥ ${AGREE_X} (letters+marks; calibrated ≙ 1pp CER on the pinned set), catastrophic ≤ ${Y_RATE * 100}%, zero invention, coverage ≥ ${COVERAGE_FLOOR * 100}%. Spend: Gemini $${spend.gemini_usd}, judge $${spend.judge_usd} (${spend.judge_calls_total} calls), Vision ${spend.vision_units} units.`);
  say(''); say('| language | n | flash unreadable | LITE agr | cata (loop/empty) | inv | cov | **lite verdict** | VISION agr | cata | cov | vision verdict |'); say('|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---|');
  for (const [L, V] of Object.entries(verdicts).sort()) {
    const a = V.arms.lite || {}, b = V.arms.vision || {};
    say(`| ${L} | ${V.n_usable} | ${V.flash_unreadable_pages} | ${a.median_agreement ?? '—'} | ${a.catastrophic ?? '—'} (${a.loop_pages ?? 0}/${a.empty_pages ?? 0}) | ${a.invention_pages ?? '—'} | ${a.covered ?? '—'} | **${a.verdict ?? '—'}** — ${a.reason ?? ''} | ${b.median_agreement ?? '—'} | ${b.catastrophic ?? '—'} | ${b.covered ?? '—'} | ${b.verdict ?? '—'} |`);
  }
  if (tibetan) { say(''); say(tibetan.applicable ? `Tibetan Derge identity (window=2): ${JSON.stringify(tibetan.median_identity)}` : `Tibetan Derge identity: NOT APPLICABLE — ${tibetan.reason || tibetan.error}`); }
  say(''); say('## Differences from the current LATIN_SCRIPT_LANGUAGES allowlist (translate-core.mjs / ai-models.ts)'); say('');
  if (!differences.length) say('None.'); for (const d of differences) say(`- **${d.language}** — allowlist says ${d.allowlist}, measured ${d.measured} (${d.reason}) → ${d.action}`);
  fs.writeFileSync(REPORT, lines.join('\n') + '\n');
  log(`score → ${OUT}\n      ${REPORT}`);
}

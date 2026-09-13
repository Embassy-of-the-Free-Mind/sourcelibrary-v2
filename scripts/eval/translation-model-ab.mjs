#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-ab.mjs — same one-page-per-book design and the same
// `scoreTranslation` (imported from it, not copied), but its ARMS are prompt versions on one
// `--model`; it cannot compare N models on one prompt without a second harness or a misuse of
// `--route`. scripts/eval/translation-model-observational.mjs — compares translations the corpus
// already holds, no fresh paired draw, and Chinese was 37 of its 1,009 books, never broken out.
// scripts/eval/qa-eval.mjs — cross-model on OCR, image-in, no arm concept. Neither answers
// "which model translates Chinese best per dollar?", a MODEL question on ONE prompt over a fresh draw.
/** N-arm paired comparison of translation models (Gemini + OpenAI-compatible via OpenRouter) on the production prompt over Chinese preview pages: reference-free metrics, refusals by arm, blind ranking packet, sign tests vs baseline, one recommendation. */
/**
 * translation-model-ab.mjs — which model should translate Chinese? (樂舞 preview pages)
 *
 * ── The decision this exists to change ─────────────────────────────────────
 * The 136 ritual-dance (樂舞) books sit at the pipeline's 25-page preview posture.
 * Translating them in full is ~20K pages: ≈$37–49 on `gemini-3.1-flash-lite` (the
 * production route for all non-BPH translation since #4762), ≈$11 on
 * `gemini-2.5-flash-lite`, ≈$195 on `gemini-3-flash-preview`. No measured Chinese
 * TRANSLATION comparison exists — only OCR numbers — so the route rests on the
 * price list. This run is the first (research: ops repo, trackA3).
 *
 * ── Design ─────────────────────────────────────────────────────────────────
 * Paired over ARMS (a list; first = baseline): every page is translated once by
 * each model with the SAME production prompt (`loadTranslationPrompts` default,
 * no version override — a model comparison, not a prompt one), no thinking
 * (`thinkingBudget: 0` on Gemini, #4581; `reasoning.enabled=false` on OpenRouter).
 * One page per BOOK (pages in a book are one observation), interior pages only
 * (page_number > 3), `ocr.data` carrying ≥ 150 CJK characters, drawn from the
 * book-id list in `--books-file` (the 136-book 樂舞 set, copied into results/).
 *
 * Arms whose provider key is absent are recorded as SKIPPED in run-meta.json and
 * in the report — a recorded result, never a failure (`--arms` re-runs add them).
 *
 * Outcomes (pre-registered in EXPERIMENTS.md before the paid run):
 *   primary    blind RANKING of all delivered arms per page, labels shuffled per
 *              page, key withheld; mean rank per arm and a sign test vs baseline
 *   co-primary fabrication flags per arm (the disqualifier for classical Chinese)
 *   secondary  refusals per arm (a ROW, never dropped — the accepted side is biased),
 *              omission / term-consistency flags, the reference-free table:
 *              scoreTranslation fields, English-chars-per-CJK-char, untranslated
 *              CJK residue share; measured $/page per arm.
 *
 * ── Phases ─────────────────────────────────────────────────────────────────
 *   --draw            pin the sample (Mongo READ only; nothing is written to Mongo)
 *   --dry-run         cost estimate; exit 2 above --max-usd; lists arms that would be skipped
 *   --run             the PAID step; refuses above --max-usd (default 2)
 *   --score           reference-free metrics per arm + paired deltas vs baseline
 *   --judge-packet    blinded ranking packet + separate key (+ a 20-page second pass)
 *   --report          unblind the verdicts, sign tests, write report.{json,md}
 *
 * Run the paid step on Hetzner (the laptop is geo-blocked for paid Gemini):
 *   set -a; . .env.production.local; set +a; node scripts/eval/translation-model-ab.mjs --run
 */
import fs from 'node:fs';
import path from 'node:path';
import { scoreTranslation } from './translation-prompt-ab.mjs';
import { buildTranslationPrompt, loadTranslationPrompts, translatablePageFilter, SAFETY_SETTINGS, sanitizeTranslationTags, MODEL_LITE, MODEL_FLASH } from '../lib/translate-core.mjs';
import { MODEL_PRICING } from '../lib/model-pricing.mjs';
import { connect, disconnect } from './lib/sampling.mjs';
import { binomTwoSided, bootstrapCI, resetSeed, seededRand, mean } from './lib/paired-stats.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const RESULTS = new URL('./results/', import.meta.url).pathname;
const TAG = arg('tag', 'translation-model-ab-zh');
const P = (suffix) => path.join(RESULTS, `${TAG}-${suffix}`);
const BOOKS_FILE = arg('books-file', P('books.txt'));
const SAMPLE_FILE = P('sample.json');
const ARMS_FILE = P('arms.jsonl');
const META_FILE = P('run-meta.json');
const N = Number(arg('n', 60));
const MIN_CJK = Number(arg('min-cjk', 150));
const SKIP_LEAVES = Number(arg('skip-leaves', 3));
const MAX_USD = Number(arg('max-usd', 2));
const CONCURRENCY = Number(arg('concurrency', 4));

/** Arms, in order; the FIRST is the baseline every sign test compares against. A `/` in the id = OpenRouter. */
const DEFAULT_ARMS = [
  MODEL_LITE, MODEL_FLASH, 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'deepseek/deepseek-v4.1-flash', 'qwen/qwen3.8-flash', 'z-ai/glm-5.3-flash', 'deepseek/deepseek-v4-pro-0813', 'qwen/qwen3.8-max-0902',
];
const ARMS = (arg('arms') ? arg('arms').split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ARMS);
const BASELINE = ARMS[0];
const providerOf = (model) => (model.includes('/') ? 'openrouter' : 'gemini');

/**
 * USD per 1M tokens. `scripts/lib/model-pricing.mjs` is authoritative for every Gemini
 * model (the single-source test forbids a Gemini price literal anywhere else); the
 * OpenRouter arms are vendor list prices read 2026-09-13 (ops repo, trackA3), kept
 * HERE because they are unverified against a bill and not Gemini. OpenRouter reports
 * the actual charge per call (`usage.cost`), which wins over the list price.
 */
const LOCAL_PRICING = {
  'deepseek/deepseek-v4.1-flash':   { input: 0.15, output: 0.60 },
  'deepseek/deepseek-v4-pro-0813':  { input: 1.32, output: 3.96 },
  'qwen/qwen3.8-flash':             { input: 0.15, output: 0.47 },
  'qwen/qwen3.8-max-0902':          { input: 2.00, output: 6.00 },
  'z-ai/glm-5.3-flash':             { input: 0.075, output: 0.25 },
};
const priceOf = (model) => MODEL_PRICING[model] || LOCAL_PRICING[model] || { input: 1.50, output: 9.00, unknown: true };
const keyFor = (model) => (providerOf(model) === 'openrouter' ? process.env.OPENROUTER_API_KEY : (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2));

// ── CJK helpers ──────────────────────────────────────────────────────────────
const CJK_RE = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2A6DF}\u{2A700}-\u{2EBEF}\u{30000}-\u{3134F}]/gu;
export const cjkCount = (s) => ((s || '').match(CJK_RE) || []).length;

/**
 * Prose body for the residue measure. The prompt LEGITIMATELY carries source
 * characters inside <note>original: "…"</note> and <term>…</term>; those are
 * citations, not untranslated text, so they are removed before counting. What
 * remains CJK after that is text the model left in the source language.
 */
const WRAPPERS = 'meta|summary|keywords|warning|vocab|language|lang|page-type|page-num|sig|scan-quality|script|columns|header|image-desc|note|term|gloss';
export function proseBody(text) {
  return (text || '')
    .replace(new RegExp(`<(${WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reference-free outcomes for one (page, arm). */
export function scoreArm(text, ocrText) {
  const base = scoreTranslation(text, ocrText);
  const prose = proseBody(text);
  const ocrCjk = cjkCount(ocrText);
  const residue = cjkCount(prose);
  return {
    ...base,
    prose_chars: prose.length,
    length_ratio: ocrCjk ? prose.length / ocrCjk : null,   // English chars per source CJK char
    cjk_residue: residue,
    cjk_residue_share: ocrCjk ? residue / ocrCjk : null,
    untranslated: ocrCjk ? residue / ocrCjk > 0.2 : false, // a fifth of the source left as-is
  };
}

/** A refusal is any call that did not deliver a translation: HTTP error, blocked prompt, refusal finish, or an empty body. */
export function classifyRefusal(res) {
  if (res.error) return `error:${res.error.slice(0, 60)}`;
  if (res.blockReason) return `blocked:${res.blockReason}`;
  if (['RECITATION', 'SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'content_filter'].includes(res.finish)) return `finish:${res.finish}`;
  if (!res.text || proseBody(res.text).length < 20) return `empty:${res.finish || 'no-candidate'}`;
  return null;
}

// ── phase: draw ─────────────────────────────────────────────────────────────
async function phaseDraw() {
  if (!fs.existsSync(BOOKS_FILE)) throw new Error(`no books file at ${BOOKS_FILE} (id|pages_count|pages_ocr|language|title per line)`);
  const bookIds = fs.readFileSync(BOOKS_FILE, 'utf8').split('\n').map((l) => l.split('|')[0].trim()).filter(Boolean);
  // Seeded shuffle so the draw is reproducible from the same list.
  resetSeed();
  for (let i = bookIds.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [bookIds[i], bookIds[j]] = [bookIds[j], bookIds[i]]; }

  const { db } = await connect();
  const pageFilter = { ...translatablePageFilter(), page_number: { $gt: SKIP_LEAVES } };
  const sample = [];
  const skipped = { noBook: 0, noPage: 0 };
  for (const id of bookIds) {
    if (sample.length >= N) break;
    const book = await db.collection('books').findOne({ $or: [{ id }, { _id: id }] },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, published: 1, image_source: 1, pages_count: 1, pages_ocr: 1 } });
    if (!book) { skipped.noBook++; continue; }
    const cands = await db.collection('pages').aggregate([
      { $match: { book_id: book.id, ...pageFilter } },
      { $sample: { size: 12 } },
      { $project: { page_number: 1, page_type: 1, 'ocr.data': 1 } },
    ], { maxTimeMS: 60000 }).toArray();
    const page = cands.map((p) => ({ p, cjk: cjkCount(p.ocr?.data) })).filter((x) => x.cjk >= MIN_CJK).sort((x, y) => y.cjk - x.cjk)[0]?.p;
    if (!page) { skipped.noPage++; continue; }
    sample.push({
      bookId: book.id, bookTitle: book.display_title || book.title, author: book.author || null,
      year: book.year || book.published || null, language: book.language || null,
      provider: book.image_source?.provider || null, pagesCount: book.pages_count, pagesOcr: book.pages_ocr,
      pageNumber: page.page_number, pageType: page.page_type || null,
      ocrText: page.ocr.data, ocrChars: page.ocr.data.length, ocrCjk: cjkCount(page.ocr.data),
    });
  }
  const books = new Set(sample.map((r) => r.bookId));
  if (books.size !== sample.length) throw new Error(`draw is not one-page-per-book: ${sample.length} pages from ${books.size} books`);
  const est = estimate(sample);
  const payload = {
    drawn_at: new Date().toISOString(), books_file: path.basename(BOOKS_FILE), books_listed: bookIds.length,
    arms: ARMS, n_pages: sample.length, n_books: books.size, min_cjk: MIN_CJK, skip_leaves: SKIP_LEAVES,
    skipped, estimate: est, sample,
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(SAMPLE_FILE, JSON.stringify(payload, null, 1));
  console.log(`n = ${sample.length} pages from ${books.size} books (of ${bookIds.length} listed; ${skipped.noBook} not found, ${skipped.noPage} with no qualifying page)`);
  console.log(`OCR: ${sample.reduce((s, r) => s + r.ocrCjk, 0).toLocaleString()} CJK chars, median ${median(sample.map((r) => r.ocrCjk))}/page`);
  printEstimate(est);
  console.log(`wrote ${SAMPLE_FILE}`);
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/**
 * Cost from the drawn pages' real CJK counts. CJK tokenises at roughly 1–1.5
 * tokens per character; the English rendering of a classical page runs about
 * 3 English chars per source char, ≈ 1 token per source char, plus tags. Both
 * taken at the generous end: 1.5 in, 1.5 out per CJK char; prompt ≈ 2,800 tokens.
 */
function estimate(sample, done = new Set(), promptTokens = 2800) {
  const per = {};
  let usd = 0, calls = 0;
  for (const model of ARMS) {
    const price = priceOf(model);
    let inTok = 0, outTok = 0, n = 0;
    for (const r of sample) {
      if (done.has(`${r.bookId}:${r.pageNumber}:${model}`)) continue;   // already on disk: a resume does not re-spend
      n++; inTok += promptTokens + Math.ceil(r.ocrCjk * 1.5) + Math.ceil((r.ocrChars - r.ocrCjk) / 4); outTok += Math.ceil(r.ocrCjk * 1.5) + 200;
    }
    const cost = (inTok / 1e6) * price.input + (outTok / 1e6) * price.output;
    const keyed = !!keyFor(model);
    per[model] = { provider: providerOf(model), calls: n, inputTokens: inTok, outputTokens: outTok, usd: cost, price_unverified: !!price.unknown, key_present: keyed };
    if (keyed) { usd += cost; calls += n; }   // an arm that will be skipped does not spend
  }
  return { calls, usd, arms: per };
}
/** (page, arm) rows already written — a resumed run neither re-spends nor re-counts them. */
function doneRows() {
  const done = new Set();
  if (!fs.existsSync(ARMS_FILE)) return done;
  for (const line of fs.readFileSync(ARMS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); done.add(`${r.bookId}:${r.pageNumber}:${r.arm}`); } catch { /* partial line */ }
  }
  return done;
}
function printEstimate(est) {
  for (const [model, a] of Object.entries(est.arms)) console.log(`  ${model.padEnd(30)} ${a.calls} calls  in ~${a.inputTokens.toLocaleString()} out ~${a.outputTokens.toLocaleString()} tok  $${a.usd.toFixed(3)}${a.price_unverified ? ' (price UNKNOWN, default used)' : ''}${a.key_present ? '' : '   ← SKIPPED: no key for ' + a.provider}`);
  console.log(`ESTIMATE $${est.usd.toFixed(2)} for the keyed arms (cap --max-usd ${MAX_USD})`);
}

function phaseDryRun() {
  const payload = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const done = doneRows();
  const est = estimate(payload.sample, done);
  if (done.size) console.log(`${done.size} (page, arm) rows already on disk are excluded from the estimate`);
  printEstimate(est);
  if (est.usd > MAX_USD) { console.error(`REFUSING TO SPEND: estimate $${est.usd.toFixed(2)} > --max-usd ${MAX_USD}`); process.exit(2); }
  console.log('within cap — run without --dry-run to spend.');
}

// ── phase: run (PAID) ───────────────────────────────────────────────────────
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function callGemini(model, promptText, maxOutputTokens) {
  // usage-ok: one-off preregistered eval (60 pages x N arms, $0.39 on 2026-09-13), hand-run on Hetzner, never
  // scheduled; it meters its own tokens per row, refuses above --max-usd, and the report's cost table is the
  // record (EXPERIMENTS.md). Not routed through gemini_usage: it is not pipeline spend.
  const key = keyFor(model);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          safetySettings: SAFETY_SETTINGS,
          // thinkingBudget 0 is the production setting; Gemini 3.x otherwise
          // thinks by default and bills it at the output rate, invisibly (#4581).
          generationConfig: { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(180000),
      });
      const j = await r.json();
      if (r.ok) {
        const c = j.candidates?.[0];
        const u = j.usageMetadata || {};
        return {
          text: c?.content?.parts?.map((p) => p.text).join('') || '', finish: c?.finishReason || null, blockReason: j.promptFeedback?.blockReason || null,
          inTok: u.promptTokenCount || 0, outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), thoughtTok: u.thoughtsTokenCount || 0,
        };
      }
      if (r.status === 429 || r.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
      return { error: `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`, status: r.status };
    } catch (e) {
      if (attempt === 3) return { error: String(e.message || e).slice(0, 200) };
      await sleep(4000 * (attempt + 1));
    }
  }
  return { error: 'retries exhausted' };
}

/** OpenAI-compatible chat completion through OpenRouter, reasoning off, actual charge requested. */
async function callOpenRouter(model, promptText, maxOutputTokens) {
  const key = keyFor(model);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://sourcelibrary.org', 'X-Title': 'Source Library translation eval' },
        body: JSON.stringify({
          model, messages: [{ role: 'user', content: promptText }], max_tokens: maxOutputTokens, temperature: 1,
          reasoning: { enabled: false },   // non-thinking where the provider allows; ignored otherwise
          usage: { include: true },        // OpenRouter returns the actual USD charge
        }),
        signal: AbortSignal.timeout(240000),
      });
      const j = await r.json();
      if (r.ok && !j.error) {
        const c = j.choices?.[0];
        const u = j.usage || {};
        return {
          text: c?.message?.content || '', finish: c?.finish_reason || null, blockReason: null,
          inTok: u.prompt_tokens || 0, outTok: u.completion_tokens || 0, thoughtTok: u.completion_tokens_details?.reasoning_tokens || 0,
          cost_reported: typeof u.cost === 'number' ? u.cost : null,
        };
      }
      const status = r.status || j.error?.code;
      if (status === 429 || status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
      return { error: `HTTP ${status}: ${JSON.stringify(j).slice(0, 200)}`, status };
    } catch (e) {
      if (attempt === 3) return { error: String(e.message || e).slice(0, 200) };
      await sleep(4000 * (attempt + 1));
    }
  }
  return { error: 'retries exhausted' };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

function readMeta() { return fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, 'utf8')) : { arms: {} }; }
function writeMeta(meta) { fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 1)); }

async function phaseRun() {
  const payload = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const done = doneRows();
  const est = estimate(payload.sample, done);
  if (done.size) console.log(`resuming: ${done.size} (page, arm) results already on disk, excluded from the estimate`);
  printEstimate(est);
  if (est.usd > MAX_USD) { console.error(`REFUSING TO SPEND: estimate $${est.usd.toFixed(2)} > --max-usd ${MAX_USD}`); process.exit(2); }
  if (new Set(ARMS).size !== ARMS.length) throw new Error('duplicate arm');

  const { db } = await connect();
  // The production default prompt — whatever is_default resolves to today. Recorded
  // per row so the result is attributable to one prompt hash.
  const prompts = await loadTranslationPrompts(db);
  console.log(`prompt: ${prompts.translation.ref.name} v${prompts.translation.ref.version} hash=${(prompts.translation.ref.content_hash || '').slice(0, 8)}`);

  const meta = readMeta();
  meta.prompt = prompts.translation.ref;
  meta.baseline = BASELINE;
  meta.arms_requested = [...new Set([...(meta.arms_requested || []), ...ARMS])];
  const active = [];
  for (const model of ARMS) {
    if (!keyFor(model)) { meta.arms[model] = { status: 'skipped', reason: `no ${providerOf(model) === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY'} in env`, at: new Date().toISOString() }; console.log(`SKIPPED ${model}: ${meta.arms[model].reason}`); continue; }
    active.push(model);
  }
  writeMeta(meta);

  const stream = fs.createWriteStream(ARMS_FILE, { flags: 'a' });

  // Probe each active arm on the first page before the fan-out: a 4xx that is not a
  // rate limit (bad model id, no credit, unauthorised) skips the WHOLE arm with a
  // recorded reason rather than writing 60 identical errors.
  const jobs = [];
  const dead = new Set();
  const first = payload.sample[0];
  for (const model of active) {
    if (done.has(`${first.bookId}:${first.pageNumber}:${model}`)) continue;
    const res = await translateOne(prompts, first, model);
    if (res.error && res.status && res.status >= 400 && res.status < 500 && res.status !== 429) {
      meta.arms[model] = { status: 'skipped', reason: `probe failed: ${res.error.slice(0, 120)}`, at: new Date().toISOString() };
      console.log(`SKIPPED ${model}: ${meta.arms[model].reason}`);
      dead.add(model); writeMeta(meta); continue;
    }
    stream.write(rowFor(first, model, res, prompts) + '\n');
    done.add(`${first.bookId}:${first.pageNumber}:${model}`);
  }
  for (const r of payload.sample) for (const model of active) if (!dead.has(model) && !done.has(`${r.bookId}:${r.pageNumber}:${model}`)) jobs.push({ r, model });
  for (const model of active) if (!dead.has(model)) meta.arms[model] = { status: 'ran', at: new Date().toISOString() };
  writeMeta(meta);
  console.log(`${jobs.length} calls to make across ${active.length - dead.size} arms\n`);

  let spent = 0, n = 0;
  const refusals = {};
  await pool(jobs, CONCURRENCY, async ({ r, model }) => {
    const res = await translateOne(prompts, r, model);
    const line = rowFor(r, model, res, prompts);
    const row = JSON.parse(line);
    spent += row.cost_usd;
    if (row.refusal) refusals[model] = (refusals[model] || 0) + 1;
    stream.write(line + '\n');
    if (++n % 25 === 0) console.log(`  ${n}/${jobs.length}  spent $${spent.toFixed(3)}  refusals ${JSON.stringify(refusals)}`);
  });
  await new Promise((res) => stream.end(res));
  console.log(`\ndone: ${n} calls, spend this run $${spent.toFixed(3)} (estimate was $${est.usd.toFixed(2)}); refusals ${JSON.stringify(refusals)}`);
  console.log(`wrote ${ARMS_FILE}; arm status in ${META_FILE}`);
}

async function translateOne(prompts, r, model) {
  const book = { id: r.bookId, title: r.bookTitle, display_title: r.bookTitle, author: r.author, published: r.year, language: r.language, image_source: { provider: r.provider } };
  // Same door the pipeline uses, no previous-page context (each page stands alone in every arm).
  const { prompt, promptRef } = buildTranslationPrompt({ prompts, book, ocrText: r.ocrText, previousTranslation: null });
  const maxOut = Math.min(32768, Math.max(4096, r.ocrCjk * 4 + 1200));
  // OpenRouter providers reject max_tokens above their own ceiling with a 400, which the probe
  // would read as "arm unavailable"; 8K covers every page but the one 17K-char outlier (finish=length is recorded).
  const res = providerOf(model) === 'openrouter' ? await callOpenRouter(model, prompt, Math.min(maxOut, 8192)) : await callGemini(model, prompt, maxOut);
  return { ...res, promptRef };
}

function rowFor(r, model, res, prompts) {
  const price = priceOf(model);
  const listCost = res.error ? 0 : ((res.inTok || 0) / 1e6) * price.input + ((res.outTok || 0) / 1e6) * price.output;
  const cost = typeof res.cost_reported === 'number' ? res.cost_reported : listCost;
  const refusal = classifyRefusal(res);
  return JSON.stringify({
    bookId: r.bookId, pageNumber: r.pageNumber, language: r.language, arm: model, provider: providerOf(model),
    prompt_version: res.promptRef?.version ?? prompts.translation.ref.version, prompt_hash: res.promptRef?.content_hash ?? prompts.translation.ref.content_hash,
    ocrChars: r.ocrChars, ocrCjk: r.ocrCjk,
    text: refusal ? (res.text || null) : sanitizeTranslationTags(res.text),
    refusal, error: res.error || null, finish: res.finish || null, blockReason: res.blockReason || null,
    inTok: res.inTok || 0, outTok: res.outTok || 0, thoughtTok: res.thoughtTok || 0,
    cost_usd: cost, cost_source: typeof res.cost_reported === 'number' ? 'provider' : (price.unknown ? 'default-unknown' : 'list'),
    at: new Date().toISOString(),
  });
}

// ── shared: load pages ──────────────────────────────────────────────────────
function loadPages() {
  const rows = fs.readFileSync(ARMS_FILE, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const sample = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')).sample;
  const byKey = new Map(sample.map((s) => [`${s.bookId}:${s.pageNumber}`, s]));
  const pages = new Map();
  for (const r of rows) {
    const k = `${r.bookId}:${r.pageNumber}`;
    if (!pages.has(k)) pages.set(k, { key: k, page: byKey.get(k), arms: {} });
    pages.get(k).arms[r.arm] = r;
  }
  const ranArms = [...new Set(rows.map((r) => r.arm))];
  const arms = [BASELINE, ...ARMS.filter((a) => a !== BASELINE && ranArms.includes(a)), ...ranArms.filter((a) => !ARMS.includes(a))].filter((a) => ranArms.includes(a));
  return { rows, pages: [...pages.values()].sort((a, b) => a.key.localeCompare(b.key)), arms, meta: readMeta() };
}

// ── phase: score ────────────────────────────────────────────────────────────
const METRICS = ['prose_chars', 'length_ratio', 'cjk_residue_share', 'notes_emitted', 'verified_rate', 'inline_terms', 'keywords_emitted', 'invented_tags', 'housekeeping_tags', 'emdashes'];
const FLAGS = ['untranslated', 'glossary_block'];
const sum = (xs) => xs.reduce((s, x) => s + (x || 0), 0);
const countBy = (xs) => xs.reduce((m, x) => { m[x] = (m[x] || 0) + 1; return m; }, {});
const fmt = (x) => (x === null || x === undefined ? '  —  ' : (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(3)).padStart(6));

function phaseScore() {
  const { rows, pages, arms, meta } = loadPages();
  const out = { scored_at: new Date().toISOString(), baseline: BASELINE, arms, skipped: Object.fromEntries(Object.entries(meta.arms || {}).filter(([, v]) => v.status === 'skipped')), prompt: meta.prompt || null, n_pages: pages.length, spend_usd: sum(rows.map((r) => r.cost_usd)), refusals: {}, per_arm: {}, paired: {}, pages: [] };
  for (const model of arms) {
    const armRows = rows.filter((r) => r.arm === model);
    const refused = armRows.filter((r) => r.refusal);
    out.refusals[model] = { n: refused.length, of: armRows.length, kinds: countBy(refused.map((r) => r.refusal.split(':')[0])), finish: countBy(armRows.map((r) => r.finish || 'none')) };
    out.per_arm[model] = { provider: providerOf(model), calls: armRows.length, delivered: armRows.length - refused.length, inTok: sum(armRows.map((r) => r.inTok)), outTok: sum(armRows.map((r) => r.outTok)), thoughtTok: sum(armRows.map((r) => r.thoughtTok)), usd: sum(armRows.map((r) => r.cost_usd)), cost_source: countBy(armRows.map((r) => r.cost_source)), max_tokens_hits: armRows.filter((r) => ['MAX_TOKENS', 'length'].includes(r.finish)).length };
    out.per_arm[model].usd_per_page = out.per_arm[model].delivered ? out.per_arm[model].usd / out.per_arm[model].delivered : null;
  }
  for (const p of pages) {
    const row = { id: p.key, ocrCjk: p.page?.ocrCjk, refusal: {}, scores: {} };
    for (const model of arms) {
      const r = p.arms[model];
      row.refusal[model] = r ? r.refusal : 'not-run';
      if (r && !r.refusal) row.scores[model] = scoreArm(r.text, p.page.ocrText);
    }
    out.pages.push(row);
  }
  for (const model of arms) {
    const scored = out.pages.filter((r) => r.scores[model]).map((r) => r.scores[model]);
    const m = {};
    for (const k of METRICS) { const xs = scored.map((s) => s[k]).filter((x) => typeof x === 'number'); m[k] = { mean: mean(xs), median: median(xs), n: xs.length }; }
    for (const k of FLAGS) m[k] = { count: scored.filter((s) => s[k]).length, of: scored.length };
    out.per_arm[model].metrics = m;
  }
  // Paired deltas arm − baseline over pages both delivered, bootstrap CI on the mean difference.
  for (const model of arms.slice(1)) {
    out.paired[model] = {};
    const both = out.pages.filter((r) => r.scores[BASELINE] && r.scores[model]);
    for (const k of METRICS) {
      const d = both.map((r) => (typeof r.scores[BASELINE][k] === 'number' && typeof r.scores[model][k] === 'number') ? r.scores[model][k] - r.scores[BASELINE][k] : null).filter((x) => x !== null);
      resetSeed();
      const ci = bootstrapCI(d);
      out.paired[model][k] = { n: d.length, delta: mean(d), ci, decisive: ci ? (ci[0] > 0 && ci[1] > 0) || (ci[0] < 0 && ci[1] < 0) : false };
    }
  }
  fs.writeFileSync(P('score.json'), JSON.stringify(out, null, 1));
  console.log(`n=${out.n_pages} pages; arms ran: ${arms.join(', ')}; skipped: ${Object.keys(out.skipped).join(', ') || 'none'}; spend $${out.spend_usd.toFixed(3)}`);
  for (const model of arms) { const a = out.per_arm[model]; console.log(`${model.padEnd(30)} delivered ${a.delivered}/${a.calls} refusals ${JSON.stringify(out.refusals[model].kinds)} MAX_TOKENS ${a.max_tokens_hits} $${a.usd.toFixed(3)} ($${(a.usd_per_page || 0).toFixed(4)}/p)  residue ${fmt(a.metrics.cjk_residue_share.mean)} ratio ${fmt(a.metrics.length_ratio.mean)} notes ${fmt(a.metrics.notes_emitted.mean)} verified ${fmt(a.metrics.verified_rate.mean)} untranslated ${a.metrics.untranslated.count}`); }
  console.log(`wrote ${P('score.json')}`);
}

// ── phase: judge packet ─────────────────────────────────────────────────────
/**
 * Every page goes to the judge with ALL the translations that were delivered for
 * it, labelled T1..Tk in a per-page shuffled order from the seeded stream; the key
 * lives in a separate file the judge never sees. A second pass over the first 20
 * pages, re-shuffled, measures judge agreement.
 */
function phaseJudgePacket() {
  const { pages, arms } = loadPages();
  const usable = pages.map((p) => ({ ...p, delivered: arms.filter((a) => p.arms[a] && !p.arms[a].refusal) })).filter((p) => p.delivered.length >= 2);
  const write = (list, seedOffset, packetName, keyName) => {
    resetSeed(0x5eed + seedOffset);
    const packet = [], key = [];
    for (const p of list) {
      const order = [...p.delivered];
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const translations = {}, map = {};
      order.forEach((model, i) => { translations[`T${i + 1}`] = p.arms[model].text; map[`T${i + 1}`] = model; });
      packet.push({ id: p.key, n: order.length, ocr: p.page.ocrText, translations });
      key.push({ id: p.key, labels: map });
    }
    fs.writeFileSync(P(packetName), packet.map((x) => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(P(keyName), JSON.stringify({ baseline: BASELINE, arms, pages: key }, null, 1));
    console.log(`wrote ${packet.length} blinded pages (${mean(packet.map((x) => x.n)).toFixed(1)} translations each) to ${P(packetName)}; key (never shown to a judge): ${P(keyName)}`);
  };
  write(usable, 0, 'judge-packet.jsonl', 'judge-key.json');
  const second = Number(arg('second-pass', 20));
  write(usable.slice(0, second), 7, 'judge-packet-pass2.jsonl', 'judge-key-pass2.json');
  console.log(`pages with < 2 delivered translations, excluded from judging (counted in the refusal row): ${pages.length - usable.length}`);
}

// ── phase: report ───────────────────────────────────────────────────────────
function readVerdicts(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
/**
 * Competition ranks from a ranking that may be flat (["T2","T1"]) or grouped
 * with ties ([["T2"],["T1","T3"]]): rank = 1 + number of labels strictly ahead.
 */
export function ranksOf(ranking) {
  const groups = (ranking || []).map((g) => (Array.isArray(g) ? g : [g]));
  const ranks = {};
  let ahead = 0;
  for (const g of groups) { for (const t of g) ranks[t] = ahead + 1; ahead += g.length; }
  return ranks;
}
/** Map T-labels onto model ids using the key. */
function unblind(v, k) {
  const ranks = ranksOf(v.ranking);
  const byModel = (obj, def = null) => Object.fromEntries(Object.entries(k.labels).map(([t, m]) => [m, obj && t in obj ? obj[t] : def]));
  const rankByModel = byModel(ranks);
  return { id: v.id, rank: rankByModel, fabrication: byModel(v.fabrication, false), omission: byModel(v.omission, false), terms_ok: byModel(v.terms_ok, null), confidence: v.confidence, reason: v.reason, labels: k.labels };
}

function phaseReport() {
  const score = JSON.parse(fs.readFileSync(P('score.json'), 'utf8'));
  const key = JSON.parse(fs.readFileSync(P('judge-key.json'), 'utf8'));
  const keyById = new Map(key.pages.map((k) => [k.id, k]));
  const verdicts = readVerdicts(P('judge-verdicts.jsonl')).filter((v) => keyById.has(v.id)).map((v) => unblind(v, keyById.get(v.id)));
  const arms = score.arms;
  const judge = {};
  for (const model of arms) {
    const ranked = verdicts.filter((v) => typeof v.rank[model] === 'number');
    const vsBase = ranked.filter((v) => typeof v.rank[BASELINE] === 'number');
    const wins = vsBase.filter((v) => v.rank[model] < v.rank[BASELINE]).length;
    const losses = vsBase.filter((v) => v.rank[model] > v.rank[BASELINE]).length;
    judge[model] = {
      n_ranked: ranked.length, mean_rank: mean(ranked.map((v) => v.rank[model])), first_place: ranked.filter((v) => v.rank[model] === 1).length,
      vs_baseline: model === BASELINE ? null : { n: vsBase.length, wins, losses, ties: vsBase.length - wins - losses, p: binomTwoSided(Math.min(wins, losses), wins + losses) },
      fabrication: ranked.filter((v) => v.fabrication[model] === true).length,
      omission: ranked.filter((v) => v.omission[model] === true).length,
      terms_ok: ranked.filter((v) => v.terms_ok[model] === true).length,
      terms_judged: ranked.filter((v) => typeof v.terms_ok[model] === 'boolean').length,
    };
  }
  // Second pass agreement.
  let agreement = null;
  if (fs.existsSync(P('judge-key-pass2.json'))) {
    const key2 = JSON.parse(fs.readFileSync(P('judge-key-pass2.json'), 'utf8'));
    const k2 = new Map(key2.pages.map((k) => [k.id, k]));
    const v2 = readVerdicts(P('judge-verdicts-pass2.jsonl')).filter((v) => k2.has(v.id)).map((v) => unblind(v, k2.get(v.id)));
    const v1 = new Map(verdicts.map((v) => [v.id, v]));
    const both = v2.filter((v) => v1.has(v.id));
    let dirSame = 0, dirN = 0, fabSame = 0, fabN = 0, firstSame = 0;
    const rhos = [];
    for (const b of both) {
      const a = v1.get(b.id);
      for (const model of arms) {
        if (model === BASELINE) continue;
        if ([a, b].every((v) => typeof v.rank[model] === 'number' && typeof v.rank[BASELINE] === 'number')) {
          dirN++; if (Math.sign(a.rank[model] - a.rank[BASELINE]) === Math.sign(b.rank[model] - b.rank[BASELINE])) dirSame++;
        }
      }
      for (const model of arms) if (typeof a.fabrication[model] === 'boolean' && typeof b.fabrication[model] === 'boolean') { fabN++; if (a.fabrication[model] === b.fabrication[model]) fabSame++; }
      const common = arms.filter((m) => typeof a.rank[m] === 'number' && typeof b.rank[m] === 'number');
      if (common.length >= 3) rhos.push(spearman(common.map((m) => a.rank[m]), common.map((m) => b.rank[m])));
      const top = (v) => arms.filter((m) => v.rank[m] === 1);
      if (top(a).some((m) => top(b).includes(m))) firstSame++;
    }
    agreement = { n: both.length, direction_vs_baseline_same: dirSame, direction_n: dirN, direction_rate: dirN ? dirSame / dirN : null, first_place_same: firstSame, mean_spearman: mean(rhos), fabrication_same: fabSame, fabrication_n: fabN };
  }

  // ── The pre-registered rule (EXPERIMENTS.md, 2026-09-13) ──
  const base = { ref: score.refusals[BASELINE].n, fab: judge[BASELINE].fabrication, cost: score.per_arm[BASELINE].usd_per_page };
  const eligible = arms.filter((m) => m !== BASELINE && score.refusals[m].n <= base.ref + 4 && judge[m].fabrication <= base.fab);
  const beats = eligible.filter((m) => judge[m].vs_baseline.wins > judge[m].vs_baseline.losses && judge[m].vs_baseline.p < 0.05);
  const cheaper = (m) => (score.per_arm[m].usd_per_page ?? Infinity) <= base.cost;
  const leads = eligible.filter((m) => !beats.includes(m) && judge[m].vs_baseline.wins > judge[m].vs_baseline.losses && judge[m].vs_baseline.p < 0.2);
  const cheapTies = eligible.filter((m) => cheaper(m) && !beats.includes(m) && judge[m].mean_rank <= judge[BASELINE].mean_rank && judge[m].vs_baseline.p >= 0.05);
  let recommendation, why;
  const byCost = (a, b) => (score.per_arm[a].usd_per_page ?? Infinity) - (score.per_arm[b].usd_per_page ?? Infinity);
  const lineFor = (m) => `${m} (ranked above ${BASELINE} on ${judge[m].vs_baseline.wins} pages, below on ${judge[m].vs_baseline.losses}, p=${judge[m].vs_baseline.p.toFixed(3)}; fabrication ${judge[m].fabrication} vs ${base.fab}; $${(score.per_arm[m].usd_per_page || 0).toFixed(4)}/page vs $${(base.cost || 0).toFixed(4)})`;
  if (beats.length) {
    const affordable = beats.filter((m) => (score.per_arm[m].usd_per_page ?? Infinity) <= 2 * base.cost).sort(byCost);
    const bigFabGap = beats.filter((m) => base.fab - judge[m].fabrication >= 5).sort(byCost);
    if (affordable.length) { recommendation = affordable[0]; why = `beats the baseline blind at p < 0.05 with no more fabrication and costs at most 2× lite: ${lineFor(affordable[0])}.${beats.length > 1 ? ` Also beat lite: ${beats.filter((m) => m !== affordable[0]).map(lineFor).join('; ')}.` : ''}`; }
    else if (bigFabGap.length) { recommendation = bigFabGap[0]; why = `costs more than 2× lite but lite fabricates on ≥ 5 more pages, the disqualifier: ${lineFor(bigFabGap[0])}.`; }
    else { recommendation = BASELINE; why = `${beats.map(lineFor).join('; ')} beat lite blind but cost more than 2× and lite's fabrication gap is under 5 pages; lite stays.`; }
  } else if (cheapTies.length || leads.length) {
    recommendation = 'undecided';
    why = `nothing beats lite at p < 0.05.${cheapTies.length ? ` Cheaper arms with a mean rank at least as good as lite: ${cheapTies.sort(byCost).map(lineFor).join('; ')} — a 120-page run (≈$${(120 * (base.cost + Math.min(...cheapTies.map((m) => score.per_arm[m].usd_per_page)))).toFixed(2)}) would decide whether the saving is real.` : ''}${leads.length ? ` Leading but not significant: ${leads.map(lineFor).join('; ')}.` : ''}`;
  } else {
    recommendation = BASELINE;
    why = `no eligible arm ranks above lite (eligible = refusals ≤ lite + 4 and fabrication ≤ lite's: ${eligible.join(', ') || 'none'}); lite stays the route.`;
  }

  const report = { reported_at: new Date().toISOString(), baseline: BASELINE, arms, skipped: score.skipped, prompt: score.prompt, n_pages: score.n_pages, n_judged: verdicts.length, spend_usd: score.spend_usd, refusals: score.refusals, per_arm: score.per_arm, paired: score.paired, judge, mean_confidence: mean(verdicts.map((v) => v.confidence).filter((x) => typeof x === 'number')), second_pass: agreement, eligible, beats_baseline: beats, recommendation, why, verdicts };
  fs.writeFileSync(P('report.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(P('report.md'), renderMd(report));
  for (const m of arms) console.log(`${m.padEnd(30)} mean rank ${fmt(judge[m].mean_rank)} first ${judge[m].first_place}  fab ${judge[m].fabrication} omit ${judge[m].omission}  ${m === BASELINE ? '(baseline)' : `vs lite ${judge[m].vs_baseline.wins}-${judge[m].vs_baseline.losses}-${judge[m].vs_baseline.ties} p=${judge[m].vs_baseline.p.toFixed(3)}`}  refusals ${score.refusals[m].n}  $${(score.per_arm[m].usd_per_page || 0).toFixed(4)}/p`);
  console.log(`RECOMMENDATION: ${recommendation} — ${why}`);
  console.log(`wrote ${P('report.md')} and ${P('report.json')}`);
}

function spearman(xs, ys) {
  const n = xs.length;
  const rank = (a) => { const s = [...a].map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(n); let i = 0; while (i < n) { let j = i; while (j + 1 < n && s[j + 1][0] === s[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[s[k][1]] = avg; i = j + 1; } return r; };
  const rx = rank(xs), ry = rank(ys);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

function renderMd(r) {
  const num = (x, d = 2) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
  const pct = (x) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(0)}%`);
  const L = [];
  L.push(`# Chinese translation model comparison — ${r.arms.length} arms on the 樂舞 preview pages`, '');
  L.push(`_${r.reported_at.slice(0, 10)} · paired, one page per book, production translation prompt v${r.prompt?.version ?? '?'} (hash ${(r.prompt?.content_hash || '').slice(0, 8)}), no thinking · **n = ${r.n_pages} pages**, ${r.n_judged} judged blind · baseline **${r.baseline}** · spent **$${r.spend_usd.toFixed(2)}**_`, '');
  L.push(`## Recommendation for the 樂舞 run: **${r.recommendation}**`, '', r.why, '');
  L.push('Pre-registered rule (EXPERIMENTS.md 2026-09-13): an arm is eligible if it refused at most 4 more pages than lite and was flagged for fabrication on no more pages; it beats lite if the blind judge ranked it above lite on more pages than below at sign-test p < 0.05. Recommend the cheapest arm that beats lite and costs ≤ 2× lite; a dearer winner only if lite fabricates on ≥ 5 more pages; otherwise lite, unless a cheaper arm ties lite, which is "undecided" with the run that would settle it.', '');
  const sk = Object.entries(r.skipped || {});
  if (sk.length) { L.push('## Arms skipped (recorded, not failed)', '', '| arm | reason |', '|---|---|'); for (const [m, v] of sk) L.push(`| ${m} | ${v.reason} |`); L.push('', 'Add `OPENROUTER_API_KEY` to the Hetzner env and re-run `--run` (the harness resumes; existing arms are not re-spent), then `--score --judge-packet`, re-judge, `--report`.', ''); }
  L.push('## Blind ranking (Sonnet lean-workers; labels shuffled per page, key withheld)', '', `| arm | pages ranked | mean rank | 1st place | vs lite W-L-T | sign p | fabrication | omission | terms ok |`, '|---|---|---|---|---|---|---|---|---|');
  for (const m of r.arms) { const j = r.judge[m]; L.push(`| ${m}${m === r.baseline ? ' (baseline)' : ''} | ${j.n_ranked} | ${num(j.mean_rank)} | ${j.first_place} | ${j.vs_baseline ? `${j.vs_baseline.wins}-${j.vs_baseline.losses}-${j.vs_baseline.ties}` : '—'} | ${j.vs_baseline ? num(j.vs_baseline.p, 3) : '—'} | ${j.fabrication} | ${j.omission} | ${j.terms_ok}/${j.terms_judged} |`); }
  L.push('', `Mean judge confidence ${num(r.mean_confidence)}. Fabrication = the judge found something asserted that the Chinese does not say (the disqualifier); omission = a clause/entry present in the source and absent from the translation.`, '');
  if (r.second_pass) L.push(`Second judge pass over ${r.second_pass.n} pages (labels re-shuffled): arm-vs-lite direction agreed on ${r.second_pass.direction_vs_baseline_same}/${r.second_pass.direction_n} comparisons (${pct(r.second_pass.direction_rate)}); same first place on ${r.second_pass.first_place_same}/${r.second_pass.n}; mean Spearman ρ between the two rankings ${num(r.second_pass.mean_spearman)}; fabrication flags identical on ${r.second_pass.fabrication_same}/${r.second_pass.fabrication_n}.`, '');
  L.push('## Refusals by arm (reported, never dropped)', '', '| arm | calls | delivered | refused | kinds | MAX_TOKENS |', '|---|---|---|---|---|---|');
  for (const m of r.arms) L.push(`| ${m} | ${r.per_arm[m].calls} | ${r.per_arm[m].delivered} | ${r.refusals[m].n} | ${JSON.stringify(r.refusals[m].kinds)} | ${r.per_arm[m].max_tokens_hits} |`);
  L.push('');
  L.push('## Reference-free table (per delivered page)', '', '| arm | prose chars | Eng chars / CJK char | untranslated CJK share | pages > 20% untranslated | original-notes / page | verified-note rate | inline terms | invented tags | housekeeping tags | glossary blocks |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of r.arms) { const t = r.per_arm[m].metrics; L.push(`| ${m} | ${num(t.prose_chars.mean, 0)} | ${num(t.length_ratio.mean)} | ${num(t.cjk_residue_share.mean, 3)} | ${t.untranslated.count}/${t.untranslated.of} | ${num(t.notes_emitted.mean)} | ${num(t.verified_rate.mean)} | ${num(t.inline_terms.mean, 1)} | ${num(t.invented_tags.mean)} | ${num(t.housekeeping_tags.mean)} | ${t.glossary_block.count} |`); }
  L.push('', 'Instrument note: `verified-note rate` checks that the phrase inside `<note>original: "…"</note>` occurs verbatim in the OCR. A model that writes the citation in pinyin ("Zuo Zhuan") instead of characters (左傳) scores ~0 here without having fabricated anything — read it as a citation-FORMAT measure, and read fabrication from the blind judge.', '');
  L.push('Paired deltas vs lite (bootstrap 95% CI on the page-wise difference; ** = CI excludes 0):', '', '| arm | Δ prose chars | Δ untranslated share | Δ notes/page | Δ verified rate | Δ invented tags |', '|---|---|---|---|---|---|');
  const cell = (d) => (d && d.n ? `${num(d.delta, 3)}${d.decisive ? ' **' : ''} [${num(d.ci?.[0], 3)}, ${num(d.ci?.[1], 3)}] n=${d.n}` : '—');
  for (const m of r.arms.slice(1)) { const p = r.paired[m] || {}; L.push(`| ${m} | ${cell(p.prose_chars)} | ${cell(p.cjk_residue_share)} | ${cell(p.notes_emitted)} | ${cell(p.verified_rate)} | ${cell(p.invented_tags)} |`); }
  L.push('');
  L.push('## Cost actually spent', '', '| arm | in tok | out tok | thought tok | USD | $/page | cost source | 樂舞 20K pages ≈ |', '|---|---|---|---|---|---|---|---|');
  for (const m of r.arms) { const a = r.per_arm[m]; L.push(`| ${m} | ${a.inTok.toLocaleString()} | ${a.outTok.toLocaleString()} | ${a.thoughtTok} | $${a.usd.toFixed(3)} | $${num(a.usd_per_page, 4)} | ${Object.keys(a.cost_source).join(',')} | $${num(20000 * (a.usd_per_page || 0), 0)} |`); }
  L.push('', 'Realtime list rates (Gemini batch is half). `list` = tokens × the price table; `provider` = the charge OpenRouter reported.', '');
  L.push('## Judge reasons (unblinded; rank per arm)', '');
  for (const v of r.verdicts) L.push(`- \`${v.id}\` conf ${num(v.confidence, 1)} — ${r.arms.filter((m) => typeof v.rank[m] === 'number').sort((a, b) => v.rank[a] - v.rank[b]).map((m) => `${v.rank[m]}. ${m.replace(/^.*\//, '')}${v.fabrication[m] ? ' ⚠fab' : ''}${v.omission[m] ? ' ⚠omit' : ''}`).join(' · ')} — ${v.reason}`);
  L.push('', 'Artifacts: `translation-model-ab-zh-{books.txt,sample.json,arms.jsonl,run-meta.json,score.json,judge-packet.jsonl,judge-key.json,judge-verdicts.jsonl,judge-packet-pass2.jsonl,judge-key-pass2.json,judge-verdicts-pass2.jsonl,report.json}`. Harness: `scripts/eval/translation-model-ab.mjs`. Judge prompt: `scripts/eval/translation-model-ab-JUDGE-PROMPT.md`.');
  return L.join('\n') + '\n';
}

// ── main ────────────────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  try {
    if (has('draw')) await phaseDraw();
    else if (has('dry-run')) phaseDryRun();
    else if (has('run')) await phaseRun();
    else if (has('score')) phaseScore();
    else if (has('judge-packet')) phaseJudgePacket();
    else if (has('report')) phaseReport();
    else console.log('one of --draw | --dry-run | --run | --score | --judge-packet | --report (see the header)');
  } finally {
    await disconnect().catch(() => {});
  }
}

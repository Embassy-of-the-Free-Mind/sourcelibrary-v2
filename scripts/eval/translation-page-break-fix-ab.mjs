#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-batch-continuity-ab.mjs — the arm runner this follows (raw
// Gemini caller `gemini` and `pool` imported from translation-prompt-ab.mjs, `readerText` imported
// from it, --approved-usd refusal, resumable jsonl rows). It does not fit as-is: its unit is an
// 8-page BLOCK under three seed shapes, its sample is its own draw, and its prompt is the worker's
// block prompt; here the unit is one SEAM (two single-page prompts, chained), the sample is the 63
// S1/P seams of the fidelity judge key, and the treatment is buildTranslationPrompt's pageBreak
// option. scripts/eval/translation-batch-shadow-judge.mjs — the blinded source-carrying packet
// this copies (seeded flips, key apart from the packet, `--with-source` junction); it reads lanes
// from translate_batch_runs and pages, not from arm rows on disk. Also checked: translation-model-ab
// (model arms), translation-prompt-ab (prompt-version arms, single page, note-verification estimand).
/**
 * translation-page-break-fix-ab — does the page-break fix (#5103) make the translation more
 * FAITHFUL across the break, measured against its own noise floor?
 *
 * Three arms, each translating BOTH pages of each seam with the realtime single-page prompt on the
 * production model, page N seeded with the stored translation of N-1, page N+1 seeded with the
 * arm's own fresh translation of N (the worker's chain):
 *
 *   B    the current production prompt, run now
 *   B2   B again — the A/A noise floor of the judge on these texts
 *   F    B + buildTranslationPrompt({ pageBreak: PAGE_BREAK_FIX }): split-word join, catchword mark,
 *        next-page lookahead, one rule line
 *
 * Seams: the 63 S1/P junctions of scripts/eval/results/translation-batch-seam-fidelity-judge-key.json
 * (9 books, de/la, mid-flow by the source), prevId from translate_batch_runs.seams. Nothing here
 * writes to `pages`; the only writes are files under scripts/eval/results/ and gemini_usage rows
 * (endpoint eval/translation-page-break-fix, book_id set) so the spend is attributable.
 *
 *   --draw                 FREE   fetch the seam pages, classify each break, estimate the cost
 *   --run --approved-usd X PAID   the arms (resumable; refuses without approval ≥ estimate, cap $3)
 *   --packet               FREE   blinded F/B and B/B2 junction pairs with the source, 8 judge chunks
 *   --score                FREE   verdicts → fidelity tallies, defects by type, the device subset
 *   --blocks               with --draw/--run/--packet: the BLOCK-shaped measurement — one production-
 *                          shaped block (≤8 pages) around each seam, the worker's own block prompt,
 *                          arms B / B2 / Fs (Fs = PAGE_BREAK_SCOPED, the flip candidate)
 *   --device-only          with --run/--packet: only the seams that carry a device (round 4: one new
 *                          arm, Fs2, on the 24 device seams against the round-3 B / B2 rows)
 *
 * Run --run on Hetzner (paid Gemini is geo-blocked on the laptop):
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/translation-page-break-fix-ab.mjs --run --approved-usd 3
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  loadTranslationPrompts, buildTranslationPrompt, buildBlockTranslationPrompt, sanitizeTranslationTags, getTranslateModelForBook,
  isTranslatablePage, PAGE_BREAK_FIX, PAGE_BREAK_SCOPED,
} from '../lib/translate-core.mjs';
import { resolvePageBreak } from '../lib/page-break-devices.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { logUsage } from '../workers/lib/supabase-usage-logger.mjs';
import { connect, disconnect } from './lib/sampling.mjs';
import { resetSeed, seededRand, binomTwoSided } from './lib/paired-stats.mjs';
import { gemini, pool } from './translation-prompt-ab.mjs';
import { readerText, parseBlock } from './translation-batch-continuity-ab.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const RESULTS = new URL('./results/', import.meta.url).pathname;
const TAG = 'translation-page-break-fix';
const SOURCE_KEY = path.join(RESULTS, 'translation-batch-seam-fidelity-judge-key.json');
const SAMPLE_FILE = path.join(RESULTS, `${TAG}-sample.json`);
// --blocks: the BLOCK-shaped measurement (2026-09-25 late night, Derek's go): one production-shaped
// block of up to 8 pages around each seam, translated with the worker's own block prompt
// (buildBlockTranslationPrompt). Its rows live in their own file so the single-page rows stay intact.
const BLOCKS = has('blocks');
const BLOCK_SAMPLE_FILE = path.join(RESULTS, `${TAG}-block-sample.json`);
const ARMS_FILE = path.join(RESULTS, BLOCKS ? `${TAG}-block-arms.jsonl` : `${TAG}-arms.jsonl`);
// --tag=NAME: file-name stem for a packet/key/verdicts/report set, so a second draw of pairs (the
// 2026-09-25 night follow-up: F0 and FC against the same B) never overwrites a judged key.
const PTAG = arg('tag', TAG);
const PACKET_FILE = path.join(RESULTS, `${PTAG}-judge-packet.jsonl`);
const KEY_FILE = path.join(RESULTS, `${PTAG}-judge-key.json`);
const VERDICTS_GLOB = `${PTAG}-judge-verdicts`;
const ENDPOINT = 'eval/translation-page-break-fix';
const CEILING_USD = 3;                       // Derek, 2026-09-25: cap $3
const ARMS = String(arg('arms', 'B,B2,F')).split(',');
/** What each arm passes as `pageBreak`. B/B2: nothing (production's prompt). */
const ARM_FIX = {
  B: undefined, B2: undefined,
  F: PAGE_BREAK_FIX,                                   // all four pieces, sentence-length lookahead
  F0: { ...PAGE_BREAK_FIX, lookahead: false },        // edits + rule only, no lookahead
  FC: { ...PAGE_BREAK_FIX, lookahead: 'clause' },     // edits + rule + clause-length lookahead
  Fs: PAGE_BREAK_SCOPED,                              // F0 applied only where a device is (the flip candidate)
  // Round 4 (2026-09-25 evening): the same option after the hardening — a plausibility gate on the
  // split-word join (continuationPlausible) and the "ordinary text" note wording. A new arm name so
  // the round-3 Fs rows stay intact beside it.
  Fs2: PAGE_BREAK_SCOPED,
};
// --device-only: only the seams that carry a device (round 4 re-runs one arm on those 24 and reuses
// the round-3 B / B2 rows for the pairs).
const DEVICE_ONLY = has('device-only');
const selectSeams = (sample) => (DEVICE_ONLY ? sample.filter((s) => s.device) : sample);
// Production's blocking rules (translate-worker.mjs BATCH_SIZE / MIN_OCR_CHARS_FOR_BATCH / MAX_BATCH_OCR_CHARS).
const BLOCK = 8, MIN_PAGE_OCR_CHARS = 200, MAX_BLOCK_OCR_CHARS = 20000;
/** --pairs X/Y,...: the blinded pairs a packet draws (default the first measurement's). */
const PAIRS = String(arg('pairs', 'F/B,B/B2')).split(',');
const CONCURRENCY = Number(arg('concurrency', 4));
const JUDGES = 8;
const EXCERPT = 1200;                        // as the fidelity judge saw it (shadow-judge EXCERPT)
const SEED = 0x5103;

const tail = (t) => (t.length > EXCERPT ? '…' + t.slice(-EXCERPT) : t);
const head = (t) => (t.length > EXCERPT ? t.slice(0, EXCERPT) + '…' : t);
const junction = (prev, seam) => `${tail(readerText(prev))}\n\n———— page break ————\n\n${head(readerText(seam))}`;
const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 12);

// ── --draw ──────────────────────────────────────────────────────────────────
async function phaseDraw() {
  const key = JSON.parse(fs.readFileSync(SOURCE_KEY, 'utf8'));
  const rows = key.key.filter((k) => k.pair === 'S1/P');
  const { db } = await connect();
  const sample = [];
  for (const bookId of key.books) {
    const runs = await db.collection('translate_batch_runs').find({ book_id: bookId, shadow: true, phase: 'shadow_complete' }).sort({ created_at: 1 }).toArray();
    const prevOf = new Map();
    for (const r of runs) for (const s of r.seams || []) if (!prevOf.has(s.seamId)) prevOf.set(s.seamId, s.prevId);
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1, 'image_source.provider': 1 } });
    for (const k of rows.filter((k) => k.book_id === bookId)) {
      const prevId = prevOf.get(k.seam_id);
      if (!prevId) throw new Error(`${k.id}: no prevId in translate_batch_runs.seams for ${k.seam_id}`);
      const [N, X] = await Promise.all([prevId, k.seam_id].map((id) => db.collection('pages').findOne({ id }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1 } })));
      if (!N?.ocr?.data || !X?.ocr?.data) throw new Error(`${k.id}: seam page without OCR`);
      const before = await db.collection('pages').findOne({ book_id: bookId, page_number: N.page_number - 1 }, { projection: { id: 1, 'translation.data': 1, 'ocr.data': 1 } });
      const after = await db.collection('pages').findOne({ book_id: bookId, page_number: X.page_number + 1 }, { projection: { id: 1, 'ocr.data': 1, page_type: 1 } });
      const brk = resolvePageBreak(N.ocr.data, X.ocr.data);
      sample.push({
        id: k.id, bookId, language: book.language, provider: book.image_source?.provider || null,
        book: { id: book.id, title: book.title, display_title: book.display_title, author: book.author, published: book.published, year: book.year, language: book.language, image_source: book.image_source },
        model: getTranslateModelForBook(book),
        seedTranslation: typeof before?.translation?.data === 'string' ? before.translation.data : null,
        N: { id: N.id, page_number: N.page_number, ocr: N.ocr.data },
        X: { id: X.id, page_number: X.page_number, ocr: X.ocr.data },
        after: after?.ocr?.data ? { id: after.id, ocr: after.ocr.data, page_type: after.page_type || null } : null,
        break: { kind: brk.kind, catchword: brk.catchword, joined: brk.joined, removedFromN: brk.removedFromN, removedFromNext: brk.removedFromNext },
        device: brk.kind != null || brk.catchword != null,
      });
    }
  }
  await disconnect();
  const est = estimate(sample);
  const kinds = {};
  for (const s of sample) kinds[String(s.break.kind)] = (kinds[String(s.break.kind)] || 0) + 1;
  fs.writeFileSync(SAMPLE_FILE, JSON.stringify({ drawn_at: new Date().toISOString(), arms: ARMS, n: sample.length, device_seams: sample.filter((s) => s.device).length, kinds, estimate: est, sample }, null, 1));
  console.log(`n = ${sample.length} seams; ${sample.filter((s) => s.device).length} carry a device (kinds ${JSON.stringify(kinds)}); ${sample.filter((s) => !s.seedTranslation).length} without a stored seed; ${sample.filter((s) => !s.after).length} without a page after the seam`);
  console.log(`ESTIMATE: ${est.calls} calls, in ~${est.inputTokens.toLocaleString()} tok, out ~${est.outputTokens.toLocaleString()} tok = $${est.usd.toFixed(2)} (cap $${CEILING_USD})`);
  console.log(`wrote ${SAMPLE_FILE}\nPAID STEP NOT RUN.`);
}

/** Two single-page calls per seam per arm; the header is ~7,300 chars, the seed ≤ 2,000, a lookahead ≤ 400. */
function estimate(sample, headerChars = 7600) {
  let inputTokens = 0, outputTokens = 0, usd = 0;
  for (const s of sample) {
    const price = priceFor(s.model);
    for (const arm of ARMS) {
      if (!(arm in ARM_FIX)) throw new Error(`unknown arm ${arm}; known: ${Object.keys(ARM_FIX).join(',')}`);
      const extra = ARM_FIX[arm] ? 900 : 0;
      const inTok = Math.ceil((headerChars + s.N.ocr.length + 2000 + extra) / 4) + Math.ceil((headerChars + s.X.ocr.length + 2000 + extra) / 4);
      const outTok = Math.ceil((s.N.ocr.length + s.X.ocr.length) * 0.35);
      inputTokens += inTok; outputTokens += outTok;
      usd += (inTok / 1e6) * price.input + (outTok / 1e6) * price.output;
    }
  }
  return { calls: sample.length * ARMS.length * 2, inputTokens, outputTokens, usd };
}

// ── --draw --blocks ─────────────────────────────────────────────────────────
/**
 * One production-shaped block per seam: the 8-page window N-3..N+4, shrunk from its ends until it
 * passes the worker's rules (every page translatable and ≥ MIN_PAGE_OCR_CHARS, ≤ MAX_BLOCK_OCR_CHARS in
 * all) with N and N+1 still inside. Seeded like the worker: the STORED translation of the page before
 * the block, the same for every arm. Device seams first, so a spend cap loses plain seams, not the
 * targeted ones.
 */
async function phaseDrawBlocks() {
  const { sample } = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const { db } = await connect();
  const out = [], dropped = [];
  for (const s of sample) {
    const lo = s.N.page_number - 3, hi = s.X.page_number + 4;
    const rows = await db.collection('pages').find({ book_id: s.bookId, page_number: { $gte: lo - 1, $lte: hi } },
      { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'translation.data': 1, 'translation.recitation_blocked': 1, 'translation.safety_blocked': 1 } }).sort({ page_number: 1 }).toArray();
    const byNum = new Map(rows.map((p) => [p.page_number, p]));
    const ok = (p) => p && isTranslatablePage(p).ok && (p.ocr?.data || '').length >= MIN_PAGE_OCR_CHARS;
    let from = lo, to = hi;
    const window = () => { const w = []; for (let n = from; n <= to; n++) w.push(byNum.get(n)); return w; };
    const chars = (w) => w.reduce((t, p) => t + (p?.ocr?.data || '').length, 0);
    // Shrink alternately from the far ends until the block is one production would send.
    let side = 0;
    while (to - from + 1 > 2 && (window().some((p) => !ok(p)) || chars(window()) > MAX_BLOCK_OCR_CHARS || to - from + 1 > BLOCK)) {
      if (side === 0 && from < s.N.page_number) from++; else if (to > s.X.page_number) to--; else from++;
      side ^= 1;
    }
    const w = window();
    if (w.some((p) => !ok(p)) || from > s.N.page_number || to < s.X.page_number) { dropped.push({ id: s.id, reason: 'no production-shaped block holds both seam pages' }); continue; }
    const before = byNum.get(from - 1);
    out.push({
      ...s,
      block: { from, to, size: w.length, ocrChars: chars(w), pages: w.map((p) => ({ id: p.id, page_number: p.page_number, ocr: p.ocr.data })) },
      blockSeed: typeof before?.translation?.data === 'string' ? before.translation.data : null,
      blockPrevOcr: before?.ocr?.data || null,
      blockNextOcr: byNum.get(to + 1)?.ocr?.data || null,
    });
  }
  await disconnect();
  out.sort((a, b) => Number(b.device) - Number(a.device));
  const est = estimateBlocks(out);
  const sizes = {};
  for (const s of out) sizes[s.block.size] = (sizes[s.block.size] || 0) + 1;
  fs.writeFileSync(BLOCK_SAMPLE_FILE, JSON.stringify({ drawn_at: new Date().toISOString(), arms: ARMS, n: out.length, device_seams: out.filter((s) => s.device).length, sizes, dropped, estimate: est, sample: out }, null, 1));
  console.log(`n = ${out.length} blocks (${out.filter((s) => s.device).length} device seams first); block sizes ${JSON.stringify(sizes)}; ${out.filter((s) => !s.blockSeed).length} without a stored seed; dropped ${dropped.length}`);
  for (const d of dropped) console.log('  dropped', JSON.stringify(d));
  console.log(`ESTIMATE: ${est.calls} block calls, in ~${est.inputTokens.toLocaleString()} tok, out ~${est.outputTokens.toLocaleString()} tok = $${est.usd.toFixed(2)} (cap $${CEILING_USD})`);
  console.log(`wrote ${BLOCK_SAMPLE_FILE}\nPAID STEP NOT RUN.`);
}

function estimateBlocks(sample, headerChars = 7600) {
  let inputTokens = 0, outputTokens = 0, usd = 0;
  for (const s of sample) {
    const price = priceFor(s.model);
    for (const arm of ARMS) {
      if (!(arm in ARM_FIX)) throw new Error(`unknown arm ${arm}`);
      const inTok = Math.ceil((headerChars + 2000 + s.block.ocrChars + 400 + (ARM_FIX[arm] ? 300 : 0)) / 4);
      const outTok = Math.ceil(s.block.ocrChars * 0.35);
      inputTokens += inTok; outputTokens += outTok;
      usd += (inTok / 1e6) * price.input + (outTok / 1e6) * price.output;
    }
  }
  return { calls: sample.length * ARMS.length, inputTokens, outputTokens, usd };
}

const maxOutForBlock = (pages) => Math.min(32768, Math.max(4096, pages.reduce((n, p) => n + p.ocr.length, 0) + 1200 * pages.length));

/** --run --blocks: one block call per seam-arm, parsed as the worker parses (parseBlock mirrors it). */
async function phaseRunBlocks() {
  const sample = selectSeams(JSON.parse(fs.readFileSync(BLOCK_SAMPLE_FILE, 'utf8')).sample);
  const est = estimateBlocks(sample);
  const approved = Number(arg('approved-usd', 0));
  if (!(approved >= est.usd) || approved > CEILING_USD) {
    console.error(`REFUSING TO SPEND. Estimate $${est.usd.toFixed(2)}; --approved-usd is ${approved || 'absent'}; cap $${CEILING_USD}.`);
    process.exit(2);
  }
  const { db } = await connect();
  const prompts = await loadTranslationPrompts(db);
  console.log(`prompt: ${prompts.translation.ref.name} v${prompts.translation.ref.version}; arms ${ARMS.join(',')}; ${sample.length} blocks`);
  const onDisk = readRows();
  const done = new Map(onDisk.map((r) => [`${r.id}:${r.arm}`, r]));
  // The approval covers the arms being run NOW; rows of other arms already on disk (an earlier
  // round's B / B2 / Fs) were approved then and do not eat this run's budget.
  let spent = onDisk.filter((r) => ARMS.includes(r.arm)).reduce((s, r) => s + (r.cost_usd || 0), 0);
  if (spent) console.log(`resuming: $${spent.toFixed(3)} already spent on ${ARMS.join(',')}, ${done.size} seam-arms on disk`);
  if (has('rerun-degenerate')) for (const [k, r] of done) if (isDegenerate(r)) { done.delete(k); console.log(`rerun ${k}: degenerate seam page`); }
  const stream = fs.createWriteStream(ARMS_FILE, { flags: 'a' });
  // Seam-major: every arm of one seam before the next seam, so a cap cutoff loses whole seams.
  const jobs = [];
  for (const s of sample) for (const arm of ARMS) if (!done.has(`${s.id}:${arm}`)) jobs.push({ s, arm });
  console.log(`${jobs.length} block calls to run`);
  await pool(jobs, CONCURRENCY, async ({ s, arm }) => {
    if (spent >= approved) { console.log(`${s.id} ${arm}: skipped, spend reached $${approved}`); return; }
    const pages = s.block.pages;
    const { prompt, pageBreak } = buildBlockTranslationPrompt({ prompts, book: s.book, pages, previousTranslation: s.blockSeed, prevOcrText: s.blockPrevOcr, nextOcrText: s.blockNextOcr, pageBreak: ARM_FIX[arm] });
    const price = priceFor(s.model);
    const t0 = Date.now();
    const call = async () => {
      const res = await gemini(prompt, maxOutForBlock(pages), s.model);
      const cost = res.error ? 0 : (res.inTok / 1e6) * price.input + (res.outTok / 1e6) * price.output;
      const parsed = res.error ? new Map() : parseBlock(res.text, pages);
      await logUsage({
        type: 'translation', mode: 'realtime', model: s.model, book_id: s.bookId, page_count: pages.length,
        input_tokens: res.inTok || 0, output_tokens: res.outTok || 0, cost_usd: cost,
        status: res.error ? 'error' : parsed.size < pages.length ? 'partial' : 'success', error_message: res.error || null, duration_ms: Date.now() - t0,
        prompt_version: `v${prompts.translation.ref.version}`, endpoint: ENDPOINT, triggered_by: 'manual',
      }, db).catch((e) => console.warn(`usage log failed: ${e.message}`));
      return { res, cost, parsed };
    };
    let { res, cost, parsed } = await call();
    let retried = false;
    // The worker re-translates a page missing from the block single-page; here one block retry when a seam page is missing.
    if ((!parsed.has(s.N.page_number) || !parsed.has(s.X.page_number)) && spent + cost < approved) {
      retried = true;
      const second = await call();
      cost += second.cost;
      if (second.parsed.size > parsed.size) ({ res, parsed } = second);
    }
    spent += cost;
    const row = {
      id: s.id, arm, bookId: s.bookId, language: s.language, model: s.model, kind: s.break.kind, device: s.device, shape: 'block',
      block: { from: s.block.from, to: s.block.to, size: pages.length, parsed: parsed.size, retried, applied: pageBreak?.applied ?? null, fired: pageBreak ? pageBreak.pages.filter((p) => p.fired).length : 0 },
      pages: Object.fromEntries(parsed),
      N: { id: s.N.id, text: parsed.get(s.N.page_number) || '', prompt_sha: sha(prompt) },
      X: { id: s.X.id, text: parsed.get(s.X.page_number) || '', prompt_sha: sha(prompt) },
      inTok: res.inTok || 0, outTok: res.outTok || 0, finish: res.finish || null, error: res.error || null,
      cost_usd: cost, at: new Date().toISOString(),
    };
    stream.write(JSON.stringify(row) + '\n');
    console.log(`${s.id} ${arm.padEnd(2)} ${s.language.padEnd(6)} block ${s.block.from}-${s.block.to} parsed ${parsed.size}/${pages.length}${pageBreak?.applied ? ' fix' : ''} N ${String(row.N.text.length).padStart(5)} X ${String(row.X.text.length).padStart(5)}  $${cost.toFixed(4)}  total $${spent.toFixed(3)}${res.error ? `  ERROR ${res.error}` : ''}`);
  });
  stream.end();
  await disconnect();
  const rows = readRows();
  console.log(`\n${rows.length} block rows on disk; spent $${spent.toFixed(3)} of $${approved} approved; ${rows.filter((r) => !r.N.text || !r.X.text).length} with a missing seam page`);
}

// ── --run (PAID) ────────────────────────────────────────────────────────────
function readRows() {
  if (!fs.existsSync(ARMS_FILE)) return [];
  const rows = [];
  for (const line of fs.readFileSync(ARMS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* torn final line */ }
  }
  return rows;
}

const maxOutFor = (ocr) => Math.min(32768, Math.max(4096, Math.ceil(ocr.length) + 1200));
/** Under 120 chars of reader text on either page: nothing a judge (or a reader) can see. */
const MIN_HALF = 120;
const isDegenerate = (r) => !r?.N?.text || !r?.X?.text || readerText(r.N.text).trim().length < MIN_HALF || readerText(r.X.text).trim().length < MIN_HALF;

async function phaseRun() {
  const { sample } = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const est = estimate(sample);
  const approved = Number(arg('approved-usd', 0));
  if (!(approved >= est.usd) || approved > CEILING_USD || est.usd > CEILING_USD) {
    console.error(`REFUSING TO SPEND. Estimate $${est.usd.toFixed(2)}; --approved-usd is ${approved || 'absent'}; cap $${CEILING_USD}.`);
    process.exit(2);
  }
  const { db } = await connect();
  const prompts = await loadTranslationPrompts(db);
  console.log(`prompt: ${prompts.translation.ref.name} v${prompts.translation.ref.version}; arms ${ARMS.join(',')}; ${sample.length} seams`);
  const onDisk = readRows();
  const done = new Map(onDisk.map((r) => [`${r.id}:${r.arm}`, r]));
  let spent = onDisk.filter((r) => ARMS.includes(r.arm)).reduce((s, r) => s + (r.cost_usd || 0), 0);
  if (spent) console.log(`resuming: $${spent.toFixed(3)} already spent on ${ARMS.join(',')}, ${done.size} seam-arms on disk`);
  // --rerun-degenerate: a page whose whole translation came back inside <meta>continues from previous
  // page: …</meta> (or otherwise under 120 chars of reader text) is a collapse the production worker's
  // health gate would refuse and retry (translatePageGuarded); give every arm that same one retry. The
  // first try stays on disk — the packet takes the LAST row per seam-arm and counts the collapses.
  if (has('rerun-degenerate')) {
    for (const [k, r] of done) if (isDegenerate(r)) { done.delete(k); console.log(`rerun ${k}: collapsed first try (N ${readerText(r.N.text || '').trim().length}, X ${readerText(r.X.text || '').trim().length} reader chars)`); }
  }
  const stream = fs.createWriteStream(ARMS_FILE, { flags: 'a' });

  /** One page call, with one retry when nothing came back. Logs usage; never touches `pages`. */
  const call = async (s, prompt, ocr) => {
    const price = priceFor(s.model);
    let res = await gemini(prompt, maxOutFor(ocr), s.model);
    let cost = res.error ? 0 : (res.inTok / 1e6) * price.input + (res.outTok / 1e6) * price.output;
    const t0 = Date.now();
    const log = (rr, c) => logUsage({
      type: 'translation', mode: 'realtime', model: s.model, book_id: s.bookId, page_count: 1,
      input_tokens: rr.inTok || 0, output_tokens: rr.outTok || 0, cost_usd: c,
      status: rr.error ? 'error' : 'success', error_message: rr.error || null, duration_ms: Date.now() - t0,
      prompt_version: `v${prompts.translation.ref.version}`, endpoint: ENDPOINT, triggered_by: 'manual',
    }, db).catch((e) => console.warn(`usage log failed: ${e.message}`));
    await log(res, cost);
    if ((!res.text || res.text.length < 20) && spent + cost < approved) {
      const res2 = await gemini(prompt, maxOutFor(ocr), s.model);
      const cost2 = res2.error ? 0 : (res2.inTok / 1e6) * price.input + (res2.outTok / 1e6) * price.output;
      await log(res2, cost2);
      cost += cost2;
      if ((res2.text || '').length > (res.text || '').length) res = res2;
    }
    spent += cost;
    return { text: sanitizeTranslationTags(res.text || ''), inTok: res.inTok || 0, outTok: res.outTok || 0, finish: res.finish || null, error: res.error || null, cost };
  };

  const jobs = [];
  for (const arm of ARMS) for (const s of sample) if (!done.has(`${s.id}:${arm}`)) jobs.push({ s, arm });
  console.log(`${jobs.length} seam-arms to run`);
  await pool(jobs, CONCURRENCY, async ({ s, arm }) => {
    if (spent >= approved) { console.log(`${s.id} ${arm}: skipped, spend reached $${approved}`); return; }
    const fix = ARM_FIX[arm];
    // Page N: seeded with the STORED translation of N-1 (the same for every arm); under F it gets the
    // devices at its foot and the next page's opening, but never a head edit — its seed was made
    // without the fix, so a fragment N-1 carried is not removed here.
    const pN = buildTranslationPrompt({ prompts, book: s.book, ocrText: s.N.ocr, previousTranslation: s.seedTranslation, nextOcrText: fix ? s.X.ocr : undefined, pageBreak: fix });
    const rN = await call(s, pN.prompt, s.N.ocr);
    // Page N+1: seeded with THIS arm's fresh translation of N; under F its head is edited against N's
    // OCR (the fragment N absorbed is gone) and its foot against the page after.
    const pX = buildTranslationPrompt({ prompts, book: s.book, ocrText: s.X.ocr, previousTranslation: rN.text || null, prevOcrText: fix ? s.N.ocr : undefined, nextOcrText: fix && s.after ? s.after.ocr : undefined, pageBreak: fix });
    const rX = rN.text ? await call(s, pX.prompt, s.X.ocr) : { text: '', error: 'page N failed', cost: 0, inTok: 0, outTok: 0, finish: null };
    const row = {
      id: s.id, arm, bookId: s.bookId, language: s.language, model: s.model, kind: s.break.kind, device: s.device,
      N: { id: s.N.id, text: rN.text, inTok: rN.inTok, outTok: rN.outTok, finish: rN.finish, error: rN.error, prompt_sha: sha(pN.prompt), pageBreak: pN.pageBreak },
      X: { id: s.X.id, text: rX.text, inTok: rX.inTok, outTok: rX.outTok, finish: rX.finish, error: rX.error, prompt_sha: sha(pX.prompt), pageBreak: pX.pageBreak },
      cost_usd: rN.cost + rX.cost, at: new Date().toISOString(),
    };
    stream.write(JSON.stringify(row) + '\n');
    console.log(`${s.id} ${arm.padEnd(2)} ${s.language.padEnd(6)} N ${String(rN.text.length).padStart(5)} X ${String(rX.text.length).padStart(5)} chars  $${row.cost_usd.toFixed(4)}  total $${spent.toFixed(3)}${rN.error || rX.error ? `  ERROR ${rN.error || rX.error}` : ''}`);
  });
  stream.end();
  await disconnect();
  const rows = readRows();
  console.log(`\n${rows.length} seam-arm rows on disk; spent $${spent.toFixed(3)} of $${approved} approved; ${rows.filter((r) => !r.N.text || !r.X.text).length} with a missing page`);
}

// ── --packet ────────────────────────────────────────────────────────────────
function phasePacket() {
  if (fs.existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} exists — a rebuilt packet invalidates judged verdicts; move it aside deliberately`);
  const sample = selectSeams(JSON.parse(fs.readFileSync(BLOCKS ? BLOCK_SAMPLE_FILE : SAMPLE_FILE, 'utf8')).sample);
  const rows = readRows();
  // The LAST row per seam-arm stands (a --rerun-degenerate retry appends); the collapses it replaced
  // are counted per arm — a whole page wrapped in <meta>continues from previous page: …</meta> is a
  // reader-facing empty page, and the first draw showed it clustering on the device seams.
  const byKey = new Map(rows.map((r) => [`${r.id}:${r.arm}`, r]));
  const collapsedFirstTry = Object.fromEntries(ARMS.map((a) => [a, []]));
  for (const r of rows) if (isDegenerate(r)) collapsedFirstTry[r.arm]?.push(r.id);
  resetSeed(SEED);
  const entries = [], key = [], skipped = [];
  for (const s of sample) {
    const arms = Object.fromEntries(ARMS.map((a) => [a, byKey.get(`${s.id}:${a}`)]));
    const usable = (a) => !isDegenerate(arms[a]);
    for (const pair of PAIRS) {
      const [x, y] = pair.split('/');
      if (!usable(x) || !usable(y)) { skipped.push({ seam: s.id, pair, reason: `missing or degenerate text in ${!usable(x) ? x : y}` }); continue; }
      const flip = seededRand() < 0.5;
      const jx = junction(arms[x].N.text, arms[x].X.text), jy = junction(arms[y].N.text, arms[y].X.text);
      const entry = {
        id: null, language: s.language,
        // The OCR of the same two pages, UNEDITED — arm-independent, so the blinding holds and the
        // judge reads every arm against the same source.
        source: `${tail(readerText(s.N.ocr))}\n\n———— page break ————\n\n${head(readerText(s.X.ocr))}`,
        left: flip ? jy : jx, right: flip ? jx : jy,
      };
      entries.push(entry);
      key.push({ id: null, entry, seam: s.id, book_id: s.bookId, pair, kind: s.break.kind, device: s.device, catchword: s.break.catchword, joined: s.break.joined, left: flip ? y : x, right: flip ? x : y,
        seam_len: Object.fromEntries([x, y].map((a) => [a, readerText(arms[a].X.text).length])) });
    }
  }
  for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
  entries.forEach((e, i) => { e.id = `j${String(i + 1).padStart(3, '0')}`; });
  for (const k of key) { k.id = k.entry.id; delete k.entry; }
  fs.writeFileSync(PACKET_FILE, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(KEY_FILE, JSON.stringify({ seed: SEED, arms: ARMS, skipped, collapsed_first_try: collapsedFirstTry, key }, null, 1));
  console.log(`collapsed translations (whole page inside <meta>, or under ${MIN_HALF} reader chars), per arm: ${ARMS.map((a) => `${a} ${collapsedFirstTry[a].length}${collapsedFirstTry[a].length ? ` (${collapsedFirstTry[a].join(',')})` : ''}`).join('; ')}`);
  // Eight chunks, interleaved so every judge sees both pair types and every book.
  const per = Math.ceil(entries.length / JUDGES);
  for (let c = 0; c < JUDGES; c++) {
    const slice = entries.slice(c * per, (c + 1) * per);
    fs.writeFileSync(path.join(RESULTS, `${PTAG}-judge-chunk-${c + 1}.jsonl`), slice.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  console.log(`wrote ${entries.length} blinded junctions (${PAIRS.map((p) => `${key.filter((k) => k.pair === p).length} ${p}`).join(', ')}; ${skipped.length} skipped) in ${JUDGES} chunks of ≤${per}`);
  console.log(`key (do NOT give this to the judge): ${KEY_FILE}`);
  for (const s of skipped) console.log('  skipped', JSON.stringify(s));
}

// ── --score ─────────────────────────────────────────────────────────────────
function loadVerdicts() {
  const files = fs.readdirSync(RESULTS).filter((f) => f.startsWith(VERDICTS_GLOB) && f.endsWith('.json'));
  const out = [];
  for (const f of files) out.push(...JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')));
  return { verdicts: out, files };
}

function phaseScore() {
  const { key } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const byId = new Map(key.map((k) => [k.id, k]));
  const { verdicts, files } = loadVerdicts();
  const seen = new Set();
  const dup = verdicts.filter((v) => { if (seen.has(v.id)) return true; seen.add(v.id); return false; });
  if (dup.length) console.log(`WARNING: ${dup.length} duplicate verdict ids (first kept): ${dup.map((d) => d.id).join(', ')}`);
  const uniq = verdicts.filter((v, i) => verdicts.findIndex((w) => w.id === v.id) === i && byId.has(v.id));
  console.log(`${uniq.length} verdicts from ${files.length} files; key has ${key.length}`);
  const DEFECTS = ['OMISSION', 'ADDITION', 'MISTRANSLATION', 'UNTRANSLATED', 'DUPLICATION'];
  const report = {};
  const tally = (label, sel, field) => {
    const rows = uniq.filter((v) => sel(byId.get(v.id)));
    if (!rows.length) return null;
    const pair = byId.get(rows[0].id).pair;
    const [x, y] = pair.split('/');
    const wins = { [x]: 0, [y]: 0 }; let ties = 0, left = 0;
    const defects = { [x]: Object.fromEntries(DEFECTS.map((d) => [d, 0])), [y]: Object.fromEntries(DEFECTS.map((d) => [d, 0])) };
    const withDefect = { [x]: 0, [y]: 0 };
    for (const v of rows) {
      const k = byId.get(v.id);
      const side = String(v[field] || '').trim().toUpperCase();
      if (side === 'LEFT' || side === 'RIGHT') { wins[k[side.toLowerCase()]]++; if (side === 'LEFT') left++; } else ties++;
      for (const s of ['left', 'right']) {
        const arm = k[s];
        const ds = v[`${s}_defects`] || [];
        if (ds.length) withDefect[arm]++;
        for (const d of ds) { const t = String(d.type || '').toUpperCase(); if (DEFECTS.includes(t)) defects[arm][t]++; }
      }
    }
    const decided = wins[x] + wins[y];
    return { pair, judged: rows.length, expected: key.filter(sel).length, wins, ties, tie_rate: +(ties / rows.length).toFixed(3), decided,
      [`${x}_share_of_decided`]: decided ? +(wins[x] / decided).toFixed(3) : null, split_p_two_sided: decided ? +binomTwoSided(Math.min(wins[x], wins[y]), decided).toFixed(3) : null,
      left_share_of_decided: decided ? +(left / decided).toFixed(3) : null, defects, breaks_with_defect: withDefect };
  };
  // One row set per pair the key holds: the A/A floor first (a pair of the same arm twice), then each
  // test pair whole, on the device breaks the fix targets, and on the plain ones.
  const pairs = [...new Set(key.map((k) => k.pair))].sort((a, b) => (a === 'B/B2' ? -1 : b === 'B/B2' ? 1 : a.localeCompare(b)));
  for (const field of ['fidelity', 'fluency']) {
    report[field] = {};
    for (const pair of pairs) {
      const label = pair === 'B/B2' ? 'B/B2 (A/A floor)' : pair;
      report[field][`${label} all`] = tally(pair, (k) => k.pair === pair, field);
      report[field][`${label} device breaks (catchword or split word)`] = tally(pair, (k) => k.pair === pair && k.device, field);
      report[field][`${label} plain breaks`] = tally(pair, (k) => k.pair === pair && !k.device, field);
    }
  }
  console.log(JSON.stringify(report, null, 1));
  console.log('\nRead the noise floor first:');
  for (const pair of pairs) {
    const [x, y] = pair.split('/');
    const all = report.fidelity[`${pair === 'B/B2' ? 'B/B2 (A/A floor)' : pair} all`], dev = report.fidelity[`${pair === 'B/B2' ? 'B/B2 (A/A floor)' : pair} device breaks (catchword or split word)`];
    if (!all) continue;
    console.log(`  ${pair.padEnd(6)} fidelity ${x} ${all.wins[x]}, ${y} ${all.wins[y]}, ties ${all.ties} (tie rate ${all.tie_rate}, p=${all.split_p_two_sided}); breaks with ≥1 defect ${x} ${all.breaks_with_defect[x]}/${all.judged}, ${y} ${all.breaks_with_defect[y]}/${all.judged}`);
    if (dev) console.log(`         device breaks only: ${x} ${dev.wins[x]}, ${y} ${dev.wins[y]}, ties ${dev.ties}; defective ${x} ${dev.breaks_with_defect[x]}/${dev.judged}, ${y} ${dev.breaks_with_defect[y]}/${dev.judged}`);
  }
  const vById = new Map(uniq.map((v) => [v.id, v]));
  const suspects = key.filter((k) => k.pair !== 'B/B2' && k.seam_len && Math.min(...Object.values(k.seam_len)) < 0.85 * Math.max(...Object.values(k.seam_len)));
  if (suspects.length) {
    console.log(`\n  OMISSION-SUSPECT (one side's seam page ≥15% shorter — hand-read before trusting):`);
    for (const k of suspects) { const v = vById.get(k.id); const w = !v || !/^(LEFT|RIGHT)$/i.test(v.fidelity || '') ? 'TIE' : v.fidelity.toUpperCase() === 'LEFT' ? k.left : k.right; console.log(`    ${k.id} ${k.pair} ${JSON.stringify(k.seam_len)} chars → ${w}`); }
  }
  fs.writeFileSync(path.join(RESULTS, `${PTAG}-report-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(report, null, 1));
}

// ── main ────────────────────────────────────────────────────────────────────
if (has('draw')) await (BLOCKS ? phaseDrawBlocks() : phaseDraw());
else if (has('run')) await (BLOCKS ? phaseRunBlocks() : phaseRun());
else if (has('packet')) phasePacket();
else if (has('score')) phaseScore();
else console.log('one of --draw | --run --approved-usd N | --packet | --score, each with --blocks for the block-shaped measurement (see the header)');

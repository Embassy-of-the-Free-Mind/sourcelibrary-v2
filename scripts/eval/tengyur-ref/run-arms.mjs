#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/gemini-arms.mjs — single pages, realtime, no context; it
// cannot reproduce the chained lane. scripts/lib/translate-batch-chained.mjs — the lane itself
// (arm A), which WRITES to pages and cannot run in shadow; its request builders (planBlocks,
// buildBlockTranslationPrompt / buildTranslationPrompt with PAGE_BREAK_SCOPED, maxOutputTokensFor,
// parseBlockTranslations, dropDriftedPages, sanitizeTranslationTags) are IMPORTED here, not copied,
// so arm A sends the bytes the lane sends. Batch submit/collect is translation-restraint-ab.mjs's.
/**
 * run-arms.mjs — two translation arms over the 84000-referenced Tengyur pages (#5497). Eval only:
 * outputs go to <dir>/arms/*.jsonl, NEVER to pages.translation.
 *
 *   A  the chained lane as the pilot ran it: gemini-3-flash-preview, prompt v13, blocks of up to 8
 *      pages (planBlocks), each block seeded with the arm's own translation of the page before it and
 *      the OCR of the pages either side (PAGE_BREAK_SCOPED); pages a block failed to return go
 *      single-page next round, seeded from their predecessor. A text longer than CHAIN_MAX pages is
 *      cut into chains (the lane chains a whole volume; ~73 Batch rounds would take most of a day),
 *      and every chain opens with a LEAD-IN page — the page before it, translated single and not
 *      scored — so the chain's first block is seeded exactly as it would be mid-volume.
 *   B  the same model and prompt, one page per request, NO previous translation and NO adjacent OCR.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-ref/run-arms.mjs \
 *        --dir /root/tref --plan            # spans, chains, prompt (v13 checked), cost estimate
 *        --dir /root/tref --tick [--wait-min 9]  # collect open jobs, then submit the next round
 *        --dir /root/tref --status
 * Spend: refuses to submit when actual + this round's estimate passes --cap-usd (default 4.5), and
 * every collected job is metered (gemini_usage, one row per book, type 'eval') so the
 * `tengyur-ref-5497` envelope sees it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PAGE_BREAK_SCOPED, buildTranslationPrompt, buildBlockTranslationPrompt, parseBlockTranslations,
  sanitizeTranslationTags, assessTranslationHealth, loadTranslationPrompts,
} from '../../lib/translate-core.mjs';
import { planBlocks, maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';
import { responseTextOf } from '../../lib/translate-batch-seam.mjs';
import { dropDriftedPages } from '../../lib/block-drift.mjs';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { SAFETY_SETTINGS } from '../../lib/translate-core.mjs';
import { submitBatchFile, fetchBatchOutput } from '../translation-restraint-ab.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const DIR = opt('dir', '/root/tref');
const MODEL = 'gemini-3-flash-preview';
const PROMPT_VERSION = 13;
const CHAIN_MAX = 80;
const CAP = Number(opt('cap-usd', 4.5));
const STATE = path.join(DIR, 'arms', 'state.json');
const KEY_ENV = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
fs.mkdirSync(path.join(DIR, 'arms'), { recursive: true });

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s));
const load = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const estUsd = (prompt, pages) => costOf(MODEL, prompt.length / 3.0, pages.reduce((n, p) => n + p.src.length, 0) / 2.0 + 300 * pages.length) * BATCH_MULTIPLIER;

function pageIndex() {
  const byVol = {};
  for (const f of fs.readdirSync(path.join(DIR, 'pages'))) {
    if (!f.endsWith('.jsonl')) continue;
    for (const p of readJsonl(path.join(DIR, 'pages', f))) (byVol[p.vol] ||= new Map()).set(p.page_number, p);
  }
  return byVol;
}
const slim = (p) => ({ vol: p.vol, book_id: p.book_id, page_id: p.page_id, page_number: p.page_number, src: p.src });
const asLanePage = (p) => ({ page_number: p.page_number, ocr: { data: p.src } });

async function phasePlan() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const prompts = await loadTranslationPrompts(c.db('bookstore'));
  await c.close();
  if (Number(prompts.translation.ref.version) !== PROMPT_VERSION) {
    console.error(`default translation prompt is v${prompts.translation.ref.version}, not v${PROMPT_VERSION} — the pilot's. Refusing: pin the v13 document first.`);
    process.exit(2);
  }
  const ref = readJsonl(path.join(DIR, 'ref', 'reference.jsonl'));
  const pages = pageIndex();
  const books = JSON.parse(fs.readFileSync(path.join(DIR, 'pages', 'books.json'), 'utf8'));
  // One span per text: every page from its first to its last referenced side, dropped sides included
  // (the lane would translate them; they are simply not scored).
  const spans = new Map();
  for (const r of ref) {
    const s = spans.get(r.toh) || { toh: r.toh, vol: r.vol, lo: Infinity, hi: -Infinity };
    s.lo = Math.min(s.lo, r.page_number); s.hi = Math.max(s.hi, r.page_number);
    spans.set(r.toh, s);
  }
  const chains = [];
  const scored = new Set(ref.map((r) => r.page_id));
  for (const s of spans.values()) {
    const ps = [];
    for (let n = s.lo; n <= s.hi; n++) { const p = pages[s.vol].get(n); if (p?.src) ps.push(p); }
    const k = Math.ceil(ps.length / CHAIN_MAX);
    const size = Math.ceil(ps.length / k);
    for (let i = 0; i < k; i++) {
      const part = ps.slice(i * size, (i + 1) * size);
      const lead = pages[s.vol].get(part[0].page_number - 1);
      chains.push({ id: `${s.toh}-c${i + 1}`, toh: s.toh, vol: s.vol, lead_in: lead?.src ? slim(lead) : null, queue: part.map(slim), cursor: 0, pending_single: [] });
    }
  }
  const allPages = chains.flatMap((ch) => ch.queue);
  // Estimate: B one request per page; A blocks as planned + lead-ins.
  let estB = 0, estA = 0;
  for (const p of allPages) estB += estUsd(buildTranslationPrompt({ prompts, book: books[p.vol], ocrText: p.src, pageBreak: PAGE_BREAK_SCOPED }).prompt, [p]);
  for (const ch of chains) {
    if (ch.lead_in) estA += estUsd(buildTranslationPrompt({ prompts, book: books[ch.vol], ocrText: ch.lead_in.src, pageBreak: PAGE_BREAK_SCOPED }).prompt, [ch.lead_in]);
    for (const b of planBlocks(ch.queue.map((p) => ({ ...p, ocr: { data: p.src } })))) {
      estA += estUsd(buildBlockTranslationPrompt({ prompts, book: books[ch.vol], pages: b.map(asLanePage), previousTranslation: 'x'.repeat(2400), pageBreak: PAGE_BREAK_SCOPED }).prompt + 'x'.repeat(3000), b);
    }
  }
  const state = { model: MODEL, prompt_ref: prompts.translation.ref, prompts, chains, scored: [...scored], rounds: [], jobs: [], a: {}, b: {}, spent_usd: 0, created_at: new Date().toISOString(), est: { A: +estA.toFixed(3), B: +estB.toFixed(3) } };
  save(state);
  console.log(`spans ${spans.size}, chains ${chains.length}, pages ${allPages.length} (scored ${scored.size}); lead-ins ${chains.filter((c) => c.lead_in).length}`);
  console.log(`estimate (batch price, conservative): A $${estA.toFixed(3)}  B $${estB.toFixed(3)}  total $${(estA + estB).toFixed(3)}`);
}

/** Arm A's request for one chain this round, or null when the chain is done. */
function nextA(state, ch, books) {
  const book = books[ch.vol];
  const prompts = state.prompts;
  const vp = (n) => pageIndex.cache[ch.vol].get(n);
  const seedFor = (n) => { const prev = vp(n - 1); return prev ? state.a[prev.page_id]?.text || null : null; };
  const reqFor = (group, kind) => {
    const first = group[0].page_number, last = group[group.length - 1].page_number;
    const previousTranslation = seedFor(first);
    const prevOcrText = vp(first - 1)?.src || undefined, nextOcrText = vp(last + 1)?.src || undefined;
    const built = kind === 'block'
      ? buildBlockTranslationPrompt({ prompts, book, pages: group.map(asLanePage), previousTranslation, prevOcrText, nextOcrText, pageBreak: PAGE_BREAK_SCOPED })
      : buildTranslationPrompt({ prompts, book, ocrText: group[0].src, previousTranslation, prevOcrText, nextOcrText, pageBreak: PAGE_BREAK_SCOPED });
    return { prompt: built.prompt, maxOutputTokens: maxOutputTokensFor(group.map((p) => ({ ocr: { data: p.src } }))), context: { previous_translation: !!previousTranslation, prev_ocr: !!prevOcrText, next_ocr: !!nextOcrText } };
  };
  if (ch.lead_in && !state.a[ch.lead_in.page_id]) return [{ kind: 'single', pages: [ch.lead_in], lead: true, ...reqFor([ch.lead_in], 'single') }];
  if (ch.pending_single.length) return ch.pending_single.map((p) => ({ kind: 'single', pages: [p], ...reqFor([p], 'single') }));
  const rest = ch.queue.slice(ch.cursor);
  if (!rest.length) return null;
  const block = planBlocks(rest.map((p) => ({ ...p, ocr: { data: p.src } })))[0].map(slim);
  const kind = block.length === 1 ? 'single' : 'block';
  return [{ kind, pages: block, ...reqFor(block, kind) }];
}

function lineFor(key, prompt, maxOutputTokens) {
  return JSON.stringify({ key, request: { contents: [{ parts: [{ text: prompt }] }], safetySettings: SAFETY_SETTINGS, generationConfig: { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } } } });
}

async function collect(state) {
  const key = process.env[KEY_ENV];
  for (const j of state.jobs.filter((x) => !x.collected_at)) {
    let text;
    try { text = await fetchBatchOutput(j, key); } catch (e) { j.collected_at = new Date().toISOString(); j.dead = String(e.message); for (const u of j.units) u.dead = true; console.log(`job dead: ${e.message} — its units are resubmitted`); continue; }
    if (text == null) continue;
    const answers = new Map();
    const tokByBook = {};
    for (const line of text.split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      const t = responseTextOf(r);
      const u = r.response?.usageMetadata || {};
      answers.set(t.key, { ...t, inTok: u.promptTokenCount || 0, outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) });
    }
    let jobUsd = 0;
    for (const unit of j.units) {
      const a = answers.get(unit.key);
      const usd = a ? costOf(MODEL, a.inTok, a.outTok) * BATCH_MULTIPLIER : 0;
      jobUsd += usd;
      const bk = unit.pages[0].book_id; (tokByBook[bk] ||= { in: 0, out: 0, n: 0 }); if (a) { tokByBook[bk].in += a.inTok; tokByBook[bk].out += a.outTok; tokByBook[bk].n += unit.pages.length; }
      const ch = unit.chain ? state.chains.find((c) => c.id === unit.chain) : null;
      if (unit.arm === 'B') {
        if (a && !a.error && a.text) state.b[unit.pages[0].page_id] = { text: sanitizeTranslationTags(a.text.trim()), finish: a.finishReason, inTok: a.inTok, outTok: a.outTok };
        else unit.retry = true;
        continue;
      }
      // Arm A
      if (unit.kind === 'block') {
        if (!a || a.error) { unit.retry = true; continue; }
        const lanePages = unit.pages.map(asLanePage);
        const parsed = parseBlockTranslations(a.text, lanePages);
        const tr = parsed.translations;
        const echoed = unit.pages.filter((p) => { const t = tr.get(p.page_number); return t && assessTranslationHealth(p.src, t, { lang: 'Tibetan' }).reason === 'echo'; });
        if (echoed.length) tr.clear();
        const { drifted } = dropDriftedPages(lanePages, tr);
        if (parsed.returned === 0) { unit.retry = true; continue; }
        const pending = [];
        for (const p of unit.pages) {
          const t = tr.get(p.page_number);
          const clean = t ? sanitizeTranslationTags(String(t).trim()) : null;
          const health = clean ? assessTranslationHealth(p.src, clean, { lang: 'Tibetan' }) : null;
          if (clean && health.healthy !== false) state.a[p.page_id] = { text: clean, via: 'block', round: unit.round, context: unit.context, block_first: unit.pages[0].page_number, block_size: unit.pages.length };
          else pending.push(p);
        }
        ch.cursor += unit.pages.length;
        ch.pending_single.push(...pending);
        unit.outcome = { returned: parsed.returned, discarded: parsed.discarded || null, drifted: drifted.map((d) => `${d.prev}→${d.next}`), echoed: echoed.length, fallback: pending.length };
      } else {
        const p = unit.pages[0];
        const clean = a && !a.error && a.text ? sanitizeTranslationTags(a.text.trim()) : '';
        if (!clean) { unit.retry = true; continue; }
        state.a[p.page_id] = { text: clean, via: unit.lead ? 'lead-in' : 'single', round: unit.round, context: unit.context };
        if (!unit.lead) {
          ch.pending_single = ch.pending_single.filter((x) => x.page_id !== p.page_id);
          if (ch.queue[ch.cursor]?.page_id === p.page_id) ch.cursor++;
        }
      }
    }
    j.collected_at = new Date().toISOString(); j.cost_usd = +jobUsd.toFixed(5);
    state.spent_usd = +(state.spent_usd + jobUsd).toFixed(5);
    try {
      const { logUsage } = await import('../../workers/lib/supabase-usage-logger.mjs');
      for (const [book_id, t] of Object.entries(tokByBook)) {
        await logUsage({ type: 'eval', mode: 'batch', model: MODEL, book_id, page_count: t.n, input_tokens: t.in, output_tokens: t.out, batch_job_id: j.job_name, endpoint: 'eval/tengyur-ref-5497', triggered_by: 'tengyur-ref-5497', prompt_version: `v${PROMPT_VERSION}`, status: 'success' });
      }
    } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
    console.log(`collected ${j.job_name} (${j.units.length} units) $${jobUsd.toFixed(4)}; total $${state.spent_usd.toFixed(4)}`);
    save(state);
  }
}

async function phaseTick() {
  const state = load();
  const books = JSON.parse(fs.readFileSync(path.join(DIR, 'pages', 'books.json'), 'utf8'));
  pageIndex.cache = pageIndex();
  await collect(state);
  if (state.jobs.some((j) => !j.collected_at)) { console.log('a job is still open; nothing submitted'); save(state); return state; }
  const round = state.rounds.length + 1;
  const units = [];
  // B: every page not yet answered (first round: all of them; later: retries).
  for (const ch of state.chains) for (const p of ch.queue) if (!state.b[p.page_id]) {
    const { prompt } = buildTranslationPrompt({ prompts: state.prompts, book: books[p.vol], ocrText: p.src, pageBreak: PAGE_BREAK_SCOPED });
    units.push({ arm: 'B', key: `B:${p.page_id}`, kind: 'single', pages: [p], prompt, maxOutputTokens: maxOutputTokensFor([{ ocr: { data: p.src } }]), round });
  }
  for (const ch of state.chains) {
    const reqs = nextA(state, ch, books);
    if (!reqs) continue;
    for (const r of reqs) units.push({ arm: 'A', chain: ch.id, key: `A:${ch.id}:r${round}${r.kind === 'single' ? `:p${r.pages[0].page_number}` : ''}`, round, ...r });
  }
  if (!units.length) { console.log('ALL DONE'); state.done_at ||= new Date().toISOString(); save(state); return state; }
  const est = units.reduce((n, u) => n + estUsd(u.prompt, u.pages), 0);
  if (state.spent_usd + est > CAP) { console.error(`REFUSING: spent $${state.spent_usd.toFixed(3)} + round estimate $${est.toFixed(3)} > cap $${CAP}`); save(state); process.exit(3); }
  const job = await submitBatchFile({ model: MODEL, lines: units.map((u) => lineFor(u.key, u.prompt, u.maxOutputTokens)), displayName: `tengyur-ref-5497-r${round}`, key: process.env[KEY_ENV] });
  job.units = units.map(({ prompt, ...u }) => ({ ...u, prompt_chars: prompt.length }));
  job.round = round; job.est_usd = +est.toFixed(4);
  state.jobs.push(job);
  state.rounds.push({ n: round, submitted_at: job.submitted_at, units: units.length, A: units.filter((u) => u.arm === 'A').length, B: units.filter((u) => u.arm === 'B').length, est_usd: job.est_usd });
  save(state);
  console.log(`round ${round}: ${units.length} requests (A ${units.filter((u) => u.arm === 'A').length}, B ${units.filter((u) => u.arm === 'B').length}) est $${est.toFixed(4)}`);
  return state;
}

function phaseStatus() {
  const s = load();
  const scored = new Set(s.scored);
  const aN = Object.keys(s.a).filter((k) => scored.has(k)).length, bN = Object.keys(s.b).filter((k) => scored.has(k)).length;
  const open = s.chains.filter((c) => c.cursor < c.queue.length || c.pending_single.length).length;
  console.log(`rounds ${s.rounds.length}; spent $${s.spent_usd.toFixed(4)}; A ${aN}/${scored.size} scored pages; B ${bN}/${scored.size}; chains open ${open}/${s.chains.length}; jobs open ${s.jobs.filter((j) => !j.collected_at).length}`);
}

async function phaseExport() {
  // arms/A.jsonl, arms/B.jsonl: one line per page {page_id, text, ...}
  const s = load();
  for (const arm of ['a', 'b']) {
    const f = path.join(DIR, 'arms', `${arm.toUpperCase()}.jsonl`);
    fs.writeFileSync(f, Object.entries(s[arm]).map(([page_id, v]) => JSON.stringify({ page_id, ...v })).join('\n') + '\n');
    console.log(`${f}: ${Object.keys(s[arm]).length}`);
  }
}

if (has('plan')) await phasePlan();
else if (has('tick')) {
  const waitMs = Number(opt('wait-min', 0)) * 60e3, t0 = Date.now();
  for (;;) {
    const st = await phaseTick();
    if (st.done_at || Date.now() - t0 > waitMs) break;
    await new Promise((r) => setTimeout(r, 60e3));
  }
} else if (has('status')) phaseStatus();
else if (has('export')) await phaseExport();
else { console.error('--plan | --tick [--wait-min N] | --status | --export'); process.exit(1); }

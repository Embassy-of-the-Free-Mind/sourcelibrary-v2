#!/usr/bin/env node
// PRIOR ART: scripts/eval/seam-ab-5678.mjs (#5701) — the seam A/B this run confirms. Its door (promptFor: v13 +
// stored seed of N−1 + adjacent OCR + PAGE_BREAK_SCOPED), its Batch submit/collect, its packet builder (plants,
// repeats, blind letters), its judge text and its `realDefect` rule are reused: the pure helpers are imported, the
// phases are repeated here with three changes that file cannot take without rewriting a registered harness —
// (1) a fifth arm, D = Flash WITHOUT markers, (2) a frame stratified by SCRIPT (Latin / Tibetan / Han / other
// non-Latin), where that file admits Latin, German, French and Italian only, and (3) the marker arms parsed by the
// LANE's positional parser (scripts/lib/folio-markers.mjs after #5719, with the block lane's overrun rule) instead
// of that file's literal parse plus its eval-only `positionalSpans`. scripts/eval/folio-positional-5678.mjs
// re-scores old outputs and makes no model call.
/**
 * seam-markers-confirm-5678 — confirmatory folio-marker A/B with the positional parser (#5678).
 * Pre-registration: scripts/eval/PREREGISTRATION-seam-markers-confirm.md.
 *
 * Arms, each on the SAME two-page block (N, N+1), production's chained request (v13, stored seed of N−1, adjacent
 * OCR, PAGE_BREAK_SCOPED, Batch, thinkingBudget 0):
 *   A    gemini-3.1-flash-lite, one <translation page="N"> per page (production)
 *   A2   A again — the noise floor (submitted FIRST)
 *   B    gemini-3.1-flash-lite + folioMarkers
 *   C    gemini-3-flash-preview + folioMarkers
 *   D    gemini-3-flash-preview, one <translation page="N"> per page (no markers)
 *
 * Phases (only --submit costs money):
 *   --draw      seeded, script-stratified frame → candidates.jsonl + screen.md                         FREE
 *   --pin       screen.json (by-eye verdicts on the SOURCE) → sample.jsonl                              FREE
 *   --submit    one Batch job per arm, A2 first; needs --approved-usd ≥ estimate and the envelope       PAID
 *   --collect   poll (--wait-min N), parse as the lane parses, outputs.jsonl, meter per book           FREE
 *   --packets   blinded judge packets with plants + repeats → packets/, packet-key.json                FREE
 *   --score     verdicts → report.json (the registered rule)                                           FREE
 *
 * NOTHING here writes to `pages`, `books` or `prompts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildBlockTranslationPrompt, parseBlockTranslations, PAGE_BREAK_SCOPED, MODEL_LITE, MODEL_FLASH, isEnglishBook,
} from '../lib/translate-core.mjs';
import { maxOutputTokensFor, batchRequest, batchRequestToJsonlLine } from '../lib/translate-batch-seam.mjs';
import { parseFolioMarkedText, endsSentence, leadingFragment } from '../lib/folio-markers.mjs';
import { duplicatedAcrossBoundary } from '../lib/block-drift.mjs';
import { sourceEndsOpen } from '../audit/translation-bridging.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { resetSeed, seededRand } from './lib/paired-stats.mjs';
import { wilson } from './lib/agreement-stats.mjs';
import { submitBatchFile, fetchBatchOutput, mcnemar } from './translation-restraint-ab.mjs';
import { signOneSided } from './translation-prompt-v14-ab.mjs';
import { pageLanguage, body, display, realDefect, PLANT_CLOSURE, LANGS } from './seam-ab-5678.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = opt('dir', path.join(HERE, 'results/seam-markers-confirm-5678'));
const SEED = 56782;
const SCOPE = 'markers-confirm-5678';
const CAP_USD = 4;
const ENDPOINT = 'eval/markers-confirm-5678';
const V13_MD5 = '516510147237b6a79d9d3f6e797bba7f';
export const ARMS = ['A2', 'A', 'B', 'C', 'D'];      // submit order: the noise floor first
export const ARM = {
  A: { model: MODEL_LITE, markers: false },
  A2: { model: MODEL_LITE, markers: false },
  B: { model: MODEL_LITE, markers: true },
  C: { model: MODEL_FLASH, markers: true },
  D: { model: MODEL_FLASH, markers: false },
};
export const GROUPS = ['latin', 'tibetan', 'han', 'other'];
// the sample: 100 true mid-sentence breaks (70 Latin-script / 30 non-Latin) + 20 closed controls (14 / 6)
const QUOTA = {
  pagebreak: { latin: 70, tibetan: 10, han: 10, other: 10 },
  control: { latin: 14, tibetan: 2, han: 2, other: 2 },
};
// candidates drawn for the by-eye screen; --pool-scale extends every pool by the same seeded procedure, and
// --pool-scale-nonlatin only the Tibetan / Han / other pools (the Latin list is then unchanged)
const SCALE = Number(opt('pool-scale', 1));
const SCALE_NL = Number(opt('pool-scale-nonlatin', 1));
const POOL = Object.fromEntries(Object.entries({
  pagebreak: { latin: 95, tibetan: 18, han: 18, other: 18 },
  control: { latin: 36, tibetan: 6, han: 6, other: 6 },
}).map(([s, g]) => [s, Object.fromEntries(Object.entries(g).map(([k, n]) => [k, Math.ceil(n * SCALE * (k === 'latin' ? 1 : SCALE_NL))]))]));
const CHAINED_CALL_SITE = 'scripts/lib/translate-batch-chained.mjs';
const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate', 'table'];
// books already used: #5701 (every candidate it drew), #5675 seam-confirm, the v14 A/B, the #5682 Tengyur preview
const PRIOR_SAMPLES = ['results/seam-ab-5678/candidates.jsonl', 'results/translation-seam-confirm-2026-10-03/sample.jsonl', 'results/translation-prompt-v14-ab-2026-10-02/sample.jsonl'];
const PRIOR_BOOKS = ['6abeb158896ea18127c82682', '6abeb583896ea18127c84e6f', '6abe932b6a920ffd924d73b0'];

const md5 = (t) => createHash('md5').update(t).digest('hex');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const shuffleWith = (rand) => (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── script of a page ──────────────────────────────────────────────────────────
const SCRIPT_RE = {
  latin: /\p{Script=Latin}/gu, tibetan: /\p{Script=Tibetan}/gu, han: /\p{Script=Han}/gu, greek: /\p{Script=Greek}/gu,
  hebrew: /\p{Script=Hebrew}/gu, arabic: /\p{Script=Arabic}/gu, cyrillic: /\p{Script=Cyrillic}/gu, devanagari: /\p{Script=Devanagari}/gu,
};
const OTHER = new Set(['greek', 'hebrew', 'arabic', 'cyrillic', 'devanagari']);
/** The dominant script of a page's body and its share of the letters and marks. */
export function scriptOf(ocr) {
  const t = body(ocr).replace(/[^\p{L}\p{M}]/gu, '');
  if (!t.length) return { script: null, share: 0 };
  let best = null, n = 0;
  for (const [k, re] of Object.entries(SCRIPT_RE)) { const c = (t.match(re) || []).length; if (c > n) { best = k; n = c; } }
  return { script: best, share: n / t.length };
}
export const groupOf = (script) => (script === 'latin' || script === 'tibetan' || script === 'han' ? script : OTHER.has(script) ? 'other' : null);
/** A first guess from books.language, used ONLY to skip a book whose pools are already full. */
const guessGroup = (lang) => (/tibetan/i.test(lang) ? 'tibetan' : /chinese|japanese/i.test(lang) ? 'han' : /greek|hebrew|arabic|persian|russian|sanskrit|pali|hindi|yiddish|slavonic/i.test(lang) ? 'other' : 'latin');
/** Pool heuristic only (the by-eye screen decides): does the page's body stop mid-sentence? */
export function endsOpen(ocr, group) {
  if (group === 'tibetan') {
    const t = body(ocr).replace(/[\s་]+$/u, '');
    return t.length >= 80 && !/[།༎༏༐༑༔]$/u.test(t);
  }
  return !!sourceEndsOpen(ocr);
}
const minBody = (group) => (group === 'han' ? [150, 80] : [400, 200]);

// ── draw ──────────────────────────────────────────────────────────────────────
async function phaseDraw() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const row = await db.collection('prompts').findOne({ type: 'translation', is_default: true }, { sort: { version: -1 } });
  if (!row || row.version !== 13 || md5(row.content) !== V13_MD5) throw new Error(`default translation prompt is v${row?.version} md5 ${row && md5(row.content)}, not v13 ${V13_MD5}`);
  const used = new Set([...PRIOR_BOOKS, ...PRIOR_SAMPLES.flatMap((f) => readJsonl(path.join(HERE, f)).map((u) => u.book.id))]);
  const bookIds = (await db.collection('translate_batch_runs').distinct('book_id', { mode: 'chained' })).sort();
  const books = new Map((await db.collection('books').find(
    { id: { $in: bookIds }, visible: true, pages_count: { $gt: 0 } },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1 } },
  ).toArray()).map((b) => [b.id, b]));
  resetSeed(SEED);
  const shuffle = shuffleWith(seededRand);
  const order = shuffle(bookIds.filter((id) => books.has(id)));
  const log = { seed: SEED, pool_scale: SCALE, pool_scale_nonlatin: SCALE_NL, frame: { call_site: CHAINED_CALL_SITE, runs_mode: 'chained', served_books: order.length, prior_books_excluded: used.size }, skipped: {}, visited: 0 };
  const skip = (k) => { log.skipped[k] = (log.skipped[k] || 0) + 1; };
  const cands = [];
  const count = (s, g) => cands.filter((u) => u.stratum === s && u.group === g).length;
  const need = (s, g) => count(s, g) < POOL[s][g];
  const groupFull = (g) => !need('pagebreak', g) && !need('control', g);
  for (const id of order) {
    if (GROUPS.every(groupFull)) break;
    const b = books.get(id);
    // the seeded page pick is consumed for every book, so an extended draw repeats the first draw's picks
    const r = seededRand();
    if (used.has(id)) { skip('prior_sample_book'); continue; }
    if (isEnglishBook(b)) { skip('english_book'); continue; }
    if (groupFull(guessGroup(b.language || ''))) { skip('group_pools_full_by_book_language'); continue; }
    log.visited++;
    const lane = await db.collection('pages').find(
      { book_id: id, 'translation.engine.call_site': CHAINED_CALL_SITE, 'translation.engine.input.context.previous_translation': true, 'translation.edited_by': { $exists: false }, page_type: { $nin: EXCLUDED_TYPES } },
      { projection: { page_number: 1, 'translation.model': 1 } },
    ).toArray();
    const ok = lane.filter((p) => /^gemini-3(\.1)?-flash/.test(p.translation?.model || '')).sort((x, y) => x.page_number - y.page_number);
    if (!ok.length) { skip('no_seeded_lane_page'); continue; }
    const pick = ok[Math.floor(r * ok.length)].page_number;
    const nb = new Map((await db.collection('pages').find({ book_id: id, page_number: { $in: [pick - 1, pick, pick + 1, pick + 2] } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray()).map((x) => [x.page_number, x]));
    const pg = nb.get(pick), nx = nb.get(pick + 1);
    if (!pg?.ocr?.data || !nx?.ocr?.data) { skip('no_ocr'); continue; }
    const s0 = scriptOf(pg.ocr.data), s1 = scriptOf(nx.ocr.data);
    const group = groupOf(s0.script);
    if (!group || s0.script !== s1.script || s0.share < 0.75 || s1.share < 0.75) { skip('mixed_or_unread_script'); continue; }
    const [min0, min1] = minBody(group);
    if (body(pg.ocr.data).length < min0) { skip('short_ocr'); continue; }
    if (body(nx.ocr.data).length < min1) { skip('short_next_ocr'); continue; }
    if (EXCLUDED_TYPES.includes(nx.page_type)) { skip('next_excluded_type'); continue; }
    // Latin script: the four languages of #5701, by the book and by the page's own tag
    if (group === 'latin' && (!/^(latin|german|french|italian)/i.test(b.language || '') || !LANGS.has(pageLanguage(pg.ocr.data)) || !LANGS.has(pageLanguage(nx.ocr.data)))) { skip('latin_script_other_language'); continue; }
    if (!nb.get(pick - 1)?.translation?.data) { skip('no_seed_now'); continue; }
    const stratum = endsOpen(pg.ocr.data, group) ? 'pagebreak' : 'control';
    if (!need(stratum, group)) { skip(`${stratum}_${group}_pool_full`); continue; }
    cands.push({
      unit: `${id}:${pick}`, stratum, group, script: s0.script, draw_index: cands.length,
      book: { id: b.id, title: b.display_title || b.title, author: b.author, language: b.language, published: b.published || b.year },
      language: pageLanguage(pg.ocr.data) || (b.language || '').toLowerCase(),
      pages: [{ page_number: pick, id: pg.id, ocr: pg.ocr.data }, { page_number: pick + 1, id: nx.id, ocr: nx.ocr.data }],
      seed: nb.get(pick - 1).translation.data,
      prevOcr: nb.get(pick - 1)?.ocr?.data || null, nextOcr: nb.get(pick + 2)?.ocr?.data || null,
    });
  }
  await c.close();
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonl(path.join(DIR, 'candidates.jsonl'), cands);
  fs.writeFileSync(path.join(DIR, 'arms.json'), JSON.stringify({ v13: { version: 13, md5: md5(row.content), id: String(row._id) }, arms: ARM, text: row.content }, null, 2));
  log.pools = Object.fromEntries(['pagebreak', 'control'].map((s) => [s, Object.fromEntries(GROUPS.map((g) => [g, count(s, g)]))]));
  fs.writeFileSync(path.join(DIR, 'draw-log.json'), JSON.stringify(log, null, 2));
  // The by-eye screen reads SOURCE only: N's last lines and N+1's first, nothing an arm wrote. Only candidates
  // not already screened are listed, so an extension is read fresh.
  const screened = fs.existsSync(path.join(DIR, 'screen.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'screen.json'), 'utf8')) : {};
  const win = (g) => (g === 'han' ? [110, 80] : [260, 180]);
  const md = cands.filter((u) => !screened[u.unit]).map((u) => `\n### ${u.unit}  [${u.stratum}] ${u.group}/${u.script} ${u.language}\nN END:   …${body(u.pages[0].ocr).slice(-win(u.group)[0]).replace(/\n/g, ' ⏎ ')}\nN+1 HEAD: ${body(u.pages[1].ocr).slice(0, win(u.group)[1]).replace(/\n/g, ' ⏎ ')}…\n`).join('');
  fs.writeFileSync(path.join(DIR, 'screen.md'), `# Source screen (seam-markers-confirm-5678): is the break a TRUE mid-sentence break?\n${md}`);
  console.log(JSON.stringify(log, null, 1));
}

// ── pin: the by-eye screen decides the sample ─────────────────────────────────
function phasePin() {
  const cands = readJsonl(path.join(DIR, 'candidates.jsonl'));
  const screen = JSON.parse(fs.readFileSync(path.join(DIR, 'screen.json'), 'utf8'));
  const units = [], fills = [];
  for (const [stratum, verdict] of [['pagebreak', 'mid'], ['control', 'closed']]) {
    const pass = (g) => cands.filter((u) => u.stratum === stratum && u.group === g && screen[u.unit]?.v === verdict);
    const keep = Object.fromEntries(GROUPS.map((g) => [g, pass(g).slice(0, QUOTA[stratum][g])]));
    if (keep.latin.length < QUOTA[stratum].latin) throw new Error(`${stratum}/latin: only ${keep.latin.length} pass the screen, need ${QUOTA[stratum].latin}`);
    // a non-Latin group short of its quota is filled from the other non-Latin groups, in draw order
    const nonLatin = ['tibetan', 'han', 'other'];
    const want = nonLatin.reduce((n, g) => n + QUOTA[stratum][g], 0);
    let have = nonLatin.reduce((n, g) => n + keep[g].length, 0);
    if (have < want) {
      const taken = new Set(nonLatin.flatMap((g) => keep[g].map((u) => u.unit)));
      const spare = cands.filter((u) => u.stratum === stratum && nonLatin.includes(u.group) && screen[u.unit]?.v === verdict && !taken.has(u.unit));
      for (const u of spare) { if (have >= want) break; keep[u.group].push(u); fills.push(`${stratum}:${u.group}:${u.unit}`); have++; }
      if (have < want) throw new Error(`${stratum}/non-Latin: only ${have} pass the screen, need ${want}`);
    }
    for (const g of GROUPS) units.push(...keep[g].map((u) => ({ ...u, screen: screen[u.unit] })));
  }
  writeJsonl(path.join(DIR, 'sample.jsonl'), units);
  const by = {}, langs = {};
  for (const u of units) { const k = `${u.stratum}:${u.group}`; by[k] = (by[k] || 0) + 1; langs[`${u.script}/${u.language}`] = (langs[`${u.script}/${u.language}`] || 0) + 1; }
  const tally = {}; for (const u of cands) { const k = `${u.stratum}:${u.group}:${screen[u.unit]?.v || 'unread'}`; tally[k] = (tally[k] || 0) + 1; }
  const est = estimate(units);
  fs.writeFileSync(path.join(DIR, 'pin-log.json'), JSON.stringify({ by, langs, fills, screen_tally: tally, estimate: est }, null, 2));
  console.log(`pinned ${JSON.stringify(by)}; fills ${JSON.stringify(fills)}\nlanguages ${JSON.stringify(langs)}\nscreen ${JSON.stringify(tally)}`);
  console.log(`requests ${est.calls}; ESTIMATE (Batch, 50%): $${est.usd.toFixed(3)} ${JSON.stringify(est.byArm)}`);
}

// ── requests ──────────────────────────────────────────────────────────────────
export function promptFor(u, arm, v13) {
  const prompts = { translation: { text: v13, ref: {} }, english: { text: v13, ref: {} } };
  return buildBlockTranslationPrompt({
    prompts, book: u.book, pages: u.pages, previousTranslation: u.seed,
    prevOcrText: u.prevOcr || undefined, nextOcrText: u.nextOcr || undefined,
    pageBreak: PAGE_BREAK_SCOPED, folioMarkers: ARM[arm].markers,
  }).prompt;
}
const maxOut = (u) => maxOutputTokensFor(u.pages.map((p) => ({ ocr: { data: p.ocr } })));
// chars per input token, and output tokens per source char, by script (rough; the Latin figures are #5701's)
const TOK = { latin: [3.5, 0.45], tibetan: [1.6, 0.6], han: [1.0, 1.6], other: [2.0, 0.6] };
function estimate(units) {
  const { text: v13 } = JSON.parse(fs.readFileSync(path.join(DIR, 'arms.json'), 'utf8'));
  let usd = 0, calls = 0; const byArm = {};
  for (const u of units) for (const a of ARMS) {
    const p = priceFor(ARM[a].model);
    const [cpt, opc] = TOK[u.group];
    const srcChars = u.pages.reduce((n, pg) => n + pg.ocr.length, 0);
    const prompt = promptFor(u, a, v13);
    const i = Math.ceil((prompt.length - srcChars) / 3.5 + srcChars / cpt);
    const o = u.pages.reduce((n, pg) => n + Math.ceil(pg.ocr.length * opc) + 400, 0);
    const d = 0.5 * ((i / 1e6) * p.input + (o / 1e6) * p.output);
    usd += d; calls++; byArm[a] = +((byArm[a] || 0) + d).toFixed(4);
  }
  return { calls, usd, byArm };
}

async function phaseSubmit() {
  const units = readJsonl(path.join(DIR, 'sample.jsonl'));
  const { text: v13, v13: meta } = JSON.parse(fs.readFileSync(path.join(DIR, 'arms.json'), 'utf8'));
  if (md5(v13) !== V13_MD5 || meta.md5 !== V13_MD5) throw new Error('arms.json v13 hash mismatch');
  const est = estimate(units);
  const approved = Number(opt('approved-usd', 0));
  if (!(approved >= est.usd) || approved > CAP_USD) { console.error(`REFUSING TO SPEND: estimate $${est.usd.toFixed(3)}, --approved-usd ${approved || 'absent'} (cap $${CAP_USD})`); process.exit(2); }
  // --resubmit A2,A,B: a job that died server-side with no output (Amendment 2) is moved to dead_jobs and the
  // same requests are submitted again, in the registered order
  const redo = (opt('resubmit', '') || '').split(',').filter(Boolean);
  const prior = fs.existsSync(path.join(DIR, 'batch.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'batch.json'), 'utf8')) : null;
  if (prior && !redo.length) { console.error('batch.json exists — already submitted'); process.exit(2); }
  if (redo.some((a) => prior?.jobs.find((j) => j.arm === a)?.collected_at)) { console.error('refusing to resubmit a collected arm'); process.exit(2); }
  // the envelope (set-scope.mjs, lanes restricted to this eval so no production worker can draw on it)
  const { MongoClient } = await import('mongodb');
  const { getScopeSpendUsd } = await import('../lib/spend-guard.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const control = await c.db('bookstore').collection('system_config').findOne({ _id: 'processing_control' });
  const env = control?.allow_scopes?.[SCOPE];
  if (!env?.budget_usd) { await c.close(); throw new Error(`no allow_scopes.${SCOPE} envelope — open it with set-scope.mjs first`); }
  const spent = await getScopeSpendUsd(c.db('bookstore'), { ids: units.map((u) => u.book.id), since: new Date(env.created_at) });
  await c.close();
  if (spent.meterError) console.warn(`meter: ${spent.meterError}`);
  const deadUsd = (prior?.dead_jobs || []).concat(prior ? prior.jobs.filter((j) => redo.includes(j.arm)) : []).reduce((n, j) => n + (est.byArm[j.arm] || 0), 0);
  if (prior && est.usd + deadUsd > CAP_USD) { console.error(`REFUSING: estimate $${est.usd.toFixed(3)} + dead jobs (assumed billed) $${deadUsd.toFixed(3)} > cap $${CAP_USD}`); process.exit(2); }
  if (!prior && spent.usd + est.usd > Math.min(env.budget_usd, CAP_USD)) { console.error(`REFUSING: envelope $${spent.usd.toFixed(3)} spent + $${est.usd.toFixed(3)} > $${env.budget_usd}`); process.exit(2); }
  const envName = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
  const key = process.env[envName];
  if (!key) throw new Error(`no ${envName}`);
  const jobs = prior ? prior.jobs.filter((j) => !redo.includes(j.arm)) : [];
  const dead_jobs = prior ? [...(prior.dead_jobs || []), ...prior.jobs.filter((j) => redo.includes(j.arm)).map((j) => ({ ...j, dead: opt('dead-reason', 'died server-side with no output') }))] : [];
  const save = () => fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify({ key_env: envName, estimate_usd: est.usd, approved_usd: approved, envelope_before_usd: spent.usd, generation: { thinkingBudget: 0, maxOutputTokens: 'maxOutputTokensFor(pages)', temperature: 'default', safety: 'SAFETY_SETTINGS (production)' }, jobs, ...(dead_jobs.length ? { dead_jobs } : {}) }, null, 2));
  for (const arm of (prior ? ARMS.filter((a) => redo.includes(a)) : ARMS)) {
    // production's request, key carried as the line key the collect side reads
    const lines = units.map((u) => {
      const line = batchRequestToJsonlLine(batchRequest({ key: `${u.unit}|${arm}`, prompt: promptFor(u, arm, v13), maxOutputTokens: maxOut(u) }));
      return JSON.stringify({ key: `${u.unit}|${arm}`, request: line.request });
    });
    jobs.push({ arm, ...(await submitBatchFile({ model: ARM[arm].model, lines, displayName: `markers-confirm-5678-${arm}`, key })) });
    save();   // a job that is submitted is recorded at once: a crash must not orphan paid work
  }
  // --retry-errors: a request that came back as an API error with NO response (Amendment 2) is asked once more
  if (has('retry-errors') && fs.existsSync(path.join(DIR, 'outputs.jsonl'))) {
    const rows = readJsonl(path.join(DIR, 'outputs.jsonl'));
    const answered = new Set(rows.filter((o) => !o.error).map((o) => `${o.unit}|${o.arm}`));
    const errs = rows.filter((o) => o.error && !answered.has(`${o.unit}|${o.arm}`));
    const byUnit = new Map(units.map((u) => [u.unit, u]));
    for (const arm of ARMS) {
      const mine = errs.filter((o) => o.arm === arm);
      if (!mine.length || jobs.some((j) => j.arm === arm && j.retry)) continue;
      const lines = mine.map((o) => { const u = byUnit.get(o.unit); const line = batchRequestToJsonlLine(batchRequest({ key: `${u.unit}|${arm}`, prompt: promptFor(u, arm, v13), maxOutputTokens: maxOut(u) })); return JSON.stringify({ key: `${u.unit}|${arm}`, request: line.request }); });
      jobs.push({ arm, retry: true, ...(await submitBatchFile({ model: ARM[arm].model, lines, displayName: `markers-confirm-5678-${arm}-retry`, key })) });
      save();
    }
  }
}

/**
 * One arm's English for pages N and N+1, parsed as the lane parses it. Marker arms: the positional parser, and the
 * block lane's rule (translate-batch-seam parseBlockResponse) that a page whose span ran on over an unmarked
 * neighbour (`overrun`) is left undrafted too. Page arms: parseBlockTranslations, as the chained lane collects.
 */
export function parseArm(u, arm, raw) {
  const nums = u.pages.map((p) => p.page_number);
  if (ARM[arm].markers) {
    const p = parseFolioMarkedText(raw, nums);
    const overrun = new Set(p.overrun);
    return {
      pages: Object.fromEntries(p.pages.map((x) => [x.page_number, x.span && !overrun.has(x.page_number) ? x.span : null])),
      markers: { reading: p.reading, rejected: p.rejected, missing: p.missing, overrun: p.overrun, duplicated: p.duplicated, unexpected: p.unexpected, outOfOrder: p.outOfOrder, leading: p.leading.length },
    };
  }
  const parsed = parseBlockTranslations(raw, u.pages.map((pg) => ({ page_number: pg.page_number, ocr: pg.ocr })));
  return { pages: Object.fromEntries(nums.map((n) => [n, parsed.translations.get(n) ?? null])), discarded: parsed.discarded };
}

async function phaseCollect() {
  const rec = JSON.parse(fs.readFileSync(path.join(DIR, 'batch.json'), 'utf8'));
  const key = process.env[rec.key_env];
  const units = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((u) => [u.unit, u]));
  const waitMax = Number(opt('wait-min', 0)) * 60e3, t0 = Date.now();
  const out = path.join(DIR, 'outputs.jsonl');
  const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
  for (;;) {
    let pending = 0, dead = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      let text;
      try { text = await fetchBatchOutput(j, key); } catch (e) { console.log(`${j.arm}: ${e.message} — no output; resubmit with --submit --resubmit ${j.arm}`); j.dead_state = e.message; dead++; continue; }
      if (text == null) { pending++; continue; }
      let inTok = 0, outTok = 0, n = 0, errors = 0;
      const p = priceFor(j.model);
      const rows = [];
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const [unit, arm] = (r.key || r.metadata?.key).split('|');
        const u = units.get(unit), resp = r.response, um = resp?.usageMetadata || {};
        const it = { unit, arm, model: j.model };
        if (r.error || !resp) { it.error = JSON.stringify(r.error || 'no response').slice(0, 300); errors++; }
        else {
          it.raw = (resp.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
          it.finish = resp.candidates?.[0]?.finishReason || null;
          it.inTok = um.promptTokenCount || 0; it.outTok = (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
          inTok += it.inTok; outTok += it.outTok;
          Object.assign(it, parseArm(u, arm, it.raw));
          // metered per book so the envelope's per-book meter sees it
          try {
            await logUsage({ type: 'eval', mode: 'batch', model: j.model, book_id: u.book.id, book_title: u.book.title, page_count: 2, input_tokens: it.inTok, output_tokens: it.outTok, batch_job_id: j.job_name, endpoint: ENDPOINT, triggered_by: 'manual', prompt_version: `markers-confirm-5678/${arm}` });
          } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
        }
        rows.push(it); n++;
      }
      fs.appendFileSync(out, rows.map((it) => JSON.stringify(it)).join('\n') + '\n');
      j.collected_at = new Date().toISOString(); j.responses = n; j.errors = errors; j.in_tokens = inTok; j.out_tokens = outTok;
      j.cost_usd = 0.5 * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
      console.log(`collected ${j.arm}: ${n} (${errors} errors) $${j.cost_usd.toFixed(4)}`);
      fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify(rec, null, 2));
    }
    if (dead) { fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify(rec, null, 2)); if (!pending) { console.log(`${dead} job(s) dead`); return; } }
    if (!pending) { console.log(`all collected; actual $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)} → ${out}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --collect later`); return; }
    await new Promise((r) => setTimeout(r, 120e3));
  }
}

// ── packets ───────────────────────────────────────────────────────────────────
const tailW = (s, n) => (s.length > n ? `…${s.slice(s.length - n).replace(/^\S*\s/, '')}` : s);
const headW = (s, n) => (s.length > n ? `${s.slice(0, n).replace(/\s\S*$/, '')}…` : s);
// #5701's windows; a Han source carries about three English characters per character, so its window is a third
const EN_TAIL = 850, EN_HEAD = 700;
const srcWin = (g) => (g === 'han' ? [260, 200] : [750, 600]);
const NP = 8;

function phasePackets() {
  const units = readJsonl(path.join(DIR, 'sample.jsonl'));
  const outs = new Map(readJsonl(path.join(DIR, 'outputs.jsonl')).map((o) => [`${o.unit}|${o.arm}`, o]));
  resetSeed(SEED + 1);
  const shuffle = shuffleWith(seededRand);
  const opaque = () => Math.floor(seededRand() * 0xffffffffff).toString(16).padStart(10, '0');
  const order = shuffle([...units]);
  const packets = Array.from({ length: NP }, (_, p) => order.filter((_, i) => i % NP === p));
  const key = {};
  const mkBreak = (u, extra = []) => {
    const id = opaque();
    const N = u.pages[0].page_number, N1 = u.pages[1].page_number;
    const versions = ARMS.map((arm) => {
      const pg = outs.get(`${u.unit}|${arm}`)?.pages;
      return { source: arm, en: pg?.[N] ?? null, en1: pg?.[N1] ?? null };
    }).concat(extra);
    const lettered = shuffle(versions.map((v) => ({ ...v })));
    const letters = 'PQRSTUVW';
    key[id] = { unit: u.unit, stratum: u.stratum, group: u.group, versions: Object.fromEntries(lettered.map((v, i) => [letters[i], v.source])) };
    const [st, sh] = srcWin(u.group);
    return {
      id, language: u.language, title: u.book.title,
      source_n_end: tailW(body(u.pages[0].ocr), st), source_n1_start: headW(body(u.pages[1].ocr), sh),
      versions: lettered.map((v, i) => ({ letter: letters[i], en_n_end: v.en == null ? '(NO ENGLISH FOR THIS PAGE)' : tailW(display(v.en), EN_TAIL), en_n1_start: v.en1 == null ? '(NO ENGLISH FOR THIS PAGE)' : headW(display(v.en1), EN_HEAD) })),
    };
  };
  // plants (as #5701): per packet 2 duplications (built on A2's English) and 2 forced closures (built on B's span,
  // where it ends mid-sentence), each as an extra version inside a page-break item
  const plants = {};
  packets.forEach((list) => {
    const pb = list.filter((u) => u.stratum === 'pagebreak');
    let dup = 0, clo = 0;
    for (const u of pb) {
      const N = u.pages[0].page_number, N1 = u.pages[1].page_number;
      const a2 = outs.get(`${u.unit}|A2`), b = outs.get(`${u.unit}|B`);
      if (dup < 2 && a2?.pages?.[N] && a2.pages[N1]) {
        const lead = leadingFragment(display(a2.pages[N1]));
        if (lead.length >= 40 && lead.length <= 400) { plants[u.unit] = { source: 'PLANT_DUP', en: `${display(a2.pages[N])} ${lead}`, en1: a2.pages[N1] }; dup++; continue; }
      }
      if (clo < 2 && b?.pages?.[N] && b.pages[N1] && !endsSentence(display(b.pages[N]))) {
        plants[u.unit] = { source: 'PLANT_CLOSURE', en: display(b.pages[N]).replace(/[\s,;:—–-]+$/u, '') + PLANT_CLOSURE, en1: b.pages[N1] }; clo++;
      }
      if (dup >= 2 && clo >= 2) break;
    }
  });
  const items = packets.map((list) => list.map((u) => mkBreak(u, plants[u.unit] ? [plants[u.unit]] : [])));
  // repeats: 2 breaks per packet re-shown (new id, new letters) in the next packet — judge noise
  for (let p = 0; p < NP; p++) {
    const from = packets[p].filter((u) => !plants[u.unit]).slice(0, 2);
    for (const u of from) {
      const it = mkBreak(u);
      key[it.id].repeat_of_unit = u.unit;
      const dest = items[(p + 1) % NP];
      dest.splice(Math.floor(seededRand() * (dest.length + 1)), 0, it);
    }
  }
  const pdir = path.join(DIR, 'packets'); fs.mkdirSync(pdir, { recursive: true });
  items.forEach((list, p) => {
    const base = path.join(pdir, `packet-${p + 1}`);
    writeJsonl(`${base}.jsonl`, list);
    fs.writeFileSync(`${base}.md`, list.map((x, i) => `\n\n######## BREAK ${i + 1}/${list.length}  id=${x.id}  language=${x.language}\n\n==== SOURCE, END OF PAGE N ====\n${x.source_n_end}\n\n==== SOURCE, START OF PAGE N+1 ====\n${x.source_n1_start}\n${x.versions.map((v) => `\n---- VERSION ${v.letter}: English assigned to page N (end) ----\n${v.en_n_end}\n---- VERSION ${v.letter}: English assigned to page N+1 (start) ----\n${v.en_n1_start}\n`).join('')}`).join(''));
  });
  fs.writeFileSync(path.join(DIR, 'packet-key.json'), JSON.stringify({ key, plants: Object.fromEntries(Object.entries(plants).map(([k, v]) => [k, v.source])) }, null, 1));
  console.log(`${items.map((l) => l.length).join('+')} breaks in ${NP} packets; plants ${Object.keys(plants).length}; → ${pdir}`);
}

// ── score ─────────────────────────────────────────────────────────────────────
const ci = (k, n) => wilson(k, n).map((x) => +x.toFixed(3));
const TYPES = ['duplication', 'forced_closure', 'omission_edge', 'import6'];
const typeOf = (v, t) => (t === 'import6' ? (v?.words_moved ?? 0) >= 6 : !!v?.[t]);
export const PAIRS = [['A2', 'A'], ['B', 'A'], ['C', 'D'], ['C', 'B'], ['D', 'A'], ['C', 'A'], ['B', 'A2']];

function phaseScore() {
  const units = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((u) => [u.unit, u]));
  const outs = new Map(readJsonl(path.join(DIR, 'outputs.jsonl')).map((o) => [`${o.unit}|${o.arm}`, o]));
  const { key } = JSON.parse(fs.readFileSync(path.join(DIR, 'packet-key.json'), 'utf8'));
  const vdir = path.join(DIR, 'verdicts');
  const byJudge = new Map();
  for (const f of fs.readdirSync(vdir).filter((x) => x.endsWith('.jsonl')).sort()) {
    const m = f.match(/packet-(\d+)-judge-(\d+)/); if (!m) continue;
    byJudge.set(`p${m[1]}j${m[2]}`, new Map(readJsonl(path.join(vdir, f)).map((r) => [r.id, r])));
  }
  const judgeSlot = (j) => j.replace(/^p\d+/, '');   // j1 / j2 within a packet
  const cell = new Map(), plantRows = [], repeatPairs = [], best = new Map();
  for (const [jid, rows] of byJudge) {
    for (const [id, r] of rows) {
      const k = key[id]; if (!k) { console.warn(`unknown id ${id} in ${jid}`); continue; }
      for (const [letter, src] of Object.entries(k.versions)) {
        const v = r.versions?.[letter];
        if (!v) { console.warn(`${jid} ${id} missing version ${letter}`); continue; }
        if (src.startsWith('PLANT')) { plantRows.push({ jid, unit: k.unit, plant: src, caught: src === 'PLANT_DUP' ? !!v.duplication : !!v.forced_closure, any: realDefect(v) }); continue; }
        if (k.repeat_of_unit) { repeatPairs.push({ jid, unit: k.unit, arm: src, v }); continue; }
        cell.set(`${k.unit}|${src}|${judgeSlot(jid)}`, v);
      }
      if (!k.repeat_of_unit) best.set(`${k.unit}|${judgeSlot(jid)}`, (Array.isArray(r.best) ? r.best : [r.best]).map((l) => (l === 'tie' ? 'tie' : k.versions[l])));
    }
  }
  // plants per judge: a judge who catches fewer than 3 in 4 is set aside (the primary is then the other judge's flag)
  const plantByJudge = {};
  for (const r of plantRows) { const p = (plantByJudge[r.jid] ||= { n: 0, caught: 0 }); p.n++; if (r.caught) p.caught++; }
  const weak = new Set(Object.entries(plantByJudge).filter(([, p]) => p.n && p.caught / p.n < 0.75).map(([j]) => j));
  const packetOf = new Map(); for (const [id, k] of Object.entries(key)) if (!k.repeat_of_unit) for (const jid of byJudge.keys()) if (byJudge.get(jid).has(id)) packetOf.set(k.unit, jid.replace(/j\d+$/, ''));
  const SLOTS = ['j1', 'j2'];
  const rowFor = (u, arm) => {
    const o = outs.get(`${u.unit}|${arm}`);
    const N = u.pages[0].page_number, N1 = u.pages[1].page_number;
    // a block that leaves either page undrafted is a real defect by construction (the page has no English)
    const undrafted = !o || !!o.error || !o.pages?.[N] || !o.pages?.[N1];
    const slots = SLOTS.filter((s) => !weak.has(`${packetOf.get(u.unit)}${s}`));
    const judged = slots.map((s) => cell.get(`${u.unit}|${arm}|${s}`)).filter(Boolean);
    const all = judged.length === slots.length && judged.length > 0;
    return {
      unit: u.unit, group: u.group, judged: judged.length, undrafted,
      both: undrafted || (all && judged.every(realDefect)),
      either: undrafted || judged.some(realDefect),
      types: Object.fromEntries(TYPES.map((t) => [t, { both: all && judged.every((v) => typeOf(v, t)), either: judged.some((v) => typeOf(v, t)) }])),
      mechDup: !!(o?.pages?.[N] && o.pages[N1] && duplicatedAcrossBoundary(o.pages[N], o.pages[N1])),
      reading: o?.markers?.reading || null,
      moved: judged.map((v) => v.words_moved ?? 0),
      broken: judged.filter((v) => v.reads_across === 'broken').length,
    };
  };
  const report = { at: new Date().toISOString(), judges: [...byJudge.keys()], judges_set_aside: [...weak], strata: {} };
  const flagAll = {};
  for (const stratum of ['pagebreak', 'control']) {
    const us = [...units.values()].filter((u) => u.stratum === stratum);
    const S = { n: us.length, arms: {} };
    const flag = {};
    for (const arm of ARMS) {
      const rows = us.map((u) => rowFor(u, arm));
      flag[arm] = new Map(rows.map((r) => [r.unit, r]));
      const k = (f, rs = rows) => rs.filter(f).length;
      const A = {
        judged_by_both: k((r) => r.judged === 2),
        real_both: k((r) => r.both), real_both_ci: ci(k((r) => r.both), rows.length),
        real_either: k((r) => r.either), real_either_ci: ci(k((r) => r.either), rows.length),
        undrafted_blocks: k((r) => r.undrafted),
        types: Object.fromEntries(TYPES.map((t) => [t, { both: k((r) => r.types[t].both), either: k((r) => r.types[t].either) }])),
        mech_duplication: k((r) => r.mechDup),
        moved_1_5_either: k((r) => r.moved.some((x) => x >= 1 && x < 6)),
        reads_broken_both: k((r) => r.broken === 2),
        by_group: Object.fromEntries(GROUPS.map((g) => { const rs = rows.filter((r) => r.group === g); return [g, { n: rs.length, real_both: k((r) => r.both, rs), undrafted: k((r) => r.undrafted, rs) }]; })),
        by_script_class: Object.fromEntries([['latin', (r) => r.group === 'latin'], ['non_latin', (r) => r.group !== 'latin']].map(([name, f]) => { const rs = rows.filter(f); return [name, { n: rs.length, real_both: k((r) => r.both, rs), real_both_ci: ci(k((r) => r.both, rs), rs.length) }]; })),
      };
      if (ARM[arm].markers) A.marker_readings = rows.reduce((acc, r) => ({ ...acc, [r.reading]: (acc[r.reading] || 0) + 1 }), {});
      S.arms[arm] = A;
    }
    const pair = (x, y, f, sel = () => true) => {
      const sub = us.filter(sel);
      const b = sub.filter((u) => f(flag[x].get(u.unit)) && !f(flag[y].get(u.unit))).length;
      const c = sub.filter((u) => !f(flag[x].get(u.unit)) && f(flag[y].get(u.unit))).length;
      return { [`${x}_only`]: b, [`${y}_only`]: c, p_two_sided: +mcnemar(b, c).toFixed(4), p_one_sided_x_lower: +signOneSided(b, c).toFixed(4) };
    };
    S.paired = Object.fromEntries([['both', (r) => r.both], ['either', (r) => r.either], ['omission_both', (r) => r.types.omission_edge.both]].map(([name, f]) => [name, Object.fromEntries(PAIRS.map(([x, y]) => [`${x}_vs_${y}`, pair(x, y, f)]))]));
    S.paired_by_script_class = Object.fromEntries([['latin', (u) => u.group === 'latin'], ['non_latin', (u) => u.group !== 'latin']].map(([name, sel]) => [name, Object.fromEntries(PAIRS.map(([x, y]) => [`${x}_vs_${y}`, pair(x, y, (r) => r.both, sel)]))]));
    const wins = Object.fromEntries([...ARMS, 'tie'].map((a) => [a, 0]));
    for (const u of us) for (const s of SLOTS) for (const a of best.get(`${u.unit}|${s}`) || []) if (a in wins) wins[a]++;
    S.best_seam_votes = wins;
    report.strata[stratum] = S;
    flagAll[stratum] = flag;
  }
  // undrafted blocks over all 120 (the parse-failure guard)
  report.undrafted_blocks_120 = Object.fromEntries(ARMS.map((a) => [a, [...units.values()].filter((u) => flagAll[u.stratum][a].get(u.unit).undrafted).map((u) => u.unit)]));
  report.plants = { n: plantRows.length, caught: plantRows.filter((r) => r.caught).length, flagged_real: plantRows.filter((r) => r.any).length, by_judge: plantByJudge, rows: plantRows };
  let agree = 0, tot = 0;
  for (const u of units.values()) for (const arm of ARMS) { const a = cell.get(`${u.unit}|${arm}|j1`), b = cell.get(`${u.unit}|${arm}|j2`); if (a && b) { tot++; if (realDefect(a) === realDefect(b)) agree++; } }
  report.inter_judge = { pairs: tot, agree_real: agree };
  const rep = repeatPairs.map((r) => ({ ...r, orig: cell.get(`${r.unit}|${r.arm}|${judgeSlot(r.jid)}`) }));
  // a repeat is judged by the NEXT packet's judges, so it is compared with the original packet's same slot
  report.repeats = { pairs: rep.filter((r) => r.orig).length, agree_real: rep.filter((r) => r.orig && realDefect(r.v) === realDefect(r.orig)).length };
  report.decision = decide(report);
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, plants: { ...report.plants, rows: undefined } }, null, 2));
}

/** The pre-registered reading (PREREGISTRATION-seam-markers-confirm.md), on the consensus ("both") flag. */
export function decide(report) {
  const pb = report.strata.pagebreak, ctl = report.strata.control;
  const n = (arm) => pb.arms[arm].real_both;
  const noise = Math.abs(n('A2') - n('A'));
  const P = pb.paired.both;
  const beats = (x, y) => n(x) < n(y) && (n(y) - n(x)) > noise && P[`${x}_vs_${y}`].p_one_sided_x_lower < 0.10;
  const T1 = beats('B', 'A'), T2 = beats('C', 'D'), S1 = beats('D', 'A'), S2 = beats('C', 'B');
  const cn = (arm) => ctl.arms[arm].real_both;
  const om = (arm) => pb.arms[arm].types.omission_edge.both;
  const un = (arm) => report.undrafted_blocks_120[arm].length;
  const cTol = Math.max(1, Math.abs(cn('A2') - cn('A'))), oTol = Math.max(2, Math.abs(om('A2') - om('A')));
  const guards = {
    B: { control: cn('B') - cn('A') <= cTol, omission: om('B') - om('A') <= oTol, undrafted: un('B') <= Math.max(un('A'), un('A2')) + 2 },
    C: { control: cn('C') - cn('D') <= cTol, omission: om('C') - om('D') <= oTol, undrafted: un('C') <= un('D') + 2 },
  };
  const ok = (g) => Object.values(g).every(Boolean);
  const markers = T1 || T2, model = S1 || S2;
  return {
    counts: Object.fromEntries(ARMS.map((a) => [a, n(a)])), noise,
    T1_markers_on_lite_B_vs_A: T1, T2_markers_on_flash_C_vs_D: T2, S1_model_without_markers_D_vs_A: S1, S2_model_with_markers_C_vs_B: S2,
    control_counts: Object.fromEntries(ARMS.map((a) => [a, cn(a)])), omission_counts: Object.fromEntries(ARMS.map((a) => [a, om(a)])), undrafted_counts: Object.fromEntries(ARMS.map((a) => [a, un(a)])),
    guards, guards_hold_B: ok(guards.B), guards_hold_C: ok(guards.C),
    markers_on_chained_lane: T1 && ok(guards.B) ? 'YES' : T1 ? 'EFFECT WITH A COST (no flip)' : 'NO',
    attribution: markers && model ? 'BOTH' : markers ? 'MARKERS' : model ? 'MODEL' : 'UNRESOLVED',
    only_flash_markers_win: T2 && !T1,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = ['draw', 'pin', 'submit', 'collect', 'packets', 'score'].find(has);
  if (!phase) { console.error('pass one of --draw --pin --submit --collect --packets --score'); process.exit(1); }
  await ({ draw: phaseDraw, pin: phasePin, submit: phaseSubmit, collect: phaseCollect, packets: phasePackets, score: phaseScore })[phase]();
}

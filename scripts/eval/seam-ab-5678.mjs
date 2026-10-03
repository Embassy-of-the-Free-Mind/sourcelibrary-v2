#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-v14-ab.mjs --study seam (the #5372/#5305 paired-arm harness): its
// chained-lane frame (one seeded lane page per book), its block door (buildBlockTranslationPrompt + stored seed of
// N−1 + adjacent OCR + PAGE_BREAK_SCOPED) and its A/A2 noise-floor design are reproduced here; its Batch
// submit/collect (submitBatchFile / fetchBatchOutput, from translation-restraint-ab.mjs) is imported, not copied.
// What it cannot do: its arms differ by PROMPT TEXT on one model, it judges page N alone on an invention rubric, and
// it has no marker arm or second model. scripts/eval/folio-markers-5678.mjs + scripts/lib/folio-markers.mjs (#5678):
// the marker prompt (folioMarkers) and the span parser, used as-is; its placement checker counts Tibetan syllables,
// so the Latin version here counts source words. scripts/eval/translation-batch-continuity-ab.mjs judges seams
// pairwise with a model; here two blind Opus judges read every arm of a break side by side, with a tie allowed.
/**
 * seam-ab-5678 — at a page break where the source sentence runs on, is the chained lane's continuity defect the
 * MODEL (Flash-Lite vs Flash) or the FORCING of each page's English to stand alone? And do folio markers fix it
 * on Lite? (#5678). Pre-registration: scripts/eval/PREREGISTRATION-seam-ab-markers.md.
 *
 * Arms, each on the SAME two-page block (N, N+1), the production seed (stored translation of N−1), adjacent OCR,
 * PAGE_BREAK_SCOPED, Batch API, thinkingBudget 0 — production's chained request (translate-batch-chained
 * buildRoundRequest + translate-batch-seam batchRequest):
 *   A    gemini-3.1-flash-lite, v13, one <translation page="N"> per page (production)
 *   A2   A again — the noise floor (submitted FIRST)
 *   B    gemini-3.1-flash-lite, v13 + folioMarkers (one continuous text, <pb n="N"/> at each page turn)
 *   C    gemini-3-flash-preview, v13 + folioMarkers
 *
 * Phases (only --submit costs money):
 *   --draw            seeded frame → candidates.jsonl + screen.md (source tails, for the by-eye screen)     FREE
 *   --pin             screen.json (by-eye verdicts on the SOURCE) → sample.jsonl + arms.json             FREE
 *   --submit          one Batch job per arm, A2 first; needs --approved-usd ≥ estimate and the envelope   PAID
 *   --collect         poll (--wait-min N), parse, outputs.jsonl, meter per book into gemini_usage        FREE
 *   --packets         blinded judge packets with plants + repeats → packets/, packet-key.json             FREE
 *   --score           verdicts + mechanical marker measures → report.json                                 FREE
 *
 * NOTHING here writes to `pages`, `books` or `prompts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildBlockTranslationPrompt, parseBlockTranslations, PAGE_BREAK_SCOPED, MODEL_LITE, MODEL_FLASH,
} from '../lib/translate-core.mjs';
import { maxOutputTokensFor, batchRequest, batchRequestToJsonlLine } from '../lib/translate-batch-seam.mjs';
import { parseFolioMarkedText, endsSentence, leadingFragment } from '../lib/folio-markers.mjs';
import { sourceProse, translationProse, duplicatedAcrossBoundary } from '../lib/block-drift.mjs';
import { sourceEndsOpen } from '../audit/translation-bridging.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { resetSeed, seededRand } from './lib/paired-stats.mjs';
import { wilson } from './lib/agreement-stats.mjs';
import { submitBatchFile, fetchBatchOutput, mcnemar } from './translation-restraint-ab.mjs';
import { signOneSided } from './translation-prompt-v14-ab.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = opt('dir', path.join(HERE, 'results/seam-ab-5678'));
const SEED = 5678;
const SCOPE = 'seam-ab-5678';
const CAP_USD = 2;
const ENDPOINT = 'eval/seam-ab-5678';
const V13_MD5 = '516510147237b6a79d9d3f6e797bba7f';
const N_PAGEBREAK = 100, N_CONTROL = 20;
// candidates drawn for the by-eye screen; --pool-control extends the control pool by the same procedure (the
// pagebreak pool is unchanged by it: the extra visits only take closed-end pages)
const POOL = { pagebreak: 150, control: Number(opt('pool-control', 30)) };
export const ARMS = ['A2', 'A', 'B', 'C'];      // submit order: the noise floor first
export const ARM = {
  A: { model: MODEL_LITE, markers: false },
  A2: { model: MODEL_LITE, markers: false },
  B: { model: MODEL_LITE, markers: true },
  C: { model: MODEL_FLASH, markers: true },
};
// Languages the reader here can check, by the PAGE's own OCR <language> tag (books.language is not enough: the
// seam-confirm draw had a French Odoric and a Hebrew page in books labelled Latin).
export const LANGS = new Set(['latin', 'german', 'french', 'italian']);
const CHAINED_CALL_SITE = 'scripts/lib/translate-batch-chained.mjs';
const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate', 'table'];
const PRIOR_SAMPLES = ['results/translation-seam-confirm-2026-10-03/sample.jsonl', 'results/translation-prompt-v14-ab-2026-10-02/sample.jsonl'];

const md5 = (t) => createHash('md5').update(t).digest('hex');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const shuffleWith = (rand) => (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** The page's own language, from its OCR header tag. */
export const pageLanguage = (ocr) => (String(ocr || '').match(/<language>\s*([^<]+?)\s*<\/language>/i)?.[1] || '').toLowerCase();
/** Body prose of a page: OCR furniture and the trailing <vocab> keyword line removed. */
export const body = (ocr) => sourceProse(ocr);
const words = (t) => (String(t || '').match(/[\p{L}\p{N}]+/gu) || []).length;

// ── draw ──────────────────────────────────────────────────────────────────────
async function phaseDraw() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const row = await db.collection('prompts').findOne({ type: 'translation', is_default: true }, { sort: { version: -1 } });
  if (!row || row.version !== 13 || md5(row.content) !== V13_MD5) throw new Error(`default translation prompt is v${row?.version} md5 ${row && md5(row.content)}, not v13 ${V13_MD5}`);
  const used = new Set(PRIOR_SAMPLES.flatMap((f) => readJsonl(path.join(HERE, f)).map((u) => u.book.id)));
  const bookIds = (await db.collection('translate_batch_runs').distinct('book_id', { mode: 'chained' })).sort();
  const books = new Map((await db.collection('books').find(
    { id: { $in: bookIds }, visible: true, pages_count: { $gt: 0 } },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1 } },
  ).toArray()).map((b) => [b.id, b]));
  resetSeed(SEED);
  const shuffle = shuffleWith(seededRand);
  const order = shuffle(bookIds.filter((id) => books.has(id)));
  const log = { seed: SEED, frame: { call_site: CHAINED_CALL_SITE, runs_mode: 'chained', served_books: order.length }, skipped: {}, visited: 0 };
  const skip = (k) => { log.skipped[k] = (log.skipped[k] || 0) + 1; };
  const cands = [];
  const need = (s) => cands.filter((u) => u.stratum === s).length < POOL[s];
  for (const id of order) {
    if (!need('pagebreak') && !need('control')) break;
    const b = books.get(id);
    if (used.has(id)) { skip('prior_sample_book'); continue; }
    if (!/^(latin|german|french|italian)/i.test(b.language || '')) { skip('book_language'); continue; }
    log.visited++;
    const lane = await db.collection('pages').find(
      { book_id: id, 'translation.engine.call_site': CHAINED_CALL_SITE, 'translation.engine.input.context.previous_translation': true, 'translation.edited_by': { $exists: false }, page_type: { $nin: EXCLUDED_TYPES } },
      { projection: { page_number: 1, 'translation.model': 1 } },
    ).toArray();
    const ok = lane.filter((p) => /^gemini-3(\.1)?-flash/.test(p.translation?.model || '')).sort((x, y) => x.page_number - y.page_number);
    if (!ok.length) { skip('no_seeded_lane_page'); continue; }
    const pick = ok[Math.floor(seededRand() * ok.length)].page_number;
    const nb = new Map((await db.collection('pages').find({ book_id: id, page_number: { $in: [pick - 1, pick, pick + 1, pick + 2] } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray()).map((r) => [r.page_number, r]));
    const pg = nb.get(pick), nx = nb.get(pick + 1);
    if (!pg?.ocr?.data || body(pg.ocr.data).length < 400) { skip('short_ocr'); continue; }
    if (!nx?.ocr?.data || body(nx.ocr.data).length < 200) { skip('no_next_ocr'); continue; }
    if (EXCLUDED_TYPES.includes(nx.page_type)) { skip('next_excluded_type'); continue; }
    if (!LANGS.has(pageLanguage(pg.ocr.data)) || !LANGS.has(pageLanguage(nx.ocr.data))) { skip('page_language'); continue; }
    if (!nb.get(pick - 1)?.translation?.data) { skip('no_seed_now'); continue; }
    const stratum = sourceEndsOpen(pg.ocr.data) ? 'pagebreak' : 'control';
    if (!need(stratum)) { skip(`${stratum}_pool_full`); continue; }
    cands.push({
      unit: `${id}:${pick}`, stratum, draw_index: cands.length,
      book: { id: b.id, title: b.display_title || b.title, author: b.author, language: b.language, published: b.published || b.year },
      language: pageLanguage(pg.ocr.data),
      pages: [{ page_number: pick, id: pg.id, ocr: pg.ocr.data }, { page_number: pick + 1, id: nx.id, ocr: nx.ocr.data }],
      seed: nb.get(pick - 1).translation.data,
      prevOcr: nb.get(pick - 1)?.ocr?.data || null, nextOcr: nb.get(pick + 2)?.ocr?.data || null,
    });
  }
  await c.close();
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonl(path.join(DIR, 'candidates.jsonl'), cands);
  fs.writeFileSync(path.join(DIR, 'arms.json'), JSON.stringify({ v13: { version: 13, md5: md5(row.content), id: String(row._id) }, arms: ARM, text: row.content }, null, 2));
  log.pools = Object.fromEntries(['pagebreak', 'control'].map((s) => [s, cands.filter((u) => u.stratum === s).length]));
  fs.writeFileSync(path.join(DIR, 'draw-log.json'), JSON.stringify(log, null, 2));
  // The by-eye screen reads SOURCE only: N's last lines and N+1's first, nothing an arm wrote.
  // the screen file lists only candidates not already screened (screen.json), so an extension is read fresh
  const screened = fs.existsSync(path.join(DIR, 'screen.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'screen.json'), 'utf8')) : {};
  const md = cands.filter((u) => !screened[u.unit]).map((u) => `\n### ${u.unit}  [${u.stratum}] ${u.language}\nN END:   …${body(u.pages[0].ocr).slice(-260).replace(/\n/g, ' ⏎ ')}\nN+1 HEAD: ${body(u.pages[1].ocr).slice(0, 180).replace(/\n/g, ' ⏎ ')}…\n`).join('');
  fs.writeFileSync(path.join(DIR, 'screen.md'), `# Source screen (seam-ab-5678): is the break a TRUE mid-sentence break?\n${md}`);
  console.log(JSON.stringify(log, null, 1));
}

// ── pin: the by-eye screen decides the sample ─────────────────────────────────
function phasePin() {
  const cands = readJsonl(path.join(DIR, 'candidates.jsonl'));
  const screen = JSON.parse(fs.readFileSync(path.join(DIR, 'screen.json'), 'utf8'));
  const units = [];
  for (const [stratum, want, verdict] of [['pagebreak', N_PAGEBREAK, 'mid'], ['control', N_CONTROL, 'closed']]) {
    const keep = cands.filter((u) => u.stratum === stratum && screen[u.unit]?.v === verdict).slice(0, want);
    if (keep.length < want) throw new Error(`${stratum}: only ${keep.length} pass the screen, need ${want}`);
    units.push(...keep.map((u) => ({ ...u, screen: screen[u.unit] })));
  }
  writeJsonl(path.join(DIR, 'sample.jsonl'), units);
  const by = {}, langs = {};
  for (const u of units) { by[u.stratum] = (by[u.stratum] || 0) + 1; langs[u.language] = (langs[u.language] || 0) + 1; }
  const tally = {}; for (const u of cands) { const k = `${u.stratum}:${screen[u.unit]?.v || 'unread'}`; tally[k] = (tally[k] || 0) + 1; }
  const est = estimate(units);
  fs.writeFileSync(path.join(DIR, 'pin-log.json'), JSON.stringify({ by, langs, screen_tally: tally, estimate: est }, null, 2));
  console.log(`pinned ${JSON.stringify(by)}; languages ${JSON.stringify(langs)}; screen ${JSON.stringify(tally)}`);
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
function estimate(units) {
  const { text: v13 } = JSON.parse(fs.readFileSync(path.join(DIR, 'arms.json'), 'utf8'));
  let usd = 0, calls = 0; const byArm = {};
  for (const u of units) for (const a of ARMS) {
    const p = priceFor(ARM[a].model);
    const i = Math.ceil(promptFor(u, a, v13).length / 3.5);
    const o = u.pages.reduce((n, pg) => n + Math.ceil(pg.ocr.length * 0.45) + 400, 0);
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
  if (fs.existsSync(path.join(DIR, 'batch.json'))) { console.error('batch.json exists — already submitted'); process.exit(2); }
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
  if (spent.usd + est.usd > Math.min(env.budget_usd, CAP_USD)) { console.error(`REFUSING: envelope $${spent.usd.toFixed(3)} spent + $${est.usd.toFixed(3)} > $${env.budget_usd}`); process.exit(2); }
  const envName = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
  const key = process.env[envName];
  if (!key) throw new Error(`no ${envName}`);
  const jobs = [];
  for (const arm of ARMS) {
    // production's request, key carried as the line key the collect side reads
    const lines = units.map((u) => {
      const line = batchRequestToJsonlLine(batchRequest({ key: `${u.unit}|${arm}`, prompt: promptFor(u, arm, v13), maxOutputTokens: maxOut(u) }));
      return JSON.stringify({ key: `${u.unit}|${arm}`, request: line.request });
    });
    jobs.push({ arm, ...(await submitBatchFile({ model: ARM[arm].model, lines, displayName: `seam-ab-5678-${arm}`, key })) });
  }
  fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify({ key_env: envName, estimate_usd: est.usd, approved_usd: approved, envelope_before_usd: spent.usd, generation: { thinkingBudget: 0, maxOutputTokens: 'maxOutputTokensFor(pages)', temperature: 'default', safety: 'SAFETY_SETTINGS (production)' }, jobs }, null, 2));
}

/** One arm's English for pages N and N+1, plus the marker parse for the marker arms. */
export function parseArm(u, arm, raw) {
  const nums = u.pages.map((p) => p.page_number);
  if (ARM[arm].markers) {
    const p = parseFolioMarkedText(raw, nums);
    return {
      pages: Object.fromEntries(p.pages.map((x) => [x.page_number, x.span || null])),
      markers: { missing: p.missing, duplicated: p.duplicated, unexpected: p.unexpected, outOfOrder: p.outOfOrder, leading: p.leading.length, fraction: p.pages[1].marker_fraction },
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
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const text = await fetchBatchOutput(j, key);
      if (text == null) { pending++; continue; }
      let inTok = 0, outTok = 0, n = 0, errors = 0;
      const p = priceFor(j.model);
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
            await logUsage({ type: 'eval', mode: 'batch', model: j.model, book_id: u.book.id, book_title: u.book.title, page_count: 2, input_tokens: it.inTok, output_tokens: it.outTok, batch_job_id: j.job_name, endpoint: ENDPOINT, triggered_by: 'manual', prompt_version: `seam-ab-5678/${arm}` });
          } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
        }
        fs.appendFileSync(out, JSON.stringify(it) + '\n'); n++;
      }
      j.collected_at = new Date().toISOString(); j.responses = n; j.errors = errors; j.in_tokens = inTok; j.out_tokens = outTok;
      j.cost_usd = 0.5 * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
      console.log(`collected ${j.arm}: ${n} (${errors} errors) $${j.cost_usd.toFixed(4)}`);
    }
    fs.writeFileSync(path.join(DIR, 'batch.json'), JSON.stringify(rec, null, 2));
    if (!pending) { console.log(`all collected; actual $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)} → ${out}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --collect later`); return; }
    await new Promise((r) => setTimeout(r, 120e3));
  }
}

// ── packets ───────────────────────────────────────────────────────────────────
/** English as a reader sees it at the turn: editorial blocks gone, inline notes kept. */
export const display = (t) => String(t || '').replace(/<(summary|keywords|meta|vocab|warning)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const tailW = (s, n) => (s.length > n ? `…${s.slice(s.length - n).replace(/^\S*\s/, '')}` : s);
const headW = (s, n) => (s.length > n ? `${s.slice(0, n).replace(/\s\S*$/, '')}…` : s);
const SRC_TAIL = 1100, SRC_HEAD = 900, EN_TAIL = 1300, EN_HEAD = 1100;
export const PLANT_CLOSURE = ', and so the matter is settled.';

function phasePackets() {
  const units = readJsonl(path.join(DIR, 'sample.jsonl'));
  const outs = new Map(readJsonl(path.join(DIR, 'outputs.jsonl')).map((o) => [`${o.unit}|${o.arm}`, o]));
  resetSeed(SEED + 1);
  const shuffle = shuffleWith(seededRand);
  const opaque = () => Math.floor(seededRand() * 0xffffffffff).toString(16).padStart(10, '0');
  const NP = 4;
  const order = shuffle([...units]);
  const packets = Array.from({ length: NP }, (_, p) => order.filter((_, i) => i % NP === p));
  const key = {};
  const mkBreak = (u, extra = []) => {
    const id = opaque();
    const N = u.pages[0].page_number, N1 = u.pages[1].page_number;
    const versions = ARMS.map((arm) => {
      const o = outs.get(`${u.unit}|${arm}`);
      return { source: arm, en: o?.pages?.[N] ?? null, en1: o?.pages?.[N1] ?? null };
    }).concat(extra);
    const lettered = shuffle(versions.map((v) => ({ ...v })));
    const letters = 'PQRSTUV';
    key[id] = { unit: u.unit, stratum: u.stratum, versions: Object.fromEntries(lettered.map((v, i) => [letters[i], v.source])) };
    return {
      id, language: u.language, title: u.book.title,
      source_n_end: tailW(body(u.pages[0].ocr), SRC_TAIL), source_n1_start: headW(body(u.pages[1].ocr), SRC_HEAD),
      versions: lettered.map((v, i) => ({ letter: letters[i], en_n_end: v.en == null ? '(NO ENGLISH FOR THIS PAGE)' : tailW(display(v.en), EN_TAIL), en_n1_start: v.en1 == null ? '(NO ENGLISH FOR THIS PAGE)' : headW(display(v.en1), EN_HEAD) })),
    };
  };
  // plants: per packet 2 duplications (built on A2's English) and 2 forced closures (built on B's span, where it
  // ends mid-sentence), each as an extra version inside a page-break item
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
/** A real seam defect in one judge's verdict on one version (the pre-registered definition). */
export const realDefect = (v) => !!(v && (v.duplication || v.forced_closure || v.omission_edge || (v.words_moved ?? 0) >= 6));
const ci = (k, n) => wilson(k, n).map((x) => +x.toFixed(3));

/** Marker placement in source words: share of English before the marker vs share of source words on page N. */
export function markerMiss(u, o) {
  const N = u.pages[0].page_number, N1 = u.pages[1].page_number;
  const en0 = translationProse(o.pages?.[N] || ''), en1 = translationProse(o.pages?.[N1] || '');
  const s0 = words(body(u.pages[0].ocr)), s1 = words(body(u.pages[1].ocr));
  const e0 = words(en0), e1 = words(en1);
  if (!e0 || !e1 || !(s0 + s1)) return null;
  const srcFrac = s0 / (s0 + s1), enFrac = e0 / (e0 + e1);
  return { src_frac: +srcFrac.toFixed(4), en_frac: +enFrac.toFixed(4), miss_words: Math.round((enFrac - srcFrac) * (e0 + e1)) };
}

function phaseScore() {
  const units = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((u) => [u.unit, u]));
  const outs = new Map(readJsonl(path.join(DIR, 'outputs.jsonl')).map((o) => [`${o.unit}|${o.arm}`, o]));
  const { key } = JSON.parse(fs.readFileSync(path.join(DIR, 'packet-key.json'), 'utf8'));
  const vdir = path.join(DIR, 'verdicts');
  const judgeFiles = fs.readdirSync(vdir).filter((f) => f.endsWith('.jsonl')).sort();
  // verdicts: judge → break id → { letter → verdict, best }
  const byJudge = new Map();
  for (const f of judgeFiles) {
    const m = f.match(/packet-(\d+)-judge-(\d+)/); if (!m) continue;
    const rows = new Map(readJsonl(path.join(vdir, f)).map((r) => [r.id, r]));
    byJudge.set(`p${m[1]}j${m[2]}`, rows);
  }
  const judgeSlot = (j) => j.replace(/^p\d+/, '');   // j1 / j2 within a packet
  // per (unit, arm, judge slot) → verdict, from the original (non-repeat) item
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
  const SLOTS = ['j1', 'j2'];
  const mech = (u, arm) => {
    const o = outs.get(`${u.unit}|${arm}`);
    const N = u.pages[0].page_number, N1 = u.pages[1].page_number;
    const r = { failed: !o || !!o.error || !o.pages?.[N] || !o.pages?.[N1] };
    if (ARM[arm].markers) { r.dropped = !!o?.markers?.missing?.length || !!o?.markers?.outOfOrder; r.leading = (o?.markers?.leading || 0) > 0; r.miss = o && !r.failed ? markerMiss(u, o) : null; }
    r.mechDup = !!(o?.pages?.[N] && o.pages[N1] && duplicatedAcrossBoundary(o.pages[N], o.pages[N1]));
    return r;
  };
  const report = { at: new Date().toISOString(), judges: [...byJudge.keys()], strata: {} };
  const TYPES = ['duplication', 'forced_closure', 'omission_edge', 'import6'];
  const typeOf = (v, t) => (t === 'import6' ? (v?.words_moved ?? 0) >= 6 : !!v?.[t]);
  for (const stratum of ['pagebreak', 'control']) {
    const us = [...units.values()].filter((u) => u.stratum === stratum);
    const S = { n: us.length, arms: {} };
    const flag = {};   // arm → unit → {both, either}
    for (const arm of ARMS) {
      const rows = us.map((u) => {
        const m = mech(u, arm);
        const vs = SLOTS.map((s) => cell.get(`${u.unit}|${arm}|${s}`));
        const judged = vs.filter(Boolean);
        // a failed parse or a dropped marker is a real defect by construction (the page has no text of its own)
        const forced = m.failed || m.dropped;
        const both = forced || (judged.length === 2 && judged.every(realDefect));
        const either = forced || judged.some(realDefect);
        const types = Object.fromEntries(TYPES.map((t) => [t, { both: judged.length === 2 && judged.every((v) => typeOf(v, t)), either: judged.some((v) => typeOf(v, t)) }]));
        return { unit: u.unit, judged: judged.length, both, either, types, m, moved: judged.map((v) => v.words_moved ?? 0) };
      });
      flag[arm] = new Map(rows.map((r) => [r.unit, r]));
      const k = (f) => rows.filter(f).length;
      const A = {
        judged_by_both: k((r) => r.judged === 2),
        real_both: k((r) => r.both), real_both_ci: ci(k((r) => r.both), rows.length),
        real_either: k((r) => r.either), real_either_ci: ci(k((r) => r.either), rows.length),
        failed_parse: k((r) => r.m.failed),
        types: Object.fromEntries(TYPES.map((t) => [t, { both: k((r) => r.types[t].both), either: k((r) => r.types[t].either) }])),
        mech_duplication: k((r) => r.m.mechDup),
        moved_1_5_either: k((r) => r.moved.some((x) => x >= 1 && x < 6)),
      };
      if (ARM[arm].markers) {
        const miss = rows.map((r) => r.m.miss).filter(Boolean).map((x) => Math.abs(x.miss_words)).sort((a, b) => a - b);
        A.markers = { dropped: k((r) => r.m.dropped), leading_text: k((r) => r.m.leading), n_measured: miss.length, median_abs_miss_words: miss.length ? miss[Math.floor(miss.length / 2)] : null, p90_abs_miss_words: miss.length ? miss[Math.min(miss.length - 1, Math.floor(miss.length * 0.9))] : null, judge_moved_median: (() => { const xs = rows.flatMap((r) => r.moved).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; })() };
      }
      S.arms[arm] = A;
    }
    const pair = (x, y, f) => {
      const b = us.filter((u) => flag[x].get(u.unit)[f] && !flag[y].get(u.unit)[f]).length;
      const c = us.filter((u) => !flag[x].get(u.unit)[f] && flag[y].get(u.unit)[f]).length;
      return { [`${x}_only`]: b, [`${y}_only`]: c, p_two_sided: +mcnemar(b, c).toFixed(4), p_one_sided_x_lower: +signOneSided(b, c).toFixed(4) };
    };
    S.paired = Object.fromEntries(['both', 'either'].map((f) => [f, { noise_A2_vs_A: pair('A2', 'A', f), B_vs_A: pair('B', 'A', f), C_vs_B: pair('C', 'B', f), C_vs_A: pair('C', 'A', f) }]));
    // best seam per break (each judge; a tie is allowed)
    const wins = Object.fromEntries([...ARMS, 'tie'].map((a) => [a, 0]));
    for (const u of us) for (const s of SLOTS) for (const a of best.get(`${u.unit}|${s}`) || []) if (a in wins) wins[a]++;
    S.best_seam_votes = wins;
    report.strata[stratum] = S;
  }
  // judges: plants caught, inter-judge agreement, repeat agreement
  report.plants = { n: plantRows.length, caught: plantRows.filter((r) => r.caught).length, flagged_real: plantRows.filter((r) => r.any).length, rows: plantRows };
  let agree = 0, tot = 0;
  for (const u of units.values()) for (const arm of ARMS) { const a = cell.get(`${u.unit}|${arm}|j1`), b = cell.get(`${u.unit}|${arm}|j2`); if (a && b) { tot++; if (realDefect(a) === realDefect(b)) agree++; } }
  report.inter_judge = { pairs: tot, agree_real: agree };
  const rep = repeatPairs.map((r) => ({ ...r, orig: cell.get(`${r.unit}|${r.arm}|${judgeSlot(r.jid)}`) })).filter((r) => r.orig);
  report.repeats = { pairs: rep.length, agree_real: rep.filter((r) => realDefect(r.v) === realDefect(r.orig)).length };
  report.decision = decide(report);
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, plants: { ...report.plants, rows: undefined } }, null, 2));
}

/** The pre-registered reading (PREREGISTRATION-seam-ab-markers.md), on the consensus ("both") flag. */
function decide(report) {
  const pb = report.strata.pagebreak, ctl = report.strata.control;
  const n = (arm) => pb.arms[arm].real_both;
  const noise = Math.abs(n('A2') - n('A'));
  const P = pb.paired.both;
  const markersFixLite = n('B') < n('A') && (n('A') - n('B')) > noise && P.B_vs_A.p_one_sided_x_lower < 0.10;
  const flashBeyondMarkers = n('C') < n('B') && (n('B') - n('C')) > noise && P.C_vs_B.p_one_sided_x_lower < 0.10;
  const flashBeatsA = n('C') < n('A') && (n('A') - n('C')) > noise && P.C_vs_A.p_one_sided_x_lower < 0.10;
  const cn = (arm) => ctl.arms[arm].real_both;
  const cnoise = Math.abs(cn('A2') - cn('A'));
  const guard = { B: cn('B') - cn('A') <= Math.max(1, cnoise), C: cn('C') - cn('A') <= Math.max(1, cnoise) };
  const plantsOk = report.plants.n ? report.plants.caught / report.plants.n : null;
  let answer;
  if (markersFixLite && !flashBeyondMarkers) answer = 'FORCING';
  else if (markersFixLite && flashBeyondMarkers) answer = 'BOTH';
  else if (!markersFixLite && flashBeatsA) answer = 'MODEL';
  else answer = 'UNRESOLVED';
  return { counts: Object.fromEntries(ARMS.map((a) => [a, n(a)])), noise, markersFixLite, flashBeyondMarkers, flashBeatsA, control_counts: Object.fromEntries(ARMS.map((a) => [a, cn(a)])), control_guard: guard, plants_caught_share: plantsOk, answer };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = ['draw', 'pin', 'submit', 'collect', 'packets', 'score'].find(has);
  if (!phase) { console.error('pass one of --draw --pin --submit --collect --packets --score'); process.exit(1); }
  await ({ draw: phaseDraw, pin: phasePin, submit: phaseSubmit, collect: phaseCollect, packets: phasePackets, score: phaseScore })[phase]();
}

#!/usr/bin/env node
// PRIOR ART: scripts/eval/fraktur-paired-7835/judge.mjs (runQueue: the pace guard, the call budget, resume from the
// verdict file; the wrong-page and planted controls), restated because its items come from its own frame files. The
// instrument is the same: correction-pass-7818 lib.mjs judgeAbsolute = route-judge-6740 judgePrompt, unchanged, Opus
// via claude -p, the page image in the workspace.
/**
 * The judging of #7866 (experiment file §Judge). Blind: one stored text a call with the page image; the judge is not
 * told the book's stratum, route or score. Nothing here writes to Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/confidence-7866/judge.mjs items
 *   ... judge.mjs main        every drawn page once (queue order makeRng(SEED.queue))
 *   ... judge.mjs controls    wrong-page (2 per stratum) and planted (3 per stratum)
 *   ... judge.mjs gemini      the SECONDARY judge (Derek, 2026-10-31): agy gemini-3.8-flash-low, the same judgePrompt, on
 *                             every item and every control text Opus judged; agy concurrency 2; stops when the agy Gemini
 *                             pool reads empty on /quota. Never enters a primary outcome, a bad-book call or containment.
 *   ... judge.mjs argon       Amendment 1 (2026-11-01, Derek's #7866 default): the same stage with agy gemini-4-argon-low on
 *                             the same 820 texts → verdicts-argon.jsonl. Needs AGY_ALLOW_HEAVY=7866 and a box cap that
 *                             holds the run (AGY_HEAVY_BOX_CAP / AGY_HEAVY_DAILY_CAP ≥ 900, this job only) and an agy
 *                             login that may run Argon (not /root/.agy-james, which is held to 3.8 Flash low).
 *   [--max-calls=N] [--concurrency=3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, J, W, sha, jsonl, SEED, mulberry32, shuffle, makeRng, arg, judgeAbsolute, paceCheck } from './lib.mjs';
import { judgeAgy } from '../correction-pass-7818/lib.mjs';
import { agyQuota, AGY_GEMINI_EMPTY } from '../../lib/agy-cli.mjs';
import { plantError, scorePlant, ERROR_KINDS, langCode } from '../lib/plant-ocr-errors.mjs';

const VO = path.join(OUT, 'verdicts-opus.jsonl'), VG = path.join(OUT, 'verdicts-gemini.jsonl'), VA = path.join(OUT, 'verdicts-argon.jsonl');
export const GEMINI_MODEL = 'gemini-3.8-flash-low';
export const ARGON_MODEL = 'gemini-4-argon-low';
const ctlFile = (id) => path.join(OUT, 'controls', `${id}.txt`);
const saveCtl = (id, t) => { fs.mkdirSync(path.dirname(ctlFile(id)), { recursive: true }); fs.writeFileSync(ctlFile(id), t); };
export const CALL_BUDGET = 900;
const text = (pageId) => fs.readFileSync(path.join(OUT, 'texts', `${pageId}.txt`), 'utf8');

/** Fetch an image once into OUT/img/<page>.jpg (the same bytes for every call on a page). */
/** Files over this are resized (long edge RESIZE_PX, JPEG q90) once, before either judge sees them (prereg §4). */
export const MAX_IMAGE_BYTES = 4e6, RESIZE_PX = 3000;
async function imageFor(pageId, url) {
  const f = path.join(OUT, 'img', `${pageId}.jpg`);
  let buf = fs.existsSync(f) ? fs.readFileSync(f) : null;
  if (!buf) {
    const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7866 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60e3) });
    if (!r.ok) throw new Error(`image HTTP ${r.status} ${url.slice(0, 100)}`);
    buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    const { default: sharp } = await import('sharp');
    fs.renameSync(f, `${f}.orig`);
    buf = await sharp(buf).resize(RESIZE_PX, RESIZE_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    fs.writeFileSync(f, buf);
  }
  return buf;
}

function items() {
  const out = [];
  for (const b of J('draw.json').drawn) for (const p of b.pages) {
    const t = text(p.page_id);
    out.push({ id: `j${sha(`${p.page_id}:${sha(t.trim())}`).slice(0, 12)}`, book: b.id, stratum: b.stratum, lang: b.language, page: p.page_id, page_number: p.page_number, fifth: p.fifth, image: p.image, text_sha: sha(t.trim()).slice(0, 16) });
  }
  W('items.json', out);
  const t = {}; for (const i of out) t[i.stratum] = (t[i.stratum] ?? 0) + 1;
  console.log(`items: ${out.length} ${JSON.stringify(t)}`);
}

const made = (r) => r.verdict || r.usage;
const callsSoFar = () => jsonl(VO).filter(made).length;
async function runQueue(jobs) {
  const limits = await import('../../lib/model-limits.mjs');
  const state = {};
  const max = Math.min(Number(arg('max-calls') ?? Infinity), CALL_BUDGET - callsSoFar());
  let calls = 0, stop = null, i = 0;
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop && i < jobs.length) {
      if (calls >= max) { stop = `call budget (${CALL_BUDGET} for the study; ${max} this run)`; break; }
      const why = await paceCheck(limits, state);
      if (why) { stop = why; break; }
      if (i >= jobs.length) break;   // another worker took the last job while this one waited on the meter
      const job = jobs[i++]; calls++;
      let rec;
      try { rec = await job(); } catch (e) { rec = { id: job.id, err: String(e.message || e).slice(0, 200) }; calls--; }
      if (!rec) { calls--; continue; }
      if (rec.cls === 'quota') { limits.noteLimitHit('claude', { reason: String(rec.raw || '').slice(0, 200) }); stop = 'quota reply'; break; }
      fs.appendFileSync(VO, JSON.stringify({ ...rec, at: new Date().toISOString() }) + '\n');
      console.log(`  ${rec.set ?? ''} ${rec.id}: ${rec.verdict ? `accept=${rec.verdict.accept} f${rec.verdict.fidelity} d${(rec.verdict.defects || []).length}` : rec.err ? `ERR ${rec.err}` : 'unparsed'}`);
    }
  }));
  console.log(`${calls} calls; ${stop ? `STOPPED: ${stop}` : 'queue done'}; meter ${JSON.stringify(state.meter ?? null)}`);
  return stop;
}
const absJob = (it, set, extra = {}) => Object.assign(async () => {
  const img = await imageFor(it.page, it.image);
  const r = await judgeAbsolute({ lang: it.lang, text: extra.text ?? text(it.page) }, img);
  return { id: it.id, set, book: it.book, stratum: it.stratum, page: it.page, ...extra.meta, ...r };
}, { id: extra.meta?.id ?? it.id });

async function main() {
  const rows = jsonl(VO).filter((r) => r.set === 'abs');
  const have = new Set(rows.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of rows) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  // An item whose reply did not parse is judged again, at most 3 times in all; an image that will not fetch is counted.
  const todo = shuffle(J('items.json').filter((i) => !have.has(i.id) && (tries.get(i.id) ?? 0) < 3), makeRng(SEED.queue));
  console.log(`main: ${todo.length} items to judge`);
  await runQueue(todo.map((it) => absJob(it, 'abs')));
}

async function controls() {
  const its = J('items.json'), have = jsonl(VO);
  const jobs = [];
  const rnd = mulberry32(SEED.wrongPage);
  const v1 = new Map(have.filter((r) => r.set === 'abs' && r.verdict).map((r) => [r.id, r]));
  for (const s of ['high', 'middle', 'low', 'unmeasured']) {
    // Wrong-page: this page's image with another book's text, same stratum and language; two per stratum.
    const pool = shuffle(its.filter((i) => i.stratum === s && v1.has(i.id)).sort((a, b) => (a.id < b.id ? -1 : 1)), rnd);
    let k = 0;
    for (const a of pool) {
      if (k >= 2) break;
      const b = pool.find((x) => x.book !== a.book && x.lang === a.lang && text(x.page).trim().length > 200);
      if (!b) continue;
      k++;
      const id = `wp${sha(`${a.id}:${b.id}`).slice(0, 10)}`;
      saveCtl(id, text(b.page));
      if (have.some((r) => r.id === id && r.verdict)) continue;
      jobs.push(absJob(a, 'wrong_page', { text: text(b.page), meta: { id, other_page: b.page } }));
    }
    // Planted: accepted texts, one error each (B, C, D, E rotating), 3 per stratum.
    const acc = shuffle(its.filter((i) => i.stratum === s && v1.get(i.id)?.verdict.accept).sort((a, b) => (a.id < b.id ? -1 : 1)), makeRng(SEED.planted + ['high', 'middle', 'low', 'unmeasured'].indexOf(s)));
    let slot = 0;
    for (const it of acc) {
      if (slot >= 3) break;
      const kind = ERROR_KINDS[slot % ERROR_KINDS.length];
      const lc = langCode(it.lang); if (!lc) continue;
      let pl = null; try { pl = plantError(text(it.page), { kind, lang: lc, seed: SEED.planted + slot }); } catch { pl = null; }
      if (!pl) continue;
      slot++;
      const id = `pl${sha(`${it.id}:${kind}`).slice(0, 10)}`;
      saveCtl(id, pl.text);
      if (have.some((r) => r.id === id && r.verdict)) continue;
      jobs.push(Object.assign(async () => { const rec = await absJob(it, 'planted', { text: pl.text, meta: { id, plant: pl.plant, planted_from: it.id } })(); return { ...rec, catch: rec.verdict ? scorePlant(rec.verdict, pl.plant) : null }; }, { id }));
    }
  }
  console.log(`controls: ${jobs.length} calls`);
  await runQueue(jobs);
}

/** The secondary judge: every Opus-judged text (items and controls) once through agy, blind, 2 at a time. */
async function gemini({ file = VG, model = GEMINI_MODEL } = {}) {
  const opus = jsonl(VO).filter((r) => r.verdict), have = new Set(jsonl(file).filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of jsonl(file)) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const its = new Map(J('items.json').map((i) => [i.id, i]));
  const todo = shuffle(opus.filter((r) => !have.has(r.id) && (tries.get(r.id) ?? 0) < 2).sort((a, b) => (a.id < b.id ? -1 : 1)), makeRng(SEED.geminiQueue));
  console.log(`${model}: ${todo.length} texts to judge`);
  const max = Number(arg('max-calls') ?? Infinity);
  let i = 0, calls = 0, stop = null, qAt = 0;
  const quotaOk = () => {
    if (Date.now() - qAt < 10 * 60e3) return null; qAt = Date.now();
    const q = agyQuota();
    if (!q) return 'agy /quota unreadable: fail closed';
    if (!(q.gemini.weekly >= AGY_GEMINI_EMPTY) || !(q.gemini.h5 == null || q.gemini.h5 >= AGY_GEMINI_EMPTY)) return `agy Gemini pool empty (weekly ${q.gemini.weekly}, 5h ${q.gemini.h5})`;
    return null;
  };
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (!stop && i < todo.length && calls < max) {
      const why = quotaOk(); if (why) { stop = why; break; }
      const r = todo[i++]; calls++;
      const it = its.get(r.set === 'abs' ? r.id : r.planted_from) ?? [...its.values()].find((x) => x.page === r.page);
      const t = r.set === 'abs' ? text(r.page) : fs.existsSync(ctlFile(r.id)) ? fs.readFileSync(ctlFile(r.id), 'utf8') : null;
      if (t == null || !it) { console.log(`  ${r.id}: no text for the control, skipped`); continue; }
      let g;
      try { g = await judgeAgy({ lang: it.lang, text: t }, await imageFor(r.page, it.image), { model }); } catch (e) { g = { verdict: null, err: String(e.message || e).slice(0, 200) }; }
      if (g.quota) { stop = `agy quota (${g.err})`; break; }
      const rec = { id: r.id, set: r.set, book: r.book, stratum: r.stratum, page: r.page, judge: 'agy', ...g, at: new Date().toISOString() };
      if (r.set === 'planted' && g.verdict) rec.catch = scorePlant(g.verdict, r.plant);
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
      console.log(`  ${model} ${r.set} ${r.id}: ${g.verdict ? `accept=${g.verdict.accept} f${g.verdict.fidelity}` : g.err ? `ERR ${g.err}` : 'unparsed'}`);
    }
  }));
  console.log(`${calls} agy judge texts; ${stop ? `STOPPED: ${stop}` : 'queue done'}`);
}

/** Fetch (and resize) every item's image once, before any judge call. */
async function images() { let n = 0; for (const it of J('items.json')) { await imageFor(it.page, it.image); n++; } console.log(`images: ${n} ready; resized ${fs.readdirSync(path.join(OUT, 'img')).filter((x) => x.endsWith('.orig')).length}`); }

/** Amendment 1: Argon on the same texts, the same prompt and image, blind; refuses to start without the heavy-model
 *  permission and an account that may run it, so a misplaced run stops before its first call. */
async function argon() {
  if (!process.env.AGY_ALLOW_HEAVY) { console.error('argon: AGY_ALLOW_HEAVY is not set (agy-guard refuses Argon without it)'); process.exit(2); }
  if (/agy-james/.test(process.env.AGY_HOME || '')) { console.error('argon: /root/.agy-james is held to gemini-3.8-flash-low'); process.exit(2); }
  await gemini({ file: VA, model: ARGON_MODEL });
}

const stages = { items, images, main, controls, gemini: () => gemini(), argon };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();

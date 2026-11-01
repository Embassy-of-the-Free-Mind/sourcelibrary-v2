#!/usr/bin/env node
// PRIOR ART: scripts/eval/queue-routes-7853/judge.mjs (items deduplicated by text a page, runQueue with the pace guard,
// the call budget and resume from the verdict file, wrong-page and planted controls; restated over this study's arms,
// one language and no tiers). The instrument is unchanged: judgeAbsolute = route-judge-6740 judgePrompt, Opus via
// claude -p, the page image attached. The wrong-page control is cheap-routes-7701's (this image, another book's text of
// the SAME arm), so each arm's control is its own.
/**
 * The judging of the Latin first-read paired test (experiment file §Judge). Blind: one text a call with the page image;
 * a text identical to one already queued for the page is judged once and stands for every arm that wrote it. Nothing
 * here writes to Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/latin-paired-6740/judge.mjs items
 *   ... judge.mjs main [--max-calls=N] [--concurrency=3]
 *   ... judge.mjs controls
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, J, W, sha, jsonl, SEED, mulberry32, shuffle, makeRng, arg, imageFor, judgeAbsolute, paceCheck, ARMS } from './lib.mjs';
import { plantError, scorePlant, ERROR_KINDS } from '../lib/plant-ocr-errors.mjs';

const VO = path.join(OUT, 'verdicts-opus.jsonl');
/** Opus calls for the whole study (items, controls, re-judged unparsed replies), counted from the verdict file. */
export const CALL_BUDGET = 220;
/** Planted controls (on accepted texts, kinds rotating) and wrong-page controls a route arm. */
export const N_PLANTED = 5, N_WRONG_PAGE = 2;
const tf = (key, arm) => path.join(OUT, 'texts', `${key}.${arm}.txt`);
const text = (f) => fs.readFileSync(path.join(OUT, 'texts', f), 'utf8');

/** One item per distinct written text a page (a page an arm did not write has no item for that arm). */
function items() {
  const out = [];
  for (const s of J('selected.json').selected) {
    const byHash = new Map();
    for (const arm of ARMS) {
      if (!fs.existsSync(tf(s.key, arm))) continue;
      const t = fs.readFileSync(tf(s.key, arm), 'utf8').trim(); if (!t) continue;
      const h = sha(t).slice(0, 16);
      if (byHash.has(h)) { byHash.get(h).arms.push(arm); continue; }
      byHash.set(h, { id: `l${sha(`${s.key}:${h}`).slice(0, 12)}`, face: s.face, stratum: s.stratum, page: s.page_id, book: s.book_id, key: s.key, arms: [arm], text_file: `${s.key}.${arm}.txt`, text_sha: h, image: s.image });
    }
    out.push(...byHash.values());
  }
  W('items.json', out);
  console.log(`items: ${out.length} on ${new Set(out.map((i) => i.page)).size} pages`);
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
      if (why) { stop = `pace: ${why}`; break; }
      const job = jobs[i++]; calls++;
      const rec = await job();
      if (!rec) { calls--; continue; }
      if (rec.cls === 'quota') { limits.noteLimitHit('claude', { reason: String(rec.raw || '').slice(0, 200) }); stop = 'quota reply'; break; }
      fs.appendFileSync(VO, JSON.stringify({ ...rec, at: new Date().toISOString() }) + '\n');
      console.log(`  ${rec.set} ${rec.id}: ${rec.verdict ? `accept=${rec.verdict.accept} f${rec.verdict.fidelity}` : 'unparsed'}`);
    }
  }));
  console.log(`${calls} calls; ${stop ? `STOPPED: ${stop}` : 'queue done'}; meter ${JSON.stringify(state.meter ?? null)}`);
  fs.writeFileSync(path.join(OUT, 'judge-last-stop.json'), JSON.stringify({ at: new Date().toISOString(), stop, meter: state.meter ?? null }));
  return stop;
}
const absJob = (it, set, extra = {}) => async () => {
  const img = await imageFor(it.key, it.image);
  const r = await judgeAbsolute({ lang: 'Latin', text: extra.text ?? text(it.text_file) }, img);
  return { id: it.id, set, face: it.face, page: it.page, key: it.key, arms: it.arms, ...extra.meta, ...r };
};

async function main() {
  const have = new Set(jsonl(VO).filter((r) => r.set === 'abs' && r.verdict).map((r) => r.id));
  const all = J('items.json').filter((i) => !have.has(i.id));
  // one queue order for the study: makeRng(SEED.queue) over the items sorted by id
  const todo = shuffle(all.sort((a, b) => (a.id < b.id ? -1 : 1)), makeRng(SEED.queue));
  console.log(`main: ${todo.length} items to judge`);
  await runQueue(todo.map((it) => absJob(it, 'abs')));
}

/** Wrong-page: N_WRONG_PAGE per arm (this page's image, another book's written text of the same arm); planted: N_PLANTED on accepted texts. */
async function controls() {
  const its = J('items.json'), have = jsonl(VO);
  const jobs = [];
  const rnd = mulberry32(SEED.wrongPage);
  for (const arm of ARMS) {
    const pool = shuffle(its.filter((i) => i.arms.includes(arm)).sort((a, b) => (a.id < b.id ? -1 : 1)), rnd);
    for (let k = 0, j = 0; k < N_WRONG_PAGE && j + 1 < pool.length; j += 2) {
      const a = pool[j], b = pool[j + 1]; if (a.book === b.book) continue;
      k++;
      const id = `wp${sha(`${arm}:${a.id}:${b.id}`).slice(0, 10)}`;
      if (have.some((r) => r.id === id && r.verdict)) continue;
      jobs.push(absJob(a, 'wrong_page', { text: text(b.text_file), meta: { id, arm, other_page: b.page } }));
    }
  }
  const v1 = new Map(have.filter((r) => r.set === 'abs' && r.verdict).map((r) => [r.id, r]));
  const pool = shuffle(its.filter((i) => v1.get(i.id)?.verdict.accept).sort((a, b) => (a.id < b.id ? -1 : 1)), makeRng(SEED.planted));
  let slot = 0;
  for (const it of pool) {
    if (slot >= N_PLANTED) break;
    const kind = ERROR_KINDS[slot % ERROR_KINDS.length];
    const pl = plantError(text(it.text_file), { kind, lang: 'Latin', seed: SEED.planted + slot });
    if (!pl) continue;
    slot++;
    const id = `pl${sha(`${it.id}:${kind}`).slice(0, 10)}`;
    if (have.some((r) => r.id === id && r.verdict)) continue;
    jobs.push(async () => { const rec = await absJob(it, 'planted', { text: pl.text, meta: { id, plant: pl.plant, planted_from: it.id } })(); return { ...rec, catch: rec.verdict ? scorePlant(rec.verdict, pl.plant) : null }; });
  }
  console.log(`controls: ${jobs.length} calls`);
  await runQueue(jobs);
}

const stages = { items, main, controls };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();

#!/usr/bin/env node
// PRIOR ART: scripts/eval/correction-pass-7818/judge.mjs (runQueue: the pace guard, the call budget, resume from the
// verdict file; the wrong-page and planted controls), restated here because its items come from its own frame files.
// The instrument is the same: lib.mjs judgeAbsolute = route-judge-6740 judgePrompt, unchanged, Opus via claude -p.
/**
 * The judging of #7835 (experiment file §Judging). Blind: one text a call with the page image; a text identical to one
 * already queued for the page is judged once and stands for every arm that served it. Nothing here writes to Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fraktur-paired-7835/judge.mjs items
 *   ... judge.mjs main [--set=t1|t2|t3]     every item once
 *   ... judge.mjs controls                  wrong-page (2 per stratum) and planted (4 per test, T1–T3)
 *   ... judge.mjs t4check                   Opus tags 30 of T4's tagged pages (face, blind to the agy tag)
 *   [--max-calls=N] [--concurrency=3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, J, W, sha, jsonl, SEED, mulberry32, shuffle, makeRng, arg, imageFor, judgeAbsolute, paceCheck, opusFace, ARMS } from './lib.mjs';
import { plantError, scorePlant, ERROR_KINDS } from '../lib/plant-ocr-errors.mjs';

const VO = path.join(OUT, 'verdicts-opus.jsonl'), VT = path.join(OUT, 't4', 'opus-check.jsonl');
export const CALL_BUDGET = 600;
const tf = (key, arm) => path.join(OUT, 'texts', `${key}.${arm}.txt`);
const text = (f) => fs.readFileSync(path.join(OUT, 'texts', f), 'utf8');

function items() {
  const out = [];
  for (const set of ['t1', 't2', 't3']) {
    if (!fs.existsSync(path.join(OUT, set, 'selected.json'))) continue;
    for (const s of J(`${set}/selected.json`).selected) {
      const byHash = new Map();
      for (const arm of ARMS[set]) {
        if (!fs.existsSync(tf(s.key, arm))) continue;
        const t = fs.readFileSync(tf(s.key, arm), 'utf8').trim(); if (!t) continue;
        const h = sha(t).slice(0, 16);
        if (byHash.has(h)) { byHash.get(h).arms.push(arm); continue; }
        byHash.set(h, { id: `j${sha(`${s.key}:${h}`).slice(0, 12)}`, set, face: s.face, page: s.page_id, key: s.key, arms: [arm], text_file: `${s.key}.${arm}.txt`, text_sha: h, image: s.image });
      }
      out.push(...byHash.values());
    }
  }
  W('items.json', out);
  const t = {}; for (const i of out) { const k = `${i.set}/${i.face}`; t[k] = (t[k] ?? 0) + 1; }
  console.log(`items: ${out.length} ${JSON.stringify(t)}`);
}

const made = (r) => r.verdict || r.tag || r.usage;
const callsSoFar = () => jsonl(VO).filter(made).length + jsonl(VT).filter(made).length;
async function runQueue(jobs, file) {
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
      const job = jobs[i++]; calls++;
      const rec = await job();
      if (!rec) { calls--; continue; }
      if (rec.cls === 'quota') { limits.noteLimitHit('claude', { reason: String(rec.raw || '').slice(0, 200) }); stop = 'quota reply'; break; }
      fs.appendFileSync(file, JSON.stringify({ ...rec, at: new Date().toISOString() }) + '\n');
      console.log(`  ${rec.set ?? ''} ${rec.id ?? rec.key}: ${rec.verdict ? `accept=${rec.verdict.accept} f${rec.verdict.fidelity}` : rec.tag ? rec.tag.face : 'unparsed'}`);
    }
  }));
  console.log(`${calls} calls; ${stop ? `STOPPED: ${stop}` : 'queue done'}; meter ${JSON.stringify(state.meter ?? null)}`);
  return stop;
}
const absJob = (it, set, extra = {}) => async () => {
  const img = await imageFor(it.key, it.image);
  const r = await judgeAbsolute({ lang: 'German', text: extra.text ?? text(it.text_file) }, img);
  return { id: it.id, set, test: it.set, face: it.face, page: it.page, key: it.key, arms: it.arms, ...extra.meta, ...r };
};

async function main() {
  const set = arg('set');
  const have = new Set(jsonl(VO).filter((r) => r.set === 'abs' && r.verdict).map((r) => r.id));
  const todo = shuffle(J('items.json').filter((i) => (!set || i.set === set) && !have.has(i.id)), makeRng(SEED.queue));
  console.log(`main${set ? ` ${set}` : ''}: ${todo.length} items to judge`);
  await runQueue(todo.map((it) => absJob(it, 'abs')), VO);
}

async function controls() {
  const its = J('items.json'), have = jsonl(VO);
  const jobs = [];
  const rnd = mulberry32(SEED.wrongPage);
  // Wrong-page: this page's image with another book's text, same test and face; two per stratum.
  for (const [set, face] of [['t1', 'fraktur'], ['t1', 'antiqua'], ['t2', 'fraktur'], ['t3', null]]) {
    const pool = shuffle(its.filter((i) => i.set === set && (!face || i.face === face)).sort((a, b) => (a.id < b.id ? -1 : 1)), rnd);
    for (let k = 0, j = 0; k < 2 && j + 1 < pool.length; j += 2) {
      const a = pool[j], b = pool[j + 1]; if (a.page === b.page) continue;
      k++;
      const id = `wp${sha(`${a.id}:${b.id}`).slice(0, 10)}`;
      if (have.some((r) => r.id === id && r.verdict)) continue;
      jobs.push(absJob(a, 'wrong_page', { text: text(b.text_file), meta: { id, other_page: b.page } }));
    }
  }
  // Planted: accepted texts (abs), one error each (B, C, D, E rotating), 4 per test.
  const v1 = new Map(have.filter((r) => r.set === 'abs' && r.verdict).map((r) => [r.id, r]));
  for (const [n, set] of ['t1', 't2', 't3'].entries()) {
    const pool = shuffle(its.filter((i) => i.set === set && v1.get(i.id)?.verdict.accept).sort((a, b) => (a.id < b.id ? -1 : 1)), makeRng(SEED.planted + n));
    let slot = 0;
    for (const it of pool) {
      if (slot >= 4) break;
      const kind = ERROR_KINDS[slot % ERROR_KINDS.length];
      const pl = plantError(text(it.text_file), { kind, lang: 'de', seed: SEED.planted + slot });
      if (!pl) continue;
      slot++;
      const id = `pl${sha(`${it.id}:${kind}`).slice(0, 10)}`;
      if (have.some((r) => r.id === id && r.verdict)) continue;
      jobs.push(async () => { const rec = await absJob(it, 'planted', { text: pl.text, meta: { id, plant: pl.plant, planted_from: it.id } })(); return { ...rec, catch: rec.verdict ? scorePlant(rec.verdict, pl.plant) : null }; });
    }
  }
  console.log(`controls: ${jobs.length} calls`);
  await runQueue(jobs, VO);
}

/** T4's check: 30 tagged pages drawn with mulberry32(SEED.t4check), Opus asked the same face question blind. */
async function t4check() {
  const C = J('t4/candidates.json').candidates, tags = new Map(jsonl(path.join(OUT, 't4', 'tags.jsonl')).filter((r) => r.tag).map((r) => [r.key, r]));
  const pick = shuffle(C.filter((c) => tags.has(c.key)).sort((a, b) => (a.key < b.key ? -1 : 1)), mulberry32(SEED.t4check)).slice(0, 30);
  W('t4/check-items.json', pick.map((c) => c.key));
  const have = new Set(jsonl(VT).filter((r) => r.tag).map((r) => r.key));
  await runQueue(pick.filter((c) => !have.has(c.key)).map((c) => async () => ({ key: c.key, ...(await opusFace(await imageFor(c.key, c.image))) })), VT);
}

const stages = { items, main, controls, t4check };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();

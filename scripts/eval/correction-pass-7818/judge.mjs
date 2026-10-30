#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `judge` (its loop: one item a call, image in the workspace, the
// pace guard, resume from the verdict file) — reused through lib.mjs judgeAbsolute; it reads a route-judge packet,
// and this run's items come from two arms and need repeat (A-vs-A) and pairwise calls besides.
/**
 * The judging of #7818 (PREREGISTRATION §J). Every call is blind: one text (absolute) or two under X/Y (pairwise) with
 * the page image, Opus through `claude -p` on this box's subscription. Nothing here writes to Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/correction-pass-7818/judge.mjs items
 *   ... judge.mjs noise                 30 Arm P items judged twice (H3 floor); kappa printed before anything else
 *   ... judge.mjs main --arm=P|W        every absolute item once
 *   ... judge.mjs pairs --arm=P|W       pairwise, pages whose two texts differ
 *   ... judge.mjs controls              wrong-page (2 per language x arm) and planted (4 per language, Arm P)
 *   ... judge.mjs judge2 [--agy-home=DIR]   second judge, Gemini via agy (reported, never decisive)
 *   [--max-calls=N] [--concurrency=3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, J, W, sha, jsonl, SEED, mulberry32, shuffle, makeRng, arg, imageFor, judgeAbsolute, judgePair, judgeAgy, paceCheck } from './lib.mjs';
import { binaryAgreement, weightedKappa } from '../lib/agreement-stats.mjs';
import { plantError, scorePlant, ERROR_KINDS } from '../lib/plant-ocr-errors.mjs';

const VO = path.join(OUT, 'verdicts-opus.jsonl'), VP = path.join(OUT, 'pairs-opus.jsonl'), VG = path.join(OUT, 'verdicts-agy.jsonl');
export const CALL_BUDGET = 650;
const text = (f) => fs.readFileSync(path.join(OUT, 'texts', f), 'utf8');
const LANG = { de: 'German', fr: 'French' };

/** One item per distinct text on a page: draft and served, or `same` when the lane left the draft. */
function items() {
  const out = [];
  const add = (page, arm, lang, key, image) => {
    const d = text(`${key}.draft.txt`), s = text(`${key}.served.txt`);
    const mk = (role, t) => ({ id: `j${sha(`${arm}:${key}:${role}:${sha(t.trim())}`).slice(0, 12)}`, arm, lang, page, key, role, text_file: `${key}.${role === 'served' ? 'served' : 'draft'}.txt`, text_sha: sha(t.trim()).slice(0, 16), image });
    if (d.trim() === s.trim()) out.push(mk('same', d)); else out.push(mk('draft', d), mk('served', s));
  };
  for (const p of J('frame/frame.json').drawn) add(p.page_id, 'P', p.lang, `P-${p.page_id}`, p.image);
  const wsDone = jsonl(path.join(OUT, 'ws', 'corrections.jsonl')).filter((r) => !r.quota);
  const set = fs.existsSync(path.join(OUT, 'ws', 'set.json')) ? J('ws/set.json').kept : [];
  for (const r of wsDone) { const p = set.find((x) => x.slug === r.slug); if (p && fs.existsSync(path.join(OUT, 'texts', `W-${p.slug}.served.txt`))) add(p.slug, 'W', p.lang, `W-${p.slug}`, p.image_url); }
  W('items.json', out);
  const t = {}; for (const i of out) t[`${i.arm}/${i.lang}/${i.role}`] = (t[`${i.arm}/${i.lang}/${i.role}`] ?? 0) + 1;
  console.log(`items: ${out.length} ${JSON.stringify(t)}`);
}

const callsSoFar = () => jsonl(VO).filter((r) => r.cls !== 'skipped').length + jsonl(VP).length;
/** Run `jobs` (each an async fn returning a record or null) with the pace guard and the call budget. */
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
    }
  }));
  console.log(`${calls} calls; ${stop ? `STOPPED: ${stop}` : 'queue done'}; meter ${JSON.stringify(state.meter ?? null)}`);
  return stop;
}
const absJob = (it, set, rep, extra = {}) => async () => {
  const img = await imageFor(it.key, it.image);
  const r = await judgeAbsolute({ lang: LANG[it.lang], text: extra.text ?? text(it.text_file) }, img);
  return { id: it.id, set, rep, arm: it.arm, lang: it.lang, page: it.page, role: it.role, ...extra.meta, ...r };
};

async function noise() {
  const its = J('items.json').filter((i) => i.arm === 'P');
  const rnd = mulberry32(SEED.noise);
  const pick = ['de', 'fr'].flatMap((l) => shuffle(its.filter((i) => i.lang === l).sort((a, b) => (a.id < b.id ? -1 : 1)), rnd).slice(0, 15));
  W('noise-items.json', pick.map((i) => i.id));
  const have = jsonl(VO);
  const jobs = [];
  for (const it of pick) for (const rep of [1, 2]) if (!have.some((r) => r.id === it.id && r.set === 'abs' && r.rep === rep && r.verdict)) jobs.push(absJob(it, 'abs', rep));
  await runQueue(jobs, VO);
  const v = jsonl(VO).filter((r) => r.set === 'abs' && r.verdict);
  const pairs = pick.map((it) => [v.find((r) => r.id === it.id && r.rep === 1), v.find((r) => r.id === it.id && r.rep === 2)]).filter(([a, b]) => a && b);
  const acc = binaryAgreement(pairs.map(([a, b]) => [a.verdict.accept, b.verdict.accept]));
  const res = { n: pairs.length, accept: acc, accept_flips: pairs.filter(([a, b]) => a.verdict.accept !== b.verdict.accept).map(([a]) => a.id),
    fidelity_exact: pairs.filter(([a, b]) => Number(a.verdict.fidelity) === Number(b.verdict.fidelity)).length, fidelity_wkappa: pairs.length ? weightedKappa(pairs.map(([a, b]) => [Number(a.verdict.fidelity), Number(b.verdict.fidelity)])) : null,
    wrong_text_agree: pairs.filter(([a, b]) => (a.verdict.defects || []).some((d) => d.severity === 'wrong_text') === (b.verdict.defects || []).some((d) => d.severity === 'wrong_text')).length };
  W('noise.json', res);
  console.log(`H3 NOISE FLOOR: accept kappa ${acc.kappa?.toFixed(3)} (observed agreement ${acc.observed?.toFixed(3)}, n ${pairs.length}); fidelity weighted kappa ${res.fidelity_wkappa?.toFixed(3)}`);
}

async function main() {
  const arm = arg('arm');
  const have = new Set(jsonl(VO).filter((r) => r.set === 'abs' && r.rep === 1 && r.verdict).map((r) => r.id));
  const todo = shuffle(J('items.json').filter((i) => (!arm || i.arm === arm) && !have.has(i.id)), makeRng(SEED.queue));
  console.log(`main${arm ? ` arm ${arm}` : ''}: ${todo.length} items to judge`);
  await runQueue(todo.map((it) => absJob(it, 'abs', 1)), VO);
}

/** X/Y by mulberry32(SEED.pairs) drawn per page in page-id order; the key goes to OUT/pairs-key.json. */
async function pairs() {
  const arm = arg('arm');
  const its = J('items.json');
  const pages = [...new Set(its.filter((i) => i.role === 'served').map((i) => `${i.arm}|${i.key}`))].sort();
  const rnd = mulberry32(SEED.pairs), key = {};
  for (const k of pages) key[k] = rnd() < 0.5 ? 'X=served' : 'X=draft';
  W('pairs-key.json', key);
  const have = new Set(jsonl(VP).filter((r) => r.answer).map((r) => r.pair));
  const jobs = pages.filter((k) => (!arm || k.startsWith(`${arm}|`)) && !have.has(k)).map((k) => async () => {
    const d = its.find((i) => `${i.arm}|${i.key}` === k && i.role === 'draft'), s = its.find((i) => `${i.arm}|${i.key}` === k && i.role === 'served');
    const [x, y] = key[k] === 'X=served' ? [text(s.text_file), text(d.text_file)] : [text(d.text_file), text(s.text_file)];
    const r = await judgePair(LANG[s.lang], x, y, await imageFor(s.key, s.image));
    return { pair: k, arm: s.arm, lang: s.lang, page: s.page, ...r };
  });
  console.log(`pairs${arm ? ` arm ${arm}` : ''}: ${jobs.length} to judge`);
  await runQueue(shuffle(jobs, makeRng(SEED.queue + 1)), VP);
}

async function controls() {
  const its = J('items.json'), have = jsonl(VO);
  const jobs = [];
  // Wrong-page: this page's image, another book's served text, same arm and language; two per language x arm.
  const rnd = mulberry32(SEED.wrongPage);
  for (const arm of ['P', 'W']) for (const lang of ['de', 'fr']) {
    const pool = shuffle(its.filter((i) => i.arm === arm && i.lang === lang && i.role !== 'draft').sort((a, b) => (a.id < b.id ? -1 : 1)), rnd);
    for (let k = 0; k < 2 && pool.length >= 4; k++) {
      const a = pool[2 * k], b = pool[2 * k + 1];
      const id = `wp${sha(`${a.id}:${b.id}`).slice(0, 10)}`;
      if (have.some((r) => r.id === id && r.verdict)) continue;
      jobs.push(absJob(a, 'wrong_page', 1, { text: text(b.text_file), meta: { id, other_page: b.page } }));
    }
  }
  // Planted: Arm P served texts the judge accepted (rep 1), one error each (B, C, D, E rotating), 4 per language.
  const v1 = new Map(have.filter((r) => r.set === 'abs' && r.rep === 1 && r.verdict).map((r) => [r.id, r]));
  for (const lang of ['de', 'fr']) {
    const pool = shuffle(its.filter((i) => i.arm === 'P' && i.lang === lang && i.role !== 'draft' && v1.get(i.id)?.verdict.accept).sort((a, b) => (a.id < b.id ? -1 : 1)), makeRng(SEED.planted + (lang === 'de' ? 1 : 2)));
    let slot = 0;
    for (const it of pool) {
      if (slot >= 4) break;
      const kind = ERROR_KINDS[slot % ERROR_KINDS.length];
      const pl = plantError(text(it.text_file), { kind, lang, seed: SEED.planted + slot });
      if (!pl) continue;
      slot++;
      const id = `pl${sha(`${it.id}:${kind}`).slice(0, 10)}`;
      if (have.some((r) => r.id === id && r.verdict)) continue;
      jobs.push(async () => { const rec = await absJob(it, 'planted', 1, { text: pl.text, meta: { id, plant: pl.plant, planted_from: it.id } })(); return { ...rec, catch: rec.verdict ? scorePlant(rec.verdict, pl.plant) : null }; });
    }
  }
  console.log(`controls: ${jobs.length} calls`);
  await runQueue(jobs, VO);
}

/** Gemini (agy's default model) on every absolute item; reported only. */
async function judge2() {
  if (arg('agy-home')) process.env.AGY_HOME = path.resolve(arg('agy-home'));
  const its = J('items.json'), have = new Set(jsonl(VG).filter((r) => r.verdict).map((r) => r.id));
  const todo = shuffle(its.filter((i) => !have.has(i.id)), makeRng(SEED.queue + 2)).slice(0, Number(arg('max-calls') ?? Infinity));
  console.log(`judge2: ${todo.length} items`);
  let i = 0, stop = null;
  await Promise.all([0, 1, 2].map(async () => {
    while (!stop && i < todo.length) {
      const it = todo[i++];
      const r = await judgeAgy({ lang: LANG[it.lang], text: text(it.text_file) }, await imageFor(it.key, it.image));
      if (r.quota) { stop = `agy quota: ${r.err}`; break; }
      fs.appendFileSync(VG, JSON.stringify({ id: it.id, arm: it.arm, lang: it.lang, page: it.page, role: it.role, agy_home: process.env.AGY_HOME || null, ...r, at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id} ${it.arm}/${it.lang}/${it.role}: ${r.verdict ? `accept=${r.verdict.accept} ${r.verdict.fidelity}` : 'unparsed'}`);
    }
  }));
  if (stop) console.log(`STOPPED: ${stop}`);
}

const stages = { items, noise, main, pairs, controls, judge2 };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();

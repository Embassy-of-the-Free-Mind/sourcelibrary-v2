#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/judge.mjs `gemini` and scripts/eval/correction-pass-7818/judge.mjs `judge2` —
// the Gemini-through-agy second judge on the same judgePrompt and image (judgeAgy, imported unchanged). Neither reads a
// route-judge-6740 packet (packet.json + key.json): they read their own items files. This is the loop only.
/**
 * The second-family judge for the hebrew-flash3/manuscript cell test (v2#8632): on manuscripts the Opus judge fails its
 * self-preference check (rules.json judge_validity, ocr/manuscript), so an Opus-written route needs a judge of another
 * family (build.py judge_gate). Gemini 3.8 Flash-low through agy, the same judgePrompt with the image, blind, one output
 * a call, 2 at a time, on the packet items of the named routes (their items, controls and repeats).
 *
 *   AGY_HOME=/root/.agy-james node scripts/eval/hebrew-mss-cell-8632/judge2.mjs --out=DIR --routes=a,b [--max-calls=N]
 *
 * Writes DIR/verdicts-gemini.jsonl ({ id, judge: 'gemini', model, verdict }). Re-running skips items with a verdict. Stops
 * on the first quota reply, or when agy /quota reads the pool as empty (checked every 10 minutes; unreadable = stop).
 */
import fs from 'node:fs';
import path from 'node:path';
import { judgeAgy, imageFor } from '../correction-pass-7818/lib.mjs';
import { agyQuota, AGY_GEMINI_EMPTY } from '../../lib/agy-cli.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out'));
const routes = (arg('routes') || '').split(',').filter(Boolean);
const max = Number(arg('max-calls') ?? Infinity);
const MODEL = 'gemini-3.8-flash-low';
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const file = path.join(OUT, 'verdicts-gemini.jsonl');
const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const have = new Set(prior.filter((r) => r.verdict).map((r) => r.id));
const tries = new Map(); for (const r of prior) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);

const key = J('key.json');
const want = new Set(key.filter((k) => routes.includes(k.route)).map((k) => k.judged_as));
const items = J('packet.json').items.filter((it) => want.has(it.id) && !have.has(it.id) && (tries.get(it.id) ?? 0) < 2);
console.log(`${MODEL}: ${items.length} items to judge (routes ${routes.join(', ')}; AGY_HOME=${process.env.AGY_HOME || 'default'})`);

let i = 0, calls = 0, stop = null, qAt = 0;
const quotaOk = () => {
  if (Date.now() - qAt < 10 * 60e3) return null; qAt = Date.now();
  const q = agyQuota();
  if (!q) return 'agy /quota unreadable: fail closed';
  if (!(q.gemini.weekly >= AGY_GEMINI_EMPTY) || !(q.gemini.h5 == null || q.gemini.h5 >= AGY_GEMINI_EMPTY)) return `agy Gemini pool empty (weekly ${q.gemini.weekly}, 5h ${q.gemini.h5})`;
  return null;
};
await Promise.all(Array.from({ length: 2 }, async () => {
  while (!stop && i < items.length && calls < max) {
    const why = quotaOk(); if (why) { stop = why; break; }
    const it = items[i++]; calls++;
    let g;
    try {
      const img = it.image_file ? fs.readFileSync(it.image_file) : await imageFor(it.id, it.image_url);
      g = await judgeAgy({ lang: it.lang, text: it.text }, img, { model: MODEL });
    } catch (e) { g = { verdict: null, err: String(e.message || e).slice(0, 200) }; }
    if (g.quota) { stop = `agy quota (${g.err})`; break; }
    fs.appendFileSync(file, JSON.stringify({ id: it.id, judge: 'gemini', model: MODEL, agy_home: process.env.AGY_HOME || null, ...g, at: new Date().toISOString() }) + '\n');
    console.log(`  ${it.id}: ${g.verdict ? `accept=${g.verdict.accept} f${g.verdict.fidelity}` : g.err ? `ERR ${g.err}` : 'unparsed'}`);
  }
}));
console.log(`${calls} calls; ${stop ? `STOPPED: ${stop}` : 'queue done'}`);
if (stop) process.exit(3);

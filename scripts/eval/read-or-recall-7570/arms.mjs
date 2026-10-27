#!/usr/bin/env node
// PRIOR ART: scripts/eval/continuation-probe-7271/probe.mjs (one call per item per engine, no retry, resumable raw
// jsonl); this adds the two image arms and runs all three arms on the same sealed pages.
/**
 * arms.mjs — the three arms of #7570 on the sealed pairs, plus the positive controls, for one engine.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-or-recall-7570/arms.mjs --engine=opus|gemini [--script=latin] [--concurrency=4]
 *
 *   A  image + work named     B  image only     C  work named, no image (anchor + length)     P  positive controls
 * Calls are made in a seeded random order over (page × arm), so a drift in the model or the quota during the run falls
 * on every arm alike. One call each, no retry: a failure is recorded and scored as a failed read (accuracy 0).
 * Writes results/read-or-recall-7570/raw-<engine>.jsonl; resumes from the rows already there. Stops at 70% weekly
 * Claude usage (opus) or on an agy quota reply (gemini).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { call, fetchImage } from './calls.mjs';
import * as PR from './prompts.mjs';
import { claudeUsage } from '../../lib/model-limits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '../results/read-or-recall-7570');
const IMG = path.join(process.env.JOB_SCRATCH || '/tmp', 'img');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const ENGINE = arg('engine');
if (!['opus', 'gemini'].includes(ENGINE)) throw new Error('--engine=opus|gemini');
const CONC = Number(arg('concurrency', ENGINE === 'opus' ? 4 : 3));
const CLI = ENGINE === 'opus' ? 'claude' : 'agy';
const ONLY = arg('script'); // run one script's pairs (and its controls) as soon as that script is sealed
const WEEKLY_STOP = 70;

const sealed = JSON.parse(fs.readFileSync(path.join(RES, 'pairs.json'), 'utf8'));
const controls = JSON.parse(fs.readFileSync(path.join(RES, 'controls.json'), 'utf8')).items;
const OUT = path.join(RES, `raw-${ENGINE}.jsonl`);
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.cls !== 'quota' && r.cls !== 'usage_limit').map((r) => `${r.slug}|${r.arm}`) : []);
const h = (s) => crypto.createHash('sha256').update(`7570:${ENGINE}:${s}`).digest('hex');
const jobs = [];
for (const p of sealed.pages) if (!ONLY || p.script === ONLY) for (const arm of ['A', 'B', 'C']) jobs.push({ p, arm });
for (const c of controls) if (!ONLY || c.script === ONLY) jobs.push({ p: c, arm: 'P' });
const todo = jobs.filter((j) => !done.has(`${j.p.slug}|${j.arm}`)).sort((a, b) => h(`${a.p.slug}|${a.arm}`).localeCompare(h(`${b.p.slug}|${b.arm}`)));
console.log(`${ENGINE}: ${todo.length} of ${jobs.length} calls to make`);

let stop = null;
async function one({ p, arm }) {
  if (stop) return;
  if (ENGINE === 'opus') { const u = claudeUsage(); if (u?.weekly != null && u.weekly >= WEEKLY_STOP) { stop = `weekly ${u.weekly}% >= ${WEEKLY_STOP}%`; return; } }
  const w = { title: p.title, author: p.author, year: p.year };
  let prompt, image = null;
  if (arm === 'P') prompt = PR.P(p);
  else if (arm === 'C') prompt = PR.C(w, p.anchor, p.key_raw_chars);
  else {
    image = await fetchImage(p.image_url, p.image_id, IMG);
    if (image?.error) { stop = `image ${p.slug}: ${image.error}`; return; }
    prompt = arm === 'A' ? PR.A(CLI, w) : PR.B(CLI);
  }
  const r = await call({ engine: ENGINE, prompt, image });
  if (r.cls === 'quota' || r.cls === 'usage_limit') { stop = `${r.cls}: ${r.err}`; fs.appendFileSync(OUT, JSON.stringify({ slug: p.slug, arm, engine: ENGINE, cls: r.cls, err: r.err, at: new Date().toISOString() }) + '\n'); return; }
  const row = { slug: p.slug, arm, engine: ENGINE, model_ids: r.model_ids, at: new Date().toISOString(), prompt_sha: crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16),
    prompt: arm === 'C' || arm === 'P' ? prompt : undefined, text: r.text, problem: r.problem, cls: r.cls, err: r.err, secs: r.secs, usage: r.usage, tool_calls: r.tool_calls };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`${p.slug} ${arm} ${r.cls || 'ok'} ${r.secs}s ${[...String(r.text)].length}ch ${r.problem || ''}`);
}
const q = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !stop) await one(q.shift()); }));
console.log(stop ? `STOPPED: ${stop}` : 'done');

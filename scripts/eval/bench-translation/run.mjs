#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/run-arms.mjs (the lite Batch runner: submit, collect, cap, meter, external_eval
// registration) and scripts/eval/plain-6728/run-arm.mjs (agy -p / sealed claude -p, resumable, sleeps through limits,
// stops at the weekly meter) are the two runners; this only picks which one, which pages and which request file.
/**
 * run.mjs — one command per arm of the #7499 benchmark (see README). Outputs go to $W/arms/<engine>-<arm>.jsonl,
 * never to pages. W = $BENCH_W, else $JOB_SCRATCH/w (built by build.mjs).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/bench-translation/run.mjs \
 *        --engine lite|flash38|opus --arm v13|v13b|v20|plain [--batch 1|2] [--collect] [--cap-usd 8]
 *   node ... run.mjs --judge lite|flash38|opus          one judge call per item of $W/judge/<engine>/req.jsonl
 *
 * Pages: lite → all; flash38 / opus → the #6545 panel (batch 1) or the other pages (batch 2, opus only); v13b → the
 * floor pages (lite: all). Judges are cross-family: Gemini arms by Opus (claude -p), Opus arms by gemini-3.8-flash-high
 * (agy); BENCH_SAME_FAMILY=1 makes Opus judge the Opus arms (only when agy is locked; the write-up must say so).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = process.env.BENCH_W || `${process.env.JOB_SCRATCH}/w`;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ENGINE = arg('engine'), ARM = arg('arm'), JUDGE = arg('judge'), BATCH = Number(arg('batch', 1));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
const node = (script, args) => { const r = spawnSync(process.execPath, [path.join(HERE, '..', script), ...args], { stdio: 'inherit' }); process.exit(r.status ?? 1); };
const uidsFile = (name, pred) => { const f = path.join(W, `${name}-uids.txt`); fs.writeFileSync(f, manifest.pages.filter(pred).map((p) => p.id).join('\n') + '\n'); return f; };

if (JUDGE) {
  const sameFamily = process.env.BENCH_SAME_FAMILY === '1';
  const [engine, model] = JUDGE === 'opus' && !sameFamily ? ['agy', 'gemini-3.8-flash-high'] : ['claude', 'opus'];
  const dir = path.join(W, 'judge', JUDGE);
  node('plain-6728/run-arm.mjs', ['--requests', path.join(dir, 'req.jsonl'), '--out', path.join(dir, 'out.jsonl'), '--engine', engine, '--model', model, '--parallel', '3', '--tag', `judge-${JUDGE}`]);
}
if (!['lite', 'flash38', 'opus'].includes(ENGINE) || !['v13', 'v13b', 'v20', 'plain'].includes(ARM)) { console.error('usage: see header'); process.exit(2); }

if (ENGINE === 'lite') {
  const common = ['--work', W, '--endpoint', 'eval/bench-translation-7499', '--issue', '7499', '--cap-usd', arg('cap-usd', '8')];
  if (process.argv.includes('--collect')) node('pareto-6182/run-arms.mjs', [...common, '--collect', '--poll-minutes', arg('poll-minutes', '9')]);
  node('pareto-6182/run-arms.mjs', [...common, '--arm', `lite-${ARM}`, '--model', 'gemini-3.1-flash-lite', '--sets', ARM]);
}
if (BATCH === 2 && ENGINE !== 'opus') { console.error('batch 2 is Opus only (README)'); process.exit(2); }
const uids = ARM === 'v13b' ? uidsFile('floor', (p) => p.floor) : BATCH === 2 ? uidsFile('rest', (p) => !p.p6545) : uidsFile('p6545', (p) => p.p6545);
const [engine, model] = ENGINE === 'flash38' ? ['agy', 'gemini-3.8-flash-low'] : ['claude', 'opus'];
node('plain-6728/run-arm.mjs', ['--requests', path.join(W, 'req', `cli-${ARM === 'v13b' ? 'v13' : ARM}.jsonl`), '--out', path.join(W, 'arms', `${ENGINE}-${ARM}.jsonl`),
  '--engine', engine, '--model', model, '--parallel', '3', '--uids-file', uids, '--tag', `${ENGINE}-${ARM}`]);

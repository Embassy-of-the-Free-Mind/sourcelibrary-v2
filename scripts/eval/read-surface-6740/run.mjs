#!/usr/bin/env node
// #6740 read-surface: the Box-Behnken runs of the agy first read (experiment file
// scripts/eval/experiments/2026-10-30-read-surface-box-behnken-6740.md, its preregistration section).
//
// PRIOR ART: scripts/eval/route-judge-6740/german-cheaper-7701/run.mjs (read@4 vs read@8 through cli-ocr.mjs read on the
//   drawn page's block; judged by Opus, one setting changed at a time); scripts/eval/euro-gpu-correct-7567/drive.sh (runs
//   engines over a fixed panel). Neither varies image size or thinking, or plans a factorial design.
//
//   node run.mjs plan  --work=DIR                       DIR/runs.json: the 17 runs a language, phase, shuffled order
//   node --env-file=… run.mjs read --work=DIR --lang=de --run=B05 [--agy-home=/root/.agy-james] [--concurrency=4]
//   node --env-file=… run.mjs phase --work=DIR --phase=A|B [--langs=de,la] [--agy-home=…] [--parallel=2]
//   node --env-file=… run.mjs batch --work=DIR --runs=de:C1,la:C1 [--agy-home=…] [--parallel=3]   (Amendment 2: sequential batches)
// A run reads into DIR/runs/<lang>/<run>/ through cli-ocr.mjs read (--fresh, --image-cache, --no-alone at 4 and 8 a
// call). Re-running a run resumes it (cli-ocr skips pages already read). Writes no page or book.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const WORK = path.resolve(arg('work', '.'));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI_OCR = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const ENV = '/root/sourcelibrary/.env.production.local';

export const LEVELS = { ppc: [1, 4, 8], edge: [1024, 1600, 2400], think: ['low', 'medium', 'high'] };
// Box-Behnken for 3 factors: 12 edge midpoints + 3 centres; L1/L2 = the live setting (4 a call, served image, low).
export const DESIGN = [
  ['B01', -1, -1, 0], ['B02', 1, -1, 0], ['B03', -1, 1, 0], ['B04', 1, 1, 0],
  ['B05', -1, 0, -1], ['B06', 1, 0, -1], ['B07', -1, 0, 1], ['B08', 1, 0, 1],
  ['B09', 0, -1, -1], ['B10', 0, 1, -1], ['B11', 0, -1, 1], ['B12', 0, 1, 1],
  ['C1', 0, 0, 0], ['C2', 0, 0, 0], ['C3', 0, 0, 0],
  ['L1', 0, null, -1], ['L2', 0, null, -1],
].map(([id, x1, x2, x3]) => ({ id, x1, x2, x3, ppc: LEVELS.ppc[x1 + 1], edge: x2 === null ? null : LEVELS.edge[x2 + 1], think: LEVELS.think[x3 + 1], live: id.startsWith('L') }));
// Phase A: the James pool (held to flash-low): the low-thinking runs and L1. Phase B: the default pool, the rest.
export const phaseOf = (r) => (r.think === 'low' && r.id !== 'L2' ? 'A' : 'B');

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffle = (xs, r) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function plan() {
  const r = rng(6740);
  const runs = {};
  for (const lang of ['de', 'la']) runs[lang] = ['A', 'B'].flatMap((ph) => shuffle(DESIGN.filter((d) => phaseOf(d) === ph), r).map((d) => ({ ...d, phase: ph })));
  fs.writeFileSync(path.join(WORK, 'runs.json'), JSON.stringify({ planned_at: new Date().toISOString(), seed: 6740, levels: LEVELS, runs }, null, 1));
  for (const [lang, rs] of Object.entries(runs)) console.log(lang, rs.map((x) => `${x.phase}:${x.id}`).join(' '));
}

function pageIds(lang, run) {
  const panel = JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8'));
  const targets = panel.langs[lang].targets;
  return targets.flatMap((t) => (run.ppc === 1 ? [t.page_id] : run.ppc === 4 ? t.window4 : t.window8));
}

function readRun(lang, runId, { agyHome, concurrency = 4 } = {}) {
  const run = DESIGN.find((d) => d.id === runId);
  if (!run) throw new Error(`no run ${runId}`);
  const dir = path.join(WORK, 'runs', lang, runId);
  fs.mkdirSync(dir, { recursive: true });
  const idsFile = path.join(dir, 'page-ids.json');
  fs.writeFileSync(idsFile, JSON.stringify(pageIds(lang, run)));
  const args = ['--env-file=' + ENV, CLI_OCR, 'read', `--page-ids-file=${idsFile}`, `--out=${dir}`, `--model=gemini-3.8-flash-${run.think}`,
    `--per-call=${run.ppc}`, `--image-cache=${path.join(WORK, 'cache')}`, '--fresh', `--job=read-surface-6740-${lang}-${runId}`, `--concurrency=${concurrency}`, '--stop-on-quota',
    ...(run.edge ? [`--long-edge=${run.edge}`] : []), ...(run.ppc > 1 ? ['--no-alone'] : [])];
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ lang, ...run, agy_home: agyHome || 'default', started_at: new Date().toISOString(), argv: args.slice(1) }, null, 1));
  return new Promise((resolve) => {
    const log = fs.openSync(path.join(dir, 'read.log'), 'a');
    const env = { ...process.env, ...(agyHome ? { AGY_HOME: agyHome } : {}) };
    if (!agyHome) delete env.AGY_HOME;
    const p = spawn('node', args, { stdio: ['ignore', log, log], env, cwd: ROOT });
    p.on('exit', (code) => { fs.appendFileSync(path.join(dir, 'exits.jsonl'), JSON.stringify({ at: new Date().toISOString(), code }) + '\n'); resolve(code); });
  });
}

async function phase(ph, langs, opts, parallel) {
  const plan = JSON.parse(fs.readFileSync(path.join(WORK, 'runs.json'), 'utf8'));
  // Interleave the languages so both advance together; each run once (a finished run is skipped by its exit 0).
  const queue = [];
  const lists = langs.map((l) => plan.runs[l].filter((r) => r.phase === ph).map((r) => ({ lang: l, id: r.id })));
  for (let i = 0; i < Math.max(...lists.map((x) => x.length)); i++) for (const l of lists) if (l[i]) queue.push(l[i]);
  const done = (q) => { const f = path.join(WORK, 'runs', q.lang, q.id, 'exits.jsonl'); return fs.existsSync(f) && fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).some((l) => JSON.parse(l).code === 0); };
  const todo = queue.filter((q) => !done(q));
  console.log(`phase ${ph}: ${todo.length} runs to read (${queue.length - todo.length} done)`);
  let quota = false;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (todo.length && !quota) {
      const q = todo.shift();
      const t0 = Date.now();
      const code = await readRun(q.lang, q.id, opts);
      console.log(`${new Date().toISOString()} ${q.lang} ${q.id} exit ${code} (${Math.round((Date.now() - t0) / 1000)}s)`);
      if (code === 3) { quota = true; console.log('quota: stopping the phase'); }
    }
  }));
}

// batch (Amendment 2, sequential): named runs, e.g. --runs=de:C1,la:C1,de:L2, `parallel` at a time.
async function batch(list, opts, parallel) {
  const todo = list.split(',').map((x) => { const [lang, id] = x.split(':'); return { lang, id }; });
  let quota = false;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (todo.length && !quota) {
      const q = todo.shift(), t0 = Date.now();
      const code = await readRun(q.lang, q.id, opts);
      console.log(`${new Date().toISOString()} ${q.lang} ${q.id} exit ${code} (${Math.round((Date.now() - t0) / 1000)}s)`);
      if (code === 3) { quota = true; console.log('quota: stopping the batch'); }
    }
  }));
}

const MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);   // fit.mjs imports DESIGN
if (!MAIN) { /* imported */ } else if (STAGE === 'plan') plan();
else if (STAGE === 'batch') await batch(arg('runs'), { agyHome: arg('agy-home'), concurrency: Number(arg('concurrency', 4)) }, Number(arg('parallel', 3)));
else if (STAGE === 'read') process.exit(await readRun(arg('lang'), arg('run'), { agyHome: arg('agy-home'), concurrency: Number(arg('concurrency', 4)) }));
else if (STAGE === 'phase') await phase(arg('phase'), arg('langs', 'de,la').split(','), { agyHome: arg('agy-home'), concurrency: Number(arg('concurrency', 4)) }, Number(arg('parallel', 2)));
else if (STAGE) { console.error('usage: run.mjs plan|read|phase (see header)'); process.exit(2); }

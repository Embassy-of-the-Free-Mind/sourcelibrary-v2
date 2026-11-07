#!/usr/bin/env node
/**
 * Asks the panel of assistants with web tools and no connector. See README.md for the rule fixed before the run.
 * topic and work run twice per engine: the second pass is the A-vs-A noise floor.
 * Resumable: a (engine, id, rep) already in runs.jsonl is skipped. Raw event streams go in <out>/raw.
 *
 * Usage: node run.mjs <out-dir> [--engines=claude,agy] [--only=topic-0,work-0] [--reps=2] [--concurrency=3]
 *
 * PRIOR ART: scripts/eval/mcp-trigger-8154/run.mjs — same spawn loop, connector on and web off, the opposite condition.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { invokeEngine } from './engines.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flag = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt;
const OUT = resolve(process.argv[2]);
const ENGINES = flag('engines', 'claude,agy').split(',');
const ONLY = flag('only', '') ? new Set(flag('only', '').split(',')) : null;
const REPS = Number(flag('reps', '2'));
const CONCURRENCY = Number(flag('concurrency', '3'));
const REPEATED = new Set(['topic', 'work']);
const QUOTA = /usage limit|limit reached|quota reached|rate limit|not logged in/i;

mkdirSync(join(OUT, 'raw'), { recursive: true });
const LOG = join(OUT, 'runs.jsonl');
const done = new Set(existsSync(LOG)
  ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.engine}/${r.id}/${r.rep}`; })
  : []);

const { panel } = JSON.parse(readFileSync(join(HERE, 'panel.json'), 'utf8'));
const jobs = [];
for (const rep of Array.from({ length: REPS }, (_, i) => i)) {
  for (const item of panel) {
    if (ONLY && !ONLY.has(item.id)) continue;
    if (rep > 0 && !REPEATED.has(item.stratum)) continue;
    for (const engine of ENGINES) {
      if (!done.has(`${engine}/${item.id}/${rep}`)) jobs.push({ engine, rep, item });
    }
  }
}
console.log(`${jobs.length} runs to do, ${done.size} already done`);

let stopped = null;
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < jobs.length && !stopped) {
    const { engine, rep, item } = jobs[next++];
    const run = await invokeEngine(engine, item.q);
    const name = `${engine}-${item.id}-${rep}.jsonl`;
    if (run.code !== 0 && QUOTA.test(`${run.raw.slice(-2000)} ${run.err}`)) {
      stopped = `${engine} ${item.id}: ${run.err || run.raw.slice(-300)}`;
      break;
    }
    writeFileSync(join(OUT, 'raw', name), run.raw);
    appendFileSync(LOG, `${JSON.stringify({
      engine, id: item.id, stratum: item.stratum, rep, code: run.code, ms: run.ms,
      at: new Date().toISOString(), answer: run.answer, raw: name,
    })}\n`);
    console.log(engine, item.id, rep, `exit=${run.code}`, `${Math.round(run.ms / 1000)}s`, `answer=${run.answer.length}`);
  }
}));
console.log(stopped ? `STOPPED, limit reached, re-run to resume: ${stopped}` : 'DONE');

#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (an image-grounded Opus reader through claude -p); this one is
// blind to the work, classifies the page and transcribes it, and its text is the key wherever no e-text/by-eye one is.
/**
 * screen.mjs — the blind key read (#7570): Opus, image only, no work named (prompts.mjs KEY), one call per candidate.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-or-recall-7570/screen.mjs \
 *        [--famous=24] [--obscure=40] [--script=latin] [--concurrency=4]
 *
 * Takes the first N candidates of each pool in pools.json, in pool order, downloads each image once
 * ($JOB_SCRATCH/read-or-recall-7570/img/<page_id>.jpg), and appends one row per page to keys.jsonl: the parsed
 * SCRIPT/SHARE/KIND/PAGE lines and the transcription. Resumes: a page already in keys.jsonl is not called again.
 * Stops (and says so) when this account's weekly Claude usage reaches 70% (the brief's budget line).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { call, fetchImage } from './calls.mjs';
import { KEY } from './prompts.mjs';
import { claudeUsage } from '../../lib/model-limits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '../results/read-or-recall-7570');
const IMG = path.join(process.env.JOB_SCRATCH || '/tmp', 'img');
fs.mkdirSync(IMG, { recursive: true });
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const NF = Number(arg('famous', 24)), NO = Number(arg('obscure', 40)), CONC = Number(arg('concurrency', 4)), ONLY = arg('script');
export const WEEKLY_STOP = 70;

const pools = JSON.parse(fs.readFileSync(path.join(RES, 'pools.json'), 'utf8')).pools;
const OUT = path.join(RES, 'keys.jsonl');
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.cls || r.cls === 'image').map((r) => r.page_key) : []);
const todo = [];
for (const [script, p] of Object.entries(pools)) {
  if (ONLY && script !== ONLY) continue;
  for (const [side, n] of [['famous', NF], ['obscure', NO]]) for (const c of p[side].slice(0, n)) {
    const page_key = `${c.book_id}:${c.page_number}`;
    if (!done.has(page_key)) todo.push({ script, side, page_key, c });
  }
}
console.log(`${todo.length} key reads to make`);

export function parseKey(raw) {
  const head = String(raw || '').split('<<<BEGIN>>>')[0];
  const g = (k) => ((new RegExp(`^\\s*\\**${k}\\**\\s*:\\s*(.+)$`, 'mi').exec(head) || [])[1] || '').trim();
  return { script: g('SCRIPT'), share: Number((g('SHARE').match(/\d+/) || [])[0] ?? NaN), kind: g('KIND').toLowerCase(), page: g('PAGE').toLowerCase() };
}

let stop = null;
async function one(t) {
  if (stop) return;
  const u = claudeUsage();
  if (u?.weekly != null && u.weekly >= WEEKLY_STOP) { stop = `weekly ${u.weekly}% >= ${WEEKLY_STOP}%`; return; }
  const img = await fetchImage(t.c.image_url, t.c.page_id || t.page_key.replace(':', '-p'), IMG);
  const base = { script: t.script, side: t.side, page_key: t.page_key, book_id: t.c.book_id, page_number: t.c.page_number, at: new Date().toISOString() };
  if (img?.error) { fs.appendFileSync(OUT, JSON.stringify({ ...base, cls: 'image', err: img.error }) + '\n'); console.log(`${t.page_key} IMAGE ${img.error}`); return; }
  const r = await call({ engine: 'opus', prompt: KEY('claude'), image: img });
  if (r.cls === 'usage_limit') { stop = `usage limit: ${r.err}`; return; }
  const row = { ...base, ...parseKey(r.raw), text: r.text, problem: r.problem, cls: r.cls, err: r.err, secs: r.secs, usage: r.usage, model_ids: r.model_ids, raw_head: String(r.raw || '').split('<<<BEGIN>>>')[0].slice(0, 400) };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`${t.script}/${t.side} ${t.page_key} ${r.cls || 'ok'} ${r.secs}s ${row.script}/${row.share}/${row.kind}/${row.page} ${[...String(r.text)].length}ch`);
}
const q = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !stop) await one(q.shift()); }));
console.log(stop ? `STOPPED: ${stop}` : 'done');

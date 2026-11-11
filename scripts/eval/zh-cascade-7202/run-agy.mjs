#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate.mjs `read` (the production CLI translation call: gatedTextCall + TRANSLATE_SUFFIX
// from scripts/lib/agy-cli.mjs) — but it builds its prompt from the live DB and seeds each page with the previous page's
// English, so it cannot send #7202's prebuilt single-page units. scripts/eval/run-cli-arm.py is the Python copy of the call
// and has no translation markers. This sends the units through the SAME agy-cli.mjs call cli-translate.mjs uses.
/**
 * One Flash arm through the Gemini subscription CLI (`agy -p`, $0) over <work>/units.jsonl → <work>/arms/<arm>.jsonl.
 * Never the Gemini API, no fallback (#7202). Eval only, nothing written to the database.
 *
 *   AGY_JOB=zh-cascade-7202 node scripts/eval/zh-cascade-7202/run-agy.mjs --work $JOB_SCRATCH/work --arm flash \
 *        [--model gemini-3.8-flash-low] [--concurrency 2]
 *
 * Sends the unit's v13 prompt + TRANSLATE_SUFFIX (markers, no tools). A quota error stops the run (exit 3); a page that
 * came back empty, cut or wrapped is recorded with its reason and retried on the next run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gatedTextCall, TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { sanitizeTranslationTags } from '../../lib/translate-core.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const W = opt('work'); const ARM = opt('arm'); const MODEL = opt('model', 'gemini-3.8-flash-low'); const CONC = Number(opt('concurrency', 2));
if (!W || !ARM) { console.error('--work --arm required'); process.exit(1); }
process.env.AGY_JOB ||= 'zh-cascade-7202';
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const OUT = path.join(W, 'arms', `${ARM}.jsonl`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const tmp = path.join(W, 'agy-ws'); fs.mkdirSync(tmp, { recursive: true });
const done = new Set(jl(OUT).filter((r) => r.text).map((r) => r.uid));
const queue = jl(path.join(W, 'units.jsonl')).filter((u) => !done.has(u.uid));
console.log(`${ARM} (${MODEL} via agy): ${queue.length} to read`);
let quota = false, n = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length && !quota) {
    const u = queue.shift();
    const r = await gatedTextCall(u.prompt + TRANSLATE_SUFFIX, { model: MODEL, task: 'translate', tmp });
    if (r.cls === 'quota') { quota = true; console.log(`QUOTA at ${u.uid}: ${r.err}`); break; }
    const chatter = r.answer ? cliChatterReason(r.answer) : null;
    const ok = !r.cls && !r.problem && !chatter && r.answer.trim().length > 5;
    const row = { uid: u.uid, arm: ARM, model: MODEL, route: 'agy', text: ok ? sanitizeTranslationTags(r.answer.trim()) : '', raw: r.text, error: r.cls || r.problem || chatter || (ok ? null : 'empty'),
      calls: r.calls, secs: Math.round(r.secs), usage: r.usage, tool_calls: r.tool_calls, date: new Date().toISOString() };
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    n++;
    console.log(`  ${u.uid} ${row.error || 'ok'} ${row.text.length} chars ${row.secs}s`);
  }
}));
console.log(`${ARM}: ${n} calls this run`);
if (quota) process.exit(3);

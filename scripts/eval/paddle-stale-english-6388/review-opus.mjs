#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-zh-qa-6388/review-opus.mjs — the same `claude -p --model opus` subscription call (every
// ANTHROPIC_* variable removed so no API key can reach it, Read the only tool, one fresh process per call). That one sends
// one image per call; this sends a batch of up to 5 (the #6388 brief) and also runs the single-page adjudication calls.
//   node scripts/eval/paddle-stale-english-6388/review-opus.mjs --batches=$JOB_SCRATCH/opus-batches.json --arm=O [--parallel=3]
//   node scripts/eval/paddle-stale-english-6388/review-opus.mjs --batches=$JOB_SCRATCH/adj-batches.json --arm=ADJ --effort=high
// Out: reads/<arm>.jsonl, one row per call ({bid, qids, model, text, json, usage, api_equiv_usd, secs, error}).
// A call whose reply does not parse is retried on restart. Hard cap: --max-calls (default 30) counted over every arm's rows.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ARM = args.arm || 'O';
const OUT = path.join(HERE, 'reads', `${ARM}.jsonl`);
const WS = path.join(process.env.JOB_SCRATCH || '/tmp', 'opus-ws');
const MAX_CALLS = Number(args['max-calls'] || 30);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

export function parseJson(s) {
  const t = String(s || '').replace(/^```(?:json)?\s*|```\s*$/gm, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
const valid = (j, qids) => qids.length === 1 && j && typeof j.verdict === 'string' ? true
  : Array.isArray(j?.pages) && qids.every(q => j.pages.some(p => p.id === q && typeof p.verdict === 'string'));
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function runOne(b) {
  return new Promise(resolve => {
    const ws = path.join(WS, `${ARM}-${b.bid}`);
    fs.mkdirSync(ws, { recursive: true });
    b.qids.forEach((q, i) => fs.copyFileSync(b.images[i], path.join(ws, `${q}.jpg`)));
    const cli = ['-p', b.prompt, '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task', '--max-turns', String(b.qids.length + 4)];
    if (args.effort) cli.push('--effort', args.effort);
    const t0 = Date.now();
    const p = spawn('claude', cli, { cwd: ws, env: claudeEnv() });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 900000);
    p.on('close', code => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not json */ }
      fs.rmSync(ws, { recursive: true, force: true });
      const text = j.result || '';
      const parsed = parseJson(text);
      resolve({ bid: b.bid, qids: b.qids, arm: ARM, model: Object.keys(j.modelUsage || {}).join(',') || 'opus (claude -p)', effort: args.effort || 'default', route: 'claude-cli', date: new Date().toISOString(), text, json: valid(parsed, b.qids) ? parsed : null, exit: code, is_error: j.is_error ?? null, num_turns: j.num_turns ?? null, usage: j.usage ? { input: (j.usage.input_tokens || 0) + (j.usage.cache_read_input_tokens || 0) + (j.usage.cache_creation_input_tokens || 0), output: j.usage.output_tokens ?? null } : null, api_equiv_usd: j.total_cost_usd ?? null, secs: (Date.now() - t0) / 1000, error: code === 0 && !j.is_error ? null : (err || out).slice(-300) });
    });
  });
}

const batches = JSON.parse(fs.readFileSync(args.batches, 'utf8'));
const done = new Map(readJsonl(OUT).map(r => [r.bid, r]));
let todo = batches.filter(b => !done.get(b.bid)?.json);
if (args.limit) todo = todo.slice(0, +args.limit);
let calls = fs.readdirSync(path.dirname(OUT)).filter(f => /^(O|ADJ)\.jsonl$/.test(f)).reduce((n, f) => n + readJsonl(path.join(path.dirname(OUT), f)).length, 0);
console.log(`${ARM}: ${batches.length} calls planned, ${todo.length} to run, ${calls} Opus calls already made (cap ${MAX_CALLS})`);
let i = 0;
await Promise.all(Array.from({ length: +(args.parallel || 3) }, async () => {
  while (i < todo.length) {
    const b = todo[i++];
    if (calls >= MAX_CALLS) { console.log('CALL CAP'); return; }
    calls++;
    const row = await runOne(b);
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    console.log(`  ${b.bid} ${row.json ? 'ok' : 'NO-JSON ' + (row.error || row.text).slice(0, 120)} ${Math.round(row.secs)}s`);
    if (/usage limit|rate limit|quota/i.test(row.error || row.text || '')) { console.log('LIMIT — stopping'); i = todo.length; }
  }
}));

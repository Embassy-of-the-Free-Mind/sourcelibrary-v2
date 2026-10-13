#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-stale-english-6388/review-opus.mjs (#6518: `claude -p --model opus` on the subscription,
// every ANTHROPIC_* variable removed so no API key can reach it, Read the only tool, one fresh process per call). That
// runner batches 5 pages per call; this one takes a generic request file (one page per call, the brief's rule) in the
// same {uid, prompt, image} shape as run-cli-arm.py, so both families get byte-identical prompts.
//   node scripts/eval/stale-gate-6567/opus.mjs --requests=REQ.jsonl --out=OUT.jsonl --arm=O-ocr [--parallel=2] [--effort=high]
// Out rows: {uid, arm, model, text, secs, usage, error}. A row without text is retried on restart (its last row wins).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const WS = path.join(process.env.JOB_SCRATCH || '/tmp', 'opus-ws');
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

function runOne(req) {
  return new Promise(resolve => {
    const ws = path.join(WS, `${args.arm}-${req.uid}`);
    fs.mkdirSync(ws, { recursive: true });
    let prompt = req.prompt;
    if (req.image) { fs.copyFileSync(req.image, path.join(ws, `${req.uid}.jpg`)); prompt += ` ./${req.uid}.jpg (open it with the Read tool)`; }
    const cli = ['-p', prompt, '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task', '--max-turns', '6'];
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
      const ok = code === 0 && !j.is_error && (j.result || '').trim();
      resolve({ uid: req.uid, arm: args.arm, model: Object.keys(j.modelUsage || {}).join(',') || 'opus (claude -p)', effort: args.effort || 'default', route: 'claude-cli', date: new Date().toISOString(), text: ok ? j.result : '', num_turns: j.num_turns ?? null, usage: j.usage ? { input: (j.usage.input_tokens || 0) + (j.usage.cache_read_input_tokens || 0) + (j.usage.cache_creation_input_tokens || 0), output: j.usage.output_tokens ?? null } : null, secs: (Date.now() - t0) / 1000, attempts: 1, error: ok ? null : (err || out).slice(-300) });
    });
  });
}

const reqs = readJsonl(args.requests);
const done = new Map(readJsonl(args.out).map(r => [r.uid, r]));
let todo = reqs.filter(r => !done.get(r.uid)?.text);
if (args.limit) todo = todo.slice(0, +args.limit);
console.log(`${args.arm}: ${reqs.length} requests, ${todo.length} to run`);
let i = 0, stop = false;
await Promise.all(Array.from({ length: +(args.parallel || 2) }, async () => {
  while (i < todo.length && !stop) {
    const r = todo[i++];
    const row = await runOne(r);
    fs.appendFileSync(args.out, JSON.stringify(row) + '\n');
    console.log(`  ${r.uid} ${row.text ? 'ok' : 'FAIL ' + (row.error || '').slice(0, 120)} ${Math.round(row.secs)}s`);
    if (/usage limit|rate limit|quota/i.test(row.error || '')) { console.log('LIMIT — stopping'); stop = true; }
  }
}));

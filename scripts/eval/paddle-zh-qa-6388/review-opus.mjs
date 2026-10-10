#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-prereg-6388/reads.mjs runClaude() — the same `claude -p` subscription call (image opened
// with Read, every ANTHROPIC_* variable removed so no API key can reach it); that one transcribes, this one reviews a
// given transcription and returns JSON, and records the model id the CLI reports.
//
// #6388 Paddle zh QA: Opus reviewer. $0 (subscription). One call per request row.
//   node scripts/eval/paddle-zh-qa-6388/review-opus.mjs --requests=$JOB_SCRATCH/requests.jsonl --arm=R1 [--effort=high] [--parallel=3] [--limit=N]
// Output: scripts/eval/paddle-zh-qa-6388/reads/<arm>.jsonl, one row per request ({uid, arm, model, text, json, ...});
// a row without parsed JSON is retried on restart (its last row wins).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ARM = args.arm || 'R1';
const OUT = path.join(HERE, 'reads', `${ARM}.jsonl`);
const WS = path.join(process.env.JOB_SCRATCH || '/tmp', 'opus-ws');
const MAX_CALLS = Number(args['max-calls'] || 150);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

export function parseReview(s) {
  const t = String(s || '').replace(/^```(?:json)?\s*|```\s*$/gm, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const j = JSON.parse(t.slice(a, b + 1)); return j && typeof j.verdict === 'string' ? j : null; } catch { return null; }
}
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function runOne(req) {
  return new Promise(resolve => {
    const ws = path.join(WS, `${ARM}-${req.uid}`);
    fs.mkdirSync(ws, { recursive: true });
    fs.copyFileSync(req.image, path.join(ws, 'page.jpg'));
    const prompt = `${req.prompt} the file ./page.jpg in the current directory. Open it with the Read tool (the only tool you may use), then answer.`;
    const cli = ['-p', prompt, '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task', '--max-turns', '4'];
    if (args.effort) cli.push('--effort', args.effort);
    const t0 = Date.now();
    const p = spawn('claude', cli, { cwd: ws, env: claudeEnv() });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 600000);
    p.on('close', code => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not json */ }
      fs.rmSync(ws, { recursive: true, force: true });
      const text = j.result || '';
      resolve({ uid: req.uid, arm: ARM, model: Object.keys(j.modelUsage || {}).join(',') || 'opus (claude -p)', effort: args.effort || 'default', route: 'claude-cli', date: new Date().toISOString(), text, json: parseReview(text), exit: code, is_error: j.is_error ?? null, num_turns: j.num_turns ?? null, secs: (Date.now() - t0) / 1000, error: code === 0 && !j.is_error ? null : (err || out).slice(-300) });
    });
  });
}

const reqs = readJsonl(args.requests);
const done = new Map(readJsonl(OUT).map(r => [r.uid, r]));
let todo = reqs.filter(r => !done.get(r.uid)?.json);
if (args.limit) todo = todo.slice(0, +args.limit);
const prior = readJsonl(OUT).length;
console.log(`${ARM}: ${reqs.length} requests, ${todo.length} to run, ${prior} calls already made (cap ${MAX_CALLS})`);
let calls = prior, i = 0;
await Promise.all(Array.from({ length: +(args.parallel || 3) }, async () => {
  while (i < todo.length) {
    const r = todo[i++];
    if (calls >= MAX_CALLS) { console.log('CALL CAP'); return; }
    calls++;
    const row = await runOne(r);
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    console.log(`  ${r.uid} ${row.json ? row.json.verdict : 'NO-JSON ' + (row.error || row.text).slice(0, 80)} ${Math.round(row.secs)}s`);
    if (/usage limit|rate limit|quota/i.test(row.error || '')) { console.log('LIMIT — stopping'); i = todo.length; }
  }
}));

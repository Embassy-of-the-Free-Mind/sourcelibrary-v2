#!/usr/bin/env node
// PRIOR ART: scripts/lib/agy-cli.mjs gatedTextCall (the Gemini call cli-translate.mjs makes: plan mode, tool gate,
// markers) is used as is; the sealed `claude -p` call is scripts/batch/claude-translate.mjs's claudeCall (not
// exported), copied; scripts/eval/pro-translate-6545/claude-arm.py and scripts/eval/run-cli-arm.py are the Python
// runners of the same shape (request rows in, one result row per request, resumable, sleep through limits).
/**
 * #6728 — one arm (or one judge) over a request file, $0 on the subscriptions: Gemini ONLY via `agy -p`, Claude ONLY
 * via `claude -p` with every ANTHROPIC_/OPENROUTER key stripped from its env.
 *
 *   node scripts/eval/plain-6728/run-arm.mjs --requests REQ.jsonl --out OUT.jsonl --engine agy|claude
 *        [--model gemini-3.8-flash-low|opus] [--parallel 1] [--uids a,b,c | --uids-file F] [--tag NAME]
 *
 * OUT rows: {uid, tag, engine, model, raw, text, problem, cls, secs, calls, usage, date}. A uid with text is skipped on
 * restart. Quota / usage-limit replies sleep 20 min and retry (never fall back to anything else). Before each call the
 * box's Claude weekly meter is read; at >= 85% the run stops (exit 4) — the brief's stop line.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { gatedTextCall, unwrapRead } from '../../lib/agy-cli.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const REQ = arg('requests'), OUT = arg('out'), ENGINE = arg('engine');
const MODEL = arg('model', ENGINE === 'claude' ? 'opus' : 'gemini-3.8-flash-low');
const PAR = Math.min(3, Number(arg('parallel', 1)));
const TAG = arg('tag', path.basename(OUT || '', '.jsonl'));
const STOP_PCT = 85;
if (!REQ || !OUT || !['agy', 'claude'].includes(ENGINE)) { console.error('usage: run-arm.mjs --requests R --out O --engine agy|claude (see header)'); process.exit(2); }
const only = arg('uids') ? new Set(arg('uids').split(',')) : arg('uids-file') ? new Set(fs.readFileSync(arg('uids-file'), 'utf8').split(/\s+/).filter(Boolean)) : null;
const reqs = fs.readFileSync(REQ, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !only || only.has(r.uid));
const done = new Set();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.text) done.add(r.uid); }
const todo = reqs.filter((r) => !done.has(r.uid));
const scratch = path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'ws'); fs.mkdirSync(scratch, { recursive: true });
console.log(`${TAG}: ${reqs.length} requests, ${done.size} done, ${todo.length} to run; ${ENGINE} ${MODEL} x${PAR}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function weeklyPct() {
  try { const s = execFileSync('/root/bin/claude-job.sh', ['where'], { encoding: 'utf8', timeout: 30000 }); const m = s.match(/weekly_pct=(\d+)/); return m ? Number(m[1]) : null; } catch { return null; }
}

// claude-translate.mjs's sealed call: `claude -p` prefers an API key over the subscription login — strip it (#6553).
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function claudeCall(prompt, model, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('claude', ['-p', '--model', model, '--restricted', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'quota' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      resolve({ text, model: Object.keys(j.modelUsage || {})[0] || null, usage: j.usage ? { input_tokens: j.usage.input_tokens, output_tokens: j.usage.output_tokens, cache_read: j.usage.cache_read_input_tokens, cache_creation: j.usage.cache_creation_input_tokens } : null, code, cls, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000, calls: 1 });
    });
  });
}

async function once(prompt) {
  if (ENGINE === 'agy') return gatedTextCall(prompt, { model: MODEL, task: 'translate', tmp: scratch });
  let r;
  for (let i = 0; i < 2; i++) {   // one retry on an empty / failed reply, as gatedTextCall's attempts
    const ws = fs.mkdtempSync(path.join(scratch, 'cl-'));
    r = await claudeCall(prompt, MODEL, ws);
    fs.rmSync(ws, { recursive: true, force: true });
    if (!r.cls || r.cls === 'quota') break;
  }
  const { text: answer, problem } = unwrapRead(r.text);
  return { ...r, answer, problem };
}

let stopped = false;
async function run(req) {
  let r, t = 0;
  for (let w = 0; w < 60 && !stopped; w++) {
    const pct = ENGINE === 'claude' ? weeklyPct() : null;
    if (pct != null && pct >= STOP_PCT) { console.error(`STOP: Claude weekly meter at ${pct}% (>= ${STOP_PCT}%)`); stopped = true; return; }
    r = await once(req.prompt); t += r.secs || 0;
    if (r.cls !== 'quota') break;
    console.log(`  ${req.uid}: quota/limit (${(r.err || r.text || '').slice(0, 120)}); sleeping 20 min`);
    await sleep(20 * 60 * 1000);
  }
  if (stopped || !r) return;
  const row = { uid: req.uid, tag: TAG, engine: ENGINE, model: MODEL, resolved_model: r.model || null, date: new Date().toISOString(), raw: r.text, text: r.cls ? '' : (r.answer || ''), problem: r.cls || r.problem || null, secs: Math.round(t), calls: r.calls, usage: r.usage || null, tool_calls: r.tool_calls || null, prompt_hash: req.prompt_hash || null };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`  ${req.uid} ${row.problem || 'ok'} ${row.text.length} chars ${row.secs}s out_tok ${r.usage?.output_tokens ?? '?'}`);
}

const queue = [...todo];
await Promise.all(Array.from({ length: PAR }, async () => { while (queue.length && !stopped) await run(queue.shift()); }));
console.log(`${TAG}: ${stopped ? 'STOPPED on the weekly meter' : 'done'}`);
process.exit(stopped ? 4 : 0);

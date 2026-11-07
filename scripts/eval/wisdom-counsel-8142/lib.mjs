// Shared calls and files for the counsel test (#8142).
// PRIOR ART: scripts/lib/agy-cli.mjs (CLI_SAFE_ARGS, isQuotaError, replyEnvelope, installToolGate — the agy call is
// theirs) and scripts/lib/claude-cli-env.mjs (subscription env); scripts/eval/agy-per-call-7503/judge.mjs for the
// `claude -p` flags. Those judge against a page image with Read; here there is no file to read, so the tools are off.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLI_SAFE_ARGS, isQuotaError, replyEnvelope, installToolGate } from '../../lib/agy-cli.mjs';
import { claudeSubscriptionEnv } from '../../lib/claude-cli-env.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRATCH = process.env.JOB_SCRATCH || '/root/jobs/wisdom-counsel-8142';
export const OUT = path.join(SCRATCH, 'out');
fs.mkdirSync(OUT, { recursive: true });

export const WRITER_MODEL = 'gemini-3.8-flash-low';
export const JUDGE2_MODEL = 'gemini-3.8-flash-medium';
export const WRITER_HOMES = ['/root/.agy-milo', '/root/.agy-james']; // held to flash-low: their pools are for this

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const here = (f) => path.join(HERE, f);
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const words = (t) => String(t).trim().split(/\s+/).filter(Boolean);
export const capWords = (t, n = 250) => { const w = words(t); return w.length <= n ? String(t).trim() : w.slice(0, n).join(' '); };
export const wc = (t) => words(t).length;

export class LimitHit extends Error {}

/** Fisher-Yates with a supplied generator, so every shuffle in this study is seeded. */
export function shuffled(xs, rng) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function seedOf(label) { return parseInt(sha256(`wisdom-counsel-8142:${label}`).slice(0, 8), 16); }

function run(cmd, args, { input = null, cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    if (input !== null) child.stdin.end(input);
  });
}

const agyWs = path.join(SCRATCH, 'agy-ws');
fs.mkdirSync(agyWs, { recursive: true });
installToolGate(agyWs, { task: 'translate' });

/** One `agy -p` call. Throws LimitHit on quota, so the caller stops and the run stays resumable. */
export async function agyCall(prompt, { model, agyHome = '', timeoutS = 300 } = {}) {
  const env = { ...process.env };
  if (agyHome) env.AGY_HOME = agyHome; else delete env.AGY_HOME;
  const suffix = '\n\nDo not open, read or write any file and do not use any tool: everything you need is above.';
  const args = ['-p', prompt + suffix, '--model', model, ...CLI_SAFE_ARGS];
  const r = await run('agy', args, { cwd: agyWs, env, timeoutMs: (timeoutS + 60) * 1000 });
  const j = replyEnvelope(r.out) || {};
  const text = String(j.response ?? '').trim();
  if (isQuotaError({ out: r.out, err: r.err, j, text })) throw new LimitHit(`agy quota (${model} ${agyHome || 'main'}): ${r.err.slice(0, 200)}`);
  if (r.code !== 0 || !text) throw new Error(`agy failed code=${r.code} status=${j.status} err=${r.err.slice(0, 300)} out=${r.out.slice(0, 200)}`);
  if (j.status && j.status !== 'SUCCESS') throw new Error(`agy status ${j.status}`);
  return { text, usage: j.usage || null, model };
}

const claudeCwd = path.join(SCRATCH, 'claude-cwd');
fs.mkdirSync(claudeCwd, { recursive: true });

/** One `claude -p` on the subscription, Opus, no tools, in an empty directory with no project doctrine. */
export async function claudeCall(prompt, { timeoutMs = 900_000 } = {}) {
  const args = ['-p', '--model', 'opus', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'];
  const r = await run('claude', args, { input: prompt, cwd: claudeCwd, env: claudeSubscriptionEnv(), timeoutMs });
  let j = {};
  try { j = JSON.parse(r.out); } catch { /* handled below */ }
  const text = String(j.result ?? '').trim();
  if (/usage limit|limit reached|rate limit|hit your limit/i.test(text.slice(0, 300)) || /usage limit|hit your limit/i.test(r.err)) throw new LimitHit(`claude limit: ${(text || r.err).slice(0, 200)}`);
  if (r.code !== 0 || !text || j.is_error) throw new Error(`claude failed code=${r.code} err=${r.err.slice(0, 300)} out=${r.out.slice(0, 300)}`);
  return { text, usage: j.usage || null, model: Object.keys(j.modelUsage || {})[0] || 'opus' };
}

/** Pull the one JSON value out of a reply that may fence it or wrap it in a line of chat. */
export function parseJsonReply(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (start < 0 || end < 0) throw new Error('no JSON in reply');
  return JSON.parse(body.slice(start, end + 1));
}

export function appendJsonl(p, row) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(row) + '\n'); }
export function readJsonl(p) { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }

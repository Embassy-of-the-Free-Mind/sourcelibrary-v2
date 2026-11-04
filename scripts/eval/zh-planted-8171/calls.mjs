// PRIOR ART: zh-punct-8140/arm.mjs on PR #8146 (claudeCall: `claude -p --model opus` text-only, and the agy
// gatedTextCall wrapper, both reused in shape); scripts/eval/route-judge-6740/judge.mjs opusCall (Read-only tools so the
// judge can open a page image). Neither keeps a ledger, and #8171 has hard caps (400 agy, 300 Claude calls): every call
// here is appended to <priv>/calls.jsonl first, and a call past the cap throws instead of running.
import fs from 'fs'; import os from 'os'; import path from 'path'; import { spawn } from 'child_process';

export const CAPS = { agy: 400, claude: 300 };
let LEDGER = null;
export const setLedger = (f) => { LEDGER = f; };
export function used() {
  const n = { agy: 0, claude: 0 };
  if (LEDGER && fs.existsSync(LEDGER)) for (const l of fs.readFileSync(LEDGER, 'utf8').split('\n')) if (l) { const r = JSON.parse(l); n[r.kind] += 1; }
  return n;
}
function book(kind, what) {
  if (!LEDGER) throw new Error('no ledger set');
  if (used()[kind] >= CAPS[kind]) throw new Error(`CAP: ${kind} calls would pass ${CAPS[kind]}`);
  fs.appendFileSync(LEDGER, JSON.stringify({ kind, what, at: new Date().toISOString() }) + '\n');
}
const QUOTA = /usage limit|rate limit|limit reached|resets? at|out of extra usage/i;

/** One `claude -p --model opus` call. `files` = {name: srcPath} copied into a fresh cwd the model may Read. */
export function claudeCall(prompt, { what = '', files = {}, model = 'opus', timeoutMs = 600_000 } = {}) {
  book('claude', what);
  return new Promise((resolve) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zhpl-'));
    for (const [n, src] of Object.entries(files)) fs.copyFileSync(src, path.join(cwd, n));
    const tools = Object.keys(files).length ? ['--tools', 'Read', '--allowedTools', 'Read'] : ['--tools', ''];
    const t0 = Date.now();
    const p = spawn('/root/.local/bin/claude', ['-p', '--model', model, ...tools, '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--output-format', 'json'], { cwd, env: { ...process.env, PATH: `/usr/local/bin:/usr/bin:/bin:/root/.local/bin` } });
    let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const killer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(killer); fs.rmSync(cwd, { recursive: true, force: true });
      let j = {}; try { j = JSON.parse(out); } catch { /* not json */ }
      const text = String(j.result ?? '');
      const cls = QUOTA.test(err + (j.is_error ? text : '')) ? 'quota' : code !== 0 || j.is_error ? 'error' : null;
      resolve({ text, cls, seconds: (Date.now() - t0) / 1000, err: cls ? (err || text).slice(0, 400) : undefined, model: Object.keys(j.modelUsage || {})[0] ?? null });
    });
    p.stdin.end(prompt);
  });
}

/** One agy text call on gemini-3.8-flash-low (gatedTextCall: plan mode, tool gate, sentinels), pool from AGY_HOME. */
export async function agyCall(prompt, { what = '' } = {}) {
  book('agy', what);
  const { gatedTextCall, isQuotaError } = await import('../../lib/agy-cli.mjs');
  const t0 = Date.now();
  const r = await gatedTextCall(prompt, { model: 'gemini-3.8-flash-low', task: 'translate', attempts: 1, tmp: os.tmpdir() });
  const quota = r.cls === 'quota' || isQuotaError({ out: r.out || '', err: r.err || '', text: r.text || '' });
  return { raw: r.text ?? '', answer: r.answer ?? null, problem: r.problem ?? null, cls: quota ? 'quota' : r.cls ?? null, seconds: (Date.now() - t0) / 1000 };
}

/** The pool reading and its floor: stop when weekly < max(0.25, reserve of every lane) or the 5-hour bucket < 0.25. */
export async function poolOk(home) {
  const { readPool, weeklyReserve } = await import('../../lib/agy-pools.mjs');
  const r = readPool(home || null);
  const line = Math.max(0.25, weeklyReserve({ resetTime: r?.weeklyReset, lane: null }));
  return { ok: !!r && r.weekly >= line && (r.fiveHour ?? 0) >= 0.25, reading: r, line };
}

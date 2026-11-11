// PRIOR ART: scripts/batch/claude-translate.mjs claudeCall (#6559) — the sealed `claude -p --restricted --tools ""`
// call, the subscription env strip and the usage-limit classifier are copied from it unchanged; it is not exported
// (main() runs on import), so it cannot be imported. New here: a bounded pool that checks the last 20 calls and
// waits out a spent 5-hour window instead of failing (#6742 brief), and a JSON-object extractor for the replies.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'node:child_process';
import { claudeBlocked, noteLimitHit, waitWhileBlocked } from '../../lib/model-limits.mjs';

// The first claude CLI that has --restricted (the seal). A stale ~/.local/bin/claude (2.1.31 on main, 2026-10-16) lacks
// it and failed every call in 2 s with "unknown option"; /usr/bin/claude is the current one there.
export const CLI = [process.env.CLAUDE_BIN, '/root/.local/bin/claude', '/usr/bin/claude', 'claude'].filter(Boolean)
  .find((b) => (b === 'claude' || fs.existsSync(b)) && /--restricted/.test(spawnSync(b, ['--help'], { encoding: 'utf8', timeout: 30e3 }).stdout || '')) || 'claude';
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

/** One sealed text-only `claude -p` call, the prompt on stdin. Resolves {text, model, usage, code, cls, err, secs}. */
export function claudeCall(prompt, model = 'opus') {
  // A spent account is not called (model-limits.mjs); the caller sees the same usage_limit it would have got.
  const blocked = claudeBlocked();
  if (blocked) return Promise.resolve({ text: '', model: null, usage: null, code: null, cls: 'usage_limit', err: blocked.reason, secs: 0, not_called: true, until: blocked.until });
  const cwd = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'seams-6742-'));
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLI, ['-p', '--model', model, '--restricted', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON: an error before the session */ }
      const text = String(j.result ?? '').trim();
      const models = Object.keys(j.modelUsage || {});
      const resolved = models.find((m) => m.includes(String(model).replace(/^claude-/, ''))) || models[0] || null;
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}${j.subtype ? `_${j.subtype}` : ''}` : !text ? 'empty' : null;
      if (cls === 'usage_limit') noteLimitHit('claude', { reason: (err || text).slice(-200) });
      resolve({ text, model: resolved, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens, cache_read: j.usage.cache_read_input_tokens, list_cost_usd: j.total_cost_usd } : null, code, cls, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

/** The first balanced {...} or [...] in a reply, parsed; null if none parses. */
export function extractJson(text, open = '{') {
  const close = open === '{' ? '}' : ']';
  const t = String(text).replace(/```(?:json)?/g, '');
  for (let s = t.indexOf(open); s >= 0; s = t.indexOf(open, s + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = s; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) { try { return JSON.parse(t.slice(s, i + 1)); } catch { break; } }
    }
  }
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Run `task(item)` over items with at most `conc` in flight. task resolves { ok, cls }. Every 20 finished calls the
 * last 20 are checked: ≥ 6 hard failures stops the run. A usage_limit pauses every worker until the limit clears
 * (up to maxWaitH hours), then the item is retried. The wait reads the meters only and never calls a model to find
 * out (model-limits.mjs): `probe` returns { cls: 'usage_limit' } while blocked and must not call either.
 */
export async function pool(items, conc, task, { log = console.log, maxWaitH = 6, probe } = {}) {
  let i = 0, finished = 0, stop = null;
  const recent = [];
  async function waitWindow() {
    if (!probe) return waitWhileBlocked(() => claudeBlocked(), { log, maxWaitH });
    const t0 = Date.now();
    while (Date.now() - t0 < maxWaitH * 3600e3) {
      log(`usage limit — waiting 15 min (since ${new Date(t0).toISOString()})`);
      await sleep(15 * 60e3);
      const r = await probe();
      if (r.cls !== 'usage_limit') return true;
    }
    return false;
  }
  let waiting = null;
  async function worker() {
    while (!stop && i < items.length) {
      const item = items[i++];
      for (;;) {
        if (waiting) await waiting;
        if (stop) return;
        const r = await task(item);
        if (r?.cls === 'usage_limit') {
          if (!waiting) waiting = waitWindow().then(ok => { if (!ok) stop = 'usage window did not reset'; waiting = null; });
          continue;
        }
        recent.push(r?.ok ? 0 : 1); if (recent.length > 20) recent.shift();
        finished++;
        if (finished % 20 === 0) {
          const bad = recent.reduce((a, b) => a + b, 0);
          log(`${finished}/${items.length} done; ${bad} of the last 20 failed`);
          if (bad >= 6) stop = `${bad} of the last 20 calls failed`;
        }
        break;
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return { finished, stop };
}

/** Seeded shuffle (Fisher–Yates) with a provided rng. */
export function shuffle(arr, rand) { const a = [...arr]; for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; }

/** Sentences of an English text (cheap: split after . ! ? followed by space + capital/quote). */
export const sentences = (t) => String(t).split(/(?<=[.!?][»”"'’)\]]*)\s+(?=[\p{Lu}"“‘'(\[])/u).filter(Boolean);

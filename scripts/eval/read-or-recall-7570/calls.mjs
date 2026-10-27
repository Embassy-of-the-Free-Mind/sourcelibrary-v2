// PRIOR ART: scripts/batch/claude-ocr.mjs claudeCall (the sealed `claude -p --restricted --tools Read` call with the
// API-key strip, imported unchanged); scripts/lib/agy-cli.mjs agyCall/installToolGate/gatedTextCall (the gated agy
// call, imported unchanged); scripts/eval/continuation-probe-7271/probe.mjs (the no-tools text call for claude).
/**
 * calls.mjs — one model call for the read-or-recall pilot (#7570), with or without the page image.
 *
 *   call({ engine: 'opus'|'gemini', prompt, image: path|null, tmp })
 *     → { text (between the markers), raw, problem, cls, secs, usage, model_ids, tool_calls }
 *   opus    image: `claude -p --model opus --restricted --tools Read` in a fresh directory holding only page.jpg;
 *           no image: `claude -p --model opus --tools ""` in an empty directory. Subscription login; no API key.
 *   gemini  `agy -p --model gemini-3.8-flash-low` in plan mode with the tool gate (image: view_file on page.jpg only;
 *           no image: every tool denied). One attempt; a denied tool is NOT nudged (a failed call is a failed read).
 * No retry anywhere: a failure is recorded with its class and scored as a failed read.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { claudeCall } from '../../batch/claude-ocr.mjs';
import { agyCall, installToolGate, gateCalls, unwrapRead, CLI_SAFE_ARGS, gatedTextCall } from '../../lib/agy-cli.mjs';
import { IMAGE_FILE } from './prompts.mjs';

export const GEMINI_MODEL = 'gemini-3.8-flash-low';
const CLAUDE = process.env.CLAUDE_BIN || (fs.existsSync('/root/.local/bin/claude') ? '/root/.local/bin/claude' : 'claude');
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

function claudeTextCall(prompt, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLAUDE, ['-p', prompt, '--model', 'opus', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 600_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const cls = /usage limit|limit reached|rate.?limit|\b429\b/i.test(err + (j.is_error ? text : '')) ? 'usage_limit' : code === null ? 'timeout' : code !== 0 || j.is_error ? `exit_${code}` : !text ? 'empty' : null;
      resolve({ text, cls, err: err.slice(-300), secs: (Date.now() - t0) / 1000, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens } : null, model_ids: Object.keys(j.modelUsage || {}) });
    });
  });
}

export async function call({ engine, prompt, image = null, tmp = process.env.TMPDIR || os.tmpdir() }) {
  const ws = fs.mkdtempSync(path.join(tmp, `ror-${engine}-`));
  try {
    if (image) fs.copyFileSync(image, path.join(ws, IMAGE_FILE));
    let r, tools = null;
    if (engine === 'opus') {
      r = image ? await claudeCall(prompt, 'opus', ws) : await claudeTextCall(prompt, ws);
      if (r.model && !r.model_ids) r.model_ids = [r.model];
    } else if (image) {
      const log = installToolGate(ws, { task: 'ocr' });
      r = await agyCall(['-p', prompt, '--model', GEMINI_MODEL, ...CLI_SAFE_ARGS], ws);
      tools = gateCalls(log); r.model_ids = [GEMINI_MODEL];
    } else {
      r = await gatedTextCall(prompt, { model: GEMINI_MODEL, task: 'translate', attempts: 1, tmp });
      tools = r.tool_calls; r.model_ids = [GEMINI_MODEL];
    }
    const { text, problem } = unwrapRead(r.text);
    return { text, raw: r.text, problem, cls: r.cls || null, err: r.cls ? r.err : null, secs: Math.round((r.secs || 0) * 10) / 10, usage: r.usage || null, model_ids: r.model_ids || null, tool_calls: tools };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

/** Download a page image once (cached by page id), JPEG, long side ≤ 2200 px. */
export async function fetchImage(url, id, dir) {
  const f = path.join(dir, `${id}.jpg`);
  if (fs.existsSync(f) && fs.statSync(f).size > 5000) return f;
  const sharp = (await import('sharp')).default;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { 'User-Agent': 'SourceLibrary-eval/7570' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(f);
      return f;
    } catch (e) { if (attempt === 2) return { error: String(e.message || e) }; await new Promise((s) => setTimeout(s, 3000)); }
  }
}

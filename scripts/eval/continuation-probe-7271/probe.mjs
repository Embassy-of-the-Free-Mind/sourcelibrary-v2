#!/usr/bin/env node
// PRIOR ART: scripts/lib/agy-cli.mjs gatedTextCall (the text-only agy call, used here unchanged for Gemini);
// scripts/batch/claude-ocr.mjs (claude -p for OCR, with an image; this sends text only and no tools).
/**
 * probe.mjs — the continuation probe (#7271): the first 60 words of each sealed page, NO image, one call per page.
 *
 *   node scripts/eval/continuation-probe-7271/probe.mjs --engine=opus|gemini [--concurrency=3]
 *
 *   opus    `claude -p --model opus --tools ""` in an empty directory (subscription, no API key);
 *   gemini  `agy -p --model gemini-3.8-flash-low` through agy-cli.mjs gatedTextCall (plan mode, tool gate, one
 *           attempt), which also honours the box's agy lock (model-limits.mjs) and the per-job ledger.
 * Neither CLI exposes temperature. One call per page: a failed call is recorded, not retried (a quota stop ends the
 * run; re-running resumes from the pages not yet recorded). Writes results/continuation-probe-7271/raw-<engine>.jsonl,
 * one row per page: the exact prompt sent, the raw reply, the unwrapped continuation, timing and usage.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { gatedTextCall } from '../../lib/agy-cli.mjs';
import { unwrapSentinels } from '../../lib/cli-chatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '../results/continuation-probe-7271');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const ENGINE = arg('engine');
const CONC = Number(arg('concurrency', ENGINE === 'opus' ? 3 : 2));
if (!['opus', 'gemini'].includes(ENGINE)) throw new Error('--engine=opus|gemini');
const MODEL = ENGINE === 'opus' ? 'opus' : 'gemini-3.8-flash-low';
const CLAUDE = process.env.CLAUDE_BIN || (fs.existsSync('/root/.local/bin/claude') ? '/root/.local/bin/claude' : 'claude');

export const PROMPT = (prefix) => `Continue this text exactly, word for word, from where it stops. Write the next 200 words of the original text as they appear in the source. Do not translate, summarise, modernise or comment. If you do not know the source, write your best guess at how it continues.

Write only the continuation, between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.

TEXT:
${prefix}`;

const sealed = JSON.parse(fs.readFileSync(path.join(RES, 'sealed.json'), 'utf8'));
const OUT = path.join(RES, `raw-${ENGINE}.jsonl`);
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).slug) : []);
const todo = sealed.pages.filter((p) => !done.has(p.slug));
console.log(`${ENGINE} (${MODEL}): ${todo.length} of ${sealed.pages.length} pages to call`);

function claudeCall(sent) {
  return new Promise((resolve) => {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cprobe-'));
    const t0 = Date.now();
    const child = spawn(CLAUDE, ['-p', sent, '--model', MODEL, '--output-format', 'json', '--tools', ''], { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('close', (code) => {
      clearTimeout(timer); fs.rmSync(ws, { recursive: true, force: true });
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const cls = /usage limit|rate limit|429/i.test(err + (j.is_error ? text : '')) ? 'quota' : code !== 0 || j.is_error ? `exit_${code}` : !text ? 'empty' : null;
      resolve({ text, cls, err: err.slice(-300), secs: (Date.now() - t0) / 1000, usage: j.usage ? { input_tokens: j.usage.input_tokens, output_tokens: j.usage.output_tokens } : null, model_ids: Object.keys(j.modelUsage || {}), stop_reason: j.stop_reason || null });
    });
  });
}

let stop = false;
async function one(p) {
  if (stop) return;
  const sent = PROMPT(p.prefix);
  let r;
  if (ENGINE === 'opus') {
    r = await claudeCall(sent);
    const u = unwrapSentinels(r.text);
    r.answer = u.inside ?? r.text; r.problem = u.inside == null ? (r.text ? 'no <<<BEGIN>>> marker' : null) : u.outside ? 'text outside the markers' : !u.closed ? 'reply cut before <<<END>>>' : null;
  } else {
    r = await gatedTextCall(sent, { model: MODEL, task: 'translate', attempts: 1, tmp: process.env.TMPDIR || os.tmpdir() });
  }
  if (r.cls === 'quota') { stop = true; console.log(`QUOTA on ${p.slug}: stopping; re-run to resume (${r.err})`); return; }
  const rowOut = { slug: p.slug, group: p.group, engine: ENGINE, model: MODEL, model_ids: r.model_ids || null, at: new Date().toISOString(),
    prompt: sent, raw: r.text, continuation: r.answer ?? '', problem: r.problem ?? null, error_class: r.cls ?? null, secs: Math.round(r.secs * 10) / 10,
    usage: r.usage ?? null, tool_calls: r.tool_calls ?? null, stop_reason: r.stop_reason ?? null };
  fs.appendFileSync(OUT, JSON.stringify(rowOut) + '\n');
  console.log(`${p.slug} ${r.cls || 'ok'} ${Math.round(r.secs)}s ${String(rowOut.continuation).split(/\s+/).length}w ${rowOut.problem || ''}`);
}
const queue = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length && !stop) await one(queue.shift()); }));
console.log('done');

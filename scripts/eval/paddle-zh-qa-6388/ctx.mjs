#!/usr/bin/env node
// PRIOR ART: transcribe.mjs (this folder) — the one-page-per-call Opus/Gemini transcription arms (TO, TG), whose rows
// are this arm's k = 1 cell; scripts/eval/run-cli-arm.py `call()` — the agy command shape (plan mode, JSON output,
// images attached as @./file), which takes ONE image per row, so it cannot send 5 or 10 pages in one call.
//
// #6388 Paddle zh QA: the CONTEXT ARM (Derek, 2026-10-10: "it matters how much each cli does at a time"). The same 10
// pages, the same live OCR prompt, transcribed by Opus and by Gemini 3.8 Flash (Low) at 5 and at 10 pages per call
// (k = 1 is TO / TG). A multi-page call returns per-page text between `===== PAGE n =====` lines. Scored in score.mjs.
// Writes NOTHING to Mongo. $0 (subscriptions).
//
//   node scripts/eval/paddle-zh-qa-6388/ctx.mjs draw                       → ctx-draw.json (seed 6397; commit before run)
//   node scripts/eval/paddle-zh-qa-6388/ctx.mjs run --engine=opus|gemini --k=5|10   → reads/CTX.jsonl (one row per call)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH || '/tmp/paddle-qa-6388';
const H = f => path.join(HERE, f);
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const safe = uid => uid.replace(/[^\w.-]/g, '_');
const img = uid => path.join(SCRATCH, 'img', `${safe(uid)}.jpg`);
const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const OUT = H('reads/CTX.jsonl');
const SEED = 6397;

if (process.argv[2] === 'draw') {
  // 10 of the 57 sample pages whose Kanripo leaf aligns (so every cell can be scored against an outside text),
  // exact Fisher–Yates over the sorted uids. The drawn order is the order the pages are sent in.
  const kan = readJsonl(H('kanripo.jsonl')).filter(k => k.status === 'scored').map(k => k.uid).sort();
  const a = [...kan], r = makeRng(SEED);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const pages = a.slice(0, 10);
  fs.writeFileSync(H('ctx-draw.json'), JSON.stringify({ issue: 6388, seed: SEED, drawn_at: new Date().toISOString(), rule: 'exact Fisher–Yates (makeRng 6397) over the sorted uids of the sample pages with kanripo.jsonl status "scored"; first 10, in drawn order. k=5 sends pages 1–5 and 6–10; k=10 sends all ten. k=1 is arms TO/TG.', pages }, null, 1) + '\n');
  console.log('ctx pages', pages.length);
  process.exit(0);
}
if (process.argv[2] !== 'run') { console.log('stages: draw | run --engine=opus|gemini --k=5|10'); process.exit(2); }

const ENGINE = args.engine, K = Number(args.k);
if (!['opus', 'gemini'].includes(ENGINE) || ![5, 10].includes(K)) throw new Error('--engine=opus|gemini --k=5|10');
const pages = JSON.parse(fs.readFileSync(H('ctx-draw.json'), 'utf8')).pages;
const groups = []; for (let i = 0; i < pages.length; i += K) groups.push(pages.slice(i, i + K));
const base = fs.readFileSync(path.join(SCRATCH, 'prompt-base.txt'), 'utf8');
const multi = n => `${base}\n\nThere are ${n} page images, page01.jpg to page${String(n).padStart(2, '0')}.jpg. They are SEPARATE pages and may come from different books. Transcribe EACH page separately, in the format above. Before each page's transcription write one line exactly \`===== PAGE n =====\`, where n is the number in that page's file name (1 to ${n}). Output only the transcriptions, with no preamble and no commentary.`;

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function run(cmd, cliArgs, cwd, killMs) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn(cmd, cliArgs, { cwd, env: cmd === 'claude' ? claudeEnv() : process.env });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), killMs);
    p.on('close', code => { clearTimeout(timer); resolve({ out, err, code, secs: (Date.now() - t0) / 1000 }); });
  });
}

const done = new Set(readJsonl(OUT).filter(r => r.text && !r.error).map(r => `${r.engine}|${r.k}|${r.group}`));
for (const [gi, g] of groups.entries()) {
  if (done.has(`${ENGINE}|${K}|${gi}`)) { console.log('done', ENGINE, K, gi); continue; }
  const ws = path.join(SCRATCH, 'ctx-ws', `${ENGINE}-${K}-${gi}`);
  fs.rmSync(ws, { recursive: true, force: true }); fs.mkdirSync(ws, { recursive: true });
  const names = g.map((u, i) => { const n = `page${String(i + 1).padStart(2, '0')}.jpg`; fs.copyFileSync(img(u), path.join(ws, n)); return n; });
  let row;
  if (ENGINE === 'opus') {
    const prompt = `${multi(g.length)}\n\nThe page images are the files ${names.map(n => './' + n).join(', ')} in the current directory. Open each with the Read tool (that is the only tool you may use), then transcribe them.`;
    const r = await run('claude', ['-p', prompt, '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task', '--max-turns', String(g.length + 4)], ws, 1800000);
    let j = {}; try { j = JSON.parse(r.out); } catch { /* not json */ }
    row = { model: Object.keys(j.modelUsage || {}).join(',') || 'opus (claude -p)', text: j.result || '', exit: r.code, num_turns: j.num_turns ?? null, usage: j.usage ? { input: (j.usage.input_tokens || 0) + (j.usage.cache_read_input_tokens || 0) + (j.usage.cache_creation_input_tokens || 0), output: j.usage.output_tokens ?? null } : null, api_equiv_usd: j.total_cost_usd ?? null, secs: r.secs, error: r.code === 0 && !j.is_error ? null : (r.err || r.out).slice(-300) };
  } else {
    const prompt = `${multi(g.length)} ${names.map(n => '@./' + n).join(' ')}`;
    const pt = 300 + 120 * g.length;
    const r = await run('agy', ['-p', prompt, '--model', 'gemini-3.8-flash-low', '--mode', 'plan', '--print-timeout', `${pt}s`, '--output-format', 'json'], ws, (pt + 60) * 1000);
    let j = {}; try { j = JSON.parse(r.out.trim()); } catch { /* not json */ }
    const text = (j.response || '').trim();
    row = { model: 'gemini-3.8-flash-low', text, exit: r.code, denied: (j.denied_actions || []).map(d => d.action), secs: r.secs, error: r.code === 0 && text ? null : (r.err || r.out).slice(-300) };
    fs.appendFileSync('/var/log/sourcelibrary/agy-calls.jsonl', JSON.stringify({ ts: new Date().toISOString(), job: 'paddle-qa3-6388', model: 'gemini-3.8-flash-low', kind: `ocr-ctx${K}`, seconds: Math.round(r.secs * 10) / 10, ok: !row.error, error_class: row.error ? 'error' : null }) + '\n');
  }
  fs.rmSync(ws, { recursive: true, force: true });
  const full = { engine: ENGINE, k: K, group: gi, uids: g, route: ENGINE === 'opus' ? 'claude-cli' : 'cli', date: new Date().toISOString(), ...row };
  fs.appendFileSync(OUT, JSON.stringify(full) + '\n');
  console.log(ENGINE, K, gi, full.error ? 'ERR ' + full.error.slice(0, 120) : `${full.text.length} chars`, Math.round(full.secs) + 's');
}

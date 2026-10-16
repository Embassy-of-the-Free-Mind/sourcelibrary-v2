#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/opus.mjs (claude -p --model opus, one page per call, Read-only tool
// gate, env scrubbed to the subscription; the spawn line is copied). It does not fit a 4,379-page detached run: it
// wants images on disk up front, keeps no per-page outcome, stops at the first limit message and never checks the
// reply's shape. scripts/batch/cli-ocr.mjs is the production CLI OCR writer; it does not fit because it writes to
// Mongo and takes no draft. The chatter guard is scripts/lib/cli-chatter.mjs (ocrReadProblem), reused.
//
// #6561 batch, step 2: Opus correct over pages.jsonl. Files only, NOTHING is written to production.
//
// Usage (cwd = scratch dir holding pages.jsonl + prompt.json from prep.mjs):
//   node run.mjs [--limit=N] [--par=2] [--max-weekly=85] [--run=NAME]
// Checkpoint: out.jsonl, one row per attempt {page_id, book_id, page_number, outcome, corrected_sha, text, …}.
//   outcome 'ok' = a closed sentinel reply that passed the guard. A page is retried (other outcomes) up to 3 times.
// Ends by writing runner.done (JSON summary) when no page is left to try; a `runner.stop` file stops it cleanly.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { ocrReadProblem } from '../../../lib/cli-chatter.mjs';
import { correctPrompt, sha } from './prompt.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const LIMIT = Number(ARG('--limit', Infinity)), PAR = Number(ARG('--par', 2)), MAX_WEEKLY = Number(ARG('--max-weekly', 85));
// --run names the run in every out.jsonl row (default: the table batch; #6561 item 1 runs it as opus-correct-6561-stale).
const MAX_TRIES = 3, OUT = 'out.jsonl', RUN = ARG('--run', 'opus-correct-6561-tables');
// cron's PATH has no ~/.local/bin
const CLAUDE = process.env.CLAUDE_BIN || (fs.existsSync('/root/.local/bin/claude') ? '/root/.local/bin/claude' : 'claude');
let CLI_VERSION = null; try { CLI_VERSION = execFileSync(CLAUDE, ['--version'], { encoding: 'utf8', timeout: 30000 }).trim(); } catch { /* recorded as null */ }
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P = JSON.parse(fs.readFileSync('prompt.json', 'utf8'));
const pages = readJsonl('pages.jsonl');
const tries = new Map(), ok = new Set();
// A limit says nothing about the page: not counted as a try.
const counts = (r) => r.outcome !== 'limit';
for (const r of readJsonl(OUT)) { if (r.outcome === 'ok') ok.add(r.page_id); else if (counts(r)) tries.set(r.page_id, (tries.get(r.page_id) || 0) + 1); }
const todo = pages.filter((p) => !ok.has(p.pid) && (tries.get(p.pid) || 0) < MAX_TRIES).slice(0, LIMIT);
log(`${pages.length} pages; ok ${ok.size}; to run ${todo.length}; par ${PAR}`);

function env() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

/** This box's weekly subscription use, from the job wrapper's meter; null when it cannot be read. */
function weeklyPct() {
  try { const m = execFileSync('/root/bin/claude-job.sh', ['where'], { encoding: 'utf8', timeout: 60000 }).match(/weekly_pct=(\d+)/); return m ? Number(m[1]) : null; } catch { return null; }
}

async function fetchImage(url, f) {
  for (let k = 0; k < 3; k++) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(60000) }); const buf = Buffer.from(await res.arrayBuffer()); if (res.ok && buf.length >= 1000) { fs.writeFileSync(f, buf); return { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') }; } } catch { /* retry */ }
    await sleep(5000 * (k + 1));
  }
  return null;
}

/** Split the reply at its sentinels; `outside` is any text before ===LAYOUT=== or after ===END===. */
export function parseReply(raw) {
  const t = String(raw || '').trim();
  const m = t.match(/^([\s\S]*?)===LAYOUT===[ \t]*([^\n]*)\n===TRANSCRIPTION===[ \t]*\n?([\s\S]*?)\n?===END===([\s\S]*)$/);
  if (!m) return { status: /===TRANSCRIPTION===/.test(t) ? 'cut' : 'no_sentinel' };
  return { status: 'ok', layout: m[2].trim(), text: m[3].trim(), outside: (m[1] + m[4]).trim() };
}

function call(pg, ws) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(CLAUDE, ['-p', correctPrompt(P, pg.paddle), '--model', 'opus', '--output-format', 'json', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Agent,Task', '--max-turns', '4'], { cwd: ws, env: env() });
    let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), 600000);
    p.on('error', (e) => { err += String(e); });
    p.on('close', (code) => { clearTimeout(timer); let j = {}; try { j = JSON.parse(out); } catch { /* not json */ }
      resolve({ code, j, secs: (Date.now() - t0) / 1000, tail: (err || out).slice(-300) }); });
  });
}

async function one(pg) {
  const ws = path.join(process.cwd(), 'ws', pg.pid); fs.mkdirSync(ws, { recursive: true });
  const row = { page_id: pg.pid, book_id: pg.bid, page_number: pg.pn, run: RUN, at: new Date().toISOString(), paddle_sha: pg.paddle_sha };
  try {
    const img = await fetchImage(pg.image_url, path.join(ws, 'page.jpg'));
    if (!img) return { ...row, outcome: 'image_fail' };
    const { code, j, secs, tail } = await call(pg, ws);
    Object.assign(row, { secs: Math.round(secs * 10) / 10, model: Object.keys(j.modelUsage || {}).join(',') || null, num_turns: j.num_turns ?? null, api_equiv_usd: j.total_cost_usd ?? null, image_bytes: img.bytes, image_sha256: img.sha256, cli_version: CLI_VERSION });
    const raw = j.result || '';
    if (code !== 0 || j.is_error) return { ...row, outcome: /usage limit|rate limit|quota|limit reached|overloaded/i.test(tail + raw) ? 'limit' : 'error', error: tail, raw: raw.slice(0, 2000) };
    // The reply must come from Opus and from a call that opened the image (the Read turn + the answer turn).
    // Opus 5.x, the arm the experiment measured: a stale CLI resolves `opus` to Opus 4.5 (main's ~/.local/bin/claude
    // 2.1.31 did, 2026-10-15), so a bare /opus/ is not enough. Set CLAUDE_BIN to the current CLI on such a box.
    if (!/opus-5/.test(row.model || '')) return { ...row, outcome: 'wrong_model', raw };
    if ((j.num_turns ?? 0) < 2) return { ...row, outcome: 'image_not_opened', raw };
    const r = parseReply(raw);
    if (r.status !== 'ok') return { ...row, outcome: r.status, raw };
    if (r.outside) return { ...row, outcome: 'chatter', chatter: 'text outside the sentinels', raw };
    // 'duplicated reply' is the guard's test for a resent answer; a regular table trips it honestly, so on these
    // pages it is recorded for the reviewer (flags) and not refused.
    const problem = ocrReadProblem(r.text);
    if (problem && problem !== 'duplicated reply') return { ...row, outcome: 'chatter', chatter: problem, raw };
    return { ...row, outcome: 'ok', layout: r.layout, corrected_sha: sha(r.text), chars: [...r.text].length, flags: problem ? [problem] : [], text: r.text };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

let i = 0, n = 0, stop = false, limitHits = 0;
async function gate() {
  // one worker at a time checks the meter, every 20 pages
  for (;;) {
    if (fs.existsSync('runner.stop')) { stop = true; return; }
    const w = weeklyPct();
    if (w === null || w <= MAX_WEEKLY) return;
    log(`weekly_pct ${w} > ${MAX_WEEKLY}: paused 30 min`);
    await sleep(30 * 60000);
  }
}
await gate();
await Promise.all(Array.from({ length: PAR }, async (_, k) => {
  await sleep(k * 3000);
  while (i < todo.length && !stop) {
    const pg = todo[i++];
    if (++n % 20 === 0) await gate();
    if (stop) break;
    const row = await one(pg);
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    log(pg.pid, row.outcome, row.chars ?? '', row.secs ?? '', row.chatter || (row.error || '').slice(0, 120));
    if (row.outcome === 'ok') ok.add(pg.pid);
    else if (row.outcome === 'limit') { limitHits++; log('limit: sleeping 30 min'); await sleep(30 * 60000); todo.push(pg); }
    else { tries.set(pg.pid, (tries.get(pg.pid) || 0) + 1); if (tries.get(pg.pid) < MAX_TRIES) todo.push(pg); }
  }
}));
const left = pages.filter((p) => !ok.has(p.pid) && (tries.get(p.pid) || 0) < MAX_TRIES).length;
const summary = { run: RUN, pages: pages.length, ok: ok.size, gave_up: pages.filter((p) => !ok.has(p.pid) && (tries.get(p.pid) || 0) >= MAX_TRIES).length, left, limit_hits: limitHits, calls: readJsonl(OUT).filter((r) => r.secs != null).length, at: new Date().toISOString() };
log('END', JSON.stringify(summary));
if (!stop && left === 0 && LIMIT === Infinity) fs.writeFileSync('runner.done', JSON.stringify(summary, null, 1));

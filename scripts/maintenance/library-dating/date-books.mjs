#!/usr/bin/env node
/**
 * Date exported books on a subscription CLI (#6721), $0: every row of <in.jsonl> (export-books.mjs) gets a work and an
 * edition date with a basis each (scripts/lib/date-works.mjs). Appends to <out.jsonl>; resumes by book_id; a quota or
 * usage-limit reply STOPS the run with exit 3 so a wrapper can sleep and resume (run-library-dating.sh). Nothing is
 * written to Mongo.
 *
 * Engines: `agy` (gatedTextCall: plan mode, tool gate, Gemini or the agy-hosted models) and `claude` (a sealed
 * `claude -p`: no tools, no MCP, no settings, no session, ANTHROPIC_* stripped so it can only bill the subscription).
 * `--batch N` puts N books in one call (buildBatchPrompt); `--batch 1` is one book per call (buildPrompt).
 *
 * PRIOR ART: scripts/analysis/experience-map/classify/date-works.mjs (#6652) — this is that runner with the prompt and
 * parsing moved to scripts/lib/date-works.mjs; it adds batching, the claude engine, --shard, an unparsed log and the
 * exit code. The sealed claude -p call follows scripts/batch/ocr-convergence/judge-6694.mjs (claudeEnv()).
 *
 *   node scripts/maintenance/library-dating/date-books.mjs <in.jsonl> <out.jsonl> [--engine agy|claude]
 *     [--model gemini-3.8-flash-low|haiku|sonnet] [--batch 15] [--conc 4] [--max N] [--shard i/n] [--per-hour 600]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { gatedTextCall } from '../../lib/agy-cli.mjs';
import { buildPrompt, buildBatchPrompt, parseReply, parseBatchReply, PROMPT_VERSION } from '../../lib/date-works.mjs';

const [IN, OUT] = process.argv.slice(2, 4);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ENGINE = arg('--engine', 'agy'); const MODEL = arg('--model', ENGINE === 'claude' ? 'haiku' : 'gemini-3.8-flash-low');
const BATCH = +arg('--batch', 15); const CONC = +arg('--conc', 4); const MAX = +arg('--max', 0); const PER_HOUR = +arg('--per-hour', 0);
const [SH, NSH] = (arg('--shard', '0/1')).split('/').map(Number);
if (!IN || !OUT) { console.error('usage: date-books.mjs <in.jsonl> <out.jsonl> [--engine agy|claude] [--model m] [--batch n] [--conc n] [--max n] [--shard i/n]'); process.exit(2); }
const BAD = OUT.replace(/\.jsonl$/, '') + '.unparsed.jsonl';
const CALLS = OUT.replace(/\.jsonl$/, '') + '.calls.jsonl';

const ids = (f) => { const s = new Set(); if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l) try { s.add(JSON.parse(l).book_id); } catch { /* torn */ } return s; };
const done = ids(OUT);
// a book whose reply failed to parse twice is not retried
const badCount = new Map(); if (fs.existsSync(BAD)) for (const l of fs.readFileSync(BAD, 'utf8').split('\n')) if (l) try { const id = JSON.parse(l).book_id; badCount.set(id, (badCount.get(id) || 0) + 1); } catch { /* torn */ }
const hash = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let todo = rows.filter((r) => !done.has(r.book_id) && (badCount.get(r.book_id) || 0) < 2 && hash(r.book_id) % NSH === SH);
if (MAX) todo = todo.slice(0, MAX);
const groups = []; for (let k = 0; k < todo.length; k += BATCH) groups.push(todo.slice(k, k + BATCH));
console.log(`${new Date().toISOString()} ${rows.length} books, ${done.size} dated, ${todo.length} to date in ${groups.length} calls: ${ENGINE}/${MODEL} batch ${BATCH} (shard ${SH}/${NSH}, ${PROMPT_VERSION})`);

const CLAUDE_LIMIT = /usage limit|limit reached|rate limit|429|overloaded|Please run \/login|Not logged in/i;
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function claudeCall(prompt) {
  return new Promise((resolve) => {
    const t0 = Date.now(); const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'date-claude-'));
    const child = spawn('claude', ['-p', prompt, '--model', MODEL, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', '', '--output-format', 'json'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 600_000);
    child.on('close', (code) => {
      clearTimeout(timer); fs.rmSync(cwd, { recursive: true, force: true });
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const quota = (j.is_error || code !== 0) && CLAUDE_LIMIT.test(text + err + out.slice(0, 500));
      resolve({ answer: text.replace(/^[\s\S]*?<<<BEGIN>>>/, '').replace(/<<<END>>>[\s\S]*$/, ''), cls: quota ? 'quota' : code !== 0 || j.is_error ? `exit_${code}` : !text ? 'empty' : null,
        err: (err || text).slice(-200), secs: (Date.now() - t0) / 1000, usage: j.usage ? { in: j.usage.input_tokens + (j.usage.cache_read_input_tokens || 0) + (j.usage.cache_creation_input_tokens || 0), out: j.usage.output_tokens } : null });
    });
  });
}
const call = (prompt) => (ENGINE === 'claude' ? claudeCall(prompt) : gatedTextCall(prompt, { model: MODEL, task: 'translate', attempts: 2 }));

// pacing: at most PER_HOUR calls an hour from this process (the agy quota is shared by every job on the box)
const starts = [];
async function pace() {
  if (!PER_HOUR) return;
  for (;;) { const now = Date.now(); while (starts.length && starts[0] < now - 3_600_000) starts.shift(); if (starts.length < PER_HOUR) { starts.push(now); return; } await new Promise((r) => setTimeout(r, 5_000)); }
}

let g = 0, ok = 0, bad = 0, calls = 0, stop = false;
async function worker() {
  while (!stop && g < groups.length) {
    const books = groups[g++];
    await pace();
    const prompt = BATCH === 1 ? buildPrompt(books[0]) : buildBatchPrompt(books);
    const res = await call(prompt); calls++;
    fs.appendFileSync(CALLS, JSON.stringify({ at: new Date().toISOString(), engine: ENGINE, model: MODEL, n: books.length, cls: res.cls, secs: res.secs, usage: res.usage || null }) + '\n');
    // a dated reply can hold the year 429, which agy-cli's short-reply quota test reads as an HTTP 429 (2026-10-12
    // incident class): a reply that parses is an answer, never a quota stop
    if (res.cls === 'quota' && res.answer && (BATCH === 1 ? parseReply(res.answer, books[0]) : parseBatchReply(res.answer, books).size)) res.cls = null;
    if (res.cls === 'quota') { stop = true; console.error(`QUOTA — stopping (${String(res.err).slice(-160)})`); break; }
    const parsed = res.cls ? new Map() : BATCH === 1 ? new Map(parseReply(res.answer, books[0]) ? [[0, parseReply(res.answer, books[0])]] : []) : parseBatchReply(res.answer, books);
    books.forEach((b, i) => {
      const r = parsed.get(i);
      if (!r) { bad++; fs.appendFileSync(BAD, JSON.stringify({ book_id: b.book_id, cls: res.cls, at: new Date().toISOString(), answer: String(res.answer || '').slice(0, 200) }) + '\n'); return; }
      fs.appendFileSync(OUT, JSON.stringify({ book_id: b.book_id, engine: ENGINE, model: MODEL, batch: books.length, prompt_version: PROMPT_VERSION, dated_at: new Date().toISOString(),
        catalogue: b.published ?? null, ...r }) + '\n');
      ok++;
    });
    if (calls % 20 === 0) console.log(`  ${new Date().toISOString()} ${calls}/${groups.length} calls, ${ok} dated, ${bad} unparsed`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`${new Date().toISOString()} done calls=${calls} dated=${ok} unparsed=${bad}${stop ? ' (stopped on quota)' : ''}`);
process.exit(stop ? 3 : 0);
